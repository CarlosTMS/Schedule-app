/**
 * server/runtime-store.mjs
 *
 * In-memory storage for Projetcs and their Immutable Versions.
 * This data is volatile and will be lost on server restart.
 */

const MAX_PROJECTS = 10;
const MAX_VERSIONS_PER_PROJECT = 20;


class RuntimeStore {
    constructor() {
        this.projects = [];
        this.versions = []; // Global list of versions
        this.appState = new Map();
    }

    // ─── Projects ─────────────────────────────────────────────────────────────

    getProjects() {
        return this.projects;
    }

    getProject(id) {
        return this.projects.find(p => p.id === id) || null;
    }

    upsertProject(project) {
        const idx = this.projects.findIndex(p => p.id === project.id);

        let nextRevision = project.revision || 1;
        if (idx !== -1) {
            nextRevision = (this.projects[idx].revision || 1) + 1;
        }

        const updated = {
            ...project,
            revision: nextRevision,
            updatedAt: new Date().toISOString()
        };

        if (idx !== -1) {
            this.projects[idx] = updated;
        } else {
            this.projects.push(updated);
        }

        // Limit capacity
        if (this.projects.length > MAX_PROJECTS) {
            this.projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            const removed = this.projects.splice(MAX_PROJECTS);
            const removedIds = removed.map(p => p.id);
            this.versions = this.versions.filter(v => !removedIds.includes(v.projectId));
        }

        return updated;
    }

    deleteProject(id) {
        const idx = this.projects.findIndex(p => p.id === id);
        if (idx === -1) return false;
        this.projects.splice(idx, 1);
        this.versions = this.versions.filter(v => v.projectId !== id);
        return true;
    }

    getConflict(id, expectedRevision) {
        if (expectedRevision === undefined || expectedRevision === null) return null;
        const p = this.getProject(id);
        if (!p) return null;
        if (p.revision !== expectedRevision) return p;
        return null;
    }

    // ─── Versions ─────────────────────────────────────────────────────────────

    getVersions(projectId) {
        return this.versions
            .filter(v => v.projectId === projectId)
            .sort((a, b) => b.versionNumber - a.versionNumber);
    }

    getVersion(id) {
        return this.versions.find(v => v.id === id) || null;
    }

    updateVersion(id, snapshot, editor) {
        const idx = this.versions.findIndex(v => v.id === id);
        if (idx === -1) return null;

        const existing = this.versions[idx];
        const updated = {
            ...existing,
            snapshot,
            createdAt: new Date().toISOString(),
            savedBy: editor?.name ?? existing.savedBy ?? null,
        };
        this.versions[idx] = updated;

        const project = this.getProject(existing.projectId);
        if (project) {
            project.activeVersionId = id;
            project.updatedAt = new Date().toISOString();
            project.revision = (project.revision || 1) + 1;
            project.updatedBy = editor?.name ?? project.updatedBy ?? null;
        }

        return {
            version: updated,
            project: project ?? null,
        };
    }

    deleteVersion(id) {
        const idx = this.versions.findIndex(v => v.id === id);
        if (idx === -1) return { ok: false, error: 'Version not found' };

        const removed = this.versions[idx];
        this.versions.splice(idx, 1);

        const project = this.getProject(removed.projectId);
        if (!project) {
            return { ok: true, projectId: removed.projectId, activeVersionId: null };
        }

        const projectVersions = this.getVersions(removed.projectId);
        const latest = projectVersions.length > 0 ? projectVersions[0] : null;

        // If deleted version was active, move active pointer to latest remaining or null.
        if (project.activeVersionId === removed.id) {
            project.activeVersionId = latest?.id ?? null;
        }

        project.updatedAt = new Date().toISOString();
        project.revision = (project.revision || 1) + 1;

        return {
            ok: true,
            projectId: removed.projectId,
            activeVersionId: project.activeVersionId
        };
    }

    addVersion(version) {
        // Versions are immutable, we only add if doesn't exist
        if (this.versions.some(v => v.id === version.id)) {
            return this.getVersion(version.id);
        }

        // Capacity check for this project
        const projectVersions = this.versions.filter(v => v.projectId === version.projectId);
        if (projectVersions.length >= MAX_VERSIONS_PER_PROJECT) {
            projectVersions.sort((a, b) => a.versionNumber - b.versionNumber);
            const oldestId = projectVersions[0].id;
            const globalIdx = this.versions.findIndex(v => v.id === oldestId);
            if (globalIdx !== -1) this.versions.splice(globalIdx, 1);
        }

        this.versions.push(version);
        return version;
    }

    getState(key) {
        return this.appState.get(key) ?? null;
    }

    setState(key, value) {
        this.appState.set(key, value);
        return value;
    }

    // ─── Batch Sync ───────────────────────────────────────────────────────────

    syncBatch(projects, versions) {
        let addedProjects = 0;
        let addedVersions = 0;

        for (const p of projects) {
            if (!this.projects.some(ex => ex.id === p.id)) {
                this.upsertProject(p);
                addedProjects++;
            }
        }

        for (const v of versions) {
            if (!this.versions.some(ex => ex.id === v.id)) {
                this.addVersion(v);
                addedVersions++;
            }
        }

        return { addedProjects, addedVersions };
    }

    // ─── Validation ───────────────────────────────────────────────────────────

    isValidProject(p) {
        return !!(p && p.id && p.name);
    }

    isValidVersion(v) {
        return !!(v && v.id && v.projectId && v.snapshot);
    }
}

export const store = new RuntimeStore();
