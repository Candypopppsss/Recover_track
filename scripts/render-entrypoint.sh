#!/bin/sh
set -eu
# Limit privileged initialization to the persistent disk's mount root.
export DATA_DIR=/app/.data
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /app/.data
  chown 10001:10001 /app/.data
  chmod 700 /app/.data
  exec gosu 10001:10001 "$@"
fi
if [ ! -w /app/.data ]; then
  echo 'The Render data mount must be writable by UID 10001.' >&2
  exit 1
fi
exec "$@"
