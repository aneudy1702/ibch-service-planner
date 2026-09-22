# IBCH Service Planner — Personas, Historial & Ajustes UX Specification (v1.0)

> **Scope & ground rules for this spec**
>
> - This specification applies to the **current single-role Version 1 experience** (Lectura Inicial only) and covers the three non-Home views: **Personas**, **Historial**, and **Ajustes**. It is the companion to [`docs/home-ux-spec.md`](./home-ux-spec.md) and reuses its shared patterns (status vocabulary, bottom sheet, accessibility, empty-state style) rather than redefining them.
> - Implementation **must preserve existing assignment and rotation behavior** — the state machine in `js/assignment-workflow.js`, the selection logic in `js/rotation.js`, and the stats/participation math in `js/people.js` (`getHomeStats`, `buildParticipationSummary`) are the source of truth and should not be altered by this UX work.
> - **Current data architecture:** the people/participant roster is **shared and D1-backed**, with **localStorage as cache/fallback for people**. Assignments, history, and settings remain **local-only** for now. This spec should **consume the existing data APIs** (`getPeople`, `addPerson`, `updatePerson`, `getAssignments`, `getSettings`, `saveSettings`, `exportState`, `replaceStateFromImport`, `buildParticipationSummary`, etc.) and **must not redefine or introduce synchronization behavior**. Where an interaction has data-layer implications (notably backup import vs. the shared roster), this spec **flags the UX risk** and defers the data-semantics decision to the data-layer owners.
> - **Multi-role support is intentionally deferred.** These views should remain structured so a future role dimension can be added (e.g., a role filter in Historial, a per-role participation view) without a rewrite, but no additional roles are designed or implemented now.

This document is a UX/UI specification only. It does not prescribe code.

Design tokens (in `css/app.css`): `--primary #7f5539`, `--primary-soft #ede0d4`, `--danger #9d2a2a`, `--border #dfd3ca`, `--muted #6f625b`, `--text #2f241f`, `--bg #f9f5f1`, `--card #fff`. Status tokens (`--status-proposed`, `--status-confirmed`, `--status-completed`) are defined in the Home spec §5 and are reused here.

---

## 0. Cross-page diagnosis (what these three views share)

The three secondary views are functional but carry the same three habits the Home review identified:

1. **Native primitives that feel unfinished on a phone.** Rename uses `prompt()`, all feedback and errors use `alert()`, and the destructive backup import has no confirmation. These work but are jarring and hard to use one-handed.
2. **Missing empty and edge states.** Personas, both Historial lists, and the settings flows render blank or silent when there's no data or after an action.
3. **Inconsistent vocabulary and no cross-linking.** Historial still shows "Rechazada" (the Home spec renames this to "Reemplazada"); the Participación list duplicates data the Home cards now surface, with no connection between them; status wording isn't shared.

Shared fixes (apply on all three views, specified once here, referenced per page):

- **Replace `prompt()`/`alert()`** with the app's native `<dialog>` pattern (already used for decline) for input and confirmation, and a polite `aria-live` region for non-blocking success/error messages.
- **Reuse the Home status vocabulary and tokens** everywhere a status appears (Historial): Propuesta / Confirmada / Completada / **Reemplazada** (not "Rechazada"), glyph + text + tint, never color alone.
- **Reuse the empty-state pattern**: a single muted line (and a CTA where an action resolves it), copy in Spanish.
- **Global ergonomics from Home spec §8 apply**: tap targets ≥ 44×44px, visible focus rings, base text ≥ 16px, bottom nav ≥ 56px + safe-area inset, `aria-current="page"` on the active tab. Not repeated per page.

---

## 1. Personas

### 1.1 Current behavior
- Card 1: "Personas" heading + add-person form (label "Agregar persona", text input `maxlength=80`, "Agregar" primary button).
- Card 2: `ul#people-list`, sorted alphabetically. Each row: name (semibold), a muted status line `"{Activa|Inactiva} · {En pausa|Disponible}"`, and three controls — an "Editar" button (rename via `prompt()`), an "Activa" checkbox, an "En pausa" checkbox.
- No count, no search, no delete, no confirmation, no empty state.

