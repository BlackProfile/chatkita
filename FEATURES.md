# ChatKita — BLUEPRINT FITUR & PROSEDUR PEMULIHAN (anti-rollback)

> **Tujuan file ini:** jika sandbox rollback/fitur hilang, AGENT BARU cukup baca file ini
> untuk tahu fitur apa saja yang harus ada, di file mana, dan cara memulihkannya —
> TANPA user perlu ngeprompt ulang dari nol.
>
> Terakhir diperbarui: versi server **v24** (Task 42 — autologin admin + delay sinkronisasi).

---

## 1. Identitas Aplikasi
- Nama: **ChatKita** — aplikasi IM/chat murni (user + panel admin), gaya WhatsApp/Messenger.
- Bahasa UI: **Indonesia**. Balasan agent ke user: **Indonesia**.
- Admin password: `admin123` — autologin admin lewat `/?admin`.
- Admin dapat ganti nama aplikasi via Dashboard → Pengaturan (identitas).

## 2. Arsitektur & Port
| Komponen | Lokasi | Port | Catatan |
|---|---|---|---|
| Next.js (UI + API) | `src/` | 3000 | `bun run dev`, log: `dev.log` |
| chat-service | `mini-services/chat-service/index.ts` | 3003 | Bun + socket.io; **auto-spawn sebagai child server Next** oleh `src/instrumentation.ts` |
| Gateway Caddy | `Caddyfile` | 81 | `/` → :3000; `?XTransformPort=3003` → :3003 |
| Database | `mini-services/chat-service/chat.db` | — | bun:sqlite (WAL). **Ter-track di git** |
| Media | `db/media/` | — | Foto/video/voice/PDF; disajikan via `/api/media` |
| Backup lokal | `/home/z/backups/` | — | git bundle + tar media, dibuat otomatis tiap commit |

- E2E selalu lewat gateway: `http://localhost:81/` (desktop 1440×900 + mobile 390×844).
- Frontend request ke chat-service via socket.io: path `/`, query `XTransformPort=3003` (JANGAN tulis port di URL).

## 3. Peta Fitur per Versi (semua WAJIB ada — centang saat verifikasi)

### v11 — Admin power (server)
- `audit_log` (jejak aksi admin), `push_subscriptions` (web-push VAPID), kontrol sesi, kata terlarang/flag pesan.
- Lokasi: `mini-services/chat-service/index.ts` (migrasi CREATE TABLE + handler admin).

### v13 — Dashboard Aplikasi (admin) + enforcement server
- **6 tab**: Ringkasan (8 KPI + hari tersibuk), Analitik (rentang 14/30 hari, chart pengguna baru, weekday, jam tersibuk, split pengirim, engagement), Pengguna (cari/urut/filter), Siaran (broadcast), Pengaturan (13 kontrol), Sistem (runtime, bersihkan media/VACUUM, jejak audit).
- **Pengaturan server-enforced**: allowRegistration, maxMessageLength (50–1000), maxUploadMb (1–25), allowImages/Voice/Files/Links, linkPreview, allowReactions, readReceipts, slowmodeSeconds (0–60).
- Enforcement: `REGISTRATION_CLOSED`, `SLOW_MODE`, tolak media/link saat off, cap teks dinamis (admin bebas 1000), read receipt dihormati.
- Pagination pesan "Muat pesan lama".
- `src/instrumentation.ts`: auto-spawn chat-service (tahan restart/rollback).
- Lokasi: `src/components/chat/admin-dashboard.tsx` + handler server di `index.ts` (`admin:dashboard`, `admin:system`, `admin:cleanup`).

### v20 — Pusat (backup/pulihkan/reset) + progres unggah + viewer besar
- **Tab "Pusat" (pertama) di dashboard**: unduh backup JSON (`admin:backup`), pulihkan impor JSON (`admin:restore`, dialog ringkasan + konfirmasi), reset total (`admin:reset_all`, AlertDialog merah) — hapus pesan/reaksi/reads/conversations/push/users non-admin/settings + purge `db/media` + audit + broadcast `app:reset` (user/admin reload otomatis).
- **Progres unggah %**: `uploadMedia` (XHR + onProgress, timeout 5 mnt) di `src/lib/chat-utils.ts`; bar progres di chip foto & dialog file, **kedua sisi** (user + admin).
- **Viewer media panggung besar**: panggung tetap `h-[72vh] w-full shrink-0 bg-black rounded-lg`; media `h-full w-full object-contain` (media kecil DIPERBESAR memenuhi panggung); zoom `w-[200%] max-w-none shrink-0`; video/PDF idem. Lokasi: `src/components/chat/media-viewer.tsx` (dipakai user + admin).
- Lokasi: `src/components/chat/admin-pusat.tsx` + `admin:reset_all`/`admin:restore` di `index.ts`.

