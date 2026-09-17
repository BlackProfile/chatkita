#!/bin/sh
# =====================================================================
# ChatKita — entrypoint container WEB (Next.js standalone)
# - Inisialisasi skema Prisma saat boot pertama (idempoten)
# - Menjalankan server standalone dengan Bun
# =====================================================================
set -e

DATA_DIR="/data"
DB_FILE="$DATA_DIR/custom.db"

mkdir -p "$DATA_DIR/media"

# Inisialisasi database hanya bila memang belum ada (aman diulang)
if [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] Database belum ada — inisialisasi skema Prisma..."
  bun /app/node_modules/prisma/build/index.js db push \
    --skip-generate --schema /app/prisma/schema.prisma
fi

echo "[entrypoint] Menjalankan ChatKita Web di port ${PORT:-3000}..."
exec bun /app/.next/standalone/server.js
