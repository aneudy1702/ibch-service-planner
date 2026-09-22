# IBCH Service Planner — Personas, Historial & Ajustes UX Specification (v1.1)

> **Scope & ground rules for this spec**
>
> - Applies to the **current single-role Version 1 experience** (Lectura Inicial only) and covers the three non-Home views: **Personas**, **Historial**, and **Ajustes**. Companion to [`docs/home-ux-spec.md`](./home-ux-spec.md).
> - **Reconciled against `main` after PR #7.** PR #7 shipped the approved Home screen **and** a shared UI foundation (status vocabulary, bottom-sheet dialog, live region, focus-visible, bottom-nav sizing/`aria-current`, empty-list/visually-hidden helpers). This spec treats those as **existing patterns to reuse**, not as gaps. It also reflects that the D1-backed shared people roster (PR #5) is in place.
> - Implementation **must preserve existing assignment and rotation behavior** — the state machine in `js/assignment-workflow.js`, the selection logic in `js/rotation.js`, and the stats/participation math in `js/people.js` (`getHomeStats`, `buildParticipationSummary`) are the source of truth and must not change.
> - **Current data architecture:** the people roster is **shared and D1-backed** via `functions/api/people.js`, accessed through `js/data.js`. Roster mutations go through the shared boundary — **`addSharedPerson`, `updateSharedPerson`, `loadPeople`** (with `js/people-model.js` normalization: `normalizePeople`, `displayPersonName`, `normalizeTitle`, `slugify`) — which already writes a localStorage cache/fallback and marks `syncPending` records when offline. Assignments, history, and settings remain **local** (`getAssignments`/`upsertAssignment`/`addAssignment`, `getSettings`/`saveSettings`, `exportState`/`replaceStateFromImport`). This spec **consumes these existing APIs and must not redefine or re-implement D1 synchronization**; do **not** reference the older local-only `addPerson`/`updatePerson` paths.
> - **Multi-role support is intentionally deferred.** Keep these views structured so a role dimension can be added later (e.g., a role filter in Historial) without a rewrite; no additional roles are designed now.

This document is a UX/UI specification only. It does not prescribe code.

Design tokens (in `css/app.css`): `--primary #7f5539`, `--primary-soft #ede0d4`, `--danger #9d2a2a`, `--border #dfd3ca`, `--muted #6f625b`, `--text #2f241f`, `--bg #f9f5f1`, `--card #fff`. Status tokens already defined (with matching `.status-*` badge rules): `--status-proposed`/`--status-proposed-bg` (`#7a5a1e` on `#f4ead8`), `--status-confirmed`/`--status-confirmed-bg`, `--status-completed`/`--status-completed-bg`. Only **Reemplazada** has no dedicated token yet — add and contrast-validate one (≥ 4.5:1) if badges are introduced in Historial (see §2).

---

## 0. Shared foundation already in place (reuse, do not re-invent)

PR #7 established these; every recommendation below builds on them rather than re-specifying them:

- **Status vocabulary** — `STATUS_TEXT` = Propuesta / Confirmada / **Reemplazada** / Completada, with `STATUS_ICON` glyphs (○ ● ✓). This is the canonical vocabulary for all views.
- **Bottom-sheet dialog** — `#people-sheet.bottom-sheet` (native `<dialog aria-modal aria-labelledby>`, focus moved to close on open, focus returned to the triggering card on close, backdrop-tap/Escape close, `prefers-reduced-motion` handled). Reuse this component for any future list surface.
- **Live region** — `#home-live-region` (`aria-live="polite"`, visually-hidden) with the `announce()` helper. Currently scoped to the Home hero card; generalize/reuse it for Personas and Ajustes feedback rather than adding `alert()` calls.
- **Global ergonomics** — bottom nav `min-height: 56px` + `padding-bottom: env(safe-area-inset-bottom)` + icons + `aria-current="page"`; `:focus-visible` rings on buttons/inputs/selects/`[role="button"]`; 16px base text; `.visually-hidden` and `.empty-list` helpers. These already satisfy Home spec §8 globally — **do not report them as missing**.

**Remaining shared gaps** (still worth fixing, referenced per page):
- `prompt()` is still used for Personas rename, and `alert()` is still used for the destructive Ajustes import and for offline/error notices. The dialog + live-region infrastructure exists; these two flows simply haven't adopted it yet.
- The live region lives in the Home card only; feedback on Personas/Ajustes still routes through `alert()`.

