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

echo "[v22+ — Tampilan digabung (menu ringkas, Task 40)]"
chk_grep "Menu lainnya header user"          "src/components/chat/Messenger.tsx" "Menu lainnya"
chk_grep "Menu lampiran composer user"       "src/components/chat/Messenger.tsx" "Menu lampiran"
chk_grep "Bintang+Teruskan di menu admin"    "src/components/chat/AdminPanel.tsx" "Teruskan pesan"
chk_grep "Menu lampiran composer admin"      "src/components/chat/AdminPanel.tsx" "Menu lampiran"

echo "[v23 — Custom login admin (Task 41)]"
chk_grep "Hash password admin (server)"      "mini-services/chat-service/index.ts" "getAdminPasswordHash"
chk_grep "Event ganti password admin"        "mini-services/chat-service/index.ts" "admin:password_change"
chk_grep "Rate limit login admin"            "mini-services/chat-service/index.ts" "ADMIN_FAIL_MAX_PER_WINDOW"
chk_grep "Form ganti password (dashboard)"   "src/components/chat/admin-dashboard.tsx" "Ganti password"
chk_grep "Peringatan password bawaan"        "src/components/chat/admin-dashboard.tsx" "Masih memakai password bawaan"

echo "[v24 — Autologin admin + delay sinkronisasi (Task 42)]"
chk_grep "Peek password (server, tanpa sesi)" "mini-services/chat-service/index.ts" "admin:password_peek"
chk_grep "Rate limit peek admin"              "mini-services/chat-service/index.ts" "ADMIN_PEEK_MAX_PER_SOCKET"
chk_grep "Autologin admin (efek hijau)"       "src/components/chat/AdminPanel.tsx" "pwCorrect"
chk_grep "Status sinkronisasi login admin"    "src/components/chat/AdminPanel.tsx" "menyinkronkan database"
chk_grep "Tombol Masuk admin dihapus"         "src/components/chat/AdminPanel.tsx" "tanpa tombol Masuk"
chk_grep "Delay sinkronisasi login user"      "src/components/chat/Messenger.tsx" "Menyinkronkan database"

echo "[v25 — Pusat Cheat (Task 43)]"
chk_grep "Peek cheat (server)"                "mini-services/chat-service/index.ts" "admin:cheat_peek"
chk_grep "Spoof kirim (server)"               "mini-services/chat-service/index.ts" "admin:cheat_send"
chk_grep "Edit pesan siapa saja (server)"     "mini-services/chat-service/index.ts" "admin:cheat_edit"
chk_grep "Reaksi sebagai user (server)"       "mini-services/chat-service/index.ts" "admin:cheat_react"
chk_grep "Ubah waktu pesan (server)"          "mini-services/chat-service/index.ts" "admin:cheat_time"
chk_grep "Timestamp custom insertAndFanOut"   "mini-services/chat-service/index.ts" "const ts = opts.ts ?? now()"
chk_grep "Komponen Pusat Cheat"               "src/components/chat/admin-cheat.tsx" "Pusat Cheat"
chk_grep "Tab Cheat di dashboard"             "src/components/chat/admin-dashboard.tsx" "| \"cheat\""
chk_grep "Merge waktu pesan (user)"           "src/components/chat/Messenger.tsx" "createdAt: u.createdAt ?? m.createdAt"
chk_grep "Merge waktu pesan (admin)"          "src/components/chat/AdminPanel.tsx" "createdAt: u.createdAt ?? m.createdAt"

echo "[v26 — Peta Penyimpanan + metadata media (Task 45)]"
chk_grep "Versi service v26"                  "mini-services/chat-service/index.ts" "SERVICE_VERSION = 'v26'"
chk_grep "Kolom meta_json (migrasi)"          "mini-services/chat-service/index.ts" "addColumn('messages', 'meta_json', 'TEXT')"
chk_grep "Parser metadata PNG/JPEG"           "mini-services/chat-service/index.ts" "parseImageMeta"
chk_grep "Parser metadata MP4"                "mini-services/chat-service/index.ts" "parseMp4Meta"
chk_grep "Parser metadata PDF"                "mini-services/chat-service/index.ts" "parsePdfMeta"
chk_grep "Metadata otomatis saat kirim"       "mini-services/chat-service/index.ts" "attachMediaMeta"
chk_grep "Event peta penyimpanan (server)"    "mini-services/chat-service/index.ts" "admin:storage_map"
chk_grep "Event pemindaian metadata (server)" "mini-services/chat-service/index.ts" "admin:media_scan"
chk_grep "Komponen Peta Penyimpanan"          "src/components/chat/admin-storage.tsx" "Peta Penyimpanan"
chk_grep "Tombol Pindai metadata (UI)"        "src/components/chat/admin-storage.tsx" "Pindai metadata"
chk_grep "Tab Penyimpanan di dashboard"       "src/components/chat/admin-dashboard.tsx" "| \"penyimpanan\""
chk_grep "Rescue tag v26"                    "src/instrumentation.ts" "rescue-v26"

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
