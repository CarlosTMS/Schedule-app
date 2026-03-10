/**
 * src/lib/runHistoryRepository.ts
 *
 * Unified data layer for run history.
 * Implements "Runtime-first + Local Mirror" strategy.
 */

import {
    type StoredRunV2, readRuns as readLocalRuns, persistRuns as persistLocalRuns,
    readLastRunId as readLocalActiveId, persistLastRunId as persistLocalActiveId,
    migrateFromV1, SCHEMA_VERSION, newId
} from './runHistoryStorage';
export type { StoredRunV2 };
import type { StudentRecord } from './excelParser';
import type { AllocationResult } from './allocationEngine';
import type { Assumptions } from '../components/Configurator';
import type { AllocationRule } from '../components/RuleBuilder';
import type { DistributionTarget } from '../components/Randomizer';
import type { SmeAssignments } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'saved-local' | 'error';

const API_BASE = '/api/runtime';
const MAX_HISTORY = 20;

/**
 * Merges two lists of runs, keeping the most recent version (by updatedAt) of each ID.
 */
export const mergeRuns = (local: StoredRunV2[], remote: StoredRunV2[]): StoredRunV2[] => {
    const map = new Map<string, StoredRunV2>();

    // Add local ones first
    local.forEach(r => map.set(r.id, r));

    // Add remote ones, overwriting if remote is newer
    remote.forEach(remoteRun => {
        const existing = map.get(remoteRun.id);
        if (!existing || new Date(remoteRun.updatedAt) > new Date(existing.updatedAt)) {
            map.set(remoteRun.id, remoteRun);
        }
    });

    return Array.from(map.values())
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_HISTORY);
};

class RunHistoryRepository {
    public runtimeAvailable = true;

    constructor() {
        migrateFromV1();
    }

    async getSyncData(): Promise<{ runs: StoredRunV2[], activeId: string | null, status: SyncStatus }> {
        try {
            const [remoteRunsRes, remoteActiveRes] = await Promise.all([
                fetch(`${API_BASE}/runs`).then(r => r.json()),
                fetch(`${API_BASE}/active`).then(r => r.json())
            ]);

            if (remoteRunsRes.ok) {
                this.runtimeAvailable = true;
                const local = readLocalRuns();

                // [P1] Re-hydration: if remote is empty but we have local, push to remote
                if (remoteRunsRes.data.length === 0 && local.length > 0) {
                    console.info('[Repository] Runtime empty, re-hydrating from local storage...');
                    // Push all local runs to remote. Note: might exceed concurrent request limits if many, 
                    // but we only have 20. Let's do them sequentially or in small batch.
                    for (const lr of local) {
                        await fetch(`${API_BASE}/runs`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(lr)
                        });
                    }
                    if (readLocalActiveId()) {
                        await fetch(`${API_BASE}/runs/${readLocalActiveId()}/activate`, { method: 'POST' });
                    }
                }

                const merged = mergeRuns(local, remoteRunsRes.data);

                // Mirror merge result back to local
                persistLocalRuns(merged);

                return {
                    runs: merged,
                    activeId: remoteActiveRes.data || readLocalActiveId(),
                    status: 'saved'
                };
            }
        } catch (e) {
            console.warn('[Repository] Runtime unavailable, falling back to local:', e);
        }

