# Direct SQL Binding Contract

## Goal
Keep the app simple: direct connection from the Node server to HANA Cloud using standard environment variables.

## Recommended env vars
- `HANA_HOST`
- `HANA_PORT`
- `HANA_SCHEMA`
- `HANA_USER`
- `HANA_PASSWORD`
- `HANA_ENCRYPT=true`
- `HANA_VALIDATE_CERTIFICATE=true`

## Optional app env vars already used
- `NODE_ENV=production`
- `CORS_ORIGIN`
- `SME_SOURCE_URL`

## Recommended Cloud Foundry setup
Use `cf set-env` on the app:

```bash
cf set-env scheduler-app HANA_HOST "<host>"
cf set-env scheduler-app HANA_PORT "443"
cf set-env scheduler-app HANA_SCHEMA "SCHEDULER_APP"
cf set-env scheduler-app HANA_USER "SCHEDULER_APP_USER"
cf set-env scheduler-app HANA_PASSWORD "<password>"
cf set-env scheduler-app HANA_ENCRYPT "true"
cf set-env scheduler-app HANA_VALIDATE_CERTIFICATE "true"
```

Then:

```bash
cf restage scheduler-app
```

## Server-side repository contract
When we wire the app, the Node server should expose one HANA repository with methods matching the current runtime behavior:
- `getProjects()`
- `getProject(id)`
- `upsertProject(project)`
- `deleteProject(id)`
- `getVersions(projectId)`
- `getVersion(id)`
- `addVersion(version)`
- `updateVersion(id, snapshot)`
- `deleteVersion(id)`
- `getLatestPublication(key)`
- `upsertPublication(key, payload)`

## Migration strategy
1. Create schema/user.
2. Run `001_initial_schema.sql`.
3. Add HANA client to the app.
4. Implement a HANA-backed repository behind the existing REST API.
5. Keep current API contract unchanged.
6. Migrate existing in-memory/file data if needed.

## Why this is safe
The frontend does not need to change first. We can swap the backend persistence layer while preserving:
- current routes
- current JSON contracts
- current versioning behavior
- current public APIs

