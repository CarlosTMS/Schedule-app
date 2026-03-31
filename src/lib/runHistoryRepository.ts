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

export interface EditorIdentity {
    id: string;
    name: string;
}

export interface VersionPresence {
    versionId: string;
    editor: EditorIdentity;
    updatedAt: string;
}

export interface VersionUpdateConflict {
    project: RunProject;
    version: RunVersion | null;
}

export interface PublicApiSource {
    projectId: string;
    versionId: string;
    updatedAt: string;
}

export interface PublicApiStatus {
    publicSource: PublicApiSource | null;
    latest: {
        summary: {
            publishedAt: string;
            sourceProjectId: string | null;
            sourceVersionId: string | null;
            url: string;
        } | null;
        vats: {
            publishedAt: string;
            sourceProjectId: string | null;
            sourceVersionId: string | null;
            url: string;
        } | null;
    };
}

class RunHistoryRepository {
    public runtimeAvailable = true;

    constructor() {
        migrateToV3();
    }

    async getProject(projectId: string): Promise<RunProject | null> {
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}`);
            if (!res.ok) throw new Error('Project fetch failed');
            const data = await res.json();
            return data?.data ?? null;
        } catch {
            return readLocalProjects().find(project => project.id === projectId) ?? null;
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
     * Creates a new project with an initial version.
     */
    async createProject(name: string, snapshot: RunSnapshot, editor?: EditorIdentity): Promise<{ project: RunProject, version: RunVersion, status: SyncStatus }> {
        const now = new Date().toISOString();
        const projectId = newId();
        const versionId = newId();

        const project: RunProject = {
            id: projectId,
            name,
            createdAt: now,
            updatedAt: now,
            activeVersionId: versionId,
            publicApiVersionId: versionId,
            updatedBy: editor?.name ?? null,
            revision: 1
        };

        const version: RunVersion = {
            id: versionId,
            projectId,
            versionNumber: 1,
            label: 'Initial version',
            createdAt: now,
            savedBy: editor?.name ?? null,
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
    async saveAsNewVersion(projectId: string, snapshot: RunSnapshot, label?: string, editor?: EditorIdentity): Promise<{ version: RunVersion, status: SyncStatus }> {
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
            savedBy: editor?.name ?? null,
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
                body: JSON.stringify({ activeVersionId: versionId, updatedAt: now, updatedBy: editor?.name ?? null, expectedRevision: currentRev })
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

    async getVersion(versionId: string, options?: { forceRemote?: boolean }): Promise<RunVersion | null> {
        if (!options?.forceRemote) {
            const local = readLocalVersions().find(v => v.id === versionId);
            if (local) return local;
        }

        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`);
            if (res.ok) {
                const data = await res.json();
                this.runtimeAvailable = true;
                const remote = data.data as RunVersion;
                const versions = readLocalVersions();
                const idx = versions.findIndex(v => v.id === remote.id);
                if (idx !== -1) versions[idx] = remote;
                else versions.push(remote);
                persistLocalVersions(versions);
                return remote;
            } else {
                this.runtimeAvailable = false;
            }
        } catch {
            this.runtimeAvailable = false;
        }
        return null;
    }

    async updateVersion(
        versionId: string,
        snapshot: RunSnapshot,
        options?: { expectedRevision?: number; editor?: EditorIdentity }
    ): Promise<{ version: RunVersion | null, project?: RunProject, status: SyncStatus, conflict?: VersionUpdateConflict }> {
        let status: SyncStatus = 'saved';
        let updatedVersion: RunVersion | null = null;
        let updatedProject: RunProject | undefined;
        let conflict: VersionUpdateConflict | undefined;

        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot, expectedRevision: options?.expectedRevision, editor: options?.editor })
            });

            if (res.status === 409) {
                const data = await res.json();
                status = 'conflict';
                conflict = {
                    project: data?.currentProject,
                    version: data?.currentVersion ?? null,
                };
                return { version: null, project: undefined, status, conflict };
            }

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

        return { version: updatedVersion, project: updatedProject, status, conflict };
    }

    async getPresence(versionId: string): Promise<VersionPresence[]> {
        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}/presence`);
            if (!res.ok) return [];
            const data = await res.json();
            return data?.data ?? [];
        } catch {
            return [];
        }
    }

    async touchPresence(versionId: string, editor: EditorIdentity): Promise<void> {
        try {
            await fetch(`${API_BASE}/versions/${versionId}/presence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ editor })
            });
        } catch {
            // Presence is best-effort only.
        }
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

    async setPublicApiSource(projectId: string, versionId: string): Promise<{ source: PublicApiSource | null, status: SyncStatus }> {
        let status: SyncStatus = 'saved';
        let source: PublicApiSource | null = null;

        try {
            const res = await fetch(`${API_BASE}/public-api-source`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, versionId })
            });
            if (!res.ok) throw new Error('Failed to update public API source');
            const data = await res.json();
            source = data?.data ?? null;
            this.runtimeAvailable = true;
        } catch {
            this.runtimeAvailable = false;
            status = 'error';
        }

        if (source) {
            const projects = readLocalProjects().map(project => ({
                ...project,
                publicApiVersionId: project.id === projectId ? versionId : null,
            }));
            persistLocalProjects(projects);
        }

        return { source, status };
    }

    async getPublicApiStatus(): Promise<PublicApiStatus | null> {
        try {
            const res = await fetch('/api/public/status');
            if (!res.ok) throw new Error('Failed to load public API status');
            const data = await res.json();
            return data?.data ?? null;
        } catch {
            return null;
        }
    }
}

export const repository = new RunHistoryRepository();