### v21 — Caption media
- Foto/file yang diupload **membawa teks composer** sebagai caption, tampil di bawah media pada bubble.
- Rantai: kolom `messages.caption`; `messages:send` validasi caption (image/file, cap maxMessageLength); persist + emit `toChatMessage`; `snippetOf` caption menang untuk foto/file; overview lastMessage membawa caption; `ChatBubble` prop `caption` render di bawah media; `sendImage`/`sendFile` (Messenger.tsx + AdminPanel.tsx) kirim `caption: input.trim()` dan **mengosongkan input saat sukses**; preview sidebar pakai caption.
- **`POST /api/upload`** (`src/app/api/upload/route.ts`): SHA-256 dedup ke `db/media`, cap 25 MiB, nama `<32hex><ext>`, respons `{ok,url,fileName,mimeType,size}`. **File ini KRITIS — pernah hilang total saat rollback.**

### v22 — Paket pulihan (bintang / teruskan / terjadwal)
- **Bintangi pesan**: toggle per-user (`messages:star`, kolom `starred_by` JSON), daftar `messages:starred`, panel "Pesan berbintang" + lompat ke pesan — kedua sisi.
- **Teruskan pesan (admin)**: `messages:forward` → salin ke percakapan lain, label "Diteruskan dari X" di bubble, dialog 2 langkah (pilih pesan → pilih kontak) di header admin.
- **Pesan terjadwal**: `messages:send` + `scheduledAt` (min +10 dtk, maks +30 hari); HANYA pengirim melihat sebelum waktunya (disembunyikan dari history/overview/unread penerima); sweep `deliverDueScheduled` tiap 10 dtk mengirim otomatis + push + transkripsi voice; batal via `messages:schedule_cancel` + tombol "Batalkan jadwal"; UI popover datetime di composer kedua sisi; bubble pending ber-chip jam.
- **Badge unread**: `document.title = "(n) ChatKita"` di user & admin.
- Lokasi: handler di `index.ts` (blok v22), UI di `Messenger.tsx`/`AdminPanel.tsx`/`ChatBubble.tsx` (props star/forward/scheduled).

### v22+ — Tampilan digabung (Task 40, permintaan "gabungkan supaya ga kebanyakan")
- **Header user**: 7 tombol → **2** (Cari + "Menu lainnya" ⋯). Isi menu: Pesan berbintang, Kunci akun PIN, Hemat data (dgn status), Ganti tema, Ukuran huruf, Keluar.
- **Header admin**: 4 tombol → **2** (Cari + "Menu lainnya" ⋯). Bintang & Teruskan kini jadi item pertama menu.
- **Composer (kedua sisi)**: Paperclip + Jam → **satu tombol +** ("Menu lampiran"): Lampirkan foto/file + Kirim terjadwal. Form terjadwal kini **Dialog** (bukan popover anchor).
- Fungsi/emit/socket TIDAK berubah — hanya pemindahan UI. Verifikasi: verify-integrity seksi "v22+".

### v23 — Custom login admin (Task 41)
- **Password admin bisa diganti** dari Dashboard → Pengaturan → kartu "Login admin" (isi password sekarang + baru ≥6 kar. + konfirmasi). Event `admin:password_change`, tersimpan **bcrypt** di settings (`adminPasswordHash`) — persist & ikut ter-backup (DB ter-track).
- **Backward compat**: tanpa hash → fallback `ADMIN_PASSWORD` env / `admin123` (perilaku lama utuh).
- **Anti brute-force**: jendela global 10 gagal/menit + 5 gagal per-socket → `RATE_LIMITED`; sukses/ubah password mereset counter.
- **`admin:auth` kini async** (Bun.password.verify) + ack berisi `usingDefault:true` bila masih bawaan → AdminPanel menampilkan peringatan amber di kartu Login admin.
- UI: login admin memakai mapping error RATE_LIMITED (login + layar kunci), Dashboard props `usingDefaultPassword`.
- Uji protokol 8/8 (ganti → login lama gagal → login baru sukses → lemah ditolak → restore). Verifikasi: verify-integrity seksi "v23".

