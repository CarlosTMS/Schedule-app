import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { store as runtimeStore } from './runtime-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const SUMMARY_FILE = path.join(DATA_DIR, 'summary.latest.json');
const VATS_FILE = path.join(DATA_DIR, 'vats.latest.json');

const PUBLICATION_CONFIG = {
  'summary.latest': { file: SUMMARY_FILE, type: 'summary' },
  'vats.latest': { file: VATS_FILE, type: 'vats' },
};

const PUBLIC_API_SOURCE_KEY = 'public-api-source';

const HANA_ENV_KEYS = ['HANA_HOST', 'HANA_PORT', 'HANA_SCHEMA', 'HANA_USER', 'HANA_PASSWORD'];

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const sqlString = (value) => {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const sqlTimestamp = (value) => {
  if (!value) return 'CURRENT_UTCTIMESTAMP';
  return `TO_TIMESTAMP(${sqlString(value)})`;
};

const sqlJson = (value) => `TO_NCLOB(${sqlString(JSON.stringify(value))})`;

class MemoryFilePersistence {
  constructor() {
    this.mode = 'memory';
    this.enabled = false;
    this.publicationStore = new Map();
    this.appState = new Map();
  }

  getStatus() {
    return { mode: this.mode, enabled: this.enabled };
  }

  async getPublicationRecord(key) {
    const config = PUBLICATION_CONFIG[key];
    if (config) {
      ensureDataDir();
      if (!fs.existsSync(config.file)) return null;
      return {
        key,
        type: config.type,
        payload: JSON.parse(fs.readFileSync(config.file, 'utf8')),
        publishedAt: fs.statSync(config.file).mtime.toISOString(),
        sourceProjectId: null,
        sourceVersionId: null,
      };
    }

    return this.publicationStore.get(key) ?? null;
  }

  async getPublication(key) {
    const record = await this.getPublicationRecord(key);
    return record?.payload ?? null;
  }

  async savePublication(key, payload, options = {}) {
    const config = PUBLICATION_CONFIG[key];
    const type = options.type ?? config?.type;
    if (!type) throw new Error(`Unsupported publication key: ${key}`);

    const record = {
      key,
      type,
      payload,
      publishedAt: new Date().toISOString(),
      sourceProjectId: options.sourceProjectId ?? null,
      sourceVersionId: options.sourceVersionId ?? null,
    };

    if (config) {
      ensureDataDir();
      fs.writeFileSync(config.file, JSON.stringify(payload, null, 2), 'utf8');
    }

    this.publicationStore.set(key, record);
    return { savedAt: record.publishedAt };
  }

  async getPublicApiSource() {
    return this.appState.get(PUBLIC_API_SOURCE_KEY) ?? null;
  }

  async setPublicApiSource(projectId, versionId) {
    const payload = {
      projectId,
      versionId,
      updatedAt: new Date().toISOString(),
    };
    this.appState.set(PUBLIC_API_SOURCE_KEY, payload);
    return payload;
  }

  async getAppState(key) {
    return this.appState.get(key) ?? null;
  }

  async setAppState(key, value) {
    this.appState.set(key, value);
    return value;
  }

  async touchPresence(versionId, editor) {
    const key = `presence.version.${versionId}.${editor.id}`;
    const value = {
      versionId,
      editor,
      updatedAt: new Date().toISOString(),
    };
    await this.setAppState(key, value);
    return value;
  }

  async getPresence(versionId, ttlMs = 70000) {
    const prefix = `presence.version.${versionId}.`;
    const rows = await this.exec(`
SELECT STATE_KEY, STATE_JSON
FROM ${this.table('SCHEDULER_APP_STATE')}
WHERE STATE_KEY LIKE ${sqlString(`${prefix}%`)}
`);
    const now = Date.now();
    const active = [];
    for (const row of rows) {
      const value = JSON.parse(row.STATE_JSON);
      const age = now - new Date(value.updatedAt).getTime();
      if (age <= ttlMs) {
        active.push(value);
      } else {
        await this.exec(`DELETE FROM ${this.table('SCHEDULER_APP_STATE')} WHERE STATE_KEY = ${sqlString(row.STATE_KEY)}`);
      }
    }
    return active.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async touchPresence(versionId, editor) {
    const key = `presence.version.${versionId}.${editor.id}`;
    const value = { versionId, editor, updatedAt: new Date().toISOString() };
    this.appState.set(key, value);
    return value;
  }

  async getPresence(versionId, ttlMs = 70000) {
    const prefix = `presence.version.${versionId}.`;
    const now = Date.now();
    const active = [];
    for (const [key, value] of this.appState.entries()) {
      if (!key.startsWith(prefix)) continue;
      const age = now - new Date(value.updatedAt).getTime();
      if (age <= ttlMs) active.push(value);
      else this.appState.delete(key);
    }
    return active.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProjects() {
    const projects = clone(runtimeStore.getProjects());
    const publicSource = await this.getPublicApiSource();
    return projects.map((project) => ({
      ...project,
      publicApiVersionId: publicSource?.projectId === project.id ? publicSource.versionId : null,
    }));
  }

  async getProject(id) {
    const project = clone(runtimeStore.getProject(id));
    if (!project) return null;
    const publicSource = await this.getPublicApiSource();
    return {
      ...project,
      publicApiVersionId: publicSource?.projectId === project.id ? publicSource.versionId : null,
    };
  }

  async upsertProject(project) {
    return clone(runtimeStore.upsertProject(project));
  }

  async deleteProject(id) {
    const publicSource = await this.getPublicApiSource();
    if (publicSource?.projectId === id) {
      this.appState.delete(PUBLIC_API_SOURCE_KEY);
    }
    return runtimeStore.deleteProject(id);
  }

  async getConflict(id, expectedRevision) {
    return clone(runtimeStore.getConflict(id, expectedRevision));
  }

  async getVersions(projectId) {
    return clone(runtimeStore.getVersions(projectId));
  }

  async getVersion(id) {
    return clone(runtimeStore.getVersion(id));
  }

  async getVersionMeta(id) {
    return clone(runtimeStore.getVersion(id));
  }

  async addVersion(version) {
    return clone(runtimeStore.addVersion(version));
  }

  async updateVersion(id, snapshot, options = {}) {
    return clone(runtimeStore.updateVersion(id, snapshot, options.editor));
  }

  async deleteVersion(id) {
    const publicSource = await this.getPublicApiSource();
    const version = runtimeStore.getVersion(id);
    if (version && publicSource?.versionId === id) {
      this.appState.delete(PUBLIC_API_SOURCE_KEY);
    }
    return clone(runtimeStore.deleteVersion(id));
  }

  async syncBatch(projects, versions) {
    return clone(runtimeStore.syncBatch(projects, versions));
  }

  isValidProject(project) {
    return runtimeStore.isValidProject(project);
  }

  isValidVersion(version) {
    return runtimeStore.isValidVersion(version);
  }
}

class HANAStore {
  constructor() {
    this.mode = 'hana';
    this.enabled = HANA_ENV_KEYS.every((key) => Boolean(process.env[key]));
    this.missingKeys = HANA_ENV_KEYS.filter((key) => !process.env[key]);
    this.options = this.enabled ? {
      serverNode: `${process.env.HANA_HOST}:${process.env.HANA_PORT}`,
      uid: process.env.HANA_USER,
      pwd: process.env.HANA_PASSWORD,
      currentSchema: process.env.HANA_SCHEMA,
      encrypt: `${process.env.HANA_ENCRYPT ?? 'true'}` !== 'false',
      sslValidateCertificate: `${process.env.HANA_VALIDATE_CERTIFICATE ?? 'true'}` !== 'false',
    } : null;
  }

  getStatus() {
    return {
      mode: this.mode,
      enabled: this.enabled,
      missingKeys: this.missingKeys,
      schema: process.env.HANA_SCHEMA ?? null,
    };
  }

  async getPublicationRecord(key) {
    const rows = await this.exec(
      `SELECT PUBLICATION_KEY, PAYLOAD_TYPE, PAYLOAD_JSON, PUBLISHED_AT, SOURCE_PROJECT_ID, SOURCE_VERSION_ID
       FROM ${this.table('SCHEDULER_PUBLICATIONS')}
       WHERE PUBLICATION_KEY = ${sqlString(key)}`
    );
    if (!rows.length) return null;
    return {
      key: rows[0].PUBLICATION_KEY,
      type: rows[0].PAYLOAD_TYPE,
      payload: JSON.parse(rows[0].PAYLOAD_JSON),
      publishedAt: new Date(rows[0].PUBLISHED_AT).toISOString(),
      sourceProjectId: rows[0].SOURCE_PROJECT_ID ?? null,
      sourceVersionId: rows[0].SOURCE_VERSION_ID ?? null,
    };
  }

  async getPublication(key) {
    const record = await this.getPublicationRecord(key);
    return record?.payload ?? null;
  }

  async savePublication(key, payload, options = {}) {
    const config = PUBLICATION_CONFIG[key];
    const type = options.type ?? config?.type;
    if (!type) throw new Error(`Unsupported publication key: ${key}`);
    const sql = `
MERGE INTO ${this.table('SCHEDULER_PUBLICATIONS')}
USING (
  SELECT
    ${sqlString(key)} AS PUBLICATION_KEY,
    ${sqlString(type)} AS PAYLOAD_TYPE,
    ${sqlJson(payload)} AS PAYLOAD_JSON,
    CURRENT_UTCTIMESTAMP AS PUBLISHED_AT,
    ${sqlString(options.sourceProjectId ?? null)} AS SOURCE_PROJECT_ID,
    ${sqlString(options.sourceVersionId ?? null)} AS SOURCE_VERSION_ID
  FROM DUMMY
) source
ON ${this.table('SCHEDULER_PUBLICATIONS')}.PUBLICATION_KEY = source.PUBLICATION_KEY
WHEN MATCHED THEN UPDATE SET
  ${this.table('SCHEDULER_PUBLICATIONS')}.PAYLOAD_TYPE = source.PAYLOAD_TYPE,
  ${this.table('SCHEDULER_PUBLICATIONS')}.PAYLOAD_JSON = source.PAYLOAD_JSON,
  ${this.table('SCHEDULER_PUBLICATIONS')}.PUBLISHED_AT = source.PUBLISHED_AT,
  ${this.table('SCHEDULER_PUBLICATIONS')}.SOURCE_PROJECT_ID = source.SOURCE_PROJECT_ID,
  ${this.table('SCHEDULER_PUBLICATIONS')}.SOURCE_VERSION_ID = source.SOURCE_VERSION_ID
WHEN NOT MATCHED THEN INSERT (PUBLICATION_KEY, PAYLOAD_TYPE, PAYLOAD_JSON, PUBLISHED_AT, SOURCE_PROJECT_ID, SOURCE_VERSION_ID)
VALUES (source.PUBLICATION_KEY, source.PAYLOAD_TYPE, source.PAYLOAD_JSON, source.PUBLISHED_AT, source.SOURCE_PROJECT_ID, source.SOURCE_VERSION_ID)
`;
    await this.exec(sql);
    return { savedAt: new Date().toISOString() };
  }

  async getPublicApiSource() {
    return this.getAppState(PUBLIC_API_SOURCE_KEY);
  }

  async setPublicApiSource(projectId, versionId) {
    const value = {
      projectId,
      versionId,
      updatedAt: new Date().toISOString(),
    };
    await this.setAppState(PUBLIC_API_SOURCE_KEY, value);
    return value;
  }

  async getAppState(key) {
    const rows = await this.exec(`
SELECT STATE_JSON
FROM ${this.table('SCHEDULER_APP_STATE')}
WHERE STATE_KEY = ${sqlString(key)}
`);
    return rows.length ? JSON.parse(rows[0].STATE_JSON) : null;
  }

  async setAppState(key, value) {
    await this.exec(`
MERGE INTO ${this.table('SCHEDULER_APP_STATE')}
USING (
  SELECT
    ${sqlString(key)} AS STATE_KEY,
    ${sqlJson(value)} AS STATE_JSON,
    CURRENT_UTCTIMESTAMP AS UPDATED_AT
  FROM DUMMY
) source
ON ${this.table('SCHEDULER_APP_STATE')}.STATE_KEY = source.STATE_KEY
WHEN MATCHED THEN UPDATE SET
  ${this.table('SCHEDULER_APP_STATE')}.STATE_JSON = source.STATE_JSON,
  ${this.table('SCHEDULER_APP_STATE')}.UPDATED_AT = source.UPDATED_AT
WHEN NOT MATCHED THEN INSERT (STATE_KEY, STATE_JSON, UPDATED_AT)
VALUES (source.STATE_KEY, source.STATE_JSON, source.UPDATED_AT)
`);
    return value;
  }

  async getProjects() {
    const rows = await this.exec(`
SELECT ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION, UPDATED_BY
FROM ${this.table('SCHEDULER_PROJECTS')}
ORDER BY UPDATED_AT DESC
`);
    const publicSource = await this.getPublicApiSource();
    return rows.map((row) => this.mapProject(row, publicSource));
  }

  async getProject(id) {
    const rows = await this.exec(`
SELECT ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION, UPDATED_BY
FROM ${this.table('SCHEDULER_PROJECTS')}
WHERE ID = ${sqlString(id)}
`);
    const publicSource = await this.getPublicApiSource();
    return rows.length ? this.mapProject(rows[0], publicSource) : null;
  }

  async upsertProject(project) {
    const existing = await this.getProject(project.id);
    const revision = existing ? (existing.revision || 1) + 1 : (project.revision || 1);
    const createdAt = existing?.createdAt ?? project.createdAt ?? new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const requestedActiveVersionId = project.activeVersionId ?? existing?.activeVersionId ?? null;
    const activeVersion = requestedActiveVersionId ? await this.getVersion(requestedActiveVersionId) : null;
    const activeVersionId = activeVersion ? requestedActiveVersionId : null;

    const sql = `
MERGE INTO ${this.table('SCHEDULER_PROJECTS')}
USING (
  SELECT
    ${sqlString(project.id)} AS ID,
    ${sqlString(project.name)} AS NAME,
    ${sqlTimestamp(createdAt)} AS CREATED_AT,
    ${sqlTimestamp(updatedAt)} AS UPDATED_AT,
    ${sqlString(activeVersionId)} AS ACTIVE_VERSION_ID,
    ${revision} AS REVISION,
    ${sqlString(project.updatedBy ?? existing?.updatedBy ?? null)} AS UPDATED_BY
  FROM DUMMY
) source
ON ${this.table('SCHEDULER_PROJECTS')}.ID = source.ID
WHEN MATCHED THEN UPDATE SET
  ${this.table('SCHEDULER_PROJECTS')}.NAME = source.NAME,
  ${this.table('SCHEDULER_PROJECTS')}.UPDATED_AT = source.UPDATED_AT,
  ${this.table('SCHEDULER_PROJECTS')}.ACTIVE_VERSION_ID = source.ACTIVE_VERSION_ID,
  ${this.table('SCHEDULER_PROJECTS')}.REVISION = source.REVISION,
  ${this.table('SCHEDULER_PROJECTS')}.UPDATED_BY = source.UPDATED_BY
WHEN NOT MATCHED THEN INSERT (ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION, UPDATED_BY)
VALUES (source.ID, source.NAME, source.CREATED_AT, source.UPDATED_AT, source.ACTIVE_VERSION_ID, source.REVISION, source.UPDATED_BY)
`;

    await this.exec(sql);
    return this.getProject(project.id);
  }

  async deleteProject(id) {
    const existing = await this.getProject(id);
    if (!existing) return false;
    const publicSource = await this.getPublicApiSource();
    if (publicSource?.projectId === id) {
      await this.exec(`DELETE FROM ${this.table('SCHEDULER_APP_STATE')} WHERE STATE_KEY = ${sqlString(PUBLIC_API_SOURCE_KEY)}`);
    }
    await this.exec(`DELETE FROM ${this.table('SCHEDULER_PROJECTS')} WHERE ID = ${sqlString(id)}`);
    return true;
  }

  async getConflict(id, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return null;
    const project = await this.getProject(id);
    if (!project) return null;
    return project.revision !== expectedRevision ? project : null;
  }

  async getVersions(projectId) {
    const rows = await this.exec(`
SELECT ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, CREATED_BY, SNAPSHOT_JSON
FROM ${this.table('SCHEDULER_VERSIONS')}
WHERE PROJECT_ID = ${sqlString(projectId)}
ORDER BY VERSION_NUMBER DESC
`);
    return rows.map((row) => this.mapVersion(row));
  }

  async getVersion(id) {
    const rows = await this.exec(`
SELECT ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, CREATED_BY, SNAPSHOT_JSON
FROM ${this.table('SCHEDULER_VERSIONS')}
WHERE ID = ${sqlString(id)}
`);
    return rows.length ? this.mapVersion(rows[0]) : null;
  }

  async getVersionMeta(id) {
    const rows = await this.exec(`
SELECT ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, CREATED_BY
FROM ${this.table('SCHEDULER_VERSIONS')}
WHERE ID = ${sqlString(id)}
`);
    return rows.length ? this.mapVersion(rows[0], false) : null;
  }

  async addVersion(version) {
    const existing = await this.getVersion(version.id);
    if (existing) return existing;

    const sql = `
INSERT INTO ${this.table('SCHEDULER_VERSIONS')} (
  ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON, SNAPSHOT_SCHEMA_VERSION, CREATED_BY
) VALUES (
  ${sqlString(version.id)},
  ${sqlString(version.projectId)},
  ${Number(version.versionNumber)},
  ${sqlString(version.label ?? null)},
  ${sqlString(version.parentVersionId ?? null)},
  ${sqlTimestamp(version.createdAt)},
  ${sqlJson(version.snapshot)},
  3,
  ${sqlString(version.savedBy ?? null)}
)
`;
    await this.exec(sql);
    const project = await this.getProject(version.projectId);
    if (project && !project.activeVersionId) {
      await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = ${sqlString(version.id)},
    UPDATED_AT = CURRENT_UTCTIMESTAMP
WHERE ID = ${sqlString(version.projectId)}
`);
    }
    return this.getVersion(version.id);
  }

  async updateVersion(id, snapshot, options = {}) {
    const existing = await this.getVersion(id);
    if (!existing) return null;

    const updatedAt = new Date().toISOString();
    await this.exec(`
UPDATE ${this.table('SCHEDULER_VERSIONS')}
SET SNAPSHOT_JSON = ${sqlJson(snapshot)},
    CREATED_AT = ${sqlTimestamp(updatedAt)},
    CREATED_BY = ${sqlString(options.editor?.name ?? existing.savedBy ?? null)}
WHERE ID = ${sqlString(id)}
`);

    const project = await this.getProject(existing.projectId);
    if (project) {
      await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = ${sqlString(id)},
    UPDATED_AT = ${sqlTimestamp(updatedAt)},
    UPDATED_BY = ${sqlString(options.editor?.name ?? project.updatedBy ?? null)},
    REVISION = ${Number(project.revision || 1) + 1}
WHERE ID = ${sqlString(existing.projectId)}
`);
    }

    return {
      version: await this.getVersion(id),
      project: await this.getProject(existing.projectId),
    };
  }

  async deleteVersion(id) {
    const existing = await this.getVersion(id);
    if (!existing) return { ok: false, error: 'Version not found' };
    const publicSource = await this.getPublicApiSource();
    if (publicSource?.versionId === id) {
      await this.exec(`DELETE FROM ${this.table('SCHEDULER_APP_STATE')} WHERE STATE_KEY = ${sqlString(PUBLIC_API_SOURCE_KEY)}`);
    }

    const projectId = existing.projectId;
    const project = await this.getProject(projectId);

    if (project?.activeVersionId === id) {
      await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = NULL,
    UPDATED_AT = CURRENT_UTCTIMESTAMP,
    REVISION = ${Number(project.revision || 1) + 1}
WHERE ID = ${sqlString(projectId)}
`);
    }

    await this.exec(`DELETE FROM ${this.table('SCHEDULER_VERSIONS')} WHERE ID = ${sqlString(id)}`);

    const remaining = await this.getVersions(projectId);
    const nextActive = remaining[0]?.id ?? null;
    if (project) {
      await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = ${sqlString(nextActive)},
    UPDATED_AT = CURRENT_UTCTIMESTAMP
WHERE ID = ${sqlString(projectId)}
`);
    }

    return { ok: true, projectId, activeVersionId: nextActive };
  }

  async syncBatch(projects, versions) {
    let addedProjects = 0;
    let addedVersions = 0;

    for (const project of projects) {
      const existing = await this.getProject(project.id);
      if (!existing) {
        await this.exec(`
INSERT INTO ${this.table('SCHEDULER_PROJECTS')} (ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION)
VALUES (
  ${sqlString(project.id)},
  ${sqlString(project.name)},
  ${sqlTimestamp(project.createdAt)},
  ${sqlTimestamp(project.updatedAt)},
  NULL,
  ${Number(project.revision || 1)}
)
`);
        addedProjects += 1;
      }
    }

    for (const version of versions) {
      const existing = await this.getVersion(version.id);
      if (!existing) {
        await this.addVersion(version);
        addedVersions += 1;
      }
    }

    for (const project of projects) {
      if (project.activeVersionId) {
        await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = ${sqlString(project.activeVersionId)},
    UPDATED_AT = ${sqlTimestamp(project.updatedAt)}
WHERE ID = ${sqlString(project.id)}
`);
      }
    }

    return { addedProjects, addedVersions };
  }

  isValidProject(project) {
    return Boolean(project && project.id && project.name);
  }

  isValidVersion(version) {
    return Boolean(version && version.id && version.projectId && version.snapshot);
  }

  async exec(sql) {
    const hana = await import('@sap/hana-client');
    const connection = hana.default.createConnection();
    await new Promise((resolve, reject) => {
      connection.connect(this.options, (err) => (err ? reject(err) : resolve()));
    });

    try {
      const rows = await new Promise((resolve, reject) => {
        connection.exec(sql, (err, result) => (err ? reject(err) : resolve(result)));
      });
      return Array.isArray(rows) ? rows : [];
    } finally {
      await new Promise((resolve) => connection.disconnect(() => resolve()));
    }
  }

  table(name) {
    return `${process.env.HANA_SCHEMA}.${name}`;
  }

  mapProject(row, publicSource = null) {
    return {
      id: row.ID,
      name: row.NAME,
      createdAt: new Date(row.CREATED_AT).toISOString(),
      updatedAt: new Date(row.UPDATED_AT).toISOString(),
      activeVersionId: row.ACTIVE_VERSION_ID,
      revision: Number(row.REVISION || 1),
      updatedBy: row.UPDATED_BY ?? null,
      publicApiVersionId: publicSource?.projectId === row.ID ? publicSource.versionId : null,
    };
  }

  mapVersion(row, includeSnapshot = true) {
    return {
      id: row.ID,
      projectId: row.PROJECT_ID,
      versionNumber: Number(row.VERSION_NUMBER),
      label: row.LABEL ?? undefined,
      parentVersionId: row.PARENT_VERSION_ID,
      createdAt: new Date(row.CREATED_AT).toISOString(),
      savedBy: row.CREATED_BY ?? null,
      ...(includeSnapshot ? { snapshot: JSON.parse(row.SNAPSHOT_JSON) } : {}),
    };
  }
}

export const createPersistence = () => {
  const hanaStore = new HANAStore();
  if (hanaStore.enabled) {
    return hanaStore;
  }

  const fallback = new MemoryFilePersistence();
  fallback.hanaStatus = hanaStore.getStatus();
  return fallback;
};