---

## 1. Personas

### 1.1 Current behavior on latest `main`
- Card 1: "Personas" heading + add-person form — name input (`maxlength=80`, required), "Agregar" primary, and a **"Título (opcional)"** field. Submit calls **`addSharedPerson({ name, title })`** (D1, with local fallback).
- Card 2: `ul#people-list`, sorted alphabetically. Each row: display name via `displayPersonName` (shows "Nombre · Título" when a title exists), a muted status line `"{Activa|Inactiva} · {En pausa|Disponible}"`, and three controls — "Editar" (rename), an "Activa" checkbox, an "En pausa" checkbox. Checkbox changes call **`updateSharedPerson`**.
- Rename uses **two sequential `prompt()`** calls (name, then title) → `updateSharedPerson`.
- Offline/error outcomes surface via `alert()` (from `data.js` sync errors and the cache-fallback notice).

### 1.2 Remaining UX issues
- **P1 — The Activa/En pausa two-checkbox model is still ambiguous.** Eligibility is `active && !paused`, so four combinations are expressible but only three are meaningful, and "Inactiva + En pausa" is nonsense. Users can't tell how "Inactiva" differs from "En pausa" or which removes someone from the next rotation. Highest-value clarity fix.
- **P2 — Rename still uses `prompt()`** (now twice), inconsistent with the app's existing dialog pattern.
- **P3 — No roster count and no participation context per row.** A leader can't see "how many are in rotation" at a glance, and rows lack the last-served/times context Home already surfaces.
- **P4 — No empty state for an empty roster**, and add/edit feedback routes through `alert()` rather than the existing live region.
- **P5 — Shared-roster status is only surfaced on failure** (an `alert()` when D1 is unreachable). There's no calm, persistent indication that edits are shared, and duplicates are accepted silently.

### 1.3 Recommended target behavior
1. **Replace the two checkboxes with one explicit 3-state membership control** per person — segmented control or single select — mapped to the existing `active`/`paused` fields **via `updateSharedPerson`, without changing eligibility logic** (`active && !paused`):
   - **En rotación** → `{ active: true, paused: false }`
   - **En pausa** → `{ active: true, paused: true }`
   - **Fuera de rotación** → `{ active: false, paused: false }`
   Show current membership as a small chip on the row (distinct hues from assignment-status badges; contrast-validate ≥ 4.5:1).
2. **Rename (and edit title) via the existing native `<dialog>` pattern** — one dialog titled "Editar persona" with name + title fields and Guardar/Cancelar — replacing the two `prompt()` calls. Persist via `updateSharedPerson`; announce the result through the (generalized) live region.
3. **Add a roster header with a live count** — "Personas · {N} en rotación" (N = `active && !paused`), which must match Home's "Personas elegibles". Add a **secondary line per row** with participation context from `buildParticipationSummary`: "Última vez: {fecha} · {N} veces" or "Nunca ha participado".
4. **Empty state** (§1.5) and **inline feedback** via the live region on add/edit; a soft duplicate warning ("Ya existe una persona con ese nombre. ¿Agregar de todos modos?") using the confirm dialog. Defer hard dedupe to the data layer.
5. **Surface the shared roster calmly** — a small persistent note ("Los cambios se comparten con el equipo") and, if `data.js` exposes it, a non-blocking sync/offline indicator that replaces the current failure-only `alert()`. Do **not** add sync logic — only reflect state the existing API provides (e.g., `syncPending`, the `fromCache` result of `loadPeople`).
6. **Search/filter** by name is **optional/deferred** — keep only if it adds no risk.

**Hard delete is intentionally NOT added** — "Fuera de rotación" covers the safe case and preserves history integrity (deferred, §6).

### 1.4 Membership vocabulary (distinct from assignment status)
| Membership | Label | Fields | Visual |
|---|---|---|---|
| Eligible | **En rotación** | `active && !paused` | neutral/positive chip |
| Paused | **En pausa** | `active && paused` | muted/amber chip |
| Removed | **Fuera de rotación** | `!active` | muted/grey chip |

Glyph + text + tint; never color-only. Validate any new tint ≥ 4.5:1.

### 1.5 Empty & feedback copy (Spanish)
- No people at all: "Aún no hay personas en la lista. Agrega la primera para comenzar." (focus the add field).
- Search yields nothing (if search is built): "Ninguna persona coincide con «{query}»."
- After add: "Agregada: {nombre}." · After membership change: "{nombre}: {nuevo estado}." (live region, not `alert()`).

