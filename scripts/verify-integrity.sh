#!/usr/bin/env bash
# verify-integrity.sh — deteksi dini rollback/kehilangan fitur ChatKita.
# Memeriksa file-file kritis + penanda kode per fitur (v13/v20/v21).
# Exit 0 = semua utuh; exit 1 = ADA YANG HILANG (lihat laporan).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0; FAILED=()

chk_file() { # chk_file <deskripsi> <path>
  if [ -f "$2" ]; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  ❌ $1 (hilang: $2)"; fi
}
chk_grep() { # chk_grep <deskripsi> <path> <pola>
  if [ -f "$2" ] && grep -q "$3" "$2" 2>/dev/null; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  ❌ $1 (penanda tidak ditemukan di $2)"; fi
}

echo "== ChatKita verify-integrity =="

echo "[Fondasi]"
chk_file "Server chat-service (socket.io)"   "mini-services/chat-service/index.ts"
chk_file "DB chat.db"                        "mini-services/chat-service/chat.db"
chk_file "API upload media (dedup SHA-256)"  "src/app/api/upload/route.ts"
chk_file "Auto-spawn chat-service"           "src/instrumentation.ts"
chk_file "Gateway Caddyfile"                 "Caddyfile"

echo "[v13 — Dashboard Aplikasi]"
chk_file "admin-dashboard.tsx"               "src/components/chat/admin-dashboard.tsx"
chk_grep "Pengaturan enforcement server"     "mini-services/chat-service/index.ts" "maxMessageLength"
chk_grep "admin:system (Sistem)"             "mini-services/chat-service/index.ts" "admin:system"
chk_grep "Pagination Muat pesan lama"        "src/components/chat/Messenger.tsx" "Muat pesan lama"

echo "[v20 — Pusat + progres unggah + viewer besar]"
chk_file "admin-pusat.tsx (tab Pusat)"       "src/components/chat/admin-pusat.tsx"
chk_grep "admin:reset_all (reset total)"     "mini-services/chat-service/index.ts" "admin:reset_all"
chk_grep "admin:restore (pulihkan JSON)"     "mini-services/chat-service/index.ts" "admin:restore"
chk_grep "Progres unggah (XHR onProgress)"   "src/lib/chat-utils.ts" "onProgress"
chk_grep "Viewer panggung 72vh"              "src/components/chat/media-viewer.tsx" "72vh"

echo "[v21 — Caption media]"
chk_grep "Kolom caption (migrasi)"           "mini-services/chat-service/index.ts" "addColumn('messages', 'caption'"
chk_grep "Persist/emit caption"              "mini-services/chat-service/index.ts" "caption"
chk_grep "Render caption di bubble"          "src/components/chat/ChatBubble.tsx" "caption"
chk_grep "Kirim caption dari composer"       "src/components/chat/Messenger.tsx" "caption"

echo "[v22 — Paket pulihan: bintang/teruskan/terjadwal]"
chk_grep "Kolom starred_by (migrasi)"        "mini-services/chat-service/index.ts" "addColumn('messages', 'starred_by'"
chk_grep "Handler bintang + daftar"          "mini-services/chat-service/index.ts" "messages:star"
chk_grep "Handler teruskan (admin)"          "mini-services/chat-service/index.ts" "messages:forward"
chk_grep "Sweep pesan terjadwal"             "mini-services/chat-service/index.ts" "deliverDueScheduled"
chk_grep "UI bintang + terjadwal user"       "src/components/chat/Messenger.tsx" "messages:star"
chk_grep "UI teruskan + bintang admin"       "src/components/chat/AdminPanel.tsx" "messages:forward"
chk_grep "ChatBubble prop star/scheduled"    "src/components/chat/ChatBubble.tsx" "onToggleStar"

echo ""
echo "== Versi server terdaftar =="
grep -m1 "SERVICE_VERSION = " mini-services/chat-service/index.ts || echo "  ❌ SERVICE_VERSION tidak ditemukan"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "HASIL: $PASS lolos, 0 gagal — SEMUA FITUR UTUH ✅"
  exit 0
else
  echo "HASIL: $PASS lolos, $FAIL GAGAL — indikasi rollback/fitur hilang!"
  echo "Tindakan: buka FEATURES.md bagian 6 (Prosedur Pemulihan Cepat),"
  echo "atau pulihkan dari bundle: ls -1t /home/z/backups/chatkita-*.bundle"
  printf 'Fitur bermasalah: %s\n' "${FAILED[*]}"
  exit 1
fi
