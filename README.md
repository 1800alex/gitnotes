# Notes

A small, self-hosted **markdown notebook** with a git-backed store.

- **Backend** — a single Go binary: JWT auth, a JSON API for notes, and all
  git plumbing (commit/push on save, fetch/pull on refresh).
- **Frontend** — a static [Eleventy](https://www.11ty.dev/) site (login page +
  editor) styled to match the `playground/web/eleventy/site` template
  (mono/condensed type, ink-on-paper, lime accent).
- **Store** — your notes are plain `.md` files inside a **git repository** you
  bind-mount. Every change is committed and (if an upstream is configured)
  pushed. A **Refresh** button fetches and integrates upstream changes.
- **Auth** — usernames + bcrypt password hashes in a flat JSON file. Login
  returns a long-lived JWT that the browser keeps in `localStorage`.
- **Typed views** — plain notes still edit as markdown, but notes in `planner/`,
  `recipes/`, `meal-plans/`, `meetings/`, or `routines/` (or with a `type:`
  front-matter) light up as a weekly planner, recipe card, meal-plan grid,
  meeting-notes list, or **recurring-chores** view. A passive **Agenda** scans
  every note for `due:` deadlines and `every:` recurring chores and shows what's
  next — no scheduler, you open it when you want it. **Search** greps every note
  (path + content) and jumps you to the matching line.
- **Never lose an edit** — every change is mirrored to a local draft as you type
  (independent of auto-sync), so unsynced work survives a reload or a dropped
  connection and is restored the next time you open the note.

```
 browser ──JWT──▶ Go backend ──exec──▶ git ──ssh──▶ your remote
   ▲                  │
   └── static site ◀──┘ (serves the built Eleventy _site)
```

## Layout

| Path                | What                                                      |
| ------------------- | -------------------------------------------------------- |
| `backend/`          | Go server (`auth.go`, `notes.go`, `git.go`, `config.go`) |
| `frontend/`         | Eleventy site (login + editor app)                       |
| `Dockerfile`        | Multi-stage build → one small runtime image              |
| `docker-compose.yml`| Bind mounts + runs as your host user                     |
| `entrypoint.sh`     | Maps the container process to your UID/GID               |

## Quick start (Docker)

1. **Have a git repo for your notes.** Any directory that is a git checkout
   works. For sync, give it an `origin` remote reachable over SSH:

   ```sh
   git clone git@github.com:you/notes.git ~/notes-repo
   ```

2. **Configure.** Copy the example env and edit it:

   ```sh
   cp .env.example .env
   $EDITOR .env          # set JWT_SECRET, REPO_PATH, PUID/PGID (id -u / id -g)
   ```

   Generate a strong secret with `openssl rand -hex 32`.

3. **Create an account.** Make a `users.json` and add a bcrypt hash:

   ```sh
   cp users.example.json users.json
   # build the binary once to use the password hasher, or use the make target:
   make hashpw            # prompts for a password, prints a $2a$… hash
   $EDITOR users.json     # paste the hash, set the username
   ```

4. **Run it.**

   ```sh
   docker compose up -d --build
   ```

   Open <http://localhost:8080>, sign in, and start writing.

### Users, repos & sharing

Each user lists the repos they can access. A user can have several repos, and a
repo is **shared** simply by listing the same `path` in more than one user's
config (the `id`/`name` may differ per user):

```json
{
  "users": [
    {
      "username": "user",
      "passwordHash": "$2a$10$…",
      "repos": [
        { "id": "personal", "name": "Personal", "path": "/data/repo" },
        { "id": "work",     "name": "Work",     "path": "/data/work-notes" }
      ]
    },
    {
      "username": "sam",
      "passwordHash": "$2a$10$…",
      "repos": [
        { "id": "sam",    "name": "Sam's Notes",   "path": "/data/sam-notes" },
        { "id": "shared", "name": "User (shared)", "path": "/data/repo" }
      ]
    }
  ]
}
```

- `path` is the **container** path — mount the matching host directory in
  `docker-compose.yml` (the default `/data/repo` is already mounted; add more
  bind mounts for the others).
- `id` must be unique within a user; it's what the UI and API use.
- A user with **no `repos`** falls back to the single default repo
  (`NOTES_REPO`/`/data/repo`) — so older single-repo `users.json` files keep
  working unchanged.
- The repo dropdown appears in the sidebar only when a user has more than one.
- **Access is enforced server-side**: a user can only read/write repos listed in
  their own config; repo paths are never sent to the browser.

