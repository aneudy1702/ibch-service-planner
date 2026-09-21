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

Any static server works. Example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Production deployment (Cloudflare Pages + D1)

Production deploys run automatically from GitHub Actions on every push to `main`.

Flow:

1. `npm test` runs in CI
2. D1 migrations are applied remotely
3. GitHub Actions deploys the repository root (`.`) to Cloudflare Pages using Wrangler Direct Upload

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
4. Run **Initialize Cloudflare D1** workflow once (creates DB and applies migrations).
5. In Cloudflare Pages project settings, add a D1 binding:
   - Binding name: `DB`
   - Database: `ibch-service-planner`

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
