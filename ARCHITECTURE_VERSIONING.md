# Versioning & Project Management Architecture (V3)

This document outlines the refactored architecture for simulation run persistence and versioning.

## 1. Core Concepts

### Projects
A **Project** is a collection of related simulation runs. It serves as a container for multiple versions.
- **Project Name**: User-defined descriptive name.
- **Active Version**: Pointer to the latest "official" version of the project.

### Immutable Versions
A **Version** is a complete, point-in-time snapshot of the simulation state.
- **Immutability**: Once saved, a version CANNOT be edited.
- **Versioning**: Every "Save" operation creates a new incremented version (v1, v2, v3...).
- **Snapshots**: Contains inputs (records, assumptions, rules, distributions) and outputs (allocation results, manual overrides).

### Local Drafts
To ensure performance and reliability, working changes are stored in a **Local Draft**.
- **Volatile**: Drafts exist only in the user's current session/browser.
- **Autosave**: Every change is instantly persisted to the local draft.
- **Promotion**: When a user clicks "Save as new version", the current draft is promoted to an official Immutable Version on the server.

---

## 2. API Contract

The Runtime Store provides the following RESTful endpoints:

### Projects
- `GET /api/runtime/projects`: List all projects.
- `POST /api/runtime/projects`: Create/Update a project metadata.
- `PATCH /api/runtime/projects/:id`: Update project metadata (e.g., rename, update `activeVersionId`).
- `DELETE /api/runtime/projects/:id`: Delete a project and all its versions.

### Versions
- `GET /api/runtime/projects/:id/versions`: List all versions for a project (ordered by version number).
- `POST /api/runtime/projects/:id/versions`: Add a new version snapshot.
- `GET /api/runtime/versions/:id`: Retrieve a specific version's full snapshot.

### Batch Sync
- `POST /api/runtime/sync/batch`: Used for rehydration. Pushes a collection of projects and versions to the runtime. Useful when the runtime server restarts and needs to be populated from the client's local mirror.

---

## 3. Data Flow

1. **Initialization**: App reads `localStorage`. If empty but server has data, it pulls server state. If server is empty but `localStorage` has legacy data (V2), it migrates to V3 Projects.
2. **Editing**: User tweaks parameters. App updates the `Local Draft`.
3. **Saving**: User clicks "Save as new version".
    - App increments `versionNumber`.
    - App POSTs new `RunVersion` to `/api/runtime/projects/:id/versions`.
    - App PATCHes `RunProject` to update its `activeVersionId`.
    - Runtime enforces capacity limits (10 projects, 20 versions/project).
4. **Loading**: User selects an older version.
    - App loads that version's snapshot into the active state.
    - Subsequent edits create a "Draft" based on that version.

---

## 4. Why this is better than revision-based OCC
- **No Overwrites**: You never lose history because you "collided" with another user. You just create Version N+1.
- **Clear Intent**: Users explicitly decide when a state is worth keeping.
- **Branching Friendly**: Users can load an old version and start a new "Draft" from it, allowing for easy experimentation without polluting the main project line.
