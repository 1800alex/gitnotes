#!/usr/bin/env bash
#
# End-to-end integration run:
#   1. seed a fresh dummy git repo (reuses testdata/seed.sh)
#   2. build + start the app in Docker (isolated compose, port 8091)
#   3. wait until it serves
#   4. install Playwright + Chromium (first run)
#   5. run the Playwright suite against the container
#   6. always tear the container down
#
# Any extra args are passed through to `playwright test`, e.g.:
#   integration/run.sh tests/agenda.spec.js --headed
#   integration/run.sh --grep @smoke
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
PORT="${ITEST_PORT:-8091}"
COMPOSE="docker-compose -f $DIR/docker-compose.yml"

cleanup() {
  echo "› tearing down the container…"
  ITEST_PORT="$PORT" $COMPOSE down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "› seeding dummy repo at integration/repo …"
"$ROOT/testdata/seed.sh" --force "$DIR/repo" >/dev/null

echo "› seeding second (work) repo at integration/work …"
rm -rf "$DIR/work"
mkdir -p "$DIR/work"
git -C "$DIR/work" init -q
git -C "$DIR/work" config user.email itest@example.com
git -C "$DIR/work" config user.name "Notes ITest"
printf '# Work note\n\nA note that lives in the second (work) repo.\n' > "$DIR/work/work-note.md"
git -C "$DIR/work" add -A
git -C "$DIR/work" commit -qm "seed work repo"

echo "› building & starting the app on :$PORT …"
ITEST_PORT="$PORT" $COMPOSE up -d --build

echo "› waiting for the app to become ready …"
ready=""
for i in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/login/" || true)"
  if [ "$code" = "200" ]; then ready=1; break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "!! app did not become ready — container logs:"
  ITEST_PORT="$PORT" $COMPOSE logs
  exit 1
fi
echo "  ready."

# Give the main repo an upstream (a bare repo inside the container) and push one
# external commit to it, so the refresh/status spec can pull in a remote change.
# Best-effort: if git plumbing differs, that spec skips itself rather than failing.
echo "› configuring an upstream remote (for refresh/status tests) …"
docker exec -i -u "${PUID:-1000}" notes-itest sh -s <<'IN_CONTAINER' || echo "  (upstream setup skipped)"
set -e
export HOME=/home/appuser
git config --global --add safe.directory '*'
git config --global user.email itest@example.com
git config --global user.name "Notes ITest"
REMOTE=/home/appuser/remote.git
[ -d "$REMOTE" ] || git init --bare -q "$REMOTE"
cd /data/repo
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git push -q -u origin HEAD
# One commit that only exists on the remote — Refresh should pull it in.
rm -rf /tmp/ext
git clone -q "$REMOTE" /tmp/ext
cd /tmp/ext
mkdir -p notes
printf '# External note\n\nAdded straight to the remote to test Refresh.\n' > notes/external-refresh-check.md
git add -A
git commit -qm "external: refresh check"
git push -q origin HEAD
IN_CONTAINER
echo "  upstream ready."

echo "› installing test dependencies …"
cd "$DIR"
[ -d node_modules ] || npm install
# Download the browser on first use (system libs may need `npx playwright install-deps` once).
npx playwright install chromium

echo "› running Playwright suite …"
BASE_URL="http://localhost:$PORT" npx playwright test "$@"
