import fs from 'fs';
import path from 'path';
import https from 'https';

const baseUrl = process.argv[2] || 'https://scheduler-app.cfapps.us10.hana.ondemand.com';
const outputPath = process.argv[3] || path.resolve('db/hana/003_seed_from_live.sql');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          } catch (error) {
            reject(new Error(`Failed to parse JSON from ${url}: ${error.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `TO_NCLOB(${sqlString(JSON.stringify(value))})`;
}

function nowUtc() {
  return new Date().toISOString();
}

const seedLines = [];
seedLines.push('-- Generated seed from live scheduler-app runtime');
seedLines.push(`-- Source: ${baseUrl}`);
seedLines.push(`-- Generated at: ${nowUtc()}`);
seedLines.push('SET SCHEMA SCHEDULER_APP;');
seedLines.push('');

const { status: projectStatus, body: projectsBody } = await getJson(`${baseUrl}/api/runtime/projects`);
if (projectStatus !== 200 || !projectsBody?.ok || !Array.isArray(projectsBody.data)) {
  throw new Error(`Failed to fetch runtime projects from ${baseUrl}/api/runtime/projects`);
}

const projects = projectsBody.data;
const versionsByProject = new Map();

for (const project of projects) {
  const { status, body } = await getJson(`${baseUrl}/api/runtime/projects/${project.id}/versions`);
  if (status !== 200 || !body?.ok || !Array.isArray(body.data)) {
    throw new Error(`Failed to fetch versions for project ${project.id}`);
  }

  const versions = body.data.map((version) => ({ ...version }));

  if (project.draftSnapshot && project.activeVersionId) {
    const activeVersion = versions.find((version) => version.id === project.activeVersionId);
    if (activeVersion) {
      // Preserve the most recent working state when migrating away from draft-based runtime.
      activeVersion.snapshot = project.draftSnapshot;
    }
  }

  versionsByProject.set(project.id, versions);
}

for (const project of projects) {
  const cleanProject = { ...project };
  delete cleanProject.draftSnapshot;

  const versions = versionsByProject.get(project.id) || [];

  seedLines.push(`-- Project ${project.name} (${project.id})`);
  seedLines.push(`MERGE INTO SCHEDULER_PROJECTS AS target`);
  seedLines.push(`USING (`);
  seedLines.push(`  SELECT`);
  seedLines.push(`    ${sqlString(cleanProject.id)} AS ID,`);
  seedLines.push(`    ${sqlString(cleanProject.name)} AS NAME,`);
  seedLines.push(`    ${sqlString(cleanProject.createdAt)} AS CREATED_AT_RAW,`);
  seedLines.push(`    ${sqlString(cleanProject.updatedAt)} AS UPDATED_AT_RAW,`);
  seedLines.push(`    NULL AS ACTIVE_VERSION_ID,`);
  seedLines.push(`    ${cleanProject.revision ?? 1} AS REVISION`);
  seedLines.push(`  FROM DUMMY`);
  seedLines.push(`) AS source`);
  seedLines.push(`ON target.ID = source.ID`);
  seedLines.push(`WHEN MATCHED THEN UPDATE SET`);
  seedLines.push(`  target.NAME = source.NAME,`);
  seedLines.push(`  target.CREATED_AT = TO_TIMESTAMP(source.CREATED_AT_RAW),`);
  seedLines.push(`  target.UPDATED_AT = TO_TIMESTAMP(source.UPDATED_AT_RAW),`);
  seedLines.push(`  target.ACTIVE_VERSION_ID = source.ACTIVE_VERSION_ID,`);
  seedLines.push(`  target.REVISION = source.REVISION`);
  seedLines.push(`WHEN NOT MATCHED THEN INSERT (ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION)`);
  seedLines.push(`VALUES (source.ID, source.NAME, TO_TIMESTAMP(source.CREATED_AT_RAW), TO_TIMESTAMP(source.UPDATED_AT_RAW), source.ACTIVE_VERSION_ID, source.REVISION);`);
  seedLines.push('');

  seedLines.push(`DELETE FROM SCHEDULER_VERSIONS WHERE PROJECT_ID = ${sqlString(project.id)};`);

  for (const version of versions) {
    seedLines.push(`INSERT INTO SCHEDULER_VERSIONS (`);
    seedLines.push(`  ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON, SNAPSHOT_SCHEMA_VERSION`);
    seedLines.push(`) VALUES (`);
    seedLines.push(`  ${sqlString(version.id)},`);
    seedLines.push(`  ${sqlString(version.projectId)},`);
    seedLines.push(`  ${version.versionNumber},`);
    seedLines.push(`  ${sqlString(version.label ?? null)},`);
    seedLines.push(`  ${sqlString(version.parentVersionId ?? null)},`);
    seedLines.push(`  TO_TIMESTAMP(${sqlString(version.createdAt)}),`);
    seedLines.push(`  ${sqlJson(version.snapshot)},`);
    seedLines.push(`  3`);
    seedLines.push(`);`);
  }

  seedLines.push(`UPDATE SCHEDULER_PROJECTS`);
  seedLines.push(`SET ACTIVE_VERSION_ID = ${sqlString(cleanProject.activeVersionId ?? null)},`);
  seedLines.push(`    UPDATED_AT = TO_TIMESTAMP(${sqlString(cleanProject.updatedAt)}),`);
  seedLines.push(`    REVISION = ${cleanProject.revision ?? 1}`);
  seedLines.push(`WHERE ID = ${sqlString(cleanProject.id)};`);
  seedLines.push('');
}

const summaryRes = await getJson(`${baseUrl}/api/public/summary`);
if (summaryRes.status === 200 && summaryRes.body && !summaryRes.body.error) {
  seedLines.push(`MERGE INTO SCHEDULER_PUBLICATIONS AS target`);
  seedLines.push(`USING (`);
  seedLines.push(`  SELECT 'summary.latest' AS PUBLICATION_KEY, 'summary' AS PAYLOAD_TYPE, ${sqlJson(summaryRes.body)} AS PAYLOAD_JSON, CURRENT_UTCTIMESTAMP AS PUBLISHED_AT FROM DUMMY`);
  seedLines.push(`) AS source`);
  seedLines.push(`ON target.PUBLICATION_KEY = source.PUBLICATION_KEY`);
  seedLines.push(`WHEN MATCHED THEN UPDATE SET target.PAYLOAD_TYPE = source.PAYLOAD_TYPE, target.PAYLOAD_JSON = source.PAYLOAD_JSON, target.PUBLISHED_AT = source.PUBLISHED_AT`);
  seedLines.push(`WHEN NOT MATCHED THEN INSERT (PUBLICATION_KEY, PAYLOAD_TYPE, PAYLOAD_JSON, PUBLISHED_AT) VALUES (source.PUBLICATION_KEY, source.PAYLOAD_TYPE, source.PAYLOAD_JSON, source.PUBLISHED_AT);`);
  seedLines.push('');
} else {
  seedLines.push(`-- Summary publication was not available at generation time.`);
  seedLines.push('');
}

const vatsRes = await getJson(`${baseUrl}/api/public/vats`);
if (vatsRes.status === 200 && vatsRes.body && !vatsRes.body.error) {
  seedLines.push(`MERGE INTO SCHEDULER_PUBLICATIONS AS target`);
  seedLines.push(`USING (`);
  seedLines.push(`  SELECT 'vats.latest' AS PUBLICATION_KEY, 'vats' AS PAYLOAD_TYPE, ${sqlJson(vatsRes.body)} AS PAYLOAD_JSON, CURRENT_UTCTIMESTAMP AS PUBLISHED_AT FROM DUMMY`);
  seedLines.push(`) AS source`);
  seedLines.push(`ON target.PUBLICATION_KEY = source.PUBLICATION_KEY`);
  seedLines.push(`WHEN MATCHED THEN UPDATE SET target.PAYLOAD_TYPE = source.PAYLOAD_TYPE, target.PAYLOAD_JSON = source.PAYLOAD_JSON, target.PUBLISHED_AT = source.PUBLISHED_AT`);
  seedLines.push(`WHEN NOT MATCHED THEN INSERT (PUBLICATION_KEY, PAYLOAD_TYPE, PAYLOAD_JSON, PUBLISHED_AT) VALUES (source.PUBLICATION_KEY, source.PAYLOAD_TYPE, source.PAYLOAD_JSON, source.PUBLISHED_AT);`);
  seedLines.push('');
} else {
  seedLines.push(`-- VAT publication was not available at generation time.`);
  seedLines.push('');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${seedLines.join('\n')}\n`, 'utf8');

console.log(`Generated HANA seed SQL: ${outputPath}`);
console.log(`Projects exported: ${projects.length}`);
console.log(`Versions exported: ${Array.from(versionsByProject.values()).reduce((sum, versions) => sum + versions.length, 0)}`);
