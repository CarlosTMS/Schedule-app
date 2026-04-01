-- Scheduler App - Runtime/HANA verification queries
--
-- Purpose:
--   Validate that edits made in the app are actually landing in HANA.
--
-- What to look for after saving in the app:
--   1. PROJECT_REVISION increases
--   2. PROJECT_UPDATED_AT / PROJECT_UPDATED_BY change
--   3. ACTIVE_VERSION_ID points to the version you edited
--   4. VERSION_CREATED_BY reflects the editor name used in the UI
--   5. PUBLICATIONS move forward when refreshing/publishing API snapshots
--   6. SNAPSHOT_JSON contains the sections you expect to have changed
--
-- Optional:
--   Replace 'Final Sim' below if you want to target another project name.

SET SCHEMA SCHEDULER_APP;

--------------------------------------------------------------------------------
-- 1) Project + active version metadata
--    This is the main "did my save land?" check.
--------------------------------------------------------------------------------
SELECT
  p.ID                         AS PROJECT_ID,
  p.NAME                       AS PROJECT_NAME,
  p.REVISION                   AS PROJECT_REVISION,
  p.UPDATED_AT                 AS PROJECT_UPDATED_AT,
  p.UPDATED_BY                 AS PROJECT_UPDATED_BY,
  p.ACTIVE_VERSION_ID          AS ACTIVE_VERSION_ID,
  v.VERSION_NUMBER             AS ACTIVE_VERSION_NUMBER,
  v.LABEL                      AS ACTIVE_VERSION_LABEL,
  v.CREATED_AT                 AS ACTIVE_VERSION_CREATED_AT,
  v.CREATED_BY                 AS ACTIVE_VERSION_CREATED_BY
FROM SCHEDULER_PROJECTS p
LEFT JOIN SCHEDULER_VERSIONS v
  ON v.ID = p.ACTIVE_VERSION_ID
WHERE p.NAME = 'Final Sim'
ORDER BY p.UPDATED_AT DESC;

--------------------------------------------------------------------------------
-- 2) Version history for the target project
--    Useful to confirm that "Save as new version" or current-version updates
--    are persisting as expected.
--------------------------------------------------------------------------------
SELECT
  v.ID                         AS VERSION_ID,
  v.PROJECT_ID,
  v.VERSION_NUMBER,
  v.LABEL,
  v.PARENT_VERSION_ID,
  v.CREATED_AT,
  v.CREATED_BY,
  LENGTH(v.SNAPSHOT_JSON)      AS SNAPSHOT_SIZE_BYTES
FROM SCHEDULER_VERSIONS v
JOIN SCHEDULER_PROJECTS p
  ON p.ID = v.PROJECT_ID
WHERE p.NAME = 'Final Sim'
ORDER BY v.VERSION_NUMBER DESC, v.CREATED_AT DESC;

--------------------------------------------------------------------------------
-- 3) Latest public publications
--    Confirms whether Summary/VAT snapshots were refreshed from the app.
--------------------------------------------------------------------------------
SELECT
  PUBLICATION_KEY,
  PAYLOAD_TYPE,
  SOURCE_PROJECT_ID,
  SOURCE_VERSION_ID,
  PUBLISHED_AT,
  PUBLISHED_BY,
  LENGTH(PAYLOAD_JSON)         AS PAYLOAD_SIZE_BYTES
FROM SCHEDULER_PUBLICATIONS
WHERE PUBLICATION_KEY IN ('summary.latest', 'vats.latest')
ORDER BY PUBLICATION_KEY;

--------------------------------------------------------------------------------
-- 4) Snapshot content sanity check for the active version
--    This does not try to fully parse the JSON; it verifies that the major
--    editable sections are present in the active version snapshot.
--------------------------------------------------------------------------------
SELECT
  p.NAME AS PROJECT_NAME,
  p.ACTIVE_VERSION_ID,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"manualSmeAssignments"') > 0 THEN 'Y' ELSE 'N' END AS HAS_SME_ASSIGNMENTS,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"smeConfirmationState"') > 0 THEN 'Y' ELSE 'N' END AS HAS_SME_CONFIRMATIONS,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"manualFacultyAssignments"') > 0 THEN 'Y' ELSE 'N' END AS HAS_FACULTY_ASSIGNMENTS,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"sessionTimeOverrides"') > 0 THEN 'Y' ELSE 'N' END AS HAS_SESSION_OVERRIDES,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"sessionInstanceTimeOverrides"') > 0 THEN 'Y' ELSE 'N' END AS HAS_INSTANCE_OVERRIDES,
  CASE WHEN LOCATE(v.SNAPSHOT_JSON, '"evaluationsOutput"') > 0 THEN 'Y' ELSE 'N' END AS HAS_EVALUATIONS_OUTPUT
FROM SCHEDULER_PROJECTS p
JOIN SCHEDULER_VERSIONS v
  ON v.ID = p.ACTIVE_VERSION_ID
WHERE p.NAME = 'Final Sim';

--------------------------------------------------------------------------------
-- 5) Optional preview of the active snapshot JSON
--    Helpful when you need to inspect whether a field/value appears at all.
--------------------------------------------------------------------------------
SELECT
  p.NAME AS PROJECT_NAME,
  p.ACTIVE_VERSION_ID,
  SUBSTR(v.SNAPSHOT_JSON, 1, 4000) AS SNAPSHOT_JSON_PREVIEW
FROM SCHEDULER_PROJECTS p
JOIN SCHEDULER_VERSIONS v
  ON v.ID = p.ACTIVE_VERSION_ID
WHERE p.NAME = 'Final Sim';

--------------------------------------------------------------------------------
-- 6) Optional preview of the published Summary/VAT payloads
--    Helps confirm the API-facing snapshots changed after "Refresh API snapshot".
--------------------------------------------------------------------------------
SELECT
  PUBLICATION_KEY,
  SOURCE_VERSION_ID,
  PUBLISHED_AT,
  SUBSTR(PAYLOAD_JSON, 1, 2000) AS PAYLOAD_JSON_PREVIEW
FROM SCHEDULER_PUBLICATIONS
WHERE PUBLICATION_KEY IN ('summary.latest', 'vats.latest')
ORDER BY PUBLICATION_KEY;
