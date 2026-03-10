/**
 * runHistoryStorage.ts
 *
 * Dedicated persistence module for run history.
 * Uses a versioned localStorage schema to allow future migrations.
 *
 * Keys:
 *   scheduler_runs_v2         – JSON array of StoredRunV2
 *   scheduler_last_run_id_v2  – id of the last active run
 *
 * Legacy keys (read-only migration):
 *   scheduler_history         – old SavedSimulation[] format from v1
 */

import type { StudentRecord } from './excelParser';
import type { AllocationResult } from './allocationEngine';
import type { Assumptions } from '../components/Configurator';
import type { AllocationRule } from '../components/RuleBuilder';
import type { DistributionTarget } from '../components/Randomizer';
import type { SmeAssignments } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';

// ─── Schema version ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2;
export const KEY_RUNS = 'scheduler_runs_v2';
const KEY_LAST_ID = 'scheduler_last_run_id_v2';
const KEY_LEGACY = 'scheduler_history';
const MAX_HISTORY = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredRunV2 {
    /** schema version – always 2 */
    version: typeof SCHEMA_VERSION;
    id: string;
    name: string;
    createdAt: string;   // ISO‑8601
    updatedAt: string;   // ISO‑8601

    // Inputs
    records: StudentRecord[];
    assumptions: Assumptions;
    rules: AllocationRule[];
    fsDistributions: DistributionTarget[];
    aeDistributions: DistributionTarget[];
    startHour: number;
    endHour: number;

    // Output
    result: AllocationResult;

    // Editable dashboard state
    sessionTimeOverrides: Record<string, number>;
    manualSmeAssignments: SmeAssignments;
    manualFacultyAssignments: FacultyAssignments;
}

export interface RunHistoryV2 {
    runs: StoredRunV2[];
}

// ─── ID generator ─────────────────────────────────────────────────────────────

export const newId = (): string =>
    Date.now().toString(36) + Math.random().toString(36).substring(2);

// ─── Low-level read / write ───────────────────────────────────────────────────

/** Returns true only if `r` has the structural fields that downstream code accesses. */
const isStructurallyValid = (r: unknown): r is StoredRunV2 => {
    if (!r || typeof r !== 'object') return false;
    const run = r as Record<string, unknown>;
    return (
        typeof run.id === 'string' && run.id.length > 0 &&
        (run.version as number) === SCHEMA_VERSION &&
        typeof run.name === 'string' &&
        typeof run.createdAt === 'string' &&
        Array.isArray(run.records) &&
        run.result !== null && typeof run.result === 'object' &&
        (run.result as Record<string, unknown>).metrics !== null &&
        typeof (run.result as Record<string, unknown>).metrics === 'object'
    );
};

/** Reads the full run list from localStorage, returning [] on any error. */
export const readRuns = (): StoredRunV2[] => {
    try {
        const raw = localStorage.getItem(KEY_RUNS);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return (parsed as unknown[]).filter(isStructurallyValid);
    } catch {
        return [];
    }
};

export const persistRuns = (runs: StoredRunV2[]): void => {
    try {
        localStorage.setItem(KEY_RUNS, JSON.stringify(runs));
    } catch (e) {
        console.warn('[runHistoryStorage] Could not write to localStorage:', e);
    }
};

export const readLastRunId = (): string | null => {
    try {
        return localStorage.getItem(KEY_LAST_ID);
    } catch {
        return null;
    }
};

export const persistLastRunId = (id: string | null): void => {
    try {
        if (id === null) localStorage.removeItem(KEY_LAST_ID);
        else localStorage.setItem(KEY_LAST_ID, id);
    } catch { /* ignore */ }
};

// ─── Migration from V1 ────────────────────────────────────────────────────────

/** Minimal type guard for legacy V1 simulation objects read from JSON. */
type LegacySim = {
    id: string;
    name?: string;
    timestamp?: string;
    records: unknown[];
    result: unknown;
    assumptions?: unknown;
    rules?: unknown[];
    fsDistributions?: unknown[];
    aeDistributions?: unknown[];
    startHour?: number;
    endHour?: number;
};

const isLegacySim = (v: unknown): v is LegacySim =>
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    Array.isArray((v as Record<string, unknown>).records) &&
    (v as Record<string, unknown>).result !== undefined;

/**
 * Reads the legacy `scheduler_history` key once and migrates valid entries to V2.
 * No-op if KEY_RUNS already has data (migration already done).
 * Does NOT delete the legacy key (non-destructive).
 */
