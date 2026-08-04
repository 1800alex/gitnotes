# testdata

Fixtures for local testing.

## `seed.sh`

Builds a git-backed notes repo pre-populated with realistic sample content so
every view has something to render:

| Folder / file       | Type       | Exercises                              |
| ------------------- | ---------- | -------------------------------------- |
| `welcome.md`, `notes/` | plain    | Edit / Split / Preview, links, tables  |
| `checklists/`       | plain      | **Checklist mode** (nested items)      |
| `planner/`          | `planner`  | **Planner mode** (this week + next)    |
| `recipes/`          | `recipe`   | recipe cards, ingredient checklists    |
| `meal-plans/`       | `mealplan` | meal grid linking recipes              |
| `meetings/`         | `meeting`  | action items with `due:`/`@` (Agenda)  |

Dates are relative to *today*: the planner and meal plan land on the current ISO
week, and meeting follow-ups fall due this week (some overdue), so time-based
views have live data.

This directory is **self-contained** — it has its own accounts
(`users.demo.json`) and its own `docker-compose.yml`, and shares nothing with
`dev/`, so the test stack can run alongside the dev stack without colliding.

## Accounts

| Username | Password |
| -------- | -------- |
| `admin`  | `admin`  |
| `user`   | `user`   |

Throwaway test creds only — never reuse them anywhere real. Neither account
lists `repos`, so both fall back to `NOTES_REPO` (the seeded repo); that one
file therefore works for both the local and Docker runs below.

## Usage

```sh
# 1. Generate the repo at testdata/repo (gitignored):
make seed                       # or: testdata/seed.sh
testdata/seed.sh --force        # wipe & regenerate
testdata/seed.sh /tmp/mynotes   # custom target dir

# 2a. Run locally (Go + built site):
make demo                       # seeds if needed, then serves on :8080

# 2b. Or run the self-contained Docker stack (its own compose):
make test-up                    # builds + serves on :8090
make test-logs
make test-down
```

Both runs use `testdata/users.demo.json` and turn auto-push off — the seed repo
has no remote. The Docker stack uses container name `notes-test` and port
`8090` (override with `TEST_PORT`) so it never clashes with `dev/`.