### 1.2 Issues (prioritized)
- **P1 — The Activa/En pausa two-checkbox model is ambiguous.** Eligibility is `active && !paused`, so there are four expressible combinations but only three meaningful ones, and "Inactiva + En pausa" is nonsense. Users can't tell how "Inactiva" differs from "En pausa" or which one removes someone from the next rotation. This is the highest-value clarity fix.
- **P2 — Rename via `prompt()`** is a poor mobile experience and inconsistent with the app's dialog style.
- **P3 — No membership status summary or count.** A leader can't see "how many are in the rotation" at a glance, and the list gives no participation context per person (last served / times), which is exactly the information Home now surfaces.
- **P4 — No empty state.** With zero people the card renders just a heading and an empty list; first-run guidance is absent (though the seed ships 26 people, an emptied roster is possible).
- **P5 — No feedback and no duplicate handling.** Adding a person clears the field silently; a duplicate name is accepted with no notice (the data layer allows it via a random id suffix).
- **P6 — Shared-roster edits are invisible.** Because the roster is now D1-backed and shared, add/rename/status changes affect everyone. Nothing communicates that these edits are shared, nor surfaces sync/offline state.

### 1.3 Recommendations
1. **Replace the two checkboxes with one explicit status control per person** — a segmented control or a single select with three states, mapped to the existing `active`/`paused` fields:
   - **En rotación** → `active: true, paused: false` (eligible)
   - **En pausa** → `active: true, paused: true` (temporarily excluded; expected to return)
   - **Fuera de rotación** → `active: false, paused: false` (removed; not counted as eligible)
   Persist via the existing `updatePerson`; do **not** change eligibility logic. Show the current state as a small status chip on the row (reusing badge styling, distinct hues from assignment statuses).
2. **Rename inline via a native `<dialog>`** (title "Editar persona", prefilled text input, Guardar/Cancelar), replacing `prompt()`. Announce the result via the live region.
3. **Add a roster header with a live count** — "Personas · {N} en rotación" (N = `active && !paused`), and a **secondary line per row** with participation context: "Última vez: {fecha} · {N} veces" or "Nunca ha participado" (from `buildParticipationSummary`). This ties the management view to the Home snapshot.
4. **Add a search/filter field** once the list has a header (a simple client-side name filter). Optional for v1 but cheap; keep it if it doesn't add risk.
5. **Empty state** (see §1.5) and **inline feedback** on add (toast/live region "Agregada: {name}"), plus a soft duplicate warning ("Ya existe una persona con ese nombre. ¿Agregar de todos modos?") using the confirm dialog — defer hard dedupe to the data layer.
6. **Surface that the roster is shared** with a small, non-intrusive note ("Los cambios se comparten con el equipo") and, if the data API exposes it, an offline/sync indicator. Do **not** build sync logic — only reflect state the existing API already provides.

**Deletion is intentionally NOT added** in v1 — "Fuera de rotación" covers the safe case and preserves history integrity. Hard delete is deferred (see §6).

### 1.4 Status vocabulary (Personas membership — distinct from assignment status)
| Membership | Label | Fields | Visual |
|---|---|---|---|
| Eligible | **En rotación** | `active && !paused` | neutral/positive chip |
| Paused | **En pausa** | `active && paused` | muted/amber chip |
| Removed | **Fuera de rotación** | `!active` | muted/grey chip |

Glyph + text + tint; not color-only. Validate any new tint ≥ 4.5:1 on its background before shipping.

### 1.5 Empty & feedback states (Spanish copy)
- No people at all: "Aún no hay personas en la lista. Agrega la primera para comenzar." with the add field focused.
- Search yields nothing: "Ninguna persona coincide con «{query}»."
- After add: live-region "Agregada: {name}."
- After status change: live-region "{name}: {nuevo estado}."

### 1.6 Target wireframe
```
┌───────────────────────────────┐
│ Personas · 26 en rotación     │
│ [ Buscar…                    ] │  (optional)
│ [ Nombre…            ][Agregar]│
├───────────────────────────────┤
│ Carlos Pacheco   (En rotación)│  ← status chip
│ Última vez: 21 sep · 3 veces  │  (muted)
│                       [Editar]│  ← opens dialog, not prompt()
│───────────────────────────────│
│ Milca Abreu      (En pausa)   │
│ Nunca ha participado          │
│                       [Editar]│
└───────────────────────────────┘
```
"Editar" dialog contains: name field + the three-state membership control + Guardar/Cancelar.

