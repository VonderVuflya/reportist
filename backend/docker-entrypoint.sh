#!/bin/sh
set -e

case "$1" in
  api)
    echo "[entrypoint] applying migrations"
    bun run src/db/migrate.ts
    echo "[entrypoint] seeding demo data (idempotent)"
    bun run scripts/seed.ts
    echo "[entrypoint] starting api"
    exec bun run src/api.ts
    ;;
  worker)
    echo "[entrypoint] starting worker"
    exec bun run src/worker.ts
    ;;
  migrate)
    exec bun run src/db/migrate.ts
    ;;
  *)
    exec "$@"
    ;;
esac
