# IBCH Service Planner

IBCH Service Planner is a small, mobile-first Progressive Web App that helps organize church participation assignments.

## Version 1 scope

Version 1 only supports one active role:

- **Opening Reading** (`Lectura Inicial`)

The app supports:

- People management (add, rename, activate/deactivate, pause)
- Assignment workflow (`selected`, `confirmed`, `declined`, `completed`, `cancelled`)
- Decline reasons and replacement selection
- Assignment history + simple participation summary
- Export/import backup JSON
- Offline-capable installable PWA shell

## Architecture

Static files only:

- `index.html`: App shell and views (Home, People, History, Settings)
- `css/app.css`: Mobile-first styling
- `js/storage.js`: Versioned localStorage data abstraction
- `js/rotation.js`: Selection/rotation logic
- `js/people.js`: Participation summaries/stat helpers
- `js/app.js`: UI wiring and workflow behavior
- `data/people.json`: Initial seed list
- `manifest.json` + `service-worker.js`: PWA install/offline support

No backend, database, authentication, framework, or build system is used.

## Data storage

Runtime persistence uses browser `localStorage` through `js/storage.js` only.

Stored model includes:

- `version: 1`
- `people`
- `roles`
- `services`
- `assignments`
- `settings`
- `meta`

On first load, people are seeded from `data/people.json`. After that, data is managed from localStorage.

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

## Deploying as a static site

Deploy this folder directly to:

- GitHub Pages
- Cloudflare Pages
- Any static host

The app uses relative asset, manifest, and service worker paths so it can run from a root domain or a repository subpath without extra deployment-specific configuration.

## localStorage limitations

- Data is per browser/device
- Clearing browser site data removes app data
- Data does not sync automatically across devices

Use **Export Backup** regularly and **Import Backup** when restoring/migrating.

## Backup and import

- Export creates full app model JSON (for example `ibch-service-planner-backup-YYYY-MM-DD.json`)
- Import validates schema version, people, assignments, IDs, statuses, service dates, and settings before replacing current data

## Dates

- Service dates are stored as local calendar dates (`YYYY-MM-DD`)
- Next-Sunday calculation uses local time instead of UTC-based date slicing

## Tests

Run the lightweight rotation tests with:

```bash
npm test
```

## Future extension path

The model is role-oriented (not reader-specific), so future roles can be added without redesigning core storage concepts, for example:

- Worship leader
- Opening prayer
- Welcome
- Special music
- Closing prayer

These roles are intentionally **not implemented** in Version 1.
