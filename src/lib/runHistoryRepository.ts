/**
 * src/lib/runHistoryRepository.ts
 *
 * Unified data layer for Projects and Versions (V3).
 * Implements "Runtime-first + Local Mirror" with explicit versioning.
 */

import {
    type RunProject, type RunVersion, type RunSnapshot,
    readProjects as readLocalProjects, persistProjects as persistLocalProjects,
    readVersions as readLocalVersions, persistVersions as persistLocalVersions,
    readActiveProjectId as readLocalActiveId, persistActiveProjectId as persistLocalActiveId,
    readDraft as readLocalDraft,
    migrateToV3, newId
} from './runHistoryStorage';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'saved-local' | 'error' | 'conflict';


const API_BASE = '/api/runtime';

export interface SyncResult {
    status: SyncStatus;
    error?: string;
    conflictData?: RunProject;
    project?: RunProject;
}

class RunHistoryRepository {
    public runtimeAvailable = true;
    private mutationQueues = new Map<string, Promise<void>>();

    constructor() {
        migrateToV3();
    }

    /**
     * Serializes mutations for a specific ID.
     */
    private async enqueueMutation<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.mutationQueues.get(id) || Promise.resolve();

        const task = (async () => {
            try { await prev; } catch { /* chain even if previous failed */ }
            return await fn();
        })();

        // Map maintenance: remove entry once settles, but only if we are still the latest in flight
        const cleanup = task.then(() => {
            if (this.mutationQueues.get(id) === cleanup) {
                this.mutationQueues.delete(id);
            }
        }, () => {
            if (this.mutationQueues.get(id) === cleanup) {
                this.mutationQueues.delete(id);
            }
        });

