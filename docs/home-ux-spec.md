# IBCH Service Planner — Home Screen UX Specification (v1.1)

> **Scope & ground rules for this spec**
>
> - This specification applies to the **current single-role Version 1 experience** (Lectura Inicial only).
> - Implementation **must preserve existing assignment and rotation behavior** — the state machine in `js/assignment-workflow.js`, the fairness/selection logic in `js/rotation.js`, and the stats math in `js/people.js` (`getHomeStats`) are the source of truth and should not be altered by this UX work.
> - **Current data architecture:** the people/participant roster is **shared and D1-backed**; **localStorage remains a cache/fallback for people**. Assignments, history, and settings remain **local-only** for now. This UX spec should **consume the existing data APIs** (`getPeople`, `getHomeStats`, `buildParticipationSummary`, `getAssignments`, `getSettings`, etc.) and **must not redefine or introduce synchronization behavior**. The Home UX work stays **independent of D1 implementation details** — it renders whatever those APIs return and adds no sync UI.
> - **Multi-role Home is intentionally deferred.** The layout is designed so it can grow into additional service segments (oración, dirección de cánticos, bienvenida, especiales, cierre) later, but those roles are **not** designed or implemented now.

This document is a UX/UI specification only. It is written so that a coding agent can implement the Home screen without guessing. It does not prescribe code.

Design tokens referenced throughout (already in `css/app.css`): `--primary #7f5539`, `--primary-soft #ede0d4`, `--danger #9d2a2a`, `--border #dfd3ca`, `--muted #6f625b`, `--text #2f241f`, `--bg #f9f5f1`, `--card #fff`. New status tokens are introduced in §5.

---

## 1. Home screen structure (concrete, in order)

Single column, mobile-first, max-width 760px centered (unchanged). Top → bottom:

```
1. App header
   - h1: "Planificador IBCH"
   - subtitle: "Lectura Inicial"        ← role label lives here now; remove "Version 1 · Lectura Inicial" duplication

2. NEXT SERVICE CARD  (the hero — first thing the eye should land on)
   - eyebrow: "PRÓXIMO SERVICIO"
   - editable date row: formatted date + edit affordance (pencil/"Cambiar")   ← §6
   - role label: "Lectura Inicial"
   - "Persona asignada" label
   - assigned person name (or empty-state text)
   - status badge (only when an assignment exists)                            ← §5
   - action row: ONE primary + at most ONE quiet secondary                    ← §4
   - live region (visually hidden) for status announcements                   ← §8

3. ROTATION SNAPSHOT CARD  ("La rotación" heading)
   - three tappable summary cards in a row: Elegibles · Participaron · Esperando  ← §2

4. Bottom navigation
   - Inicio · Personas · Historial · Ajustes (unchanged IA)
```

**What the user should notice first:** the *date* and the *assigned person + its current status*, in that order. The single primary button tells them the one thing to do next. The snapshot is reference, visually lighter than the hero card.

**What is visible in each assignment state** (hero card body):

| State | Person line | Status badge | Primary action | Secondary action |
|---|---|---|---|---|
| No assignment | "Sin asignar aún" (muted) | none | **Seleccionar persona** | — |
| Selected (Propuesta) | person name | Propuesta | **Confirmar** | Elegir otra persona (quiet) |
| Confirmed (Confirmada) | person name | Confirmada | **Marcar como completado** | Elegir otra persona (quiet) |
| Completed (Completada) | person name | Completada | — (no primary) | Deshacer (quiet text) |

**After selection:** person name populates, badge appears as *Propuesta*, primary flips from "Seleccionar persona" to "Confirmar", "Elegir otra persona" appears as a quiet secondary, live region announces "Propuesta: {name}". Snapshot numbers do **not** change (selection ≠ completion).

**After confirmation:** badge → *Confirmada*, primary → "Marcar como completado", secondary stays "Elegir otra persona", live region announces "Confirmada: {name}". Snapshot unchanged.

