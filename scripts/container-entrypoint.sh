#!/bin/sh
set -eu
# Railway mounts persistent volumes as root. Give only the data directory to
# the application user, then drop root before starting the server.
mkdir -p /app/data
chown -R node:node /app/data
exec runuser -u node -- "$@"
