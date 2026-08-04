# AGENTS.md

Guidance for AI agents (and humans) working in this repo. Read this before making
changes; it captures the architecture, the core patterns, and how to test.

## What this is

A small, self-hosted **git-backed markdown notebook**. Plain `.md` files live in a
git repo you bind-mount; every save is a commit (and push, if an upstream is set),
and a Refresh does fetch/pull. On top of the raw notebook there are **typed views**
(planner, recipes, meal plans, meetings) and a **passive Agenda** — each one just a
specialized UI layered over ordinary markdown.

- **Backend** — a single Go binary: JWT auth, a JSON API for notes, and all git
  plumbing. No database.
- **Frontend** — a static [Eleventy](https://www.11ty.dev) site: a login page and a
  one-page editor app (`app.js`) talking to the API.
- **Store** — your notes, as markdown, in a git repo. That's the whole database.

## Layout

| Path                     | What                                                                 |
| ------------------------ | ------------------------------------------------------------------- |
| `backend/`               | Go server: `auth.go` (JWT+users), `notes.go` (note CRUD + agenda), `git.go` (commit/push/merge/refresh), `repos.go`, `config.go`, `main.go` |
| `frontend/src/`          | Eleventy site. `index.njk` (app shell), `login.njk`, `assets/js/app.js` (the SPA), `api.js` (client), `assets/css/app.css` |
| `frontend/_site/`        | Built site (gitignored); served by the backend                      |
| `docs/design.md`         | Design of the typed views + Agenda                                  |
| `testdata/`              | `seed.sh` (dummy-repo generator), `users.demo.json`, a manual docker stack |
| `integration/`           | End-to-end Playwright suite + its own docker stack (see Testing)     |
| `Dockerfile`             | Multi-stage build → one runtime image                               |
| `Makefile`               | All dev/test commands                                                |

## Architecture

- **Auth** ([auth.go](backend/auth.go)): usernames + bcrypt hashes in a flat JSON
  file. Login returns a long-lived JWT kept in `localStorage` (`notes.token`). The
  middleware validates the token **and** that the account still exists (a token for
  a removed/renamed user → 401 → the client clears it and redirects to login).
- **Repos** ([repos.go](backend/repos.go), auth.go): each user lists the repos they
  may access; a user with **no `repos`** falls back to `NOTES_REPO`. Access is
  enforced server-side and repo paths are never sent to the client. Every mutation
  is serialized per-repo by a mutex.
- **Notes** ([notes.go](backend/notes.go)): path-safe CRUD (`resolvePath` rejects
  traversal/dotfiles and always works from the **absolutized** repo root — a
  relative `NOTES_REPO` must still be contained), file upload/raw serving, a
  **3-way merge on save** (your loaded copy is the common ancestor), and
  `GET /api/agenda` (server-side scan for due-dated items).
- **Git** ([git.go](backend/git.go)): commit/push on write, fetch + fast-forward or
  merge on refresh; identity from `GIT_AUTHOR_NAME/EMAIL` or the mounted gitconfig.
- **Frontend** ([app.js](frontend/src/assets/js/app.js)): one IIFE. The `<textarea>`
  markdown is the **single source of truth**; typed views parse it into a model,
  render an interactive DOM, and rewrite the markdown on every change (so undo/redo,
  autosave, and 3-way merge all keep working). Autosave is debounced and
  **user-configurable** (Settings gear → on/off + idle delay, default 12s).

## Typed notes & the "mode" pattern

A note declares its type via YAML front-matter (`type: planner|recipe|mealplan|
meeting|routines`) or by folder (`planner/`, `recipes/`, `meal-plans/`, `meetings/`,
`routines/`). Opening a typed note auto-selects its **mode** (view); Edit/Split/Preview
always show the raw markdown. Modes: `edit`, `split`, `preview`, `todo` (checklist),
plus the typed `planner`, `recipe`, `mealplan`, `meeting`, `routines`.

**To add a new typed view**, touch these (grep an existing one, e.g. `planner`, as a
template):

1. `MODES` + `TYPED_MODES` arrays, and `SECONDARY_PANES` map.
2. `refreshModeView()` — dispatch to your `renderX()`.
3. `noteType()` — front-matter + folder inference; `setNoteChrome()` — toggle the
   mode button; `defaultScaffold()` — starter content.
4. A pane + a mode button in `index.njk`; styles in `app.css`.
5. The module itself: `parseX(text) → model`, `renderX()` builds DOM, and a
   `commitX()` that rewrites the textarea, `setDirty(true)`, re-renders, and
   `recordHistory()`.
6. Wire creation into the header **New** menu.

**Shared token grammar** for task/action lines (keep client `parseAction` and the Go
`parseActionTokens` in sync — the Agenda relies on them agreeing):

```text
- [ ] 09:00 Draft the doc due:2026-08-10 @alex #tag !
       time              due-date       owner tag  important
- [ ] Take out the trash every:tue                 # recurring (weekly on Tue)
- [ ] Add salt to softener every:6w since:2026-08-01  # every 6 weeks, phased from since
```

A `due:` is a **fixed** date; an `every:` makes the item **recurring** and the Agenda
resolves its *next occurrence* on/after today (`since:` phases interval recurrences;
weekdays ignore it). Recurrence specs: `mon…sun`, `Nd/Nw/Nm/Ny`, and friendly aliases
(`daily/weekly/biweekly/monthly/quarterly/yearly`). Recurrence is **pure display** —
chores never "complete"; checking one pauses it. The parse/next-occurrence math lives
in `core.js` (`parseRecurrence`, `nextOccurrence`) and is mirrored 1:1 in `notes.go`.

## Build / run / dev

```sh
make build          # build the Eleventy site + the Go binary
make dev            # live-reload frontend (eleventy serve)
make run            # run backend locally against $NOTES_REPO / $USERS_FILE
make demo           # seed testdata/repo + run locally on :8080 (admin/admin)
make seed           # (re)generate testdata/repo fixture content
make hashpw         # generate a bcrypt hash for users.json
```

Config is all env vars (see `.env.example` / README): `JWT_SECRET`, `NOTES_REPO`,
`USERS_FILE`, `AUTO_PUSH`, `AUTO_PULL`, `GIT_AUTHOR_NAME/EMAIL`, etc.

## Testing

The committed test suite is the **integration** harness in `integration/` — it runs
the real app in Docker against a freshly-seeded repo and drives the actual UI with
Playwright, asserting persistence by **reading notes back through the API** (so a
green run proves UI → backend → git commit, not just DOM updates).

```sh
make test           # fast unit tests (no Docker): Go logic + JS core.js helpers
make itest          # setup + seed → docker build/up → Playwright → teardown
make itest-setup    # one-time: npm deps + Chromium browser
make itest-deps     # install Chromium system libs (needs sudo/apt) if it won't launch
integration/run.sh tests/planner.spec.js --headed   # args pass through to playwright
```

There is also a **fast unit layer** (`make test`, no Docker): `backend/*_test.go`
covers the action grammar, agenda scan, recurrence/next-occurrence math, and 3-way
merge; `frontend/test/core.test.js` covers the dates, action grammar, and recurrence
in `core.js`. The action-grammar and recurrence cases are kept identical on both sides
to guard client/server parity (same case tables, same expected next-occurrence dates).

- Fixtures come from `testdata/seed.sh`, which writes **date-relative** content (the
  planner/meal-plan land on the current ISO week; meeting follow-ups are due this
  week), so tests compute expected paths with matching date math in `tests/helpers.js`.
- Accounts: `admin/admin`, `user/user`. The integration stack is isolated (container
  `notes-itest`, port 8091) and torn down after each run.
- Pure parser/serializer logic (planner, recipe, meal-plan, meeting, action tokens,
  ISO-week) is currently exercised only through the E2E suite; there is **no Go or
  JS unit-test layer yet** — adding one is a known gap (below).

**When you add or change a feature, add or update an integration spec** and keep the
seed fixture representative. If you change the action grammar, update *both*
`parseAction` (JS) and `parseActionTokens` (Go) and a meeting/agenda spec.

## Invariants & gotchas

- The `<textarea>` is the source of truth; never mutate a typed model without writing
  it back and re-rendering (`commitX`).
- Typed views are **per-note, not sticky** — never boot into one; the note re-selects
  it on open.
- `resolvePath` must stay containment-safe with **relative** `NOTES_REPO`.
- Client and server task grammars must match (Agenda correctness).
- Serializers should round-trip and be idempotent; preserve hand-written content
  outside the structured section (planner extras, meeting notes, meal-plan tail).

## Known coverage gaps

See the "more integration tests needed" list — highest priority: **git sync
semantics** (3-way merge, conflict UI, refresh/status), **autosave behavior** (not
just the setting), **note deletion**, **multi-repo access control**, and the
**checklist/todo mode**. A pure-logic unit-test layer for the parsers would also
catch grammar regressions faster than the E2E suite.
