# Structured notes: planners, meal plans & meeting follow-ups

This app is a git-backed markdown notebook. Notes are plain `.md` files;
every save is a commit (+push), refresh is a pull, and the frontend renders
a note in one of several **modes** (Edit / Split / Preview / Checklist).

We want three new capabilities without abandoning any of that:

1. **Weekly planner** — important tasks laid out day-by-day.
2. **Meal plans + reusable recipes** — a weekly grid that links recipe notes,
   with an auto shopping list.
3. **Work meeting notes** — notes with action items that carry follow-up dates,
   surfaced in one place.

The design goal is: **change nothing about the store**. Every new feature is
still just markdown in git, so sync, 3-way merge, sharing, history and the
mobile drawer keep working untouched. What we add is:

- a light **frontmatter convention** to *type* a note, and
- a **specialized view (mode)** per type — exactly how "Checklist mode" already
  layers a tappable UI over `- [ ]` lines.

This mirrors the existing pattern in `frontend/src/assets/js/app.js` (the
`todo` mode: parse markdown → render an interactive view → rewrite the markdown
on every change; the textarea stays the single source of truth).

---

## 1. Note types (frontmatter)

A note declares its type with YAML frontmatter. Untyped notes behave exactly as
today.

```markdown
---
type: planner        # planner | recipe | mealplan | meeting
week: 2026-W31        # type-specific fields
---
# body is normal markdown
```

Type is also inferred from the folder when frontmatter is absent, so existing
files dropped into `planner/`, `recipes/`, etc. light up automatically:

| Type      | Folder convention               | View                       |
| --------- | ------------------------------- | -------------------------- |
| `planner` | `planner/2026-W31.md`           | Weekly planner (day cards) |
| `recipe`  | `recipes/*.md`                  | Recipe card + ingredients  |
| `mealplan`| `meal-plans/2026-W31.md`        | Week × meal grid           |
| `meeting` | `meetings/2026-08-03-standup.md`| Meeting note + action items |

Opening a typed note auto-selects its view; you can still drop to Edit/Preview
to see the raw markdown. Nothing about a typed note is un-editable by hand — the
markdown *is* the data.

## 2. Shared token vocabulary

So a future **Agenda** can aggregate across all note types, action/task lines
share a small, greppable, still-valid-markdown grammar:

```
- [ ] 09:00 Draft the Q3 doc due:2026-08-10 @alex #q3 !
       └time┘ └────── text ──────┘ └── due ──┘ └who┘ tag  └important
```

- **`HH:MM`** (leading) — a time-of-day.
- **`due:YYYY-MM-DD`** — a follow-up / deadline date.
- **`@name`** — an owner.
- **`#tag`** — a free tag.
- **trailing `!`** — important / starred.

All optional; any `- [ ]` line is still a plain checklist item and renders fine
in Preview and in the existing Checklist mode. The planner slice (below) uses
`HH:MM` + `!`; meetings add `due:` + `@`.

## 3. The Agenda (passive)  ✅ implemented

A read-only dashboard that scans every note for open `- [ ]` lines carrying a
`due:` date and lists **Overdue / Today / This week / Later**, each row linking
back to its note. No scheduler, no push — you open it (calendar-day button in the
header), it tells you. It prefers a **server-side scan** — `GET /api/agenda?repo=…`
walks the working tree once and returns all open, due-dated items (one request
instead of N; fast on large repos) — and **falls back to a client-side scan**
(fetch every note, grep in the browser) if the endpoint is absent (older
backend). Grouping into Overdue / Today / This week / Later happens on the client
so it tracks the user's local clock. The server and client use the *same* token
grammar so results are identical. (If active push is ever wanted, the same scan
runs in a backend cron and delivers via the existing Nextcloud Talk / TARS bot —
explicitly out of scope here.)

---

## Feature designs

### A. Weekly planner  ✅ implemented (first slice)

One file per ISO week: `planner/2026-W31.md`, `type: planner`.

```markdown
---
type: planner
week: 2026-W31
---
# Week 31 · Aug 4 – Aug 10, 2026

## Monday
- [ ] 09:00 Standup !
- [ ] Draft the Q3 doc

## Tuesday
- [x] Dentist 14:00
…
## Sunday
```

