# Seeding Current Live Data into HANA

## Purpose
Capture the current live state from the running platform before switching persistence to HANA.

## What gets seeded
- Runtime projects
- All project versions
- The current active project metadata
- The latest public summary payload
- The latest public VAT payload, when available

## Important behavior
If the live runtime still exposes `draftSnapshot` inside a project record, the generator folds that state into the active version snapshot during seed generation. That preserves the most recent working state when migrating away from draft-based persistence.

## Generate seed SQL

```bash
node scripts/generate_hana_seed.mjs
```

Optional:

```bash
node scripts/generate_hana_seed.mjs "https://scheduler-app.cfapps.us10.hana.ondemand.com" "db/hana/003_seed_from_live.sql"
```

## Apply order
1. Run [001_initial_schema.sql](/Users/I848070/Documents/Github/Schedule-app/db/hana/001_initial_schema.sql)
2. Run the generated `003_seed_from_live.sql`

## Notes
- The generated seed is environment-specific and captures a point-in-time export.
- Re-run the generator right before cutover if you want the freshest state.
- If no VAT publication exists yet, the generated seed will leave a comment and skip that payload.