        this.runtimeAvailable = false;
        return {
            runs: readLocalRuns(),
            activeId: readLocalActiveId(),
            status: 'saved-local'
        };
    }

    async createRun(
        name: string,
        records: StudentRecord[],
        assumptions: Assumptions,
        rules: AllocationRule[],
        fsDistributions: DistributionTarget[],
        aeDistributions: DistributionTarget[],
        startHour: number,
        endHour: number,
        result: AllocationResult,
    ): Promise<{ run: StoredRunV2, status: SyncStatus }> {
        const now = new Date().toISOString();
        const run: StoredRunV2 = {
            version: SCHEMA_VERSION as 2,
            id: newId(),
            name,
            createdAt: now,
            updatedAt: now,
            records,
            assumptions,
            rules,
            fsDistributions,
            aeDistributions,
            startHour,
            endHour,
            result,
            sessionTimeOverrides: {},
            manualSmeAssignments: {},
            manualFacultyAssignments: {},
        };

        let status: SyncStatus = 'saved';

        // Remote
        try {
            const res = await fetch(`${API_BASE}/runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(run)
            }).then(r => r.json());

            if (res.ok) {
                this.runtimeAvailable = true;
                // Also activate on remote
                await fetch(`${API_BASE}/runs/${run.id}/activate`, { method: 'POST' });
            } else {
                throw new Error(res.error);
            }
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        // Always mirror to local
        const local = readLocalRuns();
        const updatedLocal = [run, ...local.filter(r => r.id !== run.id)].slice(0, MAX_HISTORY);
        persistLocalRuns(updatedLocal);
        persistLocalActiveId(run.id);

        return { run, status };
    }

    async patchCore(id: string, patch: Partial<Pick<StoredRunV2, 'assumptions' | 'rules' | 'fsDistributions' | 'aeDistributions' | 'startHour' | 'endHour' | 'records' | 'result'>>): Promise<SyncStatus> {
        let status: SyncStatus = 'saved';
        try {
            const res = await fetch(`${API_BASE}/runs/${id}/core`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            }).then(r => r.json());

            if (!res.ok) throw new Error(res.error);
            this.runtimeAvailable = true;
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        // Mirror to local
        const local = readLocalRuns();
        const idx = local.findIndex(r => r.id === id);
        if (idx !== -1) {
            local[idx] = { ...local[idx], ...patch, updatedAt: new Date().toISOString() };
            persistLocalRuns(local);
        }
        return status;
    }

    async patchDashboard(id: string, patch: { sessionTimeOverrides?: Record<string, number>, manualSmeAssignments?: SmeAssignments, manualFacultyAssignments?: FacultyAssignments }): Promise<SyncStatus> {
        let status: SyncStatus = 'saved';
        try {
            const res = await fetch(`${API_BASE}/runs/${id}/dashboard`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            }).then(r => r.json());

            if (!res.ok) throw new Error(res.error);
            this.runtimeAvailable = true;
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        const local = readLocalRuns();
        const idx = local.findIndex(r => r.id === id);
        if (idx !== -1) {
            local[idx] = { ...local[idx], ...patch, updatedAt: new Date().toISOString() };
            persistLocalRuns(local);
        }
        return status;
    }

    async renameRun(id: string, name: string): Promise<SyncStatus> {
        let status: SyncStatus = 'saved';
        try {
            const res = await fetch(`${API_BASE}/runs/${id}/meta`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            }).then(r => r.json());
            if (!res.ok) throw new Error(res.error);
        } catch {
            status = 'saved-local';
        }

        const local = readLocalRuns();
        const idx = local.findIndex(r => r.id === id);
        if (idx !== -1) {
            local[idx] = { ...local[idx], name, updatedAt: new Date().toISOString() };
            persistLocalRuns(local);
        }
        return status;
    }

    async deleteRun(id: string): Promise<SyncStatus> {
        let status: SyncStatus = 'saved';
        try {
            await fetch(`${API_BASE}/runs/${id}`, { method: 'DELETE' });
        } catch {
            status = 'saved-local';
        }

        const local = readLocalRuns().filter(r => r.id !== id);
        persistLocalRuns(local);
        if (readLocalActiveId() === id) {
            persistLocalActiveId(local[0]?.id ?? null);
        }
        return status;
    }

    async setActiveRun(id: string): Promise<SyncStatus> {
        let status: SyncStatus = 'saved';
        try {
            await fetch(`${API_BASE}/runs/${id}/activate`, { method: 'POST' });
        } catch {
            status = 'saved-local';
        }
        persistLocalActiveId(id);
        return status;
    }
}

export const repository = new RunHistoryRepository();
