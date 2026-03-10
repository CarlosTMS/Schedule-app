/**
 * server/runtime-store.mjs
 *
 * In-memory storage for simulation runs. 
 * This data is volatile and will be lost on server restart.
 */

const MAX_RUNS = 20;

class RuntimeStore {
    constructor() {
        this.runs = [];
        this.activeRunId = null;
    }

    /**
     * Returns all runs, sorted by updatedAt (desc) or as stored.
     */
    getRuns() {
        return this.runs;
    }

    /**
     * Returns the active run ID.
     */
    getActiveRunId() {
        return this.activeRunId;
    }

    /**
     * Sets the active run ID.
     */
    setActiveRunId(id) {
        this.activeRunId = id;
        return true;
    }

    /**
     * Adds or updates a run. 
     * If ID exists, it performs a full replace (mirroring the 'create/save' behavior).
     */
    upsertRun(run) {
        const idx = this.runs.findIndex((r) => r.id === run.id);
        const updatedRun = {
            ...run,
            updatedAt: new Date().toISOString(),
        };

        if (idx !== -1) {
            this.runs[idx] = updatedRun;
        } else {
            this.runs.push(updatedRun);
        }

        // Capacity limiting: protect activeRunId
        if (this.runs.length > MAX_RUNS) {
            // Sort by updatedAt desc (most recent first)
            this.runs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

            // If active run is way back, don't slice it. 
            // Better: identify which indices to keep. Top items, plus the active one.
            const toKeep = this.runs.filter((r, i) => i < MAX_RUNS || r.id === this.activeRunId);
            this.runs = toKeep;

            // If STILL too many (because active was protected and added to the 20), drop the oldest non-active.
            if (this.runs.length > MAX_RUNS) {
                const oldestNonActiveIdx = [...this.runs].reverse().findIndex(r => r.id !== this.activeRunId);
                if (oldestNonActiveIdx !== -1) {
                    const items = [...this.runs];
                    items.splice(items.length - 1 - oldestNonActiveIdx, 1);
                    this.runs = items;
                }
            }
        }
        return updatedRun;
    }

    /**
     * Partial update for core configuration.
     */
    patchCore(id, patch) {
        const idx = this.runs.findIndex((r) => r.id === id);
        if (idx === -1) return null;

        this.runs[idx] = {
            ...this.runs[idx],
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        return this.runs[idx];
    }

    /**
     * Partial update for dashboard state.
     */
    patchDashboard(id, patch) {
        const idx = this.runs.findIndex((r) => r.id === id);
        if (idx === -1) return null;

        this.runs[idx] = {
            ...this.runs[idx],
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        return this.runs[idx];
    }

    /**
     * Update metadata (rename).
     */
    patchMeta(id, patch) {
        const idx = this.runs.findIndex((r) => r.id === id);
        if (idx === -1) return null;

        this.runs[idx] = {
            ...this.runs[idx],
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        return this.runs[idx];
    }

    /**
     * Delete a run.
     */
    deleteRun(id) {
        const idx = this.runs.findIndex((r) => r.id === id);
        if (idx === -1) return false;

        this.runs.splice(idx, 1);
        if (this.activeRunId === id) {
            this.activeRunId = null;
        }
        return true;
    }

    /**
     * Structural validation (minimal check to avoid corrupt data in memory).
     */
    isValidRun(r) {
        if (!r || typeof r !== 'object') return false;
        // Required fields for StoredRunV2
        return !!(r.id && r.version === 2 && r.records && r.result);
    }
}

export const store = new RuntimeStore();
