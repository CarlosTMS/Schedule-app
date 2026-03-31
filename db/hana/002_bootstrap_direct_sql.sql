-- Scheduler App - Direct SQL bootstrap for HANA Cloud
--
-- Fill these placeholders before execution:
--   {{SCHEMA_NAME}}
--   {{APP_USER}}
--   {{APP_PASSWORD}}
--
-- Recommended approach:
--   1. Run this with a high-privilege DB user
--   2. Reconnect as {{APP_USER}}
--   3. Run 001_initial_schema.sql inside {{SCHEMA_NAME}}

CREATE SCHEMA "{{SCHEMA_NAME}}";

CREATE USER "{{APP_USER}}" PASSWORD "{{APP_PASSWORD}}" NO FORCE_FIRST_PASSWORD_CHANGE;

GRANT CONNECT TO "{{APP_USER}}";
GRANT RESOURCE ADMIN TO "{{APP_USER}}";

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ANY, DROP, ALTER
ON SCHEMA "{{SCHEMA_NAME}}" TO "{{APP_USER}}";

ALTER USER "{{APP_USER}}" DISABLE PASSWORD LIFETIME;

-- Optional sanity checks
SELECT SCHEMA_NAME FROM SYS.SCHEMAS WHERE SCHEMA_NAME = '{{SCHEMA_NAME}}';
SELECT USER_NAME FROM SYS.USERS WHERE USER_NAME = '{{APP_USER}}';