### 1.6 Target wireframe
```
┌───────────────────────────────┐
│ Personas · 26 en rotación     │
│ [ Nombre…            ][Agregar]│
│ [ Título (opcional)         ] │
│ Los cambios se comparten…     │  ← calm shared-roster note
├───────────────────────────────┤
│ Carlos Pacheco · Pastor       │
│ (En rotación)                 │  ← membership chip
│ Última vez: 21 sep · 3 veces  │  ← participation context
│                       [Editar]│  ← opens dialog (name + title), not prompt()
│───────────────────────────────│
│ Milca Abreu      (En pausa)   │
│ Nunca ha participado          │
│                       [Editar]│
└───────────────────────────────┘
```

---

## 2. Historial

### 2.1 Current behavior on latest `main`
- Card 1: "Historial de asignaciones" + `ul#history-list`, sorted by `createdAt` desc. Each row: full long-format date, display name, a muted line `"{roleEs} · {statusText}"`, plus a muted "Motivo: …" line for replaced items. **Status vocabulary is already correct** — declined renders as **"Reemplazada"** via `STATUS_TEXT`. **An empty state already exists**: "Todavía no hay asignaciones registradas."
- Card 2: "Participación" + `ul#participation-list`. It is **already filtered to `completedCount > 0`** (only people who have actually read), and **already has an empty state**: "Aún no hay participaciones completadas." It can include people who are now paused or out of rotation if they have past completions.

### 2.2 Remaining UX issues
- **P1 — Status is plain muted text, not a badge.** The vocabulary is right, but rows show `"Lectura Inicial · Reemplazada"` as muted text; there's no visual status treatment consistent with Home's badges.
- **P2 — No filtering or grouping.** The log is chronological only — no filter by person/status, no grouping by service date. It won't scale as history grows.
- **P3 — Participación vs. Home eligibility is unexplained.** Participación lists everyone with a completion (including paused/removed), while Home's cards count only eligible people. The difference is intentional but uncaptioned, so the same names can imply different totals across views.
- **P4 — Date verbosity.** The long date ("domingo, 28 de septiembre de 2025") on every row is heavy for a scannable log.

> Note: "Rechazada→Reemplazada" and the two empty states were requested in the previous draft as fixes; **they are already implemented on `main`** and are listed here only as behavior to **preserve**, not as defects.

### 2.3 Recommended target behavior
1. **Render status as a badge** (glyph + text + tint) by reusing the existing Home badge treatments and their `.status-proposed` / `.status-confirmed` / `.status-completed` classes and tokens (`--status-proposed`, `--status-confirmed`, `--status-completed`). Only **Reemplazada** lacks a treatment — introduce and contrast-validate one (≥ 4.5:1) if it needs distinct styling; otherwise it can fall back to the neutral badge base. Keep the "Motivo" line for replaced items. **Preserve the Reemplazada wording.**
2. **Group the log by service date** with a short-format header (e.g., "dom 28 sep 2025") and that date's assignment(s) beneath it — reads as "what happened each Sunday" and compresses repeated dates.
3. **Add lightweight client-side filters** (person, status). Leave a **reserved slot for a future role filter** (do not build it).
4. **Caption Participación** to reconcile it with Home: "Resumen de quienes han participado, incluidas personas ahora en pausa o fuera de rotación." Optionally add a "Solo en rotación" toggle mirroring Home eligibility. **Keep the existing `completedCount > 0` filter and empty state.**
5. **Reduce date verbosity** (short format on group headers; optionally omit the current year).

Keep both lists **read-only**.

### 2.4 Empty-state copy (Spanish) — preserve existing, add filter case
- No assignments: "Todavía no hay asignaciones registradas." *(already implemented — preserve)*
- No completed participation: "Aún no hay participaciones completadas." *(already implemented — preserve)*
- Filter yields nothing (new): "No hay asignaciones que coincidan con el filtro."

