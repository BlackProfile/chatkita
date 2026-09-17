#!/bin/sh
# =====================================================================
# ChatKita — entrypoint container CHAT (socket.io + bun:sqlite)
# - Volume chatdata dipasang di /opt/chat-service (chat.db + WAL ikut persisten)
# - Kode selalu disinkronkan dari image -> upgrade image tidak merusak DB
# - MEDIA_DIR bawaan (../../db/media) dan BACKUP_DIR (../../backups)
#   diarahkan ke volume /data agar selaras dengan container web
# =====================================================================
set -e

APP_DIR="/opt/chat-service"
TPL_DIR="/opt/chat-service-template"

mkdir -p "$APP_DIR" /data/media /data/backups

# Sinkronkan kode terbaru dari image (chat.db / wal / shm tidak tersentuh)
cp -f "$TPL_DIR/index.ts" "$TPL_DIR/package.json" "$TPL_DIR/bun.lock" "$APP_DIR/" 2>/dev/null || true

# Pasang dependensi bila volume masih kosong (boot pertama / volume baru)
if [ ! -d "$APP_DIR/node_modules/socket.io" ]; then
  echo "[entrypoint] Memasang dependensi chat-service..."
  (cd "$APP_DIR" && bun install --frozen-lockfile)
fi

# ../../db/media (dari index.ts) => /db/media => /data/media  (volume bersama web)
rm -rf /db && ln -s /data /db
# ../../backups (dari index.ts) => /backups => /data/backups
rm -rf /backups && ln -s /data/backups /backups

if [ -z "$ADMIN_PASSWORD" ] || [ "$ADMIN_PASSWORD" = "admin123" ]; then
  echo "[entrypoint] ⚠️  ADMIN_PASSWORD kosong / masih default 'admin123' — WAJIB diganti!"
fi

echo "[entrypoint] Menjalankan chat-service di port 3003..."
cd "$APP_DIR"
exec bun index.ts