Generate each hash with `make hashpw` (or `./backend/notes -hashpw`). The file
is mounted read-only; edit it on the host and restart the container.

## How sync works

- **Save** → if the note changed on disk since you opened it (another device
  saved through the same backend), the server does a **3-way merge** using your
  loaded version as the common ancestor. Non-overlapping edits merge silently.
  Overlapping edits are **union-merged** — both sides' lines are kept (nothing is
  dropped and no conflict markers are written), and the UI flags that overlap so
  you can tidy up the duplicated lines. The merged/written file is then `git add`-ed,
  `git commit`-ed and `git push`-ed (when an upstream exists and `AUTO_PUSH=true`).
  If the push is rejected (e.g. the remote moved on), the change is still committed
  locally and the UI shows *exactly* why the push failed, prompting you to **Refresh**.
- **Refresh** → `git fetch` → fast-forward if possible, otherwise attempt a
  merge. **On conflict the merge is aborted** (your working tree is left
  untouched) and the UI lists the conflicting files so you can resolve them
  from a terminal, then refresh again.
- **Startup** → an optional `git pull` (`AUTO_PULL=true`) brings the working
  copy current when the container boots.

Concurrent edits to the *same note* are merged automatically when they don't
overlap (3-way merge on save, see above); overlapping edits keep both sides
(union merge) rather than silently overwriting one, and you're warned to tidy up.
Divergent *git histories* (local vs.
remote) are never auto-resolved — the app reports them and leaves both sides
intact for you to reconcile.

## Running as your host user

The container starts as root only long enough for `entrypoint.sh` to create a
user matching `PUID`/`PGID`, then drops to that user with `su-exec`. This means
commits are authored as you, the bind-mounted SSH keys/`.gitconfig` are used as
expected, and files written into the repo are owned by you on the host. Set
`PUID`/`PGID` to the output of `id -u` / `id -g`.

## Local development (no Docker)

```sh
make install            # frontend deps
make build              # build _site + backend binary
NOTES_REPO=/path/to/repo USERS_FILE=./users.json JWT_SECRET=dev make run
# or, for live frontend reload:
make dev
```

## Configuration reference

All via environment variables (see `.env.example`):

| Var                | Default          | Meaning                                        |
| ------------------ | ---------------- | ---------------------------------------------- |
| `JWT_SECRET`       | *(random)*       | Token signing key. **Set this** for stable logins. |
| `TOKEN_TTL_HOURS`  | `720`            | Token lifetime (30 days).                      |
| `NOTES_REPO`       | `/data/repo`     | Path to the git-backed notes repo.             |
| `USERS_FILE`       | `/data/users.json` | Accounts file.                               |
| `STATIC_DIR`       | `/app/site`      | Built Eleventy site.                           |
| `LISTEN_ADDR`      | `:8080`          | Bind address.                                  |
| `NOTE_EXT`         | `.md`            | File extension treated as a note.              |
| `AUTO_PUSH`        | `true`           | Push to upstream after each change.            |
| `AUTO_PULL`        | `true`           | Pull on startup.                               |
| `GIT_AUTHOR_NAME`  | *(gitconfig)*    | Override commit author name.                   |
| `GIT_AUTHOR_EMAIL` | *(gitconfig)*    | Override commit author email.                  |

## API

`POST /api/login` is public; everything else needs `Authorization: Bearer <jwt>`.
All note/repo endpoints are scoped to a `repo` id from the user's config.

| Method & path                       | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `POST /api/login`                   | `{username,password}` → `{token,repos}` |
| `GET  /api/repos`                   | Repos the user can access (`id`,`name`) |
| `GET  /api/notes?repo=…`            | List notes in a repo                  |
| `GET  /api/note?repo=…&path=…`      | Read one note                         |
| `PUT  /api/note`                    | `{repo,path,content,base}` → commit (+push) |
| `DELETE /api/note?repo=…&path=…`    | Delete → commit (+push)               |
| `GET  /api/status?repo=…`           | Branch / ahead / behind / dirty       |
| `POST /api/refresh`                 | `{repo}` → fetch + integrate upstream |

## Security notes

This is a personal-scale app. Worth knowing:

- Tokens live in `localStorage`; serve behind HTTPS (a reverse proxy) in any
  real deployment.
- Passwords use bcrypt; the login endpoint does constant-ish work for unknown
  users to avoid leaking which usernames exist.
- Note paths are validated against traversal and constrained to `NOTE_EXT`
  files inside the repo.
- Markdown is rendered client-side; only put people you trust on the account
  list.
