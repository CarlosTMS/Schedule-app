/**
 * src/lib/runHistoryRepository.ts
 *
 * Unified data layer for Projects and Versions (V3).
 * Implements server-authoritative runtime persistence with lightweight local UI preferences.
 */

import {
    type RunProject, type RunVersion, type RunSnapshot,
    readActiveProjectId as readLocalActiveId, persistActiveProjectId as persistLocalActiveId,
    clearRuntimeMirrorStorage, newId
} from './runHistoryStorage';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';


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
        clearRuntimeMirrorStorage();
    }

    async getProject(projectId: string): Promise<RunProject | null> {
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}`);
            if (!res.ok) throw new Error('Project fetch failed');
            this.runtimeAvailable = true;
            const data = await res.json();
            return data?.data ?? null;
        } catch {
            this.runtimeAvailable = false;
            return null;
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
                const remoteProjects = (projectsRes.data as RunProject[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                const activeProjectId = readLocalActiveId();
                const activeStillExists = remoteProjects.some(project => project.id === activeProjectId);

                return {
                    projects: remoteProjects,
                    activeProjectId: activeStillExists ? activeProjectId : null,
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
            projects: [],
            activeProjectId: null,
            status: 'error'
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
            persistLocalActiveId(projectId);
        } catch {
            this.runtimeAvailable = false;
            status = 'error';
        }

        return { project, version, status };
    }

    /**
     * Saves a new immutable version for an existing project.
     */
    async saveAsNewVersion(projectId: string, snapshot: RunSnapshot, label?: string, editor?: EditorIdentity): Promise<{ version: RunVersion, status: SyncStatus }> {
        const remoteVersions = await this.getVersions(projectId);
        const nextNum = (remoteVersions[0]?.versionNumber || 0) + 1;
        const now = new Date().toISOString();
        const versionId = newId();

        const version: RunVersion = {
            id: versionId,
            projectId,
            versionNumber: nextNum,
            label: label || `Version ${nextNum}`,
            parentVersionId: remoteVersions[0]?.id || null,
            createdAt: now,
            savedBy: editor?.name ?? null,
            snapshot
        };
        const project = await this.getProject(projectId);
        const currentRev = project?.revision || 1;

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
            persistLocalActiveId(projectId);
        } catch {
            this.runtimeAvailable = false;
            status = 'error';
        }

        return { version, status };
    }

    async getVersions(projectId: string): Promise<RunVersion[]> {
        try {
            const projRes = await fetch(`${API_BASE}/projects/${projectId}/versions`);
            if (projRes.ok) {
                const res = await projRes.json();
                this.runtimeAvailable = true;
                return (res.data as RunVersion[]).sort((a, b) => b.versionNumber - a.versionNumber);
            } else {
                this.runtimeAvailable = false;
            }
        } catch {
            this.runtimeAvailable = false;
        }
        return [];
    }

    async getVersion(versionId: string, _options?: { forceRemote?: boolean }): Promise<RunVersion | null> {
        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`);
            if (res.ok) {
                const data = await res.json();
                this.runtimeAvailable = true;
                return data.data as RunVersion;
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
            if (updatedVersion?.projectId) {
                persistLocalActiveId(updatedVersion.projectId);
            }
        } catch {
            this.runtimeAvailable = false;
            status = 'error';
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
        try {
            const res = await fetch(`${API_BASE}/versions/${versionId}`, { method: 'DELETE' });
            if (res.ok || res.status === 404) {
                this.runtimeAvailable = true;
                if (res.ok) {
                    const data = await res.json();
                    persistLocalActiveId(data?.data?.activeVersionId ?? projectId);
                }
                return true;
            } else {
                this.runtimeAvailable = false;
                return false;
            }
        } catch {
            this.runtimeAvailable = false;
            return false;
        }
    }

    async deleteProject(id: string): Promise<boolean> {
        try {
            const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
            if (res.ok || res.status === 404) {
                this.runtimeAvailable = true;
                if (readLocalActiveId() === id) {
                    persistLocalActiveId(null);
                }
                return true;
            } else {
                this.runtimeAvailable = false;
                return false;
            }
        } catch {
            this.runtimeAvailable = false;
            return false;
        }
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
        return status;
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