### v24 — Autologin admin + delay sinkronisasi (Task 42)
- **Login admin tanpa tombol**: tombol "Masuk" dihapus. Saat mengetik password, form mengecek kebenaran via event BARU `admin:peek` (tanpa membuka sesi, ack hanya `{ ok }`, tidak menyentuh data).
- **Feedback hijau**: password benar → titik-titik input berubah **hijau** (border + teks emerald) + status "Password benar — menyinkronkan database…" (spinner).
- **Delay sinkronisasi + autologin**: setelah benar, jeda ±0,9 dtk lalu `admin:auth` dipanggil otomatis. Mengetik lagi membatalkan antrean login. Enter tetap berfungsi.
- **Rate limit peek terpisah** (30 gagal/socket/menit + 120 gagal global/menit, minimum 6 kar) — mengetik bertahap TIDAK mengunci `admin:auth` (counter v23 tetap ketat).
- **Login user ber-delay**: klik Masuk/Lanjut/PIN → tombol berubah "Menyinkronkan database…" (spinner) ±0,9 dtk → auth dikirim. Proteksi dobel-kirim; auto re-auth saat reconnect TIDAK ter-delay.
- Logout admin mengosongkan form password (autologin tidak menyala ulang). Verifikasi: verify-integrity seksi "v24".

### Sebelum v11 (fondasi)
- Chat real-time socket.io (typing, read receipt 3 titik, reaksi, edit/publish pesan, balasan/reply, voice note, link preview, galeri media per kontak, pencarian, dark mode, push notifikasi, PDF viewer, unduh media, format pesan Markdown, PIN opsional).

## 4. Peta File Inti
| File | Isi |
|---|---|
| `src/app/page.tsx` | Entry — render Messenger (user) |
| `src/components/chat/Messenger.tsx` | UI user: login/kartu continue, chat, composer pill, attachment, galeri, PIN |
| `src/components/chat/AdminPanel.tsx` | UI admin: login premium, inbox, chat pane, composer |
| `src/components/chat/admin-dashboard.tsx` | Dashboard 6 tab (Ringkasan/Analitik/Pengguna/Siaran/Pengaturan/Sistem) |
| `src/components/chat/admin-pusat.tsx` | Tab Pusat: backup/pulihkan/reset + badge versi |
| `src/components/chat/admin-tools.tsx`, `user-manager.tsx` | Alat admin lama (v10) |
| `src/components/chat/ChatBubble.tsx` | Bubble pesan: media, caption (v21), reaksi, edit, reply |
| `src/components/chat/media-viewer.tsx` | Lightbox panggung besar (v20), galeri, zoom, swipe |
| `src/components/chat/emoji-picker.tsx`, `voice-player.tsx`, `link-preview.tsx`, `day-separator.tsx`, `TypingDots.tsx` | Pendukung |
| `src/lib/chat-utils.ts` | `uploadMedia` (XHR + onProgress), util chat |
| `src/lib/chat-types.ts` | Tipe bersama user↔admin↔server (caption opsional) |
| `src/app/api/upload/route.ts` | POST upload media (dedup SHA-256) |
| `src/app/api/media/`, `src/app/api/link-preview/` | Penyajian media + preview link |
| `src/instrumentation.ts` | Auto-spawn chat-service :3003 |
| `mini-services/chat-service/index.ts` | SEMUA logika server: socket.io, DB, enforcement, admin handlers, `SERVICE_VERSION` (baris ~88) |
| `src/lib/db.ts` + `prisma/` | Prisma (SQLite) tersedia untuk fitur Next-side (chat-service tidak pakai ini) |

## 5. Skema DB (bun:sqlite, `chat.db`)
- `users(id, name, is_admin, pin_hash, avatar_color, last_seen_at, joined_at, ...)`
- `conversations(id, user_a_id, user_b_id, ...)`
- `messages(id, conversation_id, sender_id, type[text/image/video/audio/file], body, media_url, media_name, media_mime, media_size, duration_ms, reply_to, edited_at, published, flagged, **caption**, created_at)`
- `reads`, `message_reactions`, `push_subscriptions`, `settings(key,value)`, `audit_log`
- Migrasi pattern: `CREATE TABLE IF NOT EXISTS` + `addColumn()` idempoten — aman dijalankan ulang.
- **DB ter-track git** → setiap bundle backup ikut membawa snapshot DB.

