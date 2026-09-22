# IBCH Service Planner

IBCH Service Planner is a small, mobile-first Progressive Web App that helps organize church participation assignments.

## Version 1 scope

Version 1 only supports one active role:

- **Opening Reading** (`Lectura Inicial`)

The app supports:

- People management (add, rename, title, activate/deactivate, pause)
- Assignment workflow (`selected`, `confirmed`, `declined`, `completed`, `cancelled`)
- Decline reasons and replacement selection
- Assignment history + simple participation summary
- Export/import backup JSON
- Offline-capable installable PWA shell

## Architecture

Static app + minimal Cloudflare Pages Functions:

- `index.html`: App shell and views (Home, People, History, Settings)
- `css/app.css`: Mobile-first styling
- `js/app.js`: UI wiring and workflow behavior
- `js/data.js`: People data access boundary (D1-first with local cache fallback)
- `js/storage.js`: localStorage abstraction for cached people + local assignments/history/settings
- `js/people-model.js`: people normalization (including pastor deduplication) + title display helpers
- `functions/api/people.js`: minimal API (`GET`, `POST`, `PATCH`) backed by D1
- `migrations/0001_people.sql`: D1 schema + idempotent people seed
- `js/rotation.js`: Selection/rotation logic
- `js/people.js`: Participation summaries/stat helpers
- `manifest.json` + `service-worker.js`: PWA install/offline support

## Data storage

### Shared in Cloudflare D1 (source of truth)

- `people`
  - `id`, `name`, `title`, `active`, `paused`, `created_at`, `updated_at`

People edits now sync across trusted users/devices through D1.

### Local-only in browser `localStorage`

- Assignments/history
- Next service date settings
- Local cache of people used for fallback when D1 is temporarily unavailable

The app no longer treats stale local cache as authoritative when D1 is reachable.

## Pastor canonical record

The duplicated pastor records were consolidated into one canonical person:

```json
{
  "id": "person-carlos-pacheco",
  "name": "Carlos Pacheco",
  "title": "Pastor"
}
```

`person-el-pastor` is removed from seed/migration and cleaned from normalized local data.

## Rotation behavior (high level)

Selection logic is isolated in `js/rotation.js` and tries to give broad opportunity:

1. Excludes inactive and paused people
2. Excludes anyone already declined for the same service during the current replacement flow
3. Prioritizes people who have never completed the role
4. Prioritizes people who served least recently
5. Uses randomness only among equal-priority ties

Reason-specific persistent effects stay outside the ranking logic:

- `unavailable_service`: excludes only for that service
- `pause`: pauses future selection
- `remove_rotation`: deactivates the person
- `shy` / `other`: recorded without auto-pausing or deactivating

## Running locally

Install dependencies, then start the app through the Cloudflare Pages runtime:

```bash
npm install
npm run dev
```

`npm run dev` applies migrations to a local D1 database and starts Wrangler Pages development. Open the URL Wrangler prints (normally `http://localhost:8788`). The local D1 data is persisted under `.wrangler/state` and is separate from production; local commands do not mutate the production database unless `--remote` is explicitly supplied.

To reapply pending local migrations without starting the app:

```bash
npm run db:migrate:local
```

To reset and reseed local D1, stop Wrangler, remove its local state, and rerun the migration:

```bash
rm -rf .wrangler/state
npm run db:migrate:local
```

The migration creates the `people` table and applies the repository's idempotent seed data.

## Production deployment (Cloudflare Pages + D1)

Production deploys run automatically from GitHub Actions on every push to `main`.

Flow:

1. `npm test` runs in CI
2. The configured D1 database name and UUID are verified
3. D1 migrations are applied remotely
4. GitHub Actions deploys the repository root (`.`) to Cloudflare Pages using the checked-in Wrangler configuration, including the `DB` binding
5. CI requests the deployment-specific `/api/people` endpoint and fails unless it returns successful JSON with a `people` array

Cloudflare configuration secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Deployment workflow environment constant:

- `CLOUDFLARE_D1_DATABASE_NAME=ibch-service-planner` (defined in `.github/workflows/deploy.yml`)

## One-time Cloudflare setup

1. Add GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
2. Ensure `CLOUDFLARE_API_TOKEN` includes permissions for **both**:
   - Cloudflare Pages deployment
   - Cloudflare D1 database create/migration operations
   - If your token currently has Pages-only scope, update or replace it to include D1 management permissions.
3. Run **Initialize Cloudflare Pages** workflow once.
4. The current production database is already provisioned. If it is ever recreated with **Initialize Cloudflare D1**, update `database_id` in `wrangler.toml` to the new UUID before deploying. The deploy workflow intentionally fails on a name/UUID mismatch instead of binding or migrating the wrong database.
5. The repository's `wrangler.toml` declaratively binds `DB` to the `ibch-service-planner` database. A manual dashboard binding is not required for deployments made by the repository workflow.

After this setup, normal deployments on `main` run tests, apply migrations, and deploy.

## API error handling

If the people API is unavailable, the app shows a clear Spanish warning and keeps user edits in local cache instead of silently dropping them. Those edits are not considered synced until D1 is reachable again.

## Backup and import

- Export creates full app model JSON (for example `ibch-service-planner-backup-YYYY-MM-DD.json`)
- Import validates schema version, people, assignments, IDs, statuses, service dates, and settings before replacing current local state

## Dates

- Service dates are stored as local calendar dates (`YYYY-MM-DD`)
- Next-Sunday calculation uses local time instead of UTC-based date slicing

## Tests

Run the lightweight test suite locally with:

```bash
npm test
```

GitHub Actions runs `npm test` automatically for pushes to `main` and pull requests targeting `main`, and the production deploy workflow runs `npm test` before deploying.

## Assignment workflow

The Home flow for **Lectura Inicial** is intentionally small:

1. No assignment → **Seleccionar persona**
2. `selected` → **Confirmar** or **Elegir otra persona**
3. `confirmed` → **Marcar como completado** or **Elegir otra persona**

The standard **Seleccionar persona** action is only available when there is no active assignment for the current service. Replacements happen explicitly through **Elegir otra persona**, which keeps the declined/completed history intact.

## Future extension path

The model is role-oriented (not reader-specific), so future roles can be added without redesigning core storage concepts, for example:

- Worship leader
- Opening prayer
- Welcome
- Special music
- Closing prayer

These roles are intentionally **not implemented** in Version 1.
