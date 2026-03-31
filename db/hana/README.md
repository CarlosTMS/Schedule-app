# HANA Cloud Persistence Plan

## Goal
Move the current in-memory/file-based runtime persistence into HANA Cloud without breaking the existing app behavior.

## What this schema covers
- Versioned projects
- Immutable version snapshots
- Active version pointer per project
- Optimistic concurrency via project revision
- Public Summary API latest payload
- Public VATs API latest payload

## Why JSON snapshots
The current app stores a rich `RunSnapshot` object with nested records, assignments, overrides, metrics, and evaluation output. Storing the snapshot as JSON in HANA lets us:
- preserve 100% of current app behavior
- migrate fast with low functional risk
- normalize later only where it adds real value

## Tables
- `SCHEDULER_PROJECTS`
  Stores project metadata and active version pointer.
- `SCHEDULER_VERSIONS`
  Stores immutable version snapshots as JSON.
- `SCHEDULER_PUBLICATIONS`
  Stores the latest published Summary/VAT payloads for public API access.
- `SCHEDULER_APP_STATE`
  Reserved for future singleton state, migrations, or runtime flags.

## Expected app mapping
- `GET /api/runtime/projects`
  Read from `SCHEDULER_PROJECTS`
- `POST /api/runtime/projects`
  Insert into `SCHEDULER_PROJECTS`
- `PATCH /api/runtime/projects/:id`
  Update metadata/revision in `SCHEDULER_PROJECTS`
- `GET /api/runtime/projects/:id/versions`
  Read from `SCHEDULER_VERSIONS`
- `POST /api/runtime/projects/:id/versions`
  Insert into `SCHEDULER_VERSIONS`
- `PATCH /api/runtime/versions/:id`
  Update `SNAPSHOT_JSON` in `SCHEDULER_VERSIONS` and refresh project metadata
- `DELETE /api/runtime/versions/:id`
  Delete from `SCHEDULER_VERSIONS`, then recalculate `ACTIVE_VERSION_ID`
- `GET/POST /api/public/summary`
  Read/write `SCHEDULER_PUBLICATIONS` where `PUBLICATION_KEY = 'summary.latest'`
- `GET/POST /api/public/vats`
  Read/write `SCHEDULER_PUBLICATIONS` where `PUBLICATION_KEY = 'vats.latest'`

## Recommended next implementation step
Use `@sap/hana-client` plus `@sap/xsenv` in the Node server and keep the same REST contract. Replace `runtime-store.mjs` with a small repository layer backed by HANA.

## Open decision
The only important infrastructure choice left is:
- direct DB credentials / SQL user
- or HDI container artifacts and binding

That choice changes the deployment artifact format, but not the data model above.