---

## 2. Historial

### 2.1 Current behavior
- Card 1: "Historial de asignaciones" + `ul#history-list`, sorted by `createdAt` descending. Each row: full long-format date (semibold), person name, muted "{roleEs} · {statusText}", and an optional muted "Motivo: …" line for declined items.
- Card 2: "Participación" + `ul#participation-list`, alphabetical. Each row: name, "Veces completadas: N", "Última vez: {fecha}|Nunca". Built from `buildParticipationSummary` over **all** people (includes paused/removed).

### 2.2 Issues (prioritized)
- **P1 — Stale status vocabulary.** Declined shows "Rechazada"; per the Home spec this must read **"Reemplazada"** for consistency and tone. Status text should reuse the shared map (Propuesta/Confirmada/Completada/Reemplazada).
- **P2 — No filtering or grouping.** The log is chronological only; there's no filter by person or status and no grouping by service date. It will become unwieldy as history grows.
- **P3 — Missing empty states.** Both lists render blank when there's no data.
- **P4 — Two overlapping "truths" with no explanation.** The Participación summary counts **all** people, while the Home cards count only **eligible** people — the same names can appear with different implied totals. This difference is intentional but undocumented in the UI, and now that Home surfaces filtered participation lists, the relationship needs to be clear.
- **P5 — List density / verbosity.** The long date format ("domingo, 28 de septiembre de 2025") on every row is heavy for a scannable log.

### 2.3 Recommendations
1. **Adopt the shared status vocabulary and tokens** — render each history row's status as a badge (glyph + text + tint), and rename declined to **Reemplazada** in the status map (`js/app.js` `STATUS_TEXT` / Historial rendering). Keep the "Motivo" line for replaced items.
2. **Group the log by service date.** Use a date subheader (shorter format, e.g. "dom 28 sep 2025") with that service's assignment(s) beneath it. This reads as "what happened each Sunday" and compresses repeated dates.
3. **Add lightweight filters** at the top of the log: a person filter and a status filter (All / Completada / Reemplazada / Confirmada / Propuesta). Client-side only. Structure the filter row so a **role filter can be added later** for multi-role — leave the slot, don't build it.
4. **Clarify the two lists.** Give Participación a one-line caption: "Resumen de todas las personas, incluidas las que están en pausa o fuera de rotación." Optionally offer a toggle "Solo en rotación" that mirrors the Home eligibility filter, so the two views can be reconciled on demand.
5. **Cross-link with Home.** Home's summary-card bottom sheets are the "who's eligible / waiting / participated" quick views; Historial → Participación remains the **canonical, complete** record. State this relationship in the caption so users know where the fuller data lives.
6. **Reduce date verbosity** in the log rows (short format on the group header; omit the year when it equals the current year, optional).

Keep both lists **read-only** in v1.

### 2.4 Empty states (Spanish copy)
- No assignments: "Todavía no hay asignaciones registradas."
- No completed participation: "Aún no hay participaciones completadas."
- Filter yields nothing: "No hay asignaciones que coincidan con el filtro."

### 2.5 Target wireframe
```
┌───────────────────────────────┐
│ Historial                     │
│ Persona: [Todas ▾]  Estado:[▾]│  ← filters (role slot reserved)
├───────────────────────────────┤
│ dom 21 sep 2025               │  ← date group header
│  Carlos Pacheco               │
│  Lectura Inicial ( ✓ Completada)│
│───────────────────────────────│
│ dom 14 sep 2025               │
│  Eliana                       │
│  Lectura Inicial ( ↔ Reemplazada)│
│  Motivo: Prefiere no leer     │
├───────────────────────────────┤
│ Participación                 │
│ Resumen de todas las personas,│  ← caption
│ incl. en pausa / fuera.       │
│ [ ] Solo en rotación          │  ← optional toggle
│───────────────────────────────│
│ Carlos Pacheco                │
│ 3 veces · Última: 21 sep      │
└───────────────────────────────┘
```