**After completion:** badge → *Completada*, primary action removed, only a quiet "Deshacer" remains, live region announces "Completada: {name}". Snapshot updates (this person moves from *Esperando* to *Participaron* if it was their first completion). A subtle helper appears: "Servicio completado. Cambia la fecha para planificar el próximo." (links to date edit).

---

## 2. The three summary cards — exact behavior

All three: whole card tappable, `role="button"`, `tabindex="0"`, Enter/Space activate, trailing chevron `›`, `aria-label` = "{label}, {count}. Ver lista." Read-only lists in v1 (no "Asignar" from here — deferred, see §Deferred).

**Filters must exactly mirror `getHomeStats` so the card number always equals the row count.** Eligible = `active && !paused`.

### Card A — Personas elegibles
- **Label:** "Personas elegibles"
- **Supporting text:** none (number + label only)
- **Affordance:** chevron `›`
- **On tap:** opens bottom sheet **"Personas elegibles (N)"**
- **Filter:** `person.active && !person.paused`
- **Sort:** alphabetical by name (matches Personas tab)
- **Row:** line 1 = name (semibold); line 2 (muted) = participation summary — `"Ha participado {N} · Última vez: {fecha}"` or `"Nunca ha participado"`
- **Read-only**

### Card B — Ya participaron
- **Label:** "Ya participaron"
- **Supporting text:** none
- **Affordance:** chevron `›`
- **On tap:** bottom sheet **"Ya participaron (N)"**
- **Filter:** eligible **and** `completedCount > 0` (from `buildParticipationSummary`), for role `opening-reading`
- **Sort:** most recent `lastServiceDate` first
- **Row:** line 1 = name; line 2 (muted) = `"Última vez: {fecha} · {N} vez/veces"`
- **Read-only**

### Card C — Esperando oportunidad
- **Label:** "Esperando oportunidad"
- **Supporting text:** none
- **Affordance:** chevron `›`
- **On tap:** bottom sheet **"Esperando oportunidad (N)"**
- **Filter:** eligible **and** `completedCount === 0`
- **Sort:** alphabetical by name
- **Row:** line 1 = name; line 2 (muted) = `"Nunca ha participado"`
- **Read-only**

**Invariant to preserve:** `Elegibles === Participaron + Esperando`. Any list-filter change must keep this true.

---

## 3. Filtered-list interaction pattern

**Decision: bottom sheet, built on the native `<dialog>` element** (the app already uses `<dialog id="decline-dialog">`, so this is consistent and needs no new dependency).

- **Why:** keeps the user in the "planning this Sunday" context, is dismissible with a swipe/tap/Escape, gets focus trapping + Escape handling for free from `<dialog>.showModal()`, and avoids a jarring tab jump. Full-screen modal is heavier than needed for a read-only list; navigation to another view loses context.
- **How it opens:** tap/Enter/Space on a summary card → `dialog.showModal()`; sheet animates up from the bottom; move focus to the sheet's close button.
- **How it closes:** (a) close button "✕" top-right, (b) tap on backdrop, (c) Escape key, (d) swipe down (optional/progressive). On close, `dialog.close()` and **return focus to the summary card that opened it.**
- **Title:** the card label + live count, e.g. `Esperando oportunidad (18)` as an `<h2 id="sheet-title">`.
- **Count:** rendered in the title and equal to rows.
- **Scrolling:** sheet max-height ≈ 85vh; header (title + close) sticky; body scrolls; respect `env(safe-area-inset-bottom)` padding so the last row isn't clipped.
- **Row layout:** two lines — name (semibold, ≥16px) over muted supporting line (≥14px); full-width; ~56px min height; no trailing action in v1.
- **Accessibility:** `<dialog aria-modal="true" aria-labelledby="sheet-title">`; focus trapped (native); Escape closes; backdrop has sufficient dimming; each row is plain text (not a button) so screen readers read it as a list — wrap rows in `<ul>/<li>`.

