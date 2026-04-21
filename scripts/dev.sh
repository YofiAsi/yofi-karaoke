#!/usr/bin/env bash
set -euo pipefail

docker compose up -d postgres minio
echo "Postgres and MinIO are running."
echo "Run 'pnpm --filter api prisma migrate dev' to apply migrations."
