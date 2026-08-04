# Integration tests

End-to-end tests that exercise the **real backend and frontend together**: the
app runs in Docker against a freshly-seeded dummy git repo, and [Playwright]
drives a browser through the actual UI, then asserts that changes were persisted
(committed) by reading them back through the API.

```
 Playwright (host) ──HTTP──▶ notes-itest container ──git──▶ integration/repo
        │                          (app image)                (seeded fixture)
        └── asserts UI state + reads /api/note to verify commits
```

## Run it

```sh
integration/run.sh            # seed → build → up → test → teardown
make itest                    # same, from the project root
```

`run.sh` will, in order: seed `integration/repo` (via `testdata/seed.sh`), build
and start the app on **:8091** (isolated compose/container — no clash with
`dev/` or `testdata/`), wait for readiness, install Playwright + Chromium on
first run, run the suite, and always tear the container down.

Pass-through args go to `playwright test`:

```sh
integration/run.sh tests/agenda.spec.js       # one file
integration/run.sh --headed                   # watch it
integration/run.sh --grep "shopping list"
```

First run may need browser system libs once: `cd integration && npx playwright install-deps`.

## What's covered

| Spec                        | Exercises                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `auth.spec.js`              | login (both accounts), bad creds, session persistence, logout |
| `session.spec.js`          | invalid/expired token → 401 → clear + redirect; unauthenticated API is 401 |
| `access-control.spec.js`    | multi-repo boundary (404 on foreign repo), `/api/repos` per user, repo switcher, shared repo |
| `notes.spec.js`             | listing, opening, **edit → commit** (verified via API), filter |
| `merge.spec.js`            | backend **3-way merge on save**: non-overlapping merges, overlapping → conflict markers |
| `refresh.spec.js`          | **upstream status + Refresh** pulls a remote-only commit (needs the run.sh remote; self-skips otherwise) |
| `planner.spec.js`           | day cards, check task → `[x]` persisted, add task            |
| `recipes-mealplan.spec.js`  | recipe card + ingredient tick, meal-plan grid, **shopping-list generation** |
| `meetings-agenda.spec.js`   | action items + due dates, add action, **agenda aggregation** + open source note |
| `routines.spec.js`         | recurring-chore view (add/rename/reschedule/pause/delete) + **Agenda shows next occurrence** with a ↻ badge |
| `autosave.spec.js`         | auto-sync **behavior**: on → persists after the delay; off → held until Save |
| `deletion.spec.js`         | delete a note → gone from list + removed from git            |
| `create.spec.js`           | New menu: Recipe/Meeting scaffolds persist, Note prompt opens editor |
| `todo.spec.js`             | checklist mode: nested render, check → `[x]`, add item, compact pref |
| `editor.spec.js`           | insert menu (bold), Ctrl+S save                              |
| `settings.spec.js`          | auto-sync toggle + delay, persistence across reload          |
| `mobile.spec.js`            | Pixel-5 viewport: sidebar drawer, planner usable on a phone  |

Fast pure-logic unit tests live alongside the code (run with `make test`, no Docker):
`backend/*_test.go` (action grammar, agenda scan, 3-way merge) and
`frontend/test/core.test.js` (dates + action grammar, mirroring the Go cases for
client/server parity).

The fixture has **two repos** (`default`, shared by both users; `work`, admin-only)
and run.sh gives `default` a bare **upstream remote** with one remote-only commit,
so the sync/access-control paths have something real to test.

Tests assert persistence by reading `/api/note` back through an authenticated
API context, so a green run proves the whole path — UI → backend → git commit —
works, not just that the DOM updated.

## Accounts & fixture

Throwaway accounts `admin/admin` and `user/user` (see `users.itest.json`). The
dummy repo is regenerated on every run, so dates (planner week, meeting
follow-ups) are always relative to *now* and the suite is repeatable.

[Playwright]: https://playwright.dev