Example body:
```
Esperando oportunidad (18)                     ✕

Milca Abreu
Nunca ha participado

Eliana
Nunca ha participado

Diego
Nunca ha participado
```

---

## 4. Assignment action hierarchy

One primary (filled `--primary`) per state, following the happy path. Secondary is **quiet** (outline or text), never red for the normal replace action.

- **No assignment** → Primary: **"Seleccionar persona"** (filled, full width). No secondary.
- **Selected (Propuesta)** → Primary: **"Confirmar"** (filled). Secondary: **"Elegir otra persona"** (outline/quiet, `--text` on transparent, `--border`).
- **Confirmed (Confirmada)** → Primary: **"Marcar como completado"** (filled). Secondary: **"Elegir otra persona"** (quiet).
- **Completed (Completada)** → No primary. Card is visibly "done" (green check badge). Provide one quiet text action **"Deshacer"** to correct a mistake (reverts Completada → Confirmada). Actions otherwise disappear.

**"Elegir otra persona" is NOT destructive-styled.** Replacing a proposed/confirmed person is a normal, frequent action. The genuinely consequential choices live *inside* the existing decline dialog (reason = "Quitar de la rotación" / "No desea participar por ahora"): in that dialog, give those two options a warning affordance and reserve `--danger` styling for the "Quitar de la rotación" confirmation only. The dialog's confirm button becomes **"Guardar y reemplazar"** as a normal primary, not danger.

**"Deshacer" note for implementer:** current `completeAssignment` is forward-only. Undo requires a small state-machine addition (Completada → Confirmada revert). If that's out of scope for this pass, ship completion without Deshacer and add the helper text "Para corregir, cambia la fecha o edita en Historial." — but Deshacer is the preferred, minimal correction path.

---

## 5. Status presentation

Confirmed vocabulary (revised from current "Seleccionada" → "Propuesta" for clarity: it reads as *tentatively proposed, not yet agreed*):

| Internal status | User-facing label | Icon (text-safe) | Color token (new) | Emphasis | Notes |
|---|---|---|---|---|---|
| `selected` | **Propuesta** | ○ (outline dot) | `--status-proposed` = dark amber `#7a5a1e` text on `#f4ead8` | medium | not yet confirmed with the person |
| `confirmed` | **Confirmada** | ● (filled dot) | `--status-confirmed` = `#2f5d84` text on `#dceaf5` | medium | person has agreed |
| `completed` | **Completada** | ✓ (check) | `--status-completed` = `#2f6b3d` text on `#dcefe0` | high | done; card reads "finished" |
| `declined` | **Reemplazada** | ↔ | reuse muted `--muted` on `--primary-soft` | low | **does not appear as a Home current status** (decline auto-selects a replacement); shown in Historial only |
| `none` | **Sin asignación** | — | `--muted` on `--primary-soft` | low | no badge shown on Home in the empty state; use inline "Sin asignar aún" text instead |

Rules:
- **Never color-only.** Every badge = icon glyph **+** text label + tint. A monochrome rendering must still be distinguishable via glyph + word.
- Badge shape: pill (reuse `.status-badge`), padding 0.2rem 0.6rem, font ≥0.85rem.
- **Contrast requirement:** every tint pairing must meet ≥ 4.5:1 for normal text, and the implementer must validate each pair before use.
  - Proposed: `#7a5a1e` on `#f4ead8` ≈ **5.3:1** (passes). The earlier `#8a6d3b` on `#f4ead8` ≈ 4.06:1 and **failed** — do not use it.
  - Confirmed: `#2f5d84` on `#dceaf5` ≈ **5.7:1** (passes).
  - Completed: `#2f6b3d` on `#dcefe0` ≈ **5.3:1** (passes).
  - If any token is retuned for palette reasons, re-validate to keep ≥ 4.5:1 before shipping.
- "Rechazada" (current code) is replaced by "Reemplazada" in the Historial status map — less accusatory toward the person.

---

## 6. Date editing on Home

