#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
    echo "Missing .env. Copy scripts/bot.env.example to .env and configure your own bot; see docs/operations.md." >&2
    exit 1
fi
npm ci --omit=dev --ignore-scripts
exec node --env-file=.env src/index.js "$@"