The **Planner view** renders seven stacked day cards (mobile-first), today
highlighted. Each task row has a checkbox, an optional time chip, the text
(inline-editable), a star (important) toggle and delete. A per-day input adds
tasks; typing `09:00 Standup !` sets the time + importance from the shared
grammar. Checked items sink to the bottom of their day (same rule as Checklist
mode). A week switcher (‹ / › / Today) opens or scaffolds the adjacent week's
file. Everything rewrites the markdown, so autosave/commit/merge just work.

*Reachable from a calendar button in the header ("This week's plan"), which
opens or creates the current week.*

### B. Recipes + meal plan  ✅ implemented (second slice)

- **Recipe** — `recipes/sheet-pan-chicken.md`, `type: recipe`, frontmatter for
  `servings`, `time`, `tags`, and an **Ingredients** section as a checklist so a
  shopping list can aggregate it. Body holds steps. The **Recipe view** is a
  read-optimised card: title, meta chips (servings/time/tags), rendered intro,
  a tappable ingredients checklist (ticking rewrites the markdown line — handy
  while cooking/shopping), and rendered steps.
- **Meal plan** — `meal-plans/2026-W31.md`, `type: mealplan`. Body is a
  week × meals markdown table whose cells are recipe links or free text
  (`[Sheet-pan chicken](../recipes/sheet-pan-chicken.md)`, or `Leftovers`). The
  **Meal-plan view** renders mobile-first day cards with a tappable slot per
  meal; a picker sets each slot from the `recipes/` folder, custom text, or
  clear. Recipe cells open the linked note. A **Shopping list** button reads
  every linked recipe's Ingredients, de-dupes them, and writes a new
  `…-shopping.md` checklist note (opened in Checklist mode). Table parsing
  tolerates variable meal columns and day counts; inter-note links reuse the
  existing relative-link resolver in `app.js`.

  *Reachable from a "Meals" calendar button in the header, which opens or
  scaffolds the current week. New notes under `recipes/`, `meal-plans/` and
  `planner/` are pre-filled with the right scaffold.*

### C. Meeting notes + follow-ups  ✅ implemented (third slice)

- `meetings/2026-08-03-standup.md`, `type: meeting`, frontmatter `date`,
  `attendees`, `project`. Body has a `## Notes` section (free markdown) plus an
  `## Action items` checklist using the shared grammar (`due:` / `@` / `!`). The
  **Meeting view** shows a header card (title + date/project/attendees chips),
  the rendered notes, and the action items below as an interactive list: check,
  inline-edit text (typed `due:`/`@`/`!` tokens are re-parsed, not left literal),
  a native **date picker** that writes `due:YYYY-MM-DD` (overdue red / today
  amber), owner chips, star, delete, and an add box. Only the action-items
  section is rewritten in-view; free-form notes are preserved verbatim. These
  items are exactly what the Agenda aggregates.

  *Reachable via New → Meeting (creates `meetings/<today>-meeting.md`).*

---

## Implementation notes

- **Frontend-only where possible.** The planner slice needs **zero backend
  changes** — it's markdown through the existing note API. Recipes/meal-plans
  also need none (links + reads). Only a *fast* server-side Agenda would add an
  endpoint; the passive Agenda can ship client-side first.
- **One view module per type** in `app.js`, following the `todo` mode shape:
  `parseX(text) → model`, `renderX()` builds the DOM, mutations rewrite the
  textarea via a `commitX()` that marks dirty + re-renders. The textarea remains
  the single source of truth so undo/redo, autosave and 3-way merge are free.
- **Mobile-first.** Reuse the `.todo-*` row/card idiom (big tap targets, stacked
  layout, ≥16px inputs to avoid iOS zoom, sync pill for save state).
- **Creation & navigation.** A single header **New** menu creates every note
  type (Note / Weekly plan / Meal plan / Recipe / Meeting), each pre-filled with
  the right scaffold and opened in its view. The **Agenda** is a header button.
- **Configurable auto-sync.** Autosave is user-configurable via a Settings
  popover (gear in the sidebar): on/off plus the idle delay before a save fires
  (default 12s, clamped 3–300s), persisted in `localStorage`. Off = manual save
  (Save button / Ctrl+S); the beforeunload guard still protects unsaved work.
