import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2] || '/Users/I848070/Downloads/scheduler-localstorage-export.json';
const projectName = process.argv[3] || 'Final Sim';
const outputPath = process.argv[4] || path.resolve('db/hana/004_seed_final_sim_from_browser_export.sql');

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const projects = Array.isArray(payload.projects) ? payload.projects : [];
const versions = Array.isArray(payload.versions) ? payload.versions : [];

const project = projects.find((entry) => entry.name === projectName);
if (!project) {
  throw new Error(`Project "${projectName}" not found in ${inputPath}`);
}

const projectVersions = versions
  .filter((entry) => entry.projectId === project.id)
  .sort((a, b) => a.versionNumber - b.versionNumber);

if (projectVersions.length === 0) {
  throw new Error(`Project "${projectName}" has no versions in ${inputPath}`);
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `TO_NCLOB(${sqlString(JSON.stringify(value))})`;
}

const lines = [];
lines.push('-- Generated seed from browser localStorage export');
lines.push(`-- Source file: ${inputPath}`);
lines.push(`-- Project: ${project.name} (${project.id})`);
lines.push(`-- Versions exported: ${projectVersions.length}`);
lines.push(`-- Generated at: ${new Date().toISOString()}`);
lines.push('SET SCHEMA SCHEDULER_APP;');
lines.push('');

lines.push(`MERGE INTO SCHEDULER_PROJECTS AS target`);
lines.push(`USING (`);
lines.push(`  SELECT`);
lines.push(`    ${sqlString(project.id)} AS ID,`);
lines.push(`    ${sqlString(project.name)} AS NAME,`);
lines.push(`    ${sqlString(project.createdAt)} AS CREATED_AT_RAW,`);
lines.push(`    ${sqlString(project.updatedAt)} AS UPDATED_AT_RAW,`);
lines.push(`    ${project.revision ?? 1} AS REVISION`);
lines.push(`  FROM DUMMY`);
lines.push(`) AS source`);
lines.push(`ON target.ID = source.ID`);
lines.push(`WHEN MATCHED THEN UPDATE SET`);
lines.push(`  target.NAME = source.NAME,`);
lines.push(`  target.CREATED_AT = TO_TIMESTAMP(source.CREATED_AT_RAW),`);
lines.push(`  target.UPDATED_AT = TO_TIMESTAMP(source.UPDATED_AT_RAW),`);
lines.push(`  target.ACTIVE_VERSION_ID = NULL,`);
lines.push(`  target.REVISION = source.REVISION`);
lines.push(`WHEN NOT MATCHED THEN INSERT (ID, NAME, CREATED_AT, UPDATED_AT, ACTIVE_VERSION_ID, REVISION)`);
lines.push(`VALUES (source.ID, source.NAME, TO_TIMESTAMP(source.CREATED_AT_RAW), TO_TIMESTAMP(source.UPDATED_AT_RAW), NULL, source.REVISION);`);
lines.push('');

lines.push(`UPDATE SCHEDULER_PROJECTS`);
lines.push(`SET ACTIVE_VERSION_ID = NULL`);
lines.push(`WHERE ID = ${sqlString(project.id)};`);
lines.push('');

lines.push(`DELETE FROM SCHEDULER_VERSIONS WHERE PROJECT_ID = ${sqlString(project.id)};`);
lines.push('');

for (const version of projectVersions) {
  lines.push(`INSERT INTO SCHEDULER_VERSIONS (`);
  lines.push(`  ID, PROJECT_ID, VERSION_NUMBER, LABEL, PARENT_VERSION_ID, CREATED_AT, SNAPSHOT_JSON, SNAPSHOT_SCHEMA_VERSION`);
  lines.push(`) VALUES (`);
  lines.push(`  ${sqlString(version.id)},`);
  lines.push(`  ${sqlString(version.projectId)},`);
  lines.push(`  ${version.versionNumber},`);
  lines.push(`  ${sqlString(version.label ?? null)},`);
  lines.push(`  ${sqlString(version.parentVersionId ?? null)},`);
  lines.push(`  TO_TIMESTAMP(${sqlString(version.createdAt)}),`);
  lines.push(`  ${sqlJson(version.snapshot)},`);
  lines.push(`  3`);
  lines.push(`);`);
  lines.push('');
}

lines.push(`UPDATE SCHEDULER_PROJECTS`);
lines.push(`SET ACTIVE_VERSION_ID = ${sqlString(project.activeVersionId)},`);
lines.push(`    UPDATED_AT = TO_TIMESTAMP(${sqlString(project.updatedAt)}),`);
lines.push(`    REVISION = ${project.revision ?? 1}`);
lines.push(`WHERE ID = ${sqlString(project.id)};`);
lines.push('');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

console.log(`Generated project seed: ${outputPath}`);
console.log(`Project: ${project.name}`);
console.log(`Versions: ${projectVersions.length}`);
