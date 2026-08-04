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

## 3. The Agenda (passive)

A read-only dashboard that scans every note for `- [ ]` lines with a `due:` (or a
planner time for today) and lists **what's due today / this week / overdue**,
each linking back to its note. No scheduler, no push — you open it, it tells you.
It can be computed entirely client-side from the existing note list + reads, or
later backed by a `GET /api/agenda?repo=…` endpoint that greps the working tree
server-side for speed. (If active push is ever wanted, the same scan runs in a
backend cron and delivers via the existing Nextcloud Talk / TARS bot — but that
is explicitly out of scope here.)

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

### C. Meeting notes + follow-ups  (next)

- `meetings/2026-08-03-standup.md`, `type: meeting`, frontmatter `date`,
  `attendees`, `project`. Body has free notes plus an **Action items** checklist
  using `due:` and `@`. Meeting view = notes on top, action items below with a
  date picker that writes `due:YYYY-MM-DD`. Those items are exactly what the
  Agenda aggregates.

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
