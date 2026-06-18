#!/bin/sh
# Entry point: map the container process to the host user's UID/GID so that
# commits, SSH auth and file ownership all line up with the bind-mounted repo,
# SSH keys and gitconfig. Starts as root, creates a matching user, then drops
# privileges with su-exec and execs the app as that user.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
HOME_DIR="/home/appuser"

# Create a group + user with the requested ids (idempotent across restarts).
if ! getent group "$PGID" >/dev/null 2>&1; then
  addgroup -g "$PGID" appgroup
fi
GROUP_NAME="$(getent group "$PGID" | cut -d: -f1)"

if ! getent passwd "$PUID" >/dev/null 2>&1; then
  adduser -D -H -u "$PUID" -G "$GROUP_NAME" -h "$HOME_DIR" appuser
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"

# Home holds the bind-mounted ~/.ssh and ~/.gitconfig; ensure it exists and is
# owned so SSH does not reject it for loose permissions.
mkdir -p "$HOME_DIR"
chown "$PUID:$PGID" "$HOME_DIR" 2>/dev/null || true
export HOME="$HOME_DIR"

# Trust the bind-mounted repo regardless of its on-disk ownership. (When UID
# matches the host this is a no-op, but it keeps git happy if it does not.)
if [ -d "$NOTES_REPO/.git" ]; then
  su-exec "$PUID:$PGID" git config --global --add safe.directory "$NOTES_REPO" 2>/dev/null || true
fi

echo "starting notes as ${USER_NAME}:${GROUP_NAME} (${PUID}:${PGID})" >&2
exec su-exec "$PUID:$PGID" "$@"