        this.mutationQueues.set(id, cleanup);
        return task;
    }


    /**
     * Internal implementation of draft synchronization.
     * Does NOT use the queue directly, allowing for recursion/retries within a single queued task.
     */
    private async _performSyncDraft(projectId: string, snapshot: RunSnapshot, expectedRevision: number, isRetry = false): Promise<SyncResult> {
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draftSnapshot: snapshot, expectedRevision })
            });
            const data = await res.json();

            if (res.status === 409 && !isRetry) {
                console.warn(`[autosave-retry] Self-conflict detected on ${projectId} (Rev: ${expectedRevision}). Fetching latest and retrying...`);
                const { projects } = await this.getSyncData();
                const latest = projects.find(p => p.id === projectId);
                if (latest) {
                    return this._performSyncDraft(projectId, snapshot, latest.revision || 1, true);
                }
            }

            if (res.status === 409) {
                return { status: 'conflict', conflictData: data.current || data.data };
            }

            if (!res.ok) throw new Error(data.error);

            this.runtimeAvailable = true;

            // Update local projects
            if (data.data) {
                const projects = readLocalProjects();
                const idx = projects.findIndex(p => p.id === projectId);
                if (idx !== -1) {
                    projects[idx] = data.data;
                    persistLocalProjects(projects);
                }
            }

            return { status: 'saved', project: data.data };
        } catch (e) {
            console.error('[Repository] _performSyncDraft failed:', e);
            this.runtimeAvailable = false;
            return { status: 'saved-local' };
        }
    }

    /**
     * Synchronizes projects and versions between runtime and local.
     */
    async getSyncData(): Promise<{ projects: RunProject[], activeProjectId: string | null, status: SyncStatus }> {
        try {
            const res = await fetch(`${API_BASE}/projects`);
            if (res.status === 200) {
                const projectsRes = await res.json();
                this.runtimeAvailable = true;
                const localProjects = readLocalProjects();
                const localVersions = readLocalVersions();

                // Re-hydration: if remote is empty, push everything
                if (projectsRes.data.length === 0 && localProjects.length > 0) {
                    console.info('[Repository] Runtime empty, re-hydrating...');
                    await fetch(`${API_BASE}/sync/batch`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projects: localProjects, versions: localVersions })
                    });
                }

                // Simple merge for projects (merging metadata)
                const remoteProjects = projectsRes.data as RunProject[];
                const projectMap = new Map<string, RunProject>();
                localProjects.forEach(p => projectMap.set(p.id, p));
                remoteProjects.forEach(p => {
                    const existing = projectMap.get(p.id);
                    if (!existing || new Date(p.updatedAt) > new Date(existing.updatedAt)) {
                        projectMap.set(p.id, p);
                    }
                });
                const mergedProjects = Array.from(projectMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                persistLocalProjects(mergedProjects);

                return {
                    projects: mergedProjects,
                    activeProjectId: readLocalActiveId(),
                    status: 'saved'
                };
            } else {
                this.runtimeAvailable = false;
            }
        } catch (e) {
            console.warn('[Repository] Runtime unavailable during syncData:', e);
            this.runtimeAvailable = false;
        }

        return {
            projects: readLocalProjects(),
            activeProjectId: readLocalActiveId(),
            status: 'saved-local'
        };
    }

    /**
     * Unified autosave: Syncs the current draft to the server with retry logic.
     */
    async syncDraft(projectId: string, snapshot: RunSnapshot, expectedRevision: number): Promise<SyncResult> {
        return this.enqueueMutation(projectId, () => this._performSyncDraft(projectId, snapshot, expectedRevision));
    }


    /**
     * Creates a new project with an initial version.
     */
    async createProject(name: string, snapshot: RunSnapshot): Promise<{ project: RunProject, version: RunVersion, status: SyncStatus }> {
        const now = new Date().toISOString();
        const projectId = newId();
        const versionId = newId();

        const project: RunProject = {
            id: projectId,
            name,
            createdAt: now,
            updatedAt: now,
            activeVersionId: versionId,
            revision: 1
        };

        const version: RunVersion = {
            id: versionId,
            projectId,
            versionNumber: 1,
            label: 'Initial version',
            createdAt: now,
            snapshot
        };

        let status: SyncStatus = 'saved';

        try {
            // Push project
            const pRes = await fetch(`${API_BASE}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(project)
            });
            // Push version
            const vRes = await fetch(`${API_BASE}/projects/${projectId}/versions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(version)
            });

            if (!pRes.ok || !vRes.ok) throw new Error('Remote save failed');
            this.runtimeAvailable = true;
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        // Persist local
        const projects = [project, ...readLocalProjects()];
        persistLocalProjects(projects);
        const versions = [version, ...readLocalVersions()];
        persistLocalVersions(versions);
        persistLocalActiveId(projectId);

        return { project, version, status };
    }

    /**
     * Saves a new immutable version for an existing project.
     */
    async saveAsNewVersion(projectId: string, snapshot: RunSnapshot, label?: string): Promise<{ version: RunVersion, status: SyncStatus }> {
        const localVersions = readLocalVersions(projectId);
        const nextNum = (localVersions[0]?.versionNumber || 0) + 1;
        const now = new Date().toISOString();
        const versionId = newId();

        const version: RunVersion = {
            id: versionId,
            projectId,
            versionNumber: nextNum,
            label: label || `Version ${nextNum}`,
            parentVersionId: localVersions[0]?.id || null,
            createdAt: now,
            snapshot
        };

        const projects = readLocalProjects();
        const pIdx = projects.findIndex(p => p.id === projectId);
        const currentRev = projects[pIdx]?.revision || 1;

        let status: SyncStatus = 'saved';

        try {
            const vRes = await fetch(`${API_BASE}/projects/${projectId}/versions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(version)
            });
            // Also update project's activeVersionId and increment revision via PATCH
            const pRes = await fetch(`${API_BASE}/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activeVersionId: versionId, updatedAt: now, expectedRevision: currentRev })
            });

            if (!vRes.ok || !pRes.ok) throw new Error('Remote save failed');
            this.runtimeAvailable = true;

            const pData = await pRes.json();
            if (pData.ok && pData.data) {
                projects[pIdx] = pData.data;
                persistLocalProjects(projects);
            }
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        // Update local versions
        const allVersions = [version, ...readLocalVersions()];
        persistLocalVersions(allVersions);

        return { version, status };
    }

    async getVersions(projectId: string): Promise<RunVersion[]> {
        // Optimistically try runtime first, fallback to local on any failure
        try {
            const projRes = await fetch(`${API_BASE}/projects/${projectId}/versions`);
            if (projRes.ok) {
                const res = await projRes.json();
                this.runtimeAvailable = true;
                const remote = res.data as RunVersion[];
                // Merge with local versions to be safe
                const local = readLocalVersions(projectId);
                const map = new Map<string, RunVersion>();
                local.forEach(v => map.set(v.id, v));
                remote.forEach(v => map.set(v.id, v));
                const merged = Array.from(map.values()).sort((a, b) => b.versionNumber - a.versionNumber);
                persistLocalVersions(Array.from(map.values()));
                return merged;
            } else {
                this.runtimeAvailable = false;
            }
        } catch {
            this.runtimeAvailable = false;
        }
        return readLocalVersions(projectId);
    }

    async getVersion(versionId: string): Promise<RunVersion | null> {
        // Check local first as it's a snapshot
        const local = readLocalVersions().find(v => v.id === versionId);
        if (local) return local;

        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`);
            if (res.ok) {
                const data = await res.json();
                this.runtimeAvailable = true;
                return data.data;
            } else {
                this.runtimeAvailable = false;
            }
        } catch {
            this.runtimeAvailable = false;
        }
        return null;
    }

    async getDraft(projectId: string): Promise<RunSnapshot | null> {
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}/draft`);
            if (res.status === 404) {
                this.runtimeAvailable = true;
                const localDraft = readLocalDraft();
                return localDraft?.projectId === projectId ? localDraft.snapshot : null;
            }
            if (res.ok) {
                const data = await res.json();
                this.runtimeAvailable = true;
                return data.data ?? null;
            }
            this.runtimeAvailable = false;
        } catch {
            this.runtimeAvailable = false;
        }

        const localDraft = readLocalDraft();
        return localDraft?.projectId === projectId ? localDraft.snapshot : null;
    }

    async updateVersion(versionId: string, snapshot: RunSnapshot): Promise<{ version: RunVersion | null, project?: RunProject, status: SyncStatus }> {
        let status: SyncStatus = 'saved';
        let updatedVersion: RunVersion | null = null;
        let updatedProject: RunProject | undefined;

        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot })
            });

            if (!res.ok) throw new Error('Remote update failed');

            const data = await res.json();
            updatedVersion = data?.data?.version ?? null;
            updatedProject = data?.data?.project ?? undefined;
            this.runtimeAvailable = true;
        } catch {
            this.runtimeAvailable = false;
            status = 'saved-local';
        }

        const versions = readLocalVersions();
        const versionIdx = versions.findIndex(v => v.id === versionId);
        if (versionIdx !== -1) {
            const baseVersion = versions[versionIdx];
            versions[versionIdx] = {
                ...baseVersion,
                snapshot,
                createdAt: updatedVersion?.createdAt ?? new Date().toISOString(),
            };
            updatedVersion = versions[versionIdx];
            persistLocalVersions(versions);
        }

        if (updatedVersion) {
            const projects = readLocalProjects();
            const projectIdx = projects.findIndex(p => p.id === updatedVersion!.projectId);
            if (projectIdx !== -1) {
                projects[projectIdx] = {
                    ...projects[projectIdx],
                    ...(updatedProject ?? {}),
                    activeVersionId: updatedVersion.id,
                    updatedAt: updatedProject?.updatedAt ?? new Date().toISOString(),
                    revision: updatedProject?.revision ?? projects[projectIdx].revision,
                };
                updatedProject = projects[projectIdx];
                persistLocalProjects(projects);
                persistLocalActiveId(updatedVersion.projectId);
            }
        }

        return { version: updatedVersion, project: updatedProject, status };
    }

    async deleteVersion(projectId: string, versionId: string): Promise<boolean> {
        let shouldDeleteLocal = false;
        let nextActiveVersionId: string | null | undefined;

        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`, { method: 'DELETE' });
            if (res.ok || res.status === 404) {
                this.runtimeAvailable = true;
                shouldDeleteLocal = true;
                if (res.ok) {
                    const data = await res.json();
                    nextActiveVersionId = data?.data?.activeVersionId;
                }
            } else {
                this.runtimeAvailable = false;
                return false;
            }
        } catch {
            this.runtimeAvailable = false;
            return false;
        }

        if (!shouldDeleteLocal) return false;

        const updatedVersions = readLocalVersions().filter(v => v.id !== versionId);
        persistLocalVersions(updatedVersions);

        const projects = readLocalProjects();
        const pIdx = projects.findIndex(p => p.id === projectId);
        if (pIdx !== -1) {
            if (nextActiveVersionId !== undefined) {
                projects[pIdx].activeVersionId = nextActiveVersionId;
            } else if (projects[pIdx].activeVersionId === versionId) {
                const latest = updatedVersions
                    .filter(v => v.projectId === projectId)
                    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
                projects[pIdx].activeVersionId = latest?.id ?? null;
            }
            projects[pIdx].updatedAt = new Date().toISOString();
            persistLocalProjects(projects);
        }

        return true;
    }

    async deleteProject(id: string): Promise<boolean> {
        let shouldDeleteLocal = false;
        let success = false;

        try {
            const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
            if (res.ok || res.status === 404) {
                this.runtimeAvailable = true;
                shouldDeleteLocal = true;
                success = true;
            } else {
                this.runtimeAvailable = false;
                success = false; // Reject if server failed with error
            }
        } catch {
            this.runtimeAvailable = false;
            success = false;
        }

        if (shouldDeleteLocal) {
            const projects = readLocalProjects().filter(p => p.id !== id);
            persistLocalProjects(projects);
            const versions = readLocalVersions().filter(v => v.projectId !== id);
            persistLocalVersions(versions);

            if (readLocalActiveId() === id) {
                persistLocalActiveId(projects[0]?.id || null);
            }
        }
        return success;
    }

    async renameProject(id: string, newName: string): Promise<SyncStatus> {
        const now = new Date().toISOString();
        let status: SyncStatus = 'saved';
        let shouldUpdateLocal = false;

        try {
            const res = await fetch(`${API_BASE}/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, updatedAt: now })
            });
            if (res.ok) {
                this.runtimeAvailable = true;
                status = 'saved';
                shouldUpdateLocal = true;
            } else {
                this.runtimeAvailable = false;
                status = 'error';
                shouldUpdateLocal = false; // Hard rejection from server
            }
        } catch {
            this.runtimeAvailable = false;
            status = 'error'; // Strictly server-authoritative: no local rename if offline
            shouldUpdateLocal = false;
        }

        if (!shouldUpdateLocal) return 'error';

        const projects = readLocalProjects();
        const idx = projects.findIndex(p => p.id === id);
        if (idx !== -1) {
            projects[idx].name = newName;
            projects[idx].updatedAt = now;
            persistLocalProjects(projects);
            return status;
        }
        return 'error';
    }
}

export const repository = new RunHistoryRepository();
