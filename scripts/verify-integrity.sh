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

echo "[v27 — 1 orang 1 akun (Task 46)]"
chk_grep "Kolom password_hash (migrasi)"      "mini-services/chat-service/index.ts" "addColumn('users', 'password_hash', 'TEXT')"
chk_grep "Tabel perangkat (kunci 1 perangkat)" "mini-services/chat-service/index.ts" "CREATE TABLE IF NOT EXISTS devices"
chk_grep "Tabel kode undangan"                "mini-services/chat-service/index.ts" "CREATE TABLE IF NOT EXISTS invite_codes"
chk_grep "Kebijakan password min 4"           "mini-services/chat-service/index.ts" "MIN_PASSWORD_LENGTH = 4"
chk_grep "Rate limit password user"           "mini-services/chat-service/index.ts" "TOO_MANY_ATTEMPTS"
chk_grep "Gate kode undangan di auth"         "mini-services/chat-service/index.ts" "INVITE_USED"
chk_grep "Gate perangkat di auth"             "mini-services/chat-service/index.ts" "DEVICE_TAKEN"
chk_grep "Event pasang password (server)"     "mini-services/chat-service/index.ts" "user:set_password"
chk_grep "Event kelola undangan (server)"     "mini-services/chat-service/index.ts" "admin:invite_create"
chk_grep "Event buat akun admin (server)"     "mini-services/chat-service/index.ts" "admin:user_create"
chk_grep "Event reset password user (server)" "mini-services/chat-service/index.ts" "admin:user_reset_password"
chk_grep "Event lepas perangkat (server)"     "mini-services/chat-service/index.ts" "admin:user_unbind_devices"
chk_grep "Notifikasi akun lama (boot)"        "mini-services/chat-service/index.ts" "notice_v27_sent"
chk_grep "mustSetPassword di ack auth"        "mini-services/chat-service/index.ts" "mustSetPassword: !user.password_hash"
chk_grep "Device ID klien (localStorage)"     "src/components/chat/Messenger.tsx" "chatkita:deviceId"
chk_grep "Field password di login (UI)"       "src/components/chat/Messenger.tsx" "messenger-password"
chk_grep "Field kode undangan (UI)"           "src/components/chat/Messenger.tsx" "messenger-invite"
chk_grep "Modal wajib password (UI)"          "src/components/chat/Messenger.tsx" "PasswordSetupDialog"
chk_grep "Tombol Buat akun (dashboard)"       "src/components/chat/admin-dashboard.tsx" "Buat akun"
chk_grep "Kartu kode undangan (dashboard)"    "src/components/chat/admin-dashboard.tsx" "Kode undangan"
chk_grep "Aksi reset password (dashboard)"    "src/components/chat/admin-dashboard.tsx" "admin:user_reset_password"
chk_grep "Aksi lepas perangkat (dashboard)"   "src/components/chat/admin-dashboard.tsx" "admin:user_unbind_devices"
chk_grep "Tipe InviteCodeInfo"                "src/lib/chat-types.ts" "InviteCodeInfo"
chk_grep "Kode error baru (union)"            "src/lib/chat-types.ts" "| \"DEVICE_TAKEN\""

echo "[v28 — Sembunyikan kode undangan utk akun lama (Task 47)]"
chk_grep "Event cek nama pre-login (server)"  "mini-services/chat-service/index.ts" "public:check_name"
chk_grep "Reserved Admin dianggap exists"     "mini-services/chat-service/index.ts" "ADMIN_NAME.toLowerCase() ||"
chk_grep "Tipe PublicCheckNameAck"            "src/lib/chat-types.ts" "PublicCheckNameAck"
chk_grep "Debounce cek nama (UI)"             "src/components/chat/Messenger.tsx" "public:check_name"
chk_grep "Sembunyikan kode bila akun ada"     "src/components/chat/Messenger.tsx" "nameExists !== true"
chk_grep "Hint akun ditemukan (UI)"           "src/components/chat/Messenger.tsx" "Akun ditemukan"
chk_grep "Sinyal INVALID_PASSWORD (UI)"       "src/components/chat/Messenger.tsx" "setNameExists(true)"

echo "[v29 — Reset & hapus menyeluruh (Task 48)]"
chk_grep "Pipeline bersama reset percakapan"  "mini-services/chat-service/index.ts" "wipeConversationMessages"
chk_grep "Hapus semua bintang (server)"       "mini-services/chat-service/index.ts" "messages:unstar_all"
chk_grep "Batalkan semua terjadwal (server)"  "mini-services/chat-service/index.ts" "messages:schedule_cancel_all"
chk_grep "Hapus akun permanen (server)"       "mini-services/chat-service/index.ts" "admin:user_delete"
chk_grep "Hapus kode belum terpakai (server)" "mini-services/chat-service/index.ts" "admin:invites_clear_unused"
chk_grep "Bersihkan audit log (server)"       "mini-services/chat-service/index.ts" "admin:audit_clear"
chk_grep "Reset pengaturan default (server)"  "mini-services/chat-service/index.ts" "admin:settings:reset"
chk_grep "Daftar kunci reset pengaturan"      "mini-services/chat-service/index.ts" "APP_SETTING_RESET_KEYS"
chk_grep "Reset tampilan (UI)"                "src/components/chat/Messenger.tsx" "Reset tampilan"
chk_grep "Hapus semua bintang (UI)"           "src/components/chat/Messenger.tsx" "Hapus semua bintang"
chk_grep "Batalkan semua terjadwal (UI)"      "src/components/chat/Messenger.tsx" "Batalkan semua terjadwal"
chk_grep "Hapus akun (dashboard)"             "src/components/chat/admin-dashboard.tsx" "Hapus akun…"
chk_grep "Hapus kode bebas (dashboard)"       "src/components/chat/admin-dashboard.tsx" "Hapus belum terpakai"
chk_grep "Kembalikan default (dashboard)"     "src/components/chat/admin-dashboard.tsx" "Kembalikan default"
chk_grep "Bersihkan log (dialog audit)"       "src/components/chat/admin-tools.tsx" "Bersihkan log"
chk_grep "Listener users:changed (admin)"     "src/components/chat/AdminPanel.tsx" "users:changed"

echo "[v30 — Bersihkan chat kedua sisi khusus admin (Task 49)]"
chk_grep "Versi service v30"                  "mini-services/chat-service/index.ts" "SERVICE_VERSION = 'v30'"
chk_grep "Jalur reset admin tetap ada"        "mini-services/chat-service/index.ts" "admin:reset_conversation"
chk_grep "Dokumentasi penghapusan (protokol)" "src/lib/chat-types.ts" "DIHAPUS dari protokol"
chk_grep "Menu user tanpa bersihkan chat"     "src/components/chat/Messenger.tsx" "hanya oleh ADMIN"
chk_grep "Tombol Reset chat (panel admin)"    "src/components/chat/AdminPanel.tsx" "Reset chat"
chk_grep "Konfirmasi reset kedua sisi (admin)" "src/components/chat/AdminPanel.tsx" "kedua sisi"
chk_grep "Rescue tag v30"                     "src/instrumentation.ts" "rescue-v30"

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