### 2.5 Target wireframe
```
┌───────────────────────────────┐
│ Historial                     │
│ Persona: [Todas ▾]  Estado:[▾]│  ← filters (role slot reserved)
├───────────────────────────────┤
│ dom 21 sep 2025               │  ← date group header (short)
│  Carlos Pacheco · Pastor      │
│  Lectura Inicial ( ✓ Completada)│ ← badge, not muted text
│───────────────────────────────│
│ dom 14 sep 2025               │
│  Eliana                       │
│  Lectura Inicial ( ↔ Reemplazada)│
│  Motivo: Prefiere no leer     │
├───────────────────────────────┤
│ Participación                 │
│ Resumen de quienes han        │  ← caption
│ participado, incl. en pausa / │
│ fuera de rotación.            │
│ [ ] Solo en rotación          │  ← optional toggle
│───────────────────────────────│
│ Carlos Pacheco · Pastor       │
│ 3 veces · Última: 21 sep      │
└───────────────────────────────┘
```

---

## 3. Ajustes

### 3.1 Current behavior on latest `main`
- Card 1: "Ajustes" + "Fecha del próximo servicio" (`<input type="date">`) + "Guardar fecha" (`saveSettings`, synced with Home's date control).
- Card 2: "Respaldo" — "Exportar respaldo" (`exportState`), an "Importar respaldo" file input + a second "Importar respaldo" button (`replaceStateFromImport`). Note: "La importación reemplaza los datos locales actuales después de validarlos." All outcomes use `alert()`; there is **no confirmation step**.
- **Fact for copy accuracy:** `exportState()` serializes the full local state **including the people cache**, and `replaceStateFromImport()` **replaces that local people cache** (it does not push to D1; on the next `loadPeople()` the shared D1 roster can re-merge/override non-`syncPending` records). So people are **not** currently excluded from backup.

### 3.2 Remaining UX issues
- **P1 — Destructive import with no confirmation.** `replaceStateFromImport` overwrites all local state behind a plain button and a single `alert()`.
- **P2 — Backup/import semantics vs. the shared D1 roster are unclear.** Backup includes the local people cache, but import doesn't reconcile with D1; the resulting behavior for people is ambiguous. **This is a data-semantics decision for the data-layer owners** — the spec sets UX guardrails and truthful copy requirements, not the resolution.
- **P3 — Weak feedback and redundant labels.** Everything is `alert()`; the section heading and the button are both "Importar respaldo".
- **P4 — No "about"/version affordance** for a service-worker-updated PWA.

### 3.3 Recommended target behavior
1. **Gate import behind a confirmation dialog** (reuse the native `<dialog>` pattern) with destructive framing and `--danger` only on the confirm action: title "Reemplazar datos", body "Esto reemplazará las asignaciones, el historial y los ajustes locales por el contenido del respaldo. Esta acción no se puede deshacer.", buttons "Cancelar" / "Reemplazar datos". Proceed only on explicit confirm.
2. **State the backup scope truthfully — verify against code before finalizing copy.** Do **not** claim people are excluded. Pending the data-layer decision, describe actual behavior, e.g.: "El respaldo incluye la lista de personas en caché junto con las asignaciones, el historial y los ajustes. Al importar, la lista de personas puede volver a sincronizarse con la base compartida (D1)." If the data-layer team decides import should not touch people, update both the code and this copy together.
3. **Group into a "Zona de datos"** that separates destructive backup actions from the routine date setting; reserve `--danger` for the confirm action only.
4. **Keep the date field here, synced with Home** (per Home spec). Optionally adopt save-on-change, or keep "Guardar fecha" with a "Cambios sin guardar" hint when the field differs from stored.
5. **Replace `alert()` with inline + live-region feedback**: "Respaldo exportado", "Respaldo importado correctamente", "El archivo no es un respaldo válido".
6. **Resolve the duplicate "Importar respaldo" labels** (section "Respaldo"; actions "Exportar" and "Importar…").
7. **Add a minimal "Acerca de"** line ("Versión 1 · Lectura Inicial", build/version if available). Low priority.

### 3.4 Feedback copy (Spanish)
- No file chosen: "Primero selecciona un archivo de respaldo."
- Invalid file: "El archivo no es un respaldo válido."
- Import success: "Respaldo importado correctamente." · Export success: "Respaldo exportado."

### 3.5 Target wireframe
```
┌───────────────────────────────┐
│ Ajustes                       │
│ Próximo servicio              │
│ [ 2025-09-28            ]     │
│ [ Guardar fecha ]  (o auto)   │
├───────────────────────────────┤
│ Zona de datos                 │
│ El respaldo incluye personas  │  ← truthful scope (verify vs code)
│ en caché + asignaciones,      │
│ historial y ajustes.          │
│ [ Exportar respaldo ]         │
│ [ Elegir archivo… ]           │
│ [ Importar respaldo ] ─→ confirm (danger)
├───────────────────────────────┤
│ Acerca de                     │
│ Versión 1 · Lectura Inicial   │
└───────────────────────────────┘
```

---

## 4. Cross-page consistency requirements

- **One status vocabulary** across Home and Historial: Propuesta / Confirmada / Completada / **Reemplazada** (already established — preserve). Personas membership uses its own set (En rotación / En pausa / Fuera de rotación). All badges: glyph + text + tint, ≥ 4.5:1, never color alone.
- **Reuse the existing dialog pattern** for all input and confirmation (Personas edit, Ajustes import) — retire `prompt()` and destructive `alert()` confirmations.
- **Reuse/generalize the existing live region** for success/error feedback instead of `alert()`.
- **Reuse the existing empty-list pattern** (`.empty-list`, muted line; CTA where an action resolves it).
- **Global ergonomics are already in place** (bottom nav sizing, `aria-current`, focus-visible, 16px base) — preserve them; no new work required.
- **Read-only lists stay read-only** (Historial fully; Personas rows act only via Editar and the membership control).

---

## 5. Acceptance criteria (testable)

Items marked *(preserve)* are already satisfied on `main` and must not regress.

**Personas**
1. Each row shows one unambiguous membership state (En rotación / En pausa / Fuera de rotación) mapped to `active`/`paused` via `updateSharedPerson`, with eligibility logic unchanged (`active && !paused`).
2. Rename/edit opens the shared native `<dialog>` (name + title), not `prompt()`; result announced via the live region.
3. A header count "en rotación" equals people with `active && !paused` and matches Home's "Personas elegibles".
4. Each row shows participation context ("Última vez / N veces" or "Nunca ha participado").
5. Add gives non-blocking feedback (live region, not `alert()`); a duplicate name triggers a soft confirm.
6. An empty roster shows the specified copy with the add field focused.
7. No hard delete exists; removal is "Fuera de rotación".
8. Roster mutations continue to use `addSharedPerson`/`updateSharedPerson`; D1 sync/fallback behavior is unchanged. *(preserve)*

**Historial**
9. Declined assignments render as **Reemplazada** (never "Rechazada"). *(preserve)*
10. Empty states for no assignments and no completed participation are present. *(preserve)*
11. Statuses render as badges (glyph + text + tint) consistent with Home, reusing the existing Propuesta/Confirmada/Completada treatments; any new **Reemplazada** tint is contrast-validated ≥ 4.5:1.
12. The log is grouped by service date with a short-format header.
13. Person and status filters work client-side; a role-filter slot is present but inert (deferred).
14. Participación carries a caption explaining it includes people now paused/out of rotation; the `completedCount > 0` filter is preserved.

**Ajustes**
15. Importing a backup requires an explicit confirmation dialog (destructive framing) before `replaceStateFromImport` runs.
16. `--danger` styling is used only on the import confirm action.
17. Backup-scope copy matches actual code behavior (must not claim people are excluded unless the code guarantees it); the people/D1 semantics decision is recorded as data-layer-owned if unresolved.
18. Date edits stay in sync with Home and persist via `saveSettings`. *(preserve)*
19. Routine outcomes use inline + live-region feedback rather than bare `alert()`.
20. The duplicate "Importar respaldo" labels are resolved.

**Cross-page**
21. Dialog, live-region, empty-list, and status patterns are reused consistently; global ergonomics (nav sizing, `aria-current`, focus-visible, 16px base) are preserved. *(preserve)*

---

## 6. Intentionally deferred

- **Hard delete of people** (kept to "Fuera de rotación" to protect history integrity).
- **Direct actions from lists** (assigning/messaging from a row) — lists stay read-only / edit-only.
- **Role dimension** across Historial filters and Participación (multi-role): leave the reserved filter slot and per-person summaries; build no role UI.
- **Backup/import data-semantics for the shared D1 roster**: the decision of what export/import does to people is owned by the data-layer team; this spec mandates the confirmation guardrail and truthful scope copy only.
- **Search within Personas** and **grouping/pagination refinements in Historial** — recommended but optional if they add risk.
- **A dedicated sync/offline indicator** beyond reflecting state the existing `data.js` API already exposes; no new sync logic.
- **App auto-update / version surfacing** beyond a static "Acerca de" line.