---

## 3. Ajustes

### 3.1 Current behavior
- Card 1: "Ajustes" + "Fecha del próximo servicio" (`<input type="date">`) + "Guardar fecha" button.
- Card 2: "Respaldo" — "Exportar respaldo" button; "Importar respaldo" file input + a second "Importar respaldo" button; muted note "La importación reemplaza los datos locales actuales después de validarlos."

### 3.2 Issues (prioritized)
- **P1 — Destructive import with no confirmation.** "Importar respaldo" calls `replaceStateFromImport`, overwriting **all** local state, behind a plain button and a single `alert()`. There is no confirmation step and no distinct destructive treatment.
- **P2 — Import semantics vs. the shared D1 roster are unclear.** Backup/export was designed for a localStorage-only app. Now that people are D1-backed and shared while assignments/history/settings are local, "replace local data" has ambiguous meaning for the people roster. **This is a data-semantics decision for the data-layer owners** — this spec flags the risk and specifies the UX guardrails, not the resolution.
- **P3 — Date field is duplicated with Home** (per Home spec §6) and uses explicit "Guardar fecha"; there's no indication of unsaved changes, and the two entry points must stay in sync.
- **P4 — Weak/opaque feedback.** All outcomes are `alert()`; there's no inline success/error state, and the two "Importar respaldo" labels (section heading vs. button) are redundant/confusing.
- **P5 — No "about" affordance.** No app version / role scope shown, which is useful for a PWA that updates via service worker.

### 3.3 Recommendations
1. **Gate import behind a confirmation dialog** (native `<dialog>`), with clearly destructive framing and `--danger` on the confirm action: title "Reemplazar datos", body "Esto reemplazará las asignaciones, el historial y los ajustes locales por el contenido del respaldo. Esta acción no se puede deshacer.", buttons "Cancelar" / "Reemplazar datos" (danger). Only proceed on explicit confirm.
2. **Clarify what backup covers** given the current architecture. Show a one-line scope note near the buttons, and word it to match whatever the data layer actually does. Recommended default wording pending the data-layer decision: "El respaldo incluye asignaciones, historial y ajustes locales. La lista de personas se sincroniza con el equipo por separado." Do **not** implement roster import behavior in this UX pass — if import currently touches people, that behavior is owned by the data layer; the spec's job is to describe it truthfully once decided.
3. **Group settings into clear sections** with a small **"Zona de datos"** (data zone) that visually separates destructive backup actions from the routine date setting. Reserve `--danger` styling for the confirm action only.
4. **Keep the date field** here (per Home spec: retained, synced). Consider save-on-change to remove the "unsaved" ambiguity, or keep the explicit "Guardar fecha" with a subtle "Cambios sin guardar" hint when the field differs from the stored value. Both entry points write `saveSettings({ nextServiceDate })` and re-render.
5. **Replace `alert()` with inline feedback** (live region + a small inline success/error line): "Respaldo exportado", "Respaldo importado correctamente", "El archivo no es un respaldo válido."
6. **Fix redundant labels** — section "Respaldo" with two actions: "Exportar" and "Importar…" (the file chooser is the import trigger; avoid two identically named controls).
7. **Add a minimal "Acerca de"** line (app name, "Versión 1 · Lectura Inicial", build/version if available). Low priority.

### 3.4 Empty / feedback states (Spanish copy)
- No file chosen on import: "Primero selecciona un archivo de respaldo."
- Invalid file: "El archivo no es un respaldo válido."
- Import success: "Respaldo importado correctamente."
- Export success: "Respaldo exportado."

### 3.5 Target wireframe
```
┌───────────────────────────────┐
│ Ajustes                       │
│ Próximo servicio              │
│ [ 2025-09-28            ]     │
│ [ Guardar fecha ]  (o auto)   │
├───────────────────────────────┤
│ Zona de datos                 │
│ El respaldo incluye asigna-   │
│ ciones, historial y ajustes.  │
│ La lista de personas se       │
│ sincroniza aparte.            │
│ [ Exportar respaldo ]         │
│ [ Elegir archivo… ]           │
│ [ Importar respaldo ]  (danger→│
│                    confirm)   │
├───────────────────────────────┤
│ Acerca de                     │
│ Versión 1 · Lectura Inicial   │
└───────────────────────────────┘
```
Import flow: choose file → tap "Importar respaldo" → **confirmation dialog** (danger) → on confirm, `replaceStateFromImport` → inline success/error.