export const migrateFromV1 = (): void => {
    // Skip if V2 data already exists
    if (localStorage.getItem(KEY_RUNS) !== null) return;

    try {
        const raw = localStorage.getItem(KEY_LEGACY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return;

        const migrated: StoredRunV2[] = (parsed as unknown[])
            .filter(isLegacySim)
            .map((s): StoredRunV2 => ({
                version: SCHEMA_VERSION,
                id: s.id,
                name: s.name ?? `Migrated run ${new Date(s.timestamp ?? Date.now()).toLocaleDateString()}`,
                createdAt: s.timestamp ?? new Date().toISOString(),
                updatedAt: s.timestamp ?? new Date().toISOString(),
                records: s.records as StoredRunV2['records'],
                assumptions: (s.assumptions ?? {}) as Assumptions,
                rules: (s.rules ?? []) as AllocationRule[],
                fsDistributions: (s.fsDistributions ?? []) as DistributionTarget[],
                aeDistributions: (s.aeDistributions ?? []) as DistributionTarget[],
                startHour: s.startHour ?? 8,
                endHour: s.endHour ?? 18,
                result: s.result as AllocationResult,
                sessionTimeOverrides: {},
                manualSmeAssignments: {},
                manualFacultyAssignments: {},
            }));

        if (migrated.length > 0) {
            persistRuns(migrated.slice(0, MAX_HISTORY));
            console.info(`[runHistoryStorage] Migrated ${migrated.length} run(s) from v1.`);
        }
    } catch (e) {
        console.warn('[runHistoryStorage] V1 migration failed (non-critical):', e);
    }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the last active run, or null if none / corrupt.
 * The returned object is a copy; mutations won't affect stored state.
 */
export const loadLastRun = (): StoredRunV2 | null => {
    const lastId = readLastRunId();
    if (!lastId) return null;
    const runs = readRuns();
    return runs.find(r => r.id === lastId) ?? null;
};

/**
 * Creates a new run entry from a successful allocation result and persists it.
 * Enforces the MAX_HISTORY cap by removing the oldest non-active entry first.
 * Returns the newly created StoredRunV2.
 */
export const createRun = (
    name: string,
    records: StudentRecord[],
    assumptions: Assumptions,
    rules: AllocationRule[],
    fsDistributions: DistributionTarget[],
    aeDistributions: DistributionTarget[],
    startHour: number,
    endHour: number,
    result: AllocationResult,
): StoredRunV2 => {
    const now = new Date().toISOString();
    const newRun: StoredRunV2 = {
        version: SCHEMA_VERSION,
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

    let runs = readRuns();

    // Enforce cap: remove oldest non-active entries until < MAX_HISTORY
    if (runs.length >= MAX_HISTORY) {
        const lastId = readLastRunId();
        // Sort so oldest are first; keep active run safe
        const trimCandidates = runs
            .filter(r => r.id !== lastId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        while (runs.length >= MAX_HISTORY && trimCandidates.length > 0) {
            const toRemove = trimCandidates.shift()!;
            runs = runs.filter(r => r.id !== toRemove.id);
        }
    }

    runs = [newRun, ...runs];
    persistRuns(runs);
    persistLastRunId(newRun.id);
    return newRun;
};

/**
 * Partially updates an existing run (for dashboard editable state).
 * Only touches updatedAt + the three editable fields.
 */
export const patchRunDashboardState = (
    id: string,
    patch: {
        sessionTimeOverrides?: Record<string, number>;
        manualSmeAssignments?: SmeAssignments;
        manualFacultyAssignments?: FacultyAssignments;
    }
): void => {
    const runs = readRuns();
    const idx = runs.findIndex(r => r.id === id);
    if (idx === -1) return;
    runs[idx] = {
        ...runs[idx],
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    persistRuns(runs);
};

/**
 * Partially updates an existing run's core configuration fields.
 * Use this to autosave assumptions/rules/distributions/hours after the user
 * tweaks config without re-running the allocation engine.
 * Always updates `updatedAt`.
 */
export const patchRunCoreState = (
    id: string,
    patch: Partial<Pick<StoredRunV2,
        'assumptions' | 'rules' | 'fsDistributions' | 'aeDistributions' |
        'startHour' | 'endHour' | 'records' | 'result'
    >>
): void => {
    const runs = readRuns();
    const idx = runs.findIndex(r => r.id === id);
    if (idx === -1) return;
    runs[idx] = {
        ...runs[idx],
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    persistRuns(runs);
};

/** Rename an existing run. Returns false if not found. */
export const renameRun = (id: string, newName: string): boolean => {
    const runs = readRuns();
    const idx = runs.findIndex(r => r.id === id);
    if (idx === -1) return false;
    runs[idx] = { ...runs[idx], name: newName, updatedAt: new Date().toISOString() };
    persistRuns(runs);
    return true;
};

/** Delete a run by id. If it was the last active run, clears that pointer. */
export const deleteRun = (id: string): void => {
    const runs = readRuns().filter(r => r.id !== id);
    persistRuns(runs);
    if (readLastRunId() === id) {
        // Promote the next most-recent run as last, or clear
        persistLastRunId(runs[0]?.id ?? null);
    }
};

/** Mark a run as the current active run (called on restore). */
export const setActiveRun = (id: string): void => {
    persistLastRunId(id);
};