- **Where:** in the Next Service card, directly under the "PRÓXIMO SERVICIO" eyebrow, replacing the read-only `#next-service-label`.
- **Looks editable:** the formatted date is shown as the label with a trailing pencil icon (or a subtle "Cambiar" text button). It has a visible border/underline affordance so it reads as a control, not static text. `role="button"`, `aria-label="Cambiar fecha del próximo servicio, actual {fecha}"`.
- **On tap:** open the **native date picker**. Preferred implementation: a visually-styled trigger that calls `input.showPicker()` on a hidden `<input type="date">` (with a plain-tap fallback of focusing/clicking the input for browsers without `showPicker`). On `change`: call `saveSettings({ nextServiceDate })`, update `stateRefs.currentDate`, `renderAll()`, announce via live region "Fecha actualizada: {fecha}".
- **Native input sufficient?** Yes. Do **not** build a custom calendar.
- **Ajustes:** **retain** the date field there (redundant, harmless, and it's the discoverable "settings" home). Both paths write the same `settings.nextServiceDate`. Keep them in sync via `renderAll()`.

---

## 7. Empty & first-use states (Spanish copy)

| Situation | Where | Copy | Behavior |
|---|---|---|---|
| No eligible people (`rotationTotal === 0`) | Hero card action area | "No hay personas en la rotación. Agrega personas para comenzar." | Replace primary with button **"Ir a Personas"** (switches to Personas tab). Snapshot card shows `0 · 0 · 0` with caption "Aún no hay personas elegibles." |
| No assignment yet (people exist) | Hero card person line + helper | Person line: "Sin asignar aún". Helper (muted): "Toca «Seleccionar persona» para proponer a alguien." | Primary = "Seleccionar persona" |
| No history yet | Historial → Historial list | "Todavía no hay asignaciones registradas." | Render a single muted `<li>` placeholder |
| No completed participation | Historial → Participación list | "Aún no hay participaciones completadas." | muted placeholder |
| Filtered sheet empty — Elegibles = 0 | Sheet body | "No hay personas elegibles. Revisa quién está activo o en pausa." | — |
| Filtered sheet empty — Participaron = 0 | Sheet body | "Nadie ha participado todavía." | — |
| Filtered sheet empty — Esperando = 0 | Sheet body | "Todos han participado al menos una vez. 🎉" | — |
| First time opening the app | Hero card, dismissible banner above person line | "Este es el próximo servicio. Selecciona quién hará la Lectura Inicial." | Show once; dismiss stored in localStorage key `ibch.home.firstRunDismissed`. Optional but recommended. |

---

## 8. Accessibility & mobile ergonomics

- **Tap targets:** every interactive element ≥ **44×44 CSS px**; ≥ 8px spacing between adjacent targets. Summary cards and sheet close button included.
- **Bottom nav:** height ≥ **56px** of content **plus** `padding-bottom: env(safe-area-inset-bottom)`. Current ~43px is under target — increase vertical padding. Add a small icon above each label (recognition + future 5th item); label text ≥ 0.8rem.
- **Focus behavior:** visible focus ring (`outline: 2px solid var(--primary); outline-offset: 2px`) on all interactive elements. Opening a sheet moves focus to its close button; closing returns focus to the triggering card. No focus lost to `display:none` views.
- **ARIA / live region:** add one visually-hidden `aria-live="polite"` region in the hero card. Announce on: select, confirm, complete, replace, undo, date change (one short sentence each). Bottom nav: `<nav>` with `aria-current="page"` on the active tab (replace the ambiguous `aria-labelledby` currently pointing views at nav buttons).
- **Modal/bottom-sheet a11y:** native `<dialog aria-modal="true" aria-labelledby="sheet-title">`; Escape + backdrop close; focus trapped; list rows as `<ul>/<li>` static text.
- **Status announcements:** driven by the live region above; do not rely on visual badge change alone.
- **Contrast:** all text ≥ 4.5:1 (badges validated in §5; body `--text` on `--card` and `--muted` on `--card` already pass).
- **Readable text:** base body ≥ **16px** (also prevents iOS input zoom — keep inputs at 16px); secondary/muted text ≥ 14px; never below.
- **Reduced motion:** wrap the sheet slide-up in `@media (prefers-reduced-motion: reduce)` to disable transform animation.

Keep it to these rules — no full design system.

---

## 9. Low-fidelity wireframes (Home, 5 states)

**State 1 — No assignment**
```
┌───────────────────────────────┐
│ Planificador IBCH             │
│ Lectura Inicial               │
├───────────────────────────────┤
│ PRÓXIMO SERVICIO              │
│ domingo, 28 sept 2025   ✎    │  ← tappable (opens native date picker)
│ Lectura Inicial               │
│                               │
│ Persona asignada              │
│ Sin asignar aún               │  (muted)
│ Toca «Seleccionar persona»…   │  (muted helper)
│                               │
│ [  Seleccionar persona  ]     │  ← filled primary, full width
├───────────────────────────────┤
│ LA ROTACIÓN                   │
│ ┌───────┐┌───────┐┌────────┐ │
│ │  26 ›││   0 ›││  26 ›   │ │  ← each whole card tappable
│ │Elegi- ││Partici-││Esperan- │ │
│ │bles   ││paron  ││do       │ │
│ └───────┘└───────┘└────────┘ │
├───────────────────────────────┤
│ Inicio │Personas│Histor.│Ajus.│
└───────────────────────────────┘
```

**State 2 — Selected (Propuesta)**
```
│ PRÓXIMO SERVICIO              │
│ domingo, 28 sept 2025   ✎    │
│ Lectura Inicial               │
│ Persona asignada              │
│ Carlos Pacheco                │  (semibold)
│ ( ○ Propuesta )               │  amber pill, glyph+text
│                               │
│ [  Confirmar  ]               │  ← filled primary
│  Elegir otra persona          │  ← quiet outline secondary (NOT red)
```

**State 3 — Confirmed (Confirmada)**
```
│ Persona asignada              │
│ Carlos Pacheco                │
│ ( ● Confirmada )              │  blue pill
│                               │
│ [  Marcar como completado  ]  │  ← filled primary
│  Elegir otra persona          │  ← quiet secondary
```

**State 4 — Completed (Completada)**
```
│ Persona asignada              │
│ Carlos Pacheco                │
│ ( ✓ Completada )              │  green pill
│ Servicio completado. Cambia   │  (muted helper)
│ la fecha para el próximo.     │
│                               │
│  Deshacer                     │  ← quiet text action only, no primary
│
│  (snapshot updates: Participaron +1, Esperando −1 if first time)
```

**State 5 — Bottom sheet from "Esperando oportunidad"**
```
        (Home dimmed behind)
┌───────────────────────────────┐
│ Esperando oportunidad (18)  ✕ │  ← sticky header, ✕ focused on open
│───────────────────────────────│
│ Milca Abreu                   │
│ Nunca ha participado          │
│                               │
│ Eliana                        │
│ Nunca ha participado          │
│                               │
│ Diego                         │
│ Nunca ha participado          │
│  …(scrolls, safe-area pad)    │
└───────────────────────────────┘
   Escape / backdrop / ✕ closes → focus returns to card
```

---

## 10. Acceptance criteria (testable)

**Summary cards & sheets**
1. Each summary card has `role="button"`, `tabindex="0"`, a visible chevron, and activates on click, Enter, and Space.
2. Tapping "Personas elegibles" opens a sheet titled "Personas elegibles (N)".
3. Tapping "Ya participaron" opens "Ya participaron (N)"; "Esperando oportunidad" opens "Esperando oportunidad (N)".
4. The N in each sheet title equals the number rendered in the corresponding card **and** equals the number of rows shown.
5. Invariant holds in UI: Elegibles count === Participaron count + Esperando count.
6. Elegibles list = `active && !paused`; Participaron list = eligible with `completedCount>0`; Esperando list = eligible with `completedCount===0`.
7. Each row shows the specified two lines; lists are read-only (no action buttons in rows).
8. Sheet closes via ✕, backdrop tap, and Escape; on close, focus returns to the card that opened it.
9. Sheet uses `<dialog aria-modal="true" aria-labelledby="sheet-title">`; focus is trapped while open.
10. Empty filtered lists show the exact copy in §7.

**Assignment actions & states**
11. No-assignment state shows exactly one primary "Seleccionar persona" and no secondary.
12. Selected state: "Confirmar" is the filled primary; "Elegir otra persona" is a quiet (non-red) secondary.
13. Confirmed state: "Marcar como completado" is primary; "Elegir otra persona" is quiet secondary.
14. Completed state: no primary CTA; a quiet "Deshacer" is present (or documented as deferred); card is visually "done".
15. "Elegir otra persona" never uses `--danger` styling on Home.
16. Only actions valid for the current state are shown (progressive disclosure preserved).

**Status**
17. Badges read Propuesta / Confirmada / Completada with glyph + text + tint; each distinguishable without color (glyph+word present).
18. Each badge tint/text pair meets ≥4.5:1 contrast.
19. Historial shows "Reemplazada" (not "Rechazada") for declined.

**Date**
20. The service date is editable from Home; tapping it opens the native date picker; a change persists via `saveSettings` and updates Home + Ajustes.
21. Ajustes still contains a working date field synced to the same value.

**Accessibility & ergonomics**
22. All interactive targets ≥44×44px; bottom nav ≥56px + safe-area inset.
23. A polite live region announces select/confirm/complete/replace/undo/date-change.
24. Visible focus ring on all interactive elements; keyboard-only user can complete: edit date → select → confirm → complete, and open/close each sheet.
25. Bottom nav marks the active tab with `aria-current="page"`.
26. Base text ≥16px; inputs 16px (no iOS zoom); sheet animation disabled under `prefers-reduced-motion`.

**Empty/first-run**
27. Zero eligible people replaces the primary with "Ir a Personas" and shows the specified caption.
28. First-run banner appears once and its dismissal persists across reloads.

---

## 11. Component / state inventory

- **Components:** `AppHeader`, `NextServiceCard`, `EditableDate`, `StatusBadge`, `ActionRow`, `RotationSnapshot`, `SummaryCard` (×3), `PeopleListSheet` (native `<dialog>`), `PersonRow`, `EmptyState`, `LiveRegion`, `BottomNav`, existing `DeclineDialog` (restyled per §4).
- **Assignment states:** `none` → `selected`(Propuesta) → `confirmed`(Confirmada) → `completed`(Completada); `declined` is transient (auto-replaces) and Historial-only. Reuses existing `getHomeActionState` transitions; adds optional `completed → confirmed` (Deshacer).
- **Data-driven variants:** eligible=0, people>0/assignment=0, history=0, participation=0, each sheet empty, first-run.
- **New tokens:** `--status-proposed`, `--status-confirmed`, `--status-completed` (+ their tint backgrounds).

---

## 12. Intentionally deferred

- Direct "Asignar" action from the filtered lists (kept read-only to close the info→people gap first).
- **Multi-role Home** (oración, dirección de cánticos, bienvenida, especiales, cierre): **structure is ready** — the Next Service card becomes one of a vertical stack of per-role cards under a single "PRÓXIMO SERVICIO · {date}" header, each with its own person/status/actions; snapshot becomes per-role or service-level. Not built now.
- Custom calendar (native picker only), toast/snackbar library (live region + inline text instead), swipe-to-dismiss on the sheet (progressive enhancement), search/filter within sheets. No sync UI: the D1-backed roster with localStorage cache/fallback already exists at the data layer, and Home simply consumes the existing data APIs.
- "Deshacer" is specced but flagged as requiring a small state-machine revert; may ship in a follow-up if out of scope for the first pass.
