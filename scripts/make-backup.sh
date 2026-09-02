#!/usr/bin/env bash
# make-backup.sh — backup berlapis ChatKita.
# Membuat: (1) git bundle = SELURUH riwayat commit + DB ter-track,
#          (2) tar.gz isi db/media (jika ada file).
# Tujuan: /home/z/backups/ — disimpan KEEP backup terakhir.
# Dijalankan otomatis oleh hook post-commit; bisa juga manual.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="/home/z/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP=4

mkdir -p "$DEST"
cd "$ROOT"

# 1) Bundle seluruh repo (semua ref: riwayat penuh + file ter-commit incl. chat.db)
git bundle create "$DEST/chatkita-$STAMP.bundle" --all >/dev/null 2>&1

# 2) Media (foto/video/voice/pdf) — biasanya kecil, ikutkan bila ada
if [ -d db/media ] && [ -n "$(ls -A db/media 2>/dev/null)" ]; then
  tar -czf "$DEST/chatkita-media-$STAMP.tar.gz" -C "$ROOT" db/media >/dev/null 2>&1 || true
fi

# 3) Pruning: sisakan KEEP terakhir per jenis
ls -1t "$DEST"/chatkita-*.bundle 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DEST"/chatkita-media-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

SIZE="$(du -sh "$DEST" 2>/dev/null | cut -f1)"
echo "[backup] OK → $DEST (total $SIZE, simpan $KEEP terakhir)"
