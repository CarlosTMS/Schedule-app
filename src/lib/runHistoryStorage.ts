/**
 * runHistoryStorage.ts
 *
 * Dedicated persistence module for versioned run history (V3).
 * Projects contain multiple immutable Versions.
 */

import type { StudentRecord } from './excelParser';
import type { AllocationResult } from './allocationEngine';
import type { Assumptions } from '../components/Configurator';
import type { AllocationRule } from '../components/RuleBuilder';
import type { DistributionTarget } from '../components/Randomizer';
import type { SmeAssignments, SmeConfirmationState } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';

// ─── Schema version ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 3;
const KEY_PROJECTS = 'scheduler_projects_v3';
const KEY_VERSIONS = 'scheduler_versions_v3';
const KEY_ACTIVE_PROJECT_ID = 'scheduler_active_project_id_v3';
const KEY_DRAFT = 'scheduler_draft_v3';

const KEY_V2_RUNS = 'scheduler_runs_v2';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunSnapshot {
    records: StudentRecord[];
    assumptions: Assumptions;
    rules: AllocationRule[];
    fsDistributions: DistributionTarget[];
    aeDistributions: DistributionTarget[];
    startHour: number;
    endHour: number;
    result: AllocationResult;
    sessionTimeOverrides: Record<string, number>;
    sessionInstanceTimeOverrides: Record<string, number>;
    manualSmeAssignments: SmeAssignments;
    smeConfirmationState: SmeConfirmationState;
    manualFacultyAssignments: FacultyAssignments;
}

export interface RunProject {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    activeVersionId: string | null;
    revision?: number;
}


export interface RunVersion {
    id: string;
    projectId: string;
    versionNumber: number;
    label?: string;
    parentVersionId?: string | null;
    createdAt: string;
    snapshot: RunSnapshot;
}

/** Local volatile draft for the current working session */
export interface RunDraft {
    projectId: string | null;
    snapshot: RunSnapshot;
    updatedAt: string;
}

// ─── ID generator ─────────────────────────────────────────────────────────────

export const newId = (): string =>
    Date.now().toString(36) + Math.random().toString(36).substring(2);

// ─── Storage Operations ───────────────────────────────────────────────────────

export const readProjects = (): RunProject[] => {
    try {
        const raw = localStorage.getItem(KEY_PROJECTS);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

export const persistProjects = (projects: RunProject[]): void => {
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(projects));
};

export const readVersions = (projectId?: string): RunVersion[] => {
    try {
        const raw = localStorage.getItem(KEY_VERSIONS);
        const all: RunVersion[] = raw ? JSON.parse(raw) : [];
        if (!projectId) return all;
        return all.filter(v => v.projectId === projectId).sort((a, b) => b.versionNumber - a.versionNumber);
    } catch { return []; }
};

export const persistVersions = (versions: RunVersion[]): void => {
    localStorage.setItem(KEY_VERSIONS, JSON.stringify(versions));
};

export const readActiveProjectId = (): string | null => localStorage.getItem(KEY_ACTIVE_PROJECT_ID);
export const persistActiveProjectId = (id: string | null): void => {
    if (id) localStorage.setItem(KEY_ACTIVE_PROJECT_ID, id);
    else localStorage.removeItem(KEY_ACTIVE_PROJECT_ID);
};

export const readDraft = (): RunDraft | null => {
    try {
        const raw = localStorage.getItem(KEY_DRAFT);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

export const persistDraft = (draft: RunDraft | null): void => {
    if (draft) localStorage.setItem(KEY_DRAFT, JSON.stringify(draft));
    else localStorage.removeItem(KEY_DRAFT);
};

// ─── Migration ────────────────────────────────────────────────────────────────

interface StoredRunV2 {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    records: StudentRecord[];
    assumptions: Assumptions;
    rules: AllocationRule[];
    fsDistributions: DistributionTarget[];
    aeDistributions: DistributionTarget[];
    startHour: number;
    endHour: number;
    result: AllocationResult;
    sessionTimeOverrides?: Record<string, number>;
    sessionInstanceTimeOverrides?: Record<string, number>;
    manualSmeAssignments?: SmeAssignments;
    smeConfirmationState?: SmeConfirmationState;
    manualFacultyAssignments?: FacultyAssignments;
}

export const migrateToV3 = (): void => {
    if (localStorage.getItem(KEY_PROJECTS)) return; // Already migrated or fresh

    const v2Raw = localStorage.getItem(KEY_V2_RUNS);
    if (!v2Raw) return;

    try {
        const v2Runs = JSON.parse(v2Raw) as StoredRunV2[];
        const projects: RunProject[] = [];
        const versions: RunVersion[] = [];

        for (const r of v2Runs) {
            const project: RunProject = {
                id: r.id,
                name: r.name,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                activeVersionId: `v1_${r.id}`,
                revision: 1
            };
            const version: RunVersion = {
                id: `v1_${r.id}`,
                projectId: r.id,
                versionNumber: 1,
                label: 'Initial Version',
                parentVersionId: null,
                createdAt: r.updatedAt,
                snapshot: {
                    records: r.records,
                    assumptions: r.assumptions,
                    rules: r.rules,
                    fsDistributions: r.fsDistributions,
                    aeDistributions: r.aeDistributions,
                    startHour: r.startHour,
                    endHour: r.endHour,
                    result: r.result,
                    sessionTimeOverrides: r.sessionTimeOverrides || {},
                    sessionInstanceTimeOverrides: r.sessionInstanceTimeOverrides || {},
                    manualSmeAssignments: r.manualSmeAssignments || {},
                    smeConfirmationState: r.smeConfirmationState || {},
                    manualFacultyAssignments: r.manualFacultyAssignments || {}
                }
            };
            projects.push(project);
            versions.push(version);
        }


        persistProjects(projects);
        persistVersions(versions);
        console.info(`[runHistoryStorage] Migrated ${projects.length} runs to V3 projects.`);
    } catch (e) {
        console.warn('[runHistoryStorage] V3 migration failed:', e);
    }
};
