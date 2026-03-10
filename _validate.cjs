const src = require('fs').readFileSync('./src/lib/runHistoryStorage.ts', 'utf8');
const checks = {
    'V2 key': src.includes('scheduler_runs_v2'),
    'last run key': src.includes('scheduler_last_run_id_v2'),
    'legacy key': src.includes('scheduler_history'),
    'MAX_HISTORY=20': src.includes('MAX_HISTORY = 20'),
    'schema v2': src.includes('SCHEMA_VERSION = 2'),
    'migrateFromV1': src.includes('export const migrateFromV1'),
    'createRun': src.includes('export const createRun'),
    'patchRun': src.includes('export const patchRunDashboardState'),
    'renameRun': src.includes('export const renameRun'),
    'deleteRun': src.includes('export const deleteRun'),
    'debounce': src.includes('export const debounce'),
    'corrupt guard': src.includes('r.version === SCHEMA_VERSION'),
    'no raw any': !src.includes(': any'),
};

let pass = true;
Object.entries(checks).forEach(([k, v]) => {
    console.log((v ? '✅' : '❌'), k);
    if (!v) pass = false;
});
process.exit(pass ? 0 : 1);