## 6. Prosedur Pemulihan Cepat (jika rollback terdeteksi)
1. **Deteksi**: `bash scripts/verify-integrity.sh` → laporan PASS/FAIL per fitur.
2. **Cek git**: `git log --oneline -8` — apakah riwayat commit terbaru masih ada?
3. **Jika commit hilang tapi bundle ada**:
   ```bash
   git bundle verify /home/z/backups/chatkita-<terbaru>.bundle
   git fetch /home/z/backups/chatkita-<terbaru>.bundle 'refs/heads/*:refs/heads/*' --force
   git reset --hard main   # atau nama branch terbaru
   ```
4. **Jika bundle juga hilang** (checkpoint sandbox penuh): rebuild fitur satu per satu
   memakai **Peta Fitur (bagian 3)** + **Peta File (bagian 4)** — urutan prioritas:
   1) `POST /api/upload` → 2) chat-service inti/socket → 3) Pusat v20 → 4) progres unggah + viewer → 5) caption v21 → 6) dashboard v13 → 7) paket v22 (bintang/teruskan/terjadwal).
5. **Restart**: `pkill -9 -f 'bun --hot index.ts'` lalu restart `bun run dev` — instrumentation auto-spawn chat-service.
6. **Selalu akhiri**: `bun run lint` 0/0 → commit → E2E gateway :81 → append `worklog.md` → commit worklog.

## 7. Backup Berlapis (sudah terpasang — Task 37)
- **Self-heal otomatis (boot)**: `src/instrumentation.ts` memeriksa file kritis saat server Next boot; yang hilang dipulihkan otomatis dari git tag **`rescue-v22`** (tercatat di dev.log; perbarui tag tiap versi: `git tag -f rescue-v22`). Penyebab kehilangan yang sudah terbukti: **checkpoint sandbox membuat "commit UUID"** yang menghapus file baru (contoh: `df40cd2` menghapus `/api/upload/route.ts`; ada 35+ commit UUID dalam sejarah).
- **Otomatis per commit**: hook `post-commit` (`scripts/githooks/`, aktif via `git config core.hooksPath scripts/githooks`) menjalankan `scripts/make-backup.sh` → git bundle + tar media ke `/home/z/backups/` (simpan 4 terakhir).
- **Manual**: `bash scripts/make-backup.sh`.
- **Cek kesehatan kapan pun**: `bash scripts/verify-integrity.sh` (24 pemeriksaan, exit 1 = ada yang hilang).
- **Pulihkan file tunggal**: `git checkout rescue-v22 -- <path>` atau dari bundle (bagian 6).
- **Offsite GitHub (AKTIF sejak Task 38)**: remote `origin` sudah terpasang → `github.com/BlackProfile/chatkita` (repo PRIVATE, token tersimpan di `.git/config` — JANGAN ditulis di file mana pun yang ter-commit). Push offsite berjalan **otomatis setiap commit** (hook post-commit, best-effort) + manual `bash scripts/push-remote.sh` (push + backup lokal sekali jalan).
  - Dengan remote aktif, checkpoint sandbox sekalipun tidak bisa menghapus riwayat — pulihkan dengan: `git clone https://github.com/BlackProfile/chatkita.git` (butuh token bila repo private).
  - Bila push gagal (token expired/revoke): `git remote set-url origin https://<TOKEN_BARU>@github.com/BlackProfile/chatkita.git`.

## 8. Konvensi Kerja Agent (jangan dilanggar)
- `bun run lint` **0 error** sebelum commit. Jangan `bun run build`.
- Ubah mini-service → kill proses bun lama, biarkan watchdog/instrumentation menaikkan ulang.
- Forensik DB hanya-baca: skrip `bun` sementara dengan `new Database(path, {readonly:true})`.
- E2E via agent-browser di gateway :81; tutup sesi, reset state uji, cek console 0 error.
- Setiap task: append `worklog.md` (pola `--- / Task ID / Agent / Task / Work Log / Stage Summary`), lalu commit.
