# Schedule App

Scheduling and assignment web app for Solution Weeks, built with React + TypeScript + Vite, with a Node.js server for API proxy/runtime endpoints and SAP BTP Cloud Foundry deployment support.

## Core Features

- Allocation engine for sessions and schedules.
- SME and Faculty assignment workflows.
- Summary tab with exports (Excel/CSV/JSON), warnings filter, and publish endpoint for summary snapshots.
- VAT tab publish action for public VAT snapshot API (`/api/public/vats`).
- Project version history with delete-version support.
- Bilingual UI (English/Spanish).
- Autosave for run edits and configuration.
- Collapsible left sidebar with persisted state across refreshes.
- Hybrid run history persistence:
  - Browser local mirror (`localStorage`).
  - Runtime in-memory API on server (`/api/runtime/*`).

## Tech Stack

- Frontend: React 19, TypeScript, Vite.
- Backend: Node.js HTTP server (`server/app.mjs`).
- Deployment: SAP BTP Cloud Foundry (`cf` CLI).

## Local Development

```bash
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Build

```bash
npm run build
```

## Runtime API Endpoints

Served by `server/app.mjs`:

- `GET /health`
- `GET /api/public/smes` (proxy to upstream SME API)
- `GET /api/public/summary`
- `POST /api/public/summary`
- `GET /api/public/vats`
- `POST /api/public/vats`
- `GET /api/runtime/projects`
- `POST /api/runtime/projects`
- `PATCH /api/runtime/projects/:id`
- `DELETE /api/runtime/projects/:id`
- `GET /api/runtime/projects/:id/versions`
- `POST /api/runtime/projects/:id/versions`
- `GET /api/runtime/versions/:id`
- `DELETE /api/runtime/versions/:id`
- `POST /api/runtime/sync/batch`

## Deploy to SAP BTP (Cloud Foundry)

Requirements:

- Cloud Foundry CLI installed (`cf`).
- Active login (`cf login` or `cf login --sso`).

One-command deployment:

```bash
./deploy_btp_cf.sh <APP_NAME>
```

Examples:

```bash
./deploy_btp_cf.sh scheduler-app
```

Optional target env vars:

```bash
export BTP_CF_API="https://api.cf.us10.hana.ondemand.com"
export BTP_CF_ORG="your-org"
export BTP_CF_SPACE="your-space"
./deploy_btp_cf.sh scheduler-app
```

Key deploy files:

- `manifest.yml`
- `.cfignore`
- `deploy_btp_cf.sh`
- `server/app.mjs`

## Upstream Sync Workflow

This project can selectively sync changes from another repository without forking.

Use:

```bash
./sync_upstream.sh --upstream-url https://github.com/CarlosTMS/Schedule-app.git
```

The script:

- Ensures/fetches `upstream` remote.
- Creates a `sync/upstream-YYYY-MM-DD` branch.
- Lists candidate commits and file diffs.
- Supports selective import via `git cherry-pick -x <sha>`.

## Notes

- Runtime history storage is in-memory by design and resets on process restart.
- For consistent runtime state, use a single CF instance unless a shared external store is introduced.
- Sidebar collapse state is stored in browser `localStorage` using key `scheduler_sidebar_collapsed_v1`.