---

## 4. Cross-page consistency requirements

- **One status vocabulary** across Home and Historial: Propuesta / Confirmada / Completada / **Reemplazada**; Personas membership uses its own set (En rotación / En pausa / Fuera de rotación). All badges: glyph + text + tint, ≥ 4.5:1 contrast, never color alone.
- **One dialog pattern** (native `<dialog>`, focus-trapped, Escape/backdrop close, focus returned to trigger) for all input and confirmation — no `prompt()`, no destructive `alert()` confirmations.
- **One feedback pattern** — a shared polite `aria-live` region for success/error, plus inline text where a control has a local result.
- **One empty-state pattern** — a single muted line, a CTA when an action resolves it, copy in Spanish.
- **Bottom nav & global ergonomics** per Home spec §8 apply on every view (tap targets, focus, text size, `aria-current`).
- **Read-only lists stay read-only** in this pass (Personas rows act only via Editar; Historial is fully read-only).

---

## 5. Acceptance criteria (testable)

**Personas**
1. Each person row shows a single, unambiguous membership state (En rotación / En pausa / Fuera de rotación) that maps to `active`/`paused` without changing eligibility logic (`active && !paused`).
2. Rename opens a native `<dialog>` (not `prompt()`), prefilled, with Guardar/Cancelar; result announced via live region.
3. A header count "en rotación" equals the number of people with `active && !paused` and matches Home's "Personas elegibles".
4. Each row shows participation context ("Última vez / N veces" or "Nunca ha participado").
5. Adding a person gives visible feedback; a duplicate name prompts a soft confirm.
6. Empty roster shows the specified copy with the add field focused.
7. No hard delete exists; removal is expressed as "Fuera de rotación".

**Historial**
8. Declined assignments render as **Reemplazada** (never "Rechazada"), using the shared badge style.
9. All statuses render as badges (glyph + text + tint), consistent with Home.
10. The log is grouped by service date with a short-format header.
11. Person and status filters work client-side; a role-filter slot is present but inert (deferred).
12. Participación carries a caption explaining it includes non-eligible people and (optionally) a "Solo en rotación" toggle that reconciles with Home's eligible count.
13. Both lists show their specified empty-state copy.

**Ajustes**
14. Importing a backup requires an explicit confirmation dialog with destructive framing before `replaceStateFromImport` runs.
15. The confirm action is the only element using `--danger` styling in the settings backup section.
16. Backup scope wording is present and matches actual data-layer behavior for the shared roster (final wording pending data-layer decision — the note must not claim behavior the code doesn't perform).
17. Date edits here stay in sync with Home and persist via `saveSettings`.
18. Success/error feedback is inline + announced (no bare `alert()` for routine outcomes).
19. Redundant duplicate "Importar respaldo" labels are resolved.

**Cross-page**
20. Status vocabulary, dialog pattern, feedback pattern, and empty-state pattern are consistent across all views and with the Home spec.
21. Global ergonomics from Home spec §8 hold on every view (tap targets ≥44px, focus rings, ≥16px base text, `aria-current` on active tab).

---

## 6. Intentionally deferred

- **Hard delete of people** (kept to "Fuera de rotación" to protect history integrity).
- **Direct actions from lists** (e.g., assigning or messaging from a Personas/Historial row) — lists remain read-only / edit-only.
- **Role dimension** across Historial filters and Participación (multi-role): structure leaves room (reserved filter slot, per-person summaries) but no role UI is built.
- **Backup/import data-semantics for the shared D1 roster**: the *decision* of what export/import does to people is owned by the data-layer team; this spec only mandates the confirmation guardrail and truthful scope wording.
- **Search within Personas** and **grouping/pagination refinements in Historial** are recommended but optional for the first pass if they add risk.
- **Sync/offline indicators**: only reflect state the existing data API already exposes; no new sync logic.
- **App auto-update / version surfacing** beyond a static "Acerca de" line.
