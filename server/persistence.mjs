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
  }

  getStatus() {
    return { mode: this.mode, enabled: this.enabled };
  }

  async getPublication(key) {
    const config = PUBLICATION_CONFIG[key];
    if (!config) return null;
    ensureDataDir();
    if (!fs.existsSync(config.file)) return null;
    return JSON.parse(fs.readFileSync(config.file, 'utf8'));
  }

  async savePublication(key, payload) {
    const config = PUBLICATION_CONFIG[key];
    if (!config) throw new Error(`Unsupported publication key: ${key}`);
    ensureDataDir();
    fs.writeFileSync(config.file, JSON.stringify(payload, null, 2), 'utf8');
    return { savedAt: new Date().toISOString() };
  }

  async getProjects() {
    return clone(runtimeStore.getProjects());
  }

  async getProject(id) {
    return clone(runtimeStore.getProject(id));
  }

  async upsertProject(project) {
    return clone(runtimeStore.upsertProject(project));
  }

  async deleteProject(id) {
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

  async addVersion(version) {
    return clone(runtimeStore.addVersion(version));
  }

  async updateVersion(id, snapshot) {
    return clone(runtimeStore.updateVersion(id, snapshot));
  }

  async deleteVersion(id) {
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

  async getPublication(key) {
    const rows = await this.exec(
      `SELECT PAYLOAD_JSON FROM ${this.table('SCHEDULER_PUBLICATIONS')} WHERE PUBLICATION_KEY = ${sqlString(key)}`
    );
    if (!rows.length) return null;
    return JSON.parse(rows[0].PAYLOAD_JSON);
  }

  async savePublication(key, payload) {
    const config = PUBLICATION_CONFIG[key];
    if (!config) throw new Error(`Unsupported publication key: ${key}`);
    const sql = `
MERGE INTO ${this.table('SCHEDULER_PUBLICATIONS')}
USING (
  SELECT
    ${sqlString(key)} AS PUBLICATION_KEY,
    ${sqlString(config.type)} AS PAYLOAD_TYPE,
    ${sqlJson(payload)} AS PAYLOAD_JSON,
    CURRENT_UTCTIMESTAMP AS PUBLISHED_AT
  FROM DUMMY
) source
ON ${this.table('SCHEDULER_PUBLICATIONS')}.PUBLICATION_KEY = source.PUBLICATION_KEY
WHEN MATCHED THEN UPDATE SET
  ${this.table('SCHEDULER_PUBLICATIONS')}.PAYLOAD_TYPE = source.PAYLOAD_TYPE,
  ${this.table('SCHEDULER_PUBLICATIONS')}.PAYLOAD_JSON = source.PAYLOAD_JSON,
  ${this.table('SCHEDULER_PUBLICATIONS')}.PUBLISHED_AT = source.PUBLISHED_AT
WHEN NOT MATCHED THEN INSERT (PUBLICATION_KEY, PAYLOAD_TYPE, PAYLOAD_JSON, PUBLISHED_AT)
VALUES (source.PUBLICATION_KEY, source.PAYLOAD_TYPE, source.PAYLOAD_JSON, source.PUBLISHED_AT)
`;
    await this.exec(sql);
    return { savedAt: new Date().toISOString() };
  }

  async getProjects() {
    const rows = await this.exec(`
SELECT ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION
FROM ${this.table('SCHEDULER_PROJECTS')}
ORDER BY UPDATED_AT DESC
`);
    return rows.map((row) => this.mapProject(row));
  }

  async getProject(id) {
    const rows = await this.exec(`
SELECT ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION
FROM ${this.table('SCHEDULER_PROJECTS')}
WHERE ID = ${sqlString(id)}
`);
    return rows.length ? this.mapProject(rows[0]) : null;
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
    ${revision} AS REVISION
  FROM DUMMY
) source
ON ${this.table('SCHEDULER_PROJECTS')}.ID = source.ID
WHEN MATCHED THEN UPDATE SET
  ${this.table('SCHEDULER_PROJECTS')}.NAME = source.NAME,
  ${this.table('SCHEDULER_PROJECTS')}.UPDATED_AT = source.UPDATED_AT,
  ${this.table('SCHEDULER_PROJECTS')}.ACTIVE_VERSION_ID = source.ACTIVE_VERSION_ID,
  ${this.table('SCHEDULER_PROJECTS')}.REVISION = source.REVISION
WHEN NOT MATCHED THEN INSERT (ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION)
VALUES (source.ID, source.NAME, source.CREATED_AT, source.UPDATED_AT, source.ACTIVE_VERSION_ID, source.REVISION)
`;

    await this.exec(sql);
    return this.getProject(project.id);
  }

  async deleteProject(id) {
    const existing = await this.getProject(id);
    if (!existing) return false;
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
SELECT ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON
FROM ${this.table('SCHEDULER_VERSIONS')}
WHERE PROJECT_ID = ${sqlString(projectId)}
ORDER BY VERSION_NUMBER DESC
`);
    return rows.map((row) => this.mapVersion(row));
  }

  async getVersion(id) {
    const rows = await this.exec(`
SELECT ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON
FROM ${this.table('SCHEDULER_VERSIONS')}
WHERE ID = ${sqlString(id)}
`);
    return rows.length ? this.mapVersion(rows[0]) : null;
  }

  async addVersion(version) {
    const existing = await this.getVersion(version.id);
    if (existing) return existing;

    const sql = `
INSERT INTO ${this.table('SCHEDULER_VERSIONS')} (
  ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON, SNAPSHOT_SCHEMA_VERSION
) VALUES (
  ${sqlString(version.id)},
  ${sqlString(version.projectId)},
  ${Number(version.versionNumber)},
  ${sqlString(version.label ?? null)},
  ${sqlString(version.parentVersionId ?? null)},
  ${sqlTimestamp(version.createdAt)},
  ${sqlJson(version.snapshot)},
  3
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

  async updateVersion(id, snapshot) {
    const existing = await this.getVersion(id);
    if (!existing) return null;

    const updatedAt = new Date().toISOString();
    await this.exec(`
UPDATE ${this.table('SCHEDULER_VERSIONS')}
SET SNAPSHOT_JSON = ${sqlJson(snapshot)},
    CREATED_AT = ${sqlTimestamp(updatedAt)}
WHERE ID = ${sqlString(id)}
`);

    const project = await this.getProject(existing.projectId);
    if (project) {
      await this.exec(`
UPDATE ${this.table('SCHEDULER_PROJECTS')}
SET ACTIVE_VERSION_ID = ${sqlString(id)},
    UPDATED_AT = ${sqlTimestamp(updatedAt)},
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

  mapProject(row) {
    return {
      id: row.ID,
      name: row.NAME,
      createdAt: new Date(row.CREATED_AT).toISOString(),
      updatedAt: new Date(row.UPDATED_AT).toISOString(),
      activeVersionId: row.ACTIVE_VERSION_ID,
      revision: Number(row.REVISION || 1),
    };
  }

  mapVersion(row) {
    return {
      id: row.ID,
      projectId: row.PROJECT_ID,
      versionNumber: Number(row.VERSION_NUMBER),
      label: row.LABEL ?? undefined,
      parentVersionId: row.PARENT_VERSION_ID,
      createdAt: new Date(row.CREATED_AT).toISOString(),
      snapshot: JSON.parse(row.SNAPSHOT_JSON),
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
