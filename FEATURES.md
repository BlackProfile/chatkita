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
- **Login admin tanpa tombol**: tombol "Masuk" dihapus. Saat mengetik password, form mengecek kebenaran via event BARU `admin:password_peek` (tanpa membuka sesi, ack hanya `{ ok }`, tidak menyentuh data).
- **Feedback hijau**: password benar → titik-titik input berubah **hijau** (border + teks emerald) + status "Password benar — menyinkronkan database…" (spinner).
- **Delay sinkronisasi + autologin**: setelah benar, jeda ±0,9 dtk lalu `admin:auth` dipanggil otomatis. Mengetik lagi membatalkan antrean login. Enter tetap berfungsi.
- **Rate limit peek terpisah** (30 gagal/socket/menit + 120 gagal global/menit, minimum 6 kar) — mengetik bertahap TIDAK mengunci `admin:auth` (counter v23 tetap ketat).
- **Login user ber-delay**: klik Masuk/Lanjut/PIN → tombol berubah "Menyinkronkan database…" (spinner) ±0,9 dtk → auth dikirim. Proteksi dobel-kirim; auto re-auth saat reconnect TIDAK ter-delay.
- Logout admin mengosongkan form password (autologin tidak menyala ulang). Verifikasi: verify-integrity seksi "v24".

### v25 — Pusat Cheat (Task 43)
- **Semua fitur cheat admin jadi SATU tempat**: tab baru **"Cheat"** di Dashboard Aplikasi (`admin-dashboard.tsx` → `AdminCheat` di `admin-cheat.tsx`), tepat setelah tab Pusat.
- **Event server baru (v25)**: `admin:cheat_peek` (muat pesan target + keadaan saklar cheat), `admin:cheat_send` (spoof kirim sebagai user + backdate opsional ≤90 hari), `admin:cheat_edit` (edit isi pesan teks siapa saja, edit_history tetap terekam), `admin:cheat_react` (reaksi emoji atas nama user), `admin:cheat_time` (ubah `created_at` pesan; klien memperbarui chip waktu via `message:updated.createdAt`).
- **`insertAndFanOut` kini menerima `ts` opt** untuk timestamp custom (spoof/backdate) — fan-out/push/audit tetap sama seperti pesan asli.
- **Fitur cheat lama ikut dikumpulkan di sini**: ilusi "sedang mengetik…" (admin:fake_typing), tandai dibaca palsu (admin:fake_receipts), selalu online (admin:always_online), mirror mengetik (admin:mirror), mode hantu (admin:ghost), terakhir dilihat palsu (admin:fake_last_seen), hapus pesan siapa saja (admin:delete_message).
- **UI**: pilih target user (Select) → daftar pesan (klik = pilih, form ikut terisi), grid aksi (spoof/edit/reaksi/ubah waktu/hapus), seksi sinyal ilusi (3 Switch + last seen + 2 tombol), **log cheat sesi** (maks 40 entri). Semua aksi di-audit (`cheat_send/cheat_edit/cheat_react/cheat_time`) + toast.
- Guard: tanpa auth → UNAUTHORIZED; target admin → NOT_FOUND; teks kosong/emoji di luar palet → INVALID_MESSAGE; waktu di luar −90 hari/+1 hari → INVALID_SCHEDULE.
- Uji protokol 16/16 PASS. Verifikasi: verify-integrity seksi "v25" (13 cek baru).

### v26 — Peta Penyimpanan + metadata media (Task 45)
- **Tab baru "Penyimpanan"** di Dashboard Aplikasi (`admin-storage.tsx`, event `admin:storage_map`): peta disk (Database + WAL + file media, jumlah file, total), rincian media **per jenis** (foto/audio/video/PDF/file lain — jumlah + byte + bar), **per pengguna** vs kuota 250 MiB/akun (bar emerald/amber/rose), daftar **12 file terbesar** dengan metadata, dan **tombol "Pindai metadata"** (`admin:media_scan`, maks 500 file/run) + badge cakupan metadata.
- **Aplikasi kini MEMBACA METADATA media/file user langsung dari header file** (kolom baru `messages.meta_json`): PNG/JPEG/GIF/WebP → dimensi `W×H`; MP4/MOV → dimensi + durasi (mvhd/tkhd); PDF → perkiraan jumlah halaman. Parser header murni TS (baca maks 4 MiB pertama, tanpa dependensi).
- **Metadata otomatis saat kirim**: pesan foto/file baru langsung dibaca metadata-nya di server (`attachMediaMeta`), termasuk pesan terjadwal. Media lama diisi lewat "Pindai metadata".
- Metadata tampil di daftar file terbesar (emerald: `1600×900`, `0:42`, `12 hlm`). Semua aksi audit (`storage_map`, `media_scan`).
- Verifikasi: verify-integrity seksi "v26" (12 cek baru).

### v27 — 1 Orang 1 Akun (Task 46)
- **Registrasi baru wajib 3 syarat** (server-side, `user:auth`): **password** (4–72 karakter, bcrypt cost 10) + **kode undangan sekali pakai** (`CK-XXXXX-XXXX`, 1 kode = 1 akun, hangus setelah dipakai) + **perangkat yang belum pernah terdaftar** (`devices` table, 1 perangkat = 1 akun, append-only). Registrasi tetap bisa dibuka/ditutup admin (Pengaturan → Akses).
- **Login akun ber-password**: nama + password benar (rate limit per-nama 10 gagal/menit → `TOO_MANY_ATTEMPTS`). **Lintas perangkat diperbolehkan via username+password**; perangkat baru ikut tercatat ke akun (maks 8). Sesi tersimpan (restore) tetap bekerja, tapi sesi di perangkat milik akun lain ditolak (menutup celah salin localStorage).
- **Akun lama dimigrasi**: login name-only/PIN tetap jalan, tapi auth mengembalikan `mustSetPassword` → **modal wajib pasang password** (tidak bisa ditutup/di-Esc) via event `user:set_password`. Sekali saja saat boot v27, server menyisipkan **pesan sistem pemberitahuan** ke chat setiap akun lama ("🔐 Pembaruan keamanan…", tanda `notice_v27_sent`).
- **Dashboard admin (tab Pengguna)**: tombol **"Buat akun"** (nama + password langsung, tanpa kode), **kartu Kode undangan** (buat 1–20 kode + catatan, klik kode = salin, status tersedia/terpakai oleh siapa, hapus), **menu aksi per user** (⋯): **Reset password…** dan **Lepas kunci perangkat** (untuk ganti HP / reset device-lock). Badge per user: 🔑 ber-password / ⚠ tanpa password + jumlah perangkat.
- Klien mengirim **deviceId** (UUID di localStorage `chatkita:deviceId`) pada setiap auth. Error baru: `PASSWORD_REQUIRED`, `INVALID_PASSWORD`, `TOO_MANY_ATTEMPTS`, `INVITE_REQUIRED/INVALID/USED`, `DEVICE_REQUIRED/TAKEN`, `ALREADY_SET`, `NAME_TAKEN` (semua terdaftar di `ChatErrorCode`).
- Semua aksi admin di-audit (`invite_create/invite_delete/user_create/user_reset_password/user_unbind_devices`).
- Verifikasi: verify-integrity seksi "v27" (26 cek baru, total 86).

### v28 — Sembunyikan Kode Undangan untuk Akun Lama (Task 47)
- **Masalah**: kartu login selalu menampilkan kolom "Kode undangan" padahal field itu hanya relevan untuk pendaftaran akun baru — user lama yang sekadar masuk ikut melihatnya (membingungkan).
- **Solusi**: event pre-login baru **`public:check_name`** `{ name }` → `{ ok, exists }` (boolean saja, case-insensitive, role `user`; nama reserved "Admin" dianggap exists). Klien mengetik nama → **debounce 300 ms** → cek ke server → `exists = true` → **kolom kode undangan disembunyikan** + hint hijau kecil "Akun ditemukan — kode undangan tidak diperlukan untuk masuk." + label nama berubah dari "Nama baru" → "Nama akun". Nama dikosongkan → kolom muncul lagi.
- Lapisan kedua: error `INVALID_PASSWORD` dari `user:auth` (password salah = akun pasti ada) juga memaksa `nameExists = true` — kolom tetap tersembunyi walau cek debounce belum sempat berjalan. Kode undangan yang tertinggal di state otomatis dibersihkan saat `exists`.
- Verifikasi: verify-integrity seksi "v28" (9 cek baru, total 93).

### v29 — Reset & Hapus Menyeluruh (Task 48)
- **Semua fitur yang menumpuk data kini punya reset/hapus**, server + UI, dengan konfirmasi:
  - **User: "Bersihkan chat…"** (menu ⋮) — menghapus SELURUH riwayat percakapan sendiri memakai pipeline yang sama dengan reset admin (`wipeConversationMessages`: tombstone batch forensik-safe + media dibebaskan + pin dilepas). Broadcast `conversation:reset` kini membawa `by`/`byName` sehingga toast/catatan sistem di kedua pihak menyebut siapa pembersihnya (tidak selalu "admin").
  - **User: "Hapus semua bintang"** (panel pesan berbintang) — `messages:unstar_all`, per-user (`starred_by`): bintang pihak lain tidak tersentuh; tiap pesan berubah di-broadcast.
  - **User: "Batalkan semua terjadwal (n)"** (dialog kirim terjadwal) — `messages:schedule_cancel_all`, hard delete semua jadwal milik sendiri yang belum terkirim.
  - **User: "Reset tampilan"** (menu ⋮) — ukuran huruf & hemat data kembali ke default.
  - **Admin: "Hapus akun…"** (menu ⋯ tab Pengguna) — `admin:user_delete`: hapus PERMANEN akun + seluruh pesan/reaksi/reads/percakapan/perangkat/langganan push (media dibebaskan), socket user langsung diputus, broadcast `users:changed` ke sesi admin lain (dashboard & panel ikut menyegarkan; percakapan aktif tertutup otomatis). Akun admin tak bisa dihapus lewat event ini.
  - **Admin: "Hapus belum terpakai (n)"** (kartu kode undangan) — `admin:invites_clear_unused`.
  - **Admin: "Bersihkan log"** (dialog Audit, dua langkah) — `admin:audit_clear`; server tetap menulis SATU entri `audit_clear` sebagai jejak.
  - **Admin: "Kembalikan default"** (tab Pengaturan, zona berbahaya) — `admin:settings:reset` menghapus hanya kunci di `APP_SETTING_RESET_KEYS` (15 kunci perilaku aplikasi); password admin, VAPID, dan kunci internal lain aman.
- Verifikasi: protokol 36/36 (`.zscripts/t48-test.ts`); verify-integrity seksi "v29" (20 cek baru, total 111).

### v30 — Bersihkan Chat Kedua Sisi Khusus Admin (Task 49)
- **Aturan baru**: membersihkan riwayat chat yang berdampak ke **kedua sisi** (user + admin) kini **hanya dapat dilakukan oleh ADMIN**.
- **`conversation:clear` (user) DIHAPUS** dari protokol & server — menu ⋮ user tidak lagi punya item "Bersihkan chat…" (dialog konfirmasinya ikut dihapus; tipe `ConversationClearAck` ditarik dari `chat-types.ts`).
- **Satu-satunya jalur pembersihan**: tombol **"Reset chat"** di panel admin (sudah ada sejak v11, kini satu-satunya) → `admin:reset_conversation` → pipeline `wipeConversationMessages` (tombstone batch forensik-safe + media dibebaskan + pin dilepas) + broadcast `conversation:reset { by: 'admin', byName: 'Admin' }` + entri audit `reset_conversation`. Dialog konfirmasi menyebut dengan jelas: "SEMUA pesan percakapan ini dihapus permanen untuk kedua sisi".
- Menu user tetap punya **"Reset tampilan"** (lokal, hanya ukuran huruf & hemat data — bukan data chat).
- Verifikasi: verify-integrity seksi "v30" (7 cek; 4 cek v29 kedaluwarsa diganti, total 114).

### v31 — UX Lampiran: Preview Inline, Caption Otomatis, Jenis Jelas (Task 50)
- **Tanpa popup**: memilih video/audio/file tidak lagi membuka dialog "Kirim file" — semua lampiran kini tampil sebagai **chip pratinjau inline** di atas composer, persis seperti foto: video memakai **cuplikan `<video>` hidup**, audio/file memakai ikon jenisnya; nama + ukuran + progres unggah + tombol batal ada di chip.
- **Teks ikut media**: apa pun yang diketik di composer saat lampiran menunggu ikut terkirim sebagai **caption di pesan yang sama** (tombol kirim maupun Enter — `handleSend` mengirim lampiran dulu); chip foto/video/audio/file semuanya mendukung.
- **Menu lampiran per jenis**: tombol + memecah satu item generik "Lampirkan foto atau file" menjadi **Foto** (ikon gambar, `image/*`), **Video** (ikon film, `video/*`), **Audio** (ikon musik, `audio/*`), **File** (paperclip, semua) — file picker langsung terfilter sesuai jenis. Berlaku di composer user DAN panel admin.
- **File audio ≠ voice note**: bubble untuk lampiran audio kini kartu berbeda — ikon musik + nama file + "File audio · ukuran" + **pemutar `<audio>` standar browser** (bisa di-seek) — sementara voice note yang direkam tetap memakai VoicePlayer gelombang + transkrip. (Server sudah benar sejak lama: transkripsi hanya `type='voice'`.)
- Verifikasi: verify-integrity seksi "v31" (9 cek baru, total 121).

### v32 — Tautan Bisa Diklik & Terbuka Langsung Tanpa Popup (Task 51)
- **Keluhan**: link di pesan tidak bisa dibuka langsung — teks URL tidak bisa diklik, dan kartu pratinjau harus melewati Dialog popup dulu baru tombol "Buka di browser".
- **Semua URL jadi tautan langsung**: teks pesan dan caption media dirender via komponen baru `LinkifiedText` (`link-preview.tsx`) — SEMUA URL http(s) di dalam teks otomatis menjadi `<a target="_blank" rel="noopener noreferrer">` bergaris bawah yang terbuka langsung di tab browser baru (bukan hanya URL pertama); tanda baca di akhir URL tidak ikut menjadi link.
- **Kartu pratinjau tanpa popup**: `LinkPreviewCard` berubah dari tombol pembuka Dialog in-app menjadi **anchor `<a>` langsung** — satu ketukan membuka tautan (perilaku native browser, bukan `window.open` yang bisa diblokir), plus ikon external-link sebagai penanda. Dialog pratinjau + tombol "Buka di browser" dihapus total. Data OG (judul/deskripsi/gambar) tetap dipakai untuk isi kartu.
- **Aman & rapi**: `rel="noopener noreferrer"` di semua tautan eksternal; ketukan tautan tidak men-toggle baris aksi bubble; berlaku simetris di chat user dan panel admin (sama-sama memakai ChatBubble).
- Verifikasi: verify-integrity seksi "v32" (9 cek; 2 cek versi v31 dipindah, total 128).

### v33 — Thumbnail Pratinjau Tautan YouTube (Task 52)
- **Keluhan**: kartu pratinjau tautan YouTube tampil **kotak hitam kosong** (fallback ikon ▶) tanpa judul — YouTube memblokir `og:image`/`og:title` untuk fetch bot (halaman persetujuan cookie), jadi parse Open Graph selalu kosong untuk link YouTube/youtu.be.
- **Thumbnail selalu ada**: bila OG tak memberi gambar, server mengisi `image` dari **CDN statis YouTube `i.ytimg.com/vi/<id>/hqdefault.jpg`** (tanpa API key, selalu tersedia untuk video valid) — thumbnail asli video langsung tampil di kartu, dimuat oleh browser pengguna.
- **Judul asli video**: bila OG tak memberi judul, server mengambil **oEmbed YouTube** (`youtube.com/oembed`, timeout 4 s) → judul video + nama kanal (jadi siteName kartu) — bukan lagi "youtube.com" generik.
- **Kartu anti-gagal**: bila fetch halaman gagal total (diblokir/timeout/bukan HTML), handler baru `providerFallback` tetap memberi kartu minimal untuk YouTube (videoId sudah diketahui dari URL — termasuk bentuk pendek `youtu.be`) alih-alih kartu menghilang.
- **TikTok ikut di-enrich**: judul + thumbnail via oEmbed TikTok (best-effort, gagal = diam).
- Verifikasi: verify-integrity seksi "v33" (7 cek; 2 cek versi v32 dipindah, total 133).

### v34 — Penampil Tautan In-App / Popup Embed (Task 53)
- **Permintaan**: "linknya ga bisa dibuka di aplikasi langsung? kayak popup tanpa buka aplikasi streamnya?" — ketukan tautan tidak lagi melompat ke browser/aplikasi stream, tapi membuka **popup di dalam aplikasi**.
- **LinkViewerDialog** (`src/components/chat/link-viewer.tsx`, baru): dialog in-app yang di-mount sekali di tiap root (Messenger + AdminPanel); dibuka dari komponen mana pun via store zustand `openLinkViewer()` — kartu pratinjau maupun tautan di teks/caption memanggilnya.
- **YouTube diputar in-app**: iframe embed resmi `youtube-nocookie.com/embed/<id>` rasio 16:9, autoplay (ketukan = gesture), fullscreen; TikTok via `tiktok.com/embed/v2/<id>` (potret). Dialog ditutup → iframe di-unmount, pemutaran benar-benar berhenti.
- **Situs lain**: tampilan info — thumbnail besar + judul + deskripsi + situs; bila data pratinjau gagal/sedang dimuat ada skeleton dan pesan "Pratinjau tidak tersedia".
- **Jalan keluar selalu ada**: tombol **"Buka di browser"** (target _blank + rel noopener noreferrer) dan **"Salin"** (clipboard + toast). `href` pada tautan tetap dipertahankan untuk middle-click / menu long-press / tanpa-JS.
- Verifikasi: verify-integrity seksi "v34" (11 cek; 2 cek versi v33 dipindah).

### v35 — Metadata Media untuk Admin: EXIF GPS/Kamera (Task 54)
- **Permintaan**: "buat admin bisa baca metadata dari foto/video/dll yang dikirim user, jadi bisa baca lokasinya dll yang ada di metadatanya".
- **Ekstraksi server-side** (`mini-services/chat-service` + pustaka **exifr**): saat pesan media dikirim, server membaca file di disk dan menyimpan `meta_json` — kini termasuk **EXIF foto**: GPS (lat/lon desimal, 0,0 diabaikan), kamera (Make/Model), lensa, waktu jepret (DateTimeOriginal/CreateDate → ISO), software, orientasi, ISO, bukaan f, waktu eksposur, focal length. Semua string dibatasi 80 char, best-effort (gagal = diam, pengiriman tak pernah terganggu).
- **Event baru `admin:message_meta`** (KHUSUS admin, ter-audit): `{messageId}` → metadata lengkap + info file (nama asli, MIME, ukuran, pengirim, waktu kirim, status hapus/kedaluwarsa). **Enrichment live**: pesan lama tanpa EXIF dibaca saat pertama dibuka admin lalu di-persist.
- **Video MP4/MOV** kini juga mendapat `videoCreated` (waktu rekaman dari mvhd box, epoch 1904 → ISO, divalidasi rentang wajar).
- **UI admin** (`media-meta-dialog.tsx` baru): aksi **"Metadata"** pada bubble media (foto/file/voice, bukan dihapus/kedaluwarsa) → dialog: seksi File, Media (dimensi/durasi/halaman/video dibuat), dan **EXIF** — lokasi GPS tampil menonjol dengan koordinat + tombol **Google Maps** & **OpenStreetMap** (target _blank, noopener). Tanpa EXIF → pesan tenang, bukan error. State reset via `key` remount; setState hanya di callback socket (aturan React Compiler).
- Verifikasi: verify-integrity seksi "v35" (13 cek; 2 cek versi v34 dipindah, total 153).

### v36 — Media Permanen: Retensi Otomatis Dinonaktifkan (Task 55)
- **Permintaan**: "bagusnya media disimpan dimana ya, biar ga hilang otomatis oleh aplikasi?" — foto/video/voice/file yang dikirim user tidak boleh dihapus otomatis lagi.
- **Perilaku lama**: sweeper retensi (tiap 6 jam) menghapus media berumur > 30 hari (`MEDIA_RETENTION_DAYS`, maks 365) → pesan jadi tombstone "media kedaluwarsa" + file disk dibuang.
- **Perilaku baru**: default retensi = **0 hari = TIDAK PERNAH** — `sweepExpiredMedia` langsung return (tidak ada media yang dibersihkan otomatis); media + pesan + metadata tetap utuh selamanya. Env `MEDIA_RETENTION_DAYS=1..365` masih bisa dipakai bila suatu saat retensi diinginkan kembali.
- **Lokasi penyimpanan** (tidak berubah): `db/media/<sha256>.<ext>` (dedup SHA-256), dilayani `/api/media/<nama>` (ETag + Range + cache immutable), dibackup otomatis ke `/home/z/backups/chatkita-media-*.tar.gz` oleh hook post-commit; kuota 250 MiB/akun tetap berlaku saat mengirim.
- **UI**: dashboard admin kini menampilkan "retensi otomatis nonaktif — media disimpan permanen" (tab Sistem) dan "disimpan permanen — tidak dihapus otomatis" (Info aplikasi); log boot service: `retensi: tidak pernah (media permanen)`. Tombol "Bersihkan media lama" tetap ada (kini hanya VACUUM — tidak ada media kedaluwarsa).
- **Backup media diperkuat**: `make-backup.sh` tidak lagi menelan kegagalan tar (`|| true` dihapus) — tar media gagal/kosong = exit 1 dengan pesan "❌ TAR MEDIA GAGAL/KOSONG", dan ringkasan backup menyatakan status tar. (Insiden Task 55: file media lama sebagian sudah hilang sebelumnya tanpa jejak karena tar diam-diam tidak jalan.)
- Verifikasi: verify-integrity seksi "v36" (10 cek; 2 cek versi v35 dipindah, total 161).

### v37 — Insight Per-Pengguna untuk Admin (Task 56)
- **Permintaan**: "berikan ide per user pada admin" — admin ingin melihat statistik + ide/saran otomatis untuk SETIAP pengguna.
- **Event baru `admin:user_insight`** (khusus admin, ter-audit): `{ userId }` → agregat percakapan user↔admin dari messages/reads/message_reactions: total pesan & media & karakter, histogram **jam (24) & hari (7) zona WIB** (bukan UTC — sesuai kebiasaan pengguna), hari aktif + **streak** berturut-turut, jeda terpanjang, **kecepatan membalas berpasangan** (user & admin, cap 12 jam agar jeda semalam tidak dihitung), **% pesan admin yang dibaca**, reaksi diberi/diterima, **tren 7 vs 7 hari**.
- **Ide otomatis (4–8 butir Bahasa Indonesia)** di server: "Berteman sejak…", "Jam paling aktif: 20:00–21:00 WIB", "Hari paling ramai: …", "Rata-rata membalas dalam …", "Kamu biasanya membalas X dalam …", tren mingguan naik/turun/stabil, "Media favorit: foto (Nx, total Y)", "% pesan kamu dibaca · N reaksi", "Streak aktif N hari 🔥", "Terakhir chat N hari lalu — coba sapa lagi 👋".
- **UI** (`user-insight-dialog.tsx` baru): menu titik-tiga tiap akun di tab **Pengguna** → **"Insight pengguna"** → dialog: 4 KPI (pesan, media, balas rata-rata, hari aktif/streak), histogram batang CSS murni (jam + hari, puncak disorot), baris tren/baca/reaksi, dan panel **"Ide buat kamu"** (amber). State di-reset via `key` remount; setState hanya di callback socket (aturan React Compiler).
- Verifikasi: verify-integrity seksi "v37" (10 cek; 2 cek versi v36 dipindah, total 169).

### v38 — Kontrol User Lengkap dari Toolbar Percakapan (Task 57)
- **Permintaan**: "tambahkan fitur disini, fitur cheating lengkap, media control, dll buat yang banyak untuk per user" (screenshot toolbar percakapan admin).
- **Toolbar percakapan admin kini 8 pill**: ⌨ Typing palsu · ✓✓ Palsu · **🎭 Cheat** · **🖼 Media** · **💡 Insight** · Ekspor chat · Reset chat · Info user.
- **🎭 Cheat** (`user-cheat-dialog.tsx` baru) — pusat cheat PER-USER tanpa pemilih target (otomatis partner percakapan aktif): daftar pesan terpilih + **kirim pesan spoof sebagai user** (bisa backdate ≤90 hari), **edit pesan teks siapa saja**, **reaksi 6 emoji atas nama user** (toggle), **ubah waktu pesan**, **hapus pesan** (pipeline resmi + forensik), serta sinyal ilusi: typing palsu (sinkron dgn pill toolbar lewat `fakeTypingMap` induk), ✓✓ dibaca palsu, selalu online, mirror mengetik, mode hantu, dan "terakhir dilihat" palsu. Semua memakai event cheat v25 yang sudah ada — ter-audit, plus log aksi lokal di dialog.
- **🖼 Media** (`user-media-dialog.tsx` baru) — kontrol media per-user: grid semua media hidup percakapan (foto thumbnail, voice durasi, file ikon+nama) dengan badge pengirim (violet=user, emerald=Admin), **filter Semua/Dari user/Dari Admin**, tap → **MediaViewer galeri**, hapus per item (ikon trash overlay), ringkasan pemakaian per sisi (jumlah + bytes), dan **"Hapus semua (N)"** dgn ConfirmDialog — HANYA media milik user (media Admin aman).
- **Event server baru (v38)**: `admin:user_media {userId}` (list read-only + totals), `admin:media_delete {messageId}` (tombstone pipeline resmi `deleted_content` utk forensik + `releaseMediaFile` SHA-256 dedup aware + kuota longgar otomatis), `admin:media_delete_all {userId, scope: "user"|"all"}` — semuanya adminGuard + audit (`media_delete`, `media_delete_all`) + broadcast `message:updated` ke kedua sisi.
- **💡 Insight** — shortcut membuka dialog insight v37 langsung dari konteks percakapan (sama dengan menu tab Pengguna).
- Verifikasi: verify-integrity seksi "v38" (12 cek; 2 cek versi v37 dipindah, total 179).

### v39 — Kendali Per-User Tambahan: Rename, Hapus Massal, Bot Balasan, Push, Kuota (Task 58)
- **Permintaan**: lanjutan "fitur cheating lengkap, media control, dll buat yang banyak untuk per user" — paket akun level berikutnya di panel X-Ray (Manajemen pengguna → ketuk user).
- **5 event server baru (semua adminGuard + `restrictionTarget` + audit)**:
  - `admin:user_rename {userId, name}` — ganti nama tampilan/login user; validasi sama dgn pembuatan akun (1–40 char, bukan nama Admin, unik antar-user); broadcast conversations agar semua daftar menyegarkan nama.
  - `admin:bulk_delete_user {userId}` — tombstone SEMUA pesan hidup milik user di SEMUA percakapan (semua jenis) via pipeline hapus resmi (`deleted_content` tersimpan utk forensik); file disk media ikut dibebaskan (SHA-256 dedup aware) → kuota longgar otomatis; percakapan terdampak di-push ulang.
  - `admin:user_bot {userId, on, text, delaySec}` — **bot balasan otomatis** per-user: saat user mengirim pesan ke percakapan yang memuat Admin, server membalas ATAS NAMA ADMIN dgn teks tersimpan setelah jeda 0–120 dtk. Konfigurasi persist di kolom `users.bot_reply_*`; satu timer pending per user (pesan beruntun tidak menumpuk); ubah konfigurasi membatalkan balasan pending.
  - `admin:user_push {userId, title, body}` — web push custom (judul ≤60, isi ≤200) ke SEMUA langganan push user; ack memuat jumlah langganan.
  - `admin:user_quota {userId, mb}` — **kuota media khusus per-user** (MiB, 0 = default global 250 MiB); dicek di `messages:send` via `effectiveQuotaBytes()` (ganti `QUOTA_BYTES` langsung).
- **UI (`user-manager.tsx`)**: seksi **"Kendali tambahan"** di panel X-Ray — ganti nama (input + Ganti), bot balasan (Switch + teks + pilihan jeda 0/3/10/30/60 dtk + Simpan), kuota media (pilihan Default/5/10/25/50/100/200/500 MiB + Terapkan, catatan terpakai), kirim push (judul + isi + Kirim), dan **"Hapus semua pesan user"** (destructive + ConfirmDialog). Konten detail kini scrollable (`max-h-[65vh]`). State diinisialisasi dari profil X-Ray (`botReplyOn/botReplyText/botReplyDelaySec/mediaQuotaMb` baru di `XrayProfile`) dan di-remount per user via `key`.
- **Tipe baru** (`chat-types.ts`): `AdminRenameAck`, `AdminBulkDeleteUserAck`, `AdminBotState/Ack`, `AdminPushAck`, `AdminQuotaAck` + protokol Kategori B2.
- Verifikasi: verify-integrity seksi "v39" (16 cek; 2 cek versi v38 dipindah, total 193).

### v40 — Pusat Kendali Per-User: Moderasi, Insight, Otomasi, Keamanan (Task 59)
- **Permintaan**: "berikan ide lagi fitur peruser" → "semua." — 19 ide per-user dievaluasi; ternyata mute/freeze/slowmode/mediablock/kick SUDAH ada sejak v10/v11, jadi dibangun **15 fitur baru + 2 penyempurnaan**.
- **Server — 20 event baru (semua adminGuard + `restrictionTarget` + audit)**:
  - MODERASI: `admin:word_filter` (kata terlarang per-user, aksi 'block' = tolak `WORD_BLOCKED` / 'censor' = sensor `***` di `messages:send`), `admin:approval_mode` + `admin:moderate` (pesan user disimpan `pending=1`, HANYA dikirim ke room admin; Setujui → `pending=0` + fan-out `message:new` ke user + `message:updated` ke admin; Tolak → tombstone via pipeline resmi + `moderation:rejected` ke user; pesan pending disembunyikan dari daftar/preview user via `pendingHide`), `admin:media_types` (blokir per jenis image/voice/file → `MEDIA_TYPE_BLOCKED`), `admin:user_force_logout` (hapus semua `devices` + `session:revoked` ke seluruh socket user + disconnect).
  - INSIGHT: `admin:user_note` (catatan pribadi + tag `vip`/`attention`/`problem`), `admin:leaderboard` (4 peringkat: pesan terbanyak, media terbanyak, paling baru aktif, balas tercepat ke Admin — rata-rata berpasangan), `admin:user_compare` (insight v37 dua user berdampingan), `admin:user_logins` (50 login terakhir dari tabel baru `login_events`, diisi otomatis di `user:auth` dgn IP/UA/kind login|restore).
  - OTOMASI: `admin:schedule_message`/`schedule_list`/`schedule_cancel` (pesan admin terjadwal ke user — REUSE kolom `scheduled_at` v22 + `deliverDueScheduled` tiap 10 dtk, tanpa tabel/timer baru), `admin:quick_reply_list`/`quick_reply_set`/`quick_send` (template per-user di `users.quick_replies`, klik = kirim instan ATAS NAMA ADMIN), `admin:user_nudge` (pengingat otomatis saat user diam ≥ X hari; sweeper 30 menit, sekali per periode diam via `nudge_last_at`), `admin:user_autoclean` (tombstone pesan > X hari di percakapan user; sweeper 6 jam via pipeline resmi + bebaskan file media).
  - MEDIA & AMAN: `admin:user_media_zip` (ZIP semua media hidup user via **fflate** level store, base64 ack, maks 40 MiB → error `NO_MEDIA`/`TOO_LARGE`), `admin:user_pinlock` + `admin:unlock` (kunci percakapan dgn PIN 4–8 digit — hash `pinHash(pin, "lock:<id>")`; `messages:history`/`messages:older` menolak dgn `PIN_LOCKED {userId}` sampai socket admin membuka kunci — per socket, hilang saat reconnect).
  - `admin:quota_warn` (push ke room admin saat pemakaian kuota media user menyentuh 80%/95%, sekali per ambang per boot via map) + `admin:activity` (feed live login/kirim/baca user ke room admin).
- **Migrasi**: 12 kolom users baru (word_filter, word_filter_action, approval_mode, blocked_media_types, admin_note, tag, quick_replies, nudge_days, nudge_text, nudge_last_at, auto_clean_days, pin_lock) + `messages.pending` + tabel `login_events` (indeks user+at).
- **Klien**: komponen baru `user-controls-v40.tsx` (9 seksi kendali di panel X-Ray: catatan+tag, filter kata, mode persetujuan, blokir jenis media, kunci PIN, balasan cepat, pesan terjadwal, pengingat otomatis, auto-bersih, ZIP, paksa logout, riwayat login) dipasang di bawah "Kendali tambahan" v39; komponen baru `dashboard-v40.tsx` di tab Pengguna (tombol Peringkat → dialog 4 peringkat, Bandingkan → dialog A vs B, Feed aktivitas live 12 entri); AdminPanel: strip "⏳ Menunggu persetujuan" + tombol Setujui/Tolak di bubble pending, dialog "Percakapan terkunci" (PIN), toast kuota via showMenuNotice, `message:updated` meng-copy `pending`; Messenger: handler `session:revoked` (toast + hapus sesi + reload), `moderation:rejected` (banner+toast), pesan error baru `WORD_BLOCKED`/`MEDIA_TYPE_BLOCKED`, ack pending → toast "menunggu persetujuan".
- Verifikasi: verify-integrity seksi "v40" (37 cek; 2 cek versi v39 dipindah, total 227). Lint 0/0.

### v45 — Kendali Akun Penuh (Account 360) + Cheat Lab (Task 61)
- **Permintaan**: "buat admin bisa setting penuh akun user apapun itu. tambahkan juga fitur cheat lainnya yang banyak."
- **Server — 14 event baru (semua adminGuard + `restrictionTarget` + audit)**:
  - AKUN 360: `admin:account_get` (profil penuh: semua kolom kendali + bendera cheat + jumlah perangkat/login/pesan hidup/pemakaian media), `admin:account_set` (SATU event patch parsial untuk SEMUA kolom: nama tampilan (validasi unik), frozen, bisu menit, slowmode, blokir media + per jenis, filter kata + aksi, mode persetujuan, kuota MiB, bot balasan (on/teks/jeda), catatan admin, plus bendera cheat), `admin:account_password` (admin SET password user langsung — bcrypt `hashUserPassword`), `admin:account_delete` (HAPUS PERMANEN akun: wipe semua percakapan via pipeline resmi + hapus reactions/reads/devices/push_subscriptions/login_events/row users; wajib `confirm:'HAPUS'`).
  - CHEAT LAB (bendera per-user di kolom baru `users.cheat_json` JSON): **lubang hitam** (`blackhole` — pesan user tetap tersimpan + ✓✓ di sisi user, tapi `insertAndFanOut` dengan `suppressAdminRoom` TIDAK menyiar live ke room admin), **bungkam ✓✓** (`suppressReads` — `messages:read` dari ADMIN atas percakapan user ini tidak pernah `markRead`/broadcast → ✓✓ user beku selamanya), **ilusi online** (`fakePresence` — disconnect tetap memancarkan `online:true`, `getConversationsFor` admin memaksa `online:true` + `lastSeenAt:null`), **auto-react** (`autoReact` emoji valid → 1,2 dtk setelah tiap pesan user, Admin otomatis mereaksi + broadcast `message:updated`).
  - AKSI: `admin:notify_user` (toast arbitrary ke user via event baru `user:toast` — preset "alert login palsu" di UI), `admin:media_gallery` (daftar file unik `db/media`, maks 200 terbaru), `admin:cheat_inject_media` (suntik media dari galeri server ke percakapan user atas nama user/admin — nama divalidasi anti path-traversal, mime dari ekstensi), `admin:cheat_flood`+`cheat_flood_stop` (banjir N×interval 100 ms–10 dtk, satu set timer per user).
  - MASSAL: `admin:cheat_retro_replace` (ganti kata di seluruh riwayat teks, `edit_history` terisi per pesan, maks 200), `admin:cheat_time_shift` (geser `created_at` ±N menit maks ±30 hari, scope user/all), `admin:cheat_delete_keyword` (tombstone semua pesan berkata kunci + bebaskan file media), `admin:broadcast_announce` (pengumuman atas nama Admin ke percakapan SETIAP user, prefiks 📢).
- **Migrasi**: `users.cheat_json` TEXT (JSON bendera: blackhole/suppressReads/fakePresence/autoReact).
- **Klien**: tipe baru Kategori J (chat-types: `AdminAccountProfile`, `AdminAccountSetPayload`, `AdminCheatFlags`, ack v45, `UserToastPayload`); komponen baru `account-control-dialog.tsx` (dialog 4 tab — **Akun** (statistik ringkas, nama, SET password, kuota, catatan, zona bahaya hapus akun), **Ilusi** (3 saklar bendera cheat, auto-react 6 emoji, toast palsu, galeri + injeksi media, flood), **Massal** (retro-edit, mesin waktu, sapu kata, scope semua), **Siaran** (broadcast)) dibuka dari tombol "Kendali akun penuh" di panel X-Ray (user-manager), refresh otomatis detail+daftar setelah aksi; Messenger: handler `user:toast` (toast sonner 8 dtk).
- Verifikasi: verify-integrity seksi "v45" (26 cek; cek versi v40 digeneralisasi v4+). Lint 0/0.

### v46 — Konsolidasi Fitur (Task 62)
- **Permintaan**: "gabungkan fitur yang perlu digabungkan" — fitur duplikat/terpencar digabung jadi SATU pintu tanpa kehilangan fungsi.
- **CheatBody bersama** (`src/components/chat/cheat-core.tsx`): seluruh logika+UI cheat (peek, spoof+backdate, edit, reaksi, ubah waktu, hapus, sinyal ilusi typing/✓✓/online/mirror/hantu/last-seen, log) kini SATU komponen — dipakai tab "Cheat" (dashboard) DAN dialog 🎭 (toolbar percakapan). `admin-cheat.tsx` & `user-cheat-dialog.tsx` tinggal wrapper (±1.250 baris duplikat hilang); pill "⌨ Typing palsu", "✓✓ Palsu", dan grup menu "Sinyal palsu" di AdminPanel DIHAPUS.
- **Account 360 = satu-satunya pusat kendali per-user** (`account-control-dialog.tsx`, kini 4 tab): **Akun** (nama, SET password, kuota, zona bahaya hapus — catatan pindah ke Moderasi), **Moderasi** (BARU: pembatasan cepat freeze/mute/slowmode/mediablock/kick via event v11 yang mem-push `user:restricted` + bot balasan kini via `admin:account_set` + embedded `UserControlsV40` — catatan+tag, filter kata, persetujuan, blokir per jenis, PIN, balasan cepat, terjadwal, nudge, auto-bersih, ZIP, paksa logout, riwayat login), **Ilusi** (flags + auto-react + toast + push custom pindahan + injeksi media + flood), **Massal** (retro-edit, mesin waktu, sapu kata + hapus semua pesan pindahan). Tab "Siaran" DIHAPUS (duplikat tab Siaran dashboard).
- **X-Ray diringkas** (`user-manager.tsx`): panel "Kendali tambahan" v39 & panel v40 inline & 5 tombol aksi duplikat DIHAPUS — tinggal profil, grafik, chip status, tombol "Kendali akun penuh", "Ekspor data". Dialog menerima `xrayProfile`/`onRestricted`/`onNotice`.
- **Dashboard**: dropdown per-user kini Insight / "Kendali akun penuh" (Account 360) / Lepas perangkat — dialog reset-password & hapus-akun duplikat DIHAPUS; tombol "Unduh backup JSON" di tab Sistem DIHAPUS (kanonik di tab Pusat).
- **Server**: event `admin:user_rename`, `admin:user_quota`, `admin:broadcast_announce` DIHAPUS (fungsinya 100% tercakup `admin:account_set` / `admin:broadcast`). Tipe ack lama di chat-types dibiarkan sebagai dokumentasi.
- Verifikasi: verify-integrity seksi "v46" (16 cek). Lint 0/0. E2E: tab Cheat + dialog 🎭 (CheatBody sama), Account 360 4 tab (Moderasi memuat panel v40), X-Ray ringkas, console 0 error.

### v47 — Cheat Lab II + Ganti Nama + Badge Ikon (Task 63)
- **Permintaan**: "gabungkan yang lainnya juga. tambahkan juga fitur cheat lainnya seperti kebal dari pesan dihapus, centang 1 padahal udah dibaca, dll buat yang banyak. buat juga admin bisa ganti nama. tambahkan juga notif di icon aplikasi".
- **Cheat Lab II — 11 cheat baru per-user** (flags `users.cheat_json`, via `admin:account_set`, semua ter-audit):
  1. **Kebal hapus pesan** (`antiDelete`): pesan yang dihapus tetap terlihat isinya di sisi user — live via event baru `message:ghost` (dipancarkan `tombstoneMessage`) + riwayat (`getMessagesPage` menampilkan `deleted_content`, bertanda `ghosted`); bubble diberi badge "Dihapus pengirim — terlihat khusus".
  2. **Bekukan ✓✓ user / centang-1 abadi** (`freezeChecks`): bacaan user ini tidak pernah dikabarkan (`broadcastRead` berhenti) — pesan lawan bicara tetap ✓1 walau sudah dibaca. Kebalikan `suppressReads` v45.
  3. **✓✓ instan** (`fakeReads`): tiap pesan user langsung dianggap terbaca lawan (`markRead` + `read:update` palsu).
  4. **Kunci hapus pesan** (`lockDelete`): `messages:delete` → `DELETE_LOCKED` (toast user).
  5. **Kunci edit pesan** (`lockEdit`): `message:edit` → `EDIT_LOCKED`.
  6. **Hancur sendiri** (`selfDestructSec` 5–3600 dtk): pesan baru user otomatis di-tombstone setelah N detik (timer per pesan, cek bendera masih aktif).
  7. **Mutator teks keluar** (`textMutator`: upper/lower/reverse/leet/emoji) — diterapkan setelah filter kata.
  8. **Delay pengiriman** (`delayMs` 1000–300000): pesan baru muncul di sisi penerima (bukan pengirim) setelah N ms — fan-out `insertAndFanOut` kini per-penerima (`later()`).
  9. **Pengganda pesan** (`multiplier` ×1–5): tiap pesan user dikirim berulang.
  10. **Mode hantu** (`alwaysOffline`): tak pernah tampak online — `isOnline`, broadcast connect/disconnect, dan list percakapan (last seen disembunyikan) semuanya menghormati bendera.
  11. **Alarm admin** (`alarmAdmin`): tiap pesan user memicu `user:toast` ke room `admins` → AdminPanel menampilkan pill 🔔.
- **Ganti nama**: aksi cepat "Ganti nama" di dropdown per-user dashboard (dialog kecil → `admin:account_set {name}` — berlaku untuk akun APA PUN termasuk Admin sendiri); rename kini menyiarkan `users:changed` agar daftar menyegarkan sendiri.
- **Konsolidasi lanjutan**: "Lepas kunci perangkat" (dropdown dashboard) + "Paksa logout semua perangkat" (panel v40) + tombol kick duplikat pindah/gabung ke **tab Akun Account 360 § Perangkat & sesi** (`admin:user_force_logout` + `admin:user_unbind_devices`); tombol & dialog lama DIHAPUS.
- **Badge ikon aplikasi**: `src/lib/app-badge.ts` BARU — favicon digambar ulang via canvas dengan lingkaran merah berhitung (maks 99+) + Web App Badging API (`navigator.setAppBadge`); dipasang di Messenger (unread tab hidden) dan AdminPanel (unread lintas percakapan). Judul tab "(n) ChatKita" tetap.
- **Perbaikan tipe**: `ChatMessageApi` (typo tak-terdefinisi warisan v45) → `ChatMessage` di `AdminInjectMediaAck` & `AdminQuickSendAck`; `ChatMessage.ghosted` + `GhostMessagePayload` ditambahkan.
- Verifikasi: verify-integrity seksi "v47" (31 cek). Lint 0/0. E2E: toggles Ilusi tersimpan, ghost live+riwayat, freezeChecks/fakeReads, lockDelete, delay, multiplier, mutator, alarm pill, ganti nama, badge favicon, dua viewport, console 0 error.

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

## v48 — MEDIA, FILE & TAUTAN (panel user + admin + cheat media)
**Server `mini-services/chat-service/index.ts` (SERVICE_VERSION 'v48'):**
- Kolom baru: `messages.sensitive/album/burn/trap_url/trap_clicks`, `users.block_attach` (addColumn idempoten).
- Setting baru (server-enforced, dashboard "Pengaturan" & tab Media & Tautan): `extBlocklist` (ekstensi dilarang), `linkBlacklist`/`linkWhitelist` (domain tautan), `retImageDays/retVideoDays/retFileDays` (kedaluwarsa per jenis, 0 = permanen, sweeper `sweepTypedMedia` tiap 30 menit).
- Pesan tipe baru `sticker` — konten = kunci resmi `STICKER_KEYS` (16 stiker SVG klien).
- Event baru: `chat:gallery` (media+files percakapan), `links:list`, `reactions:of` (dengan nama), `messages:forward` (teruskan ≤20 pesan, label "Diteruskan dari"), `messages:sensitive` (blur oleh pengirim/admin), `messages:burn_seen` (penerima buka media burn → media hancur + `message:updated` mediaExpiredAt), `link:trap_click` (+ broadcast `admin:trap_click`).
- Event admin baru: `admin:media_swap` (tukar isi media pesan), `admin:message_burn`, `admin:message_blur`, `admin:link_trap` (jebakan tautan + counter klik live), `admin:user_attach_block` (blokir stiker/tautan per-user).
- HTTP pintas v48 (`/http/*` dicegat SEBELUM engine.io via `httpServer.emit` override — path socket.io '/' memindap semua request): `GET /http/upload_policy` (extBlocklist untuk /api/upload), `GET /http/link_preview?url=` (fetch Open Graph server-side, cache 1 jam/maks 200, anti-SSRF).
- Enforcement `messages:send`: blokir `block_attach` (sticker/link), ekstensi dilarang (users), blacklist/whitelist domain.

**Klien:**
- `src/app/api/upload/route.ts`: `HARD_BLOCK_EXT` (exe/apk/bat/… selalu ditolak) + daftar admin via chat-service + deteksi **magic-bytes** `sniffKind()` (file menyamar ditolak, `mime-mismatch:`/`ext-blocked:`/`executable-blocked:`).
- `src/lib/link-tools.ts`: `firstUrlInText`, `suspicionOf` (shortener/IP/punycode/TLD berisiko/kata phishing), `videoEmbedOf` (YouTube/Vimeo), `isTextPreviewable`.
- `src/lib/stickers.tsx`: 16 stiker SVG inline (`StickerSvg`) + `GIF_PACK` 8 GIF animasi lokal `public/gifs/*.gif` (dibuat `bun .zscripts/gen-gifs.ts`, GIF89a tanpa dependensi).
- `ChatBubble`: bubble stiker besar; blur sensitif (img/video, ketuk untuk buka); chip 🔥 burn; label 📁 album; `trapUrl` dipakai ke SEMUA tautan/caption/kartu + `onTrapClick`; aksi **Teruskan**; tipe 'sticker'.
- `link-preview.tsx`: strip peringatan "Tautan berisiko" + tombol **QR code** (qrcode.react, dialog) + trap pada kartu & LinkifiedText.
- `media-viewer.tsx`: **slideshow** play/pause (3 dtk/media) + **bar reaksi cepat** + daftar pereaksi (`reactions:of`); prop `react?: ViewerReact`.
- `Messenger.tsx`: **multi-lampiran** (menu "Banyak file", drag & drop di composer, paste Ctrl+V → antrian chip + progres, "Kirim semua"); picker **Stiker & GIF** (2 tab); **Kamera** (`CameraCapture`, getUserMedia → pipeline foto); toggle **Sensitif** + **Album**; tombol header 📁 membuka **Panel media, file & tautan** (`user-media-panel.tsx`); burn diteruskan saat buka media; viewer mendapat react.
- `user-media-panel.tsx`: dialog 3 tab — Media (grid + blur sensitif + chip burn/album + MediaViewer), File (daftar + unduh), Tautan (domain, tanggal, peringatan berisiko, buka in-app; trap tetap bekerja tanpa terlihat).
- **Admin**: tab baru **"Media & Tautan"** di Dashboard (`admin-media-tautan.tsx`): keamanan unggahan & kedaluwarsa (6 setting), blokir stiker/tautan per-user, **Lab Aksi Pesan** — burn-on-view, blur, **tukar media** (upload pengganti), **jebakan tautan** dengan counter klik korban LIVE (listener `admin:trap_click`). ID pesan via aksi "Metadata" di bubble panel chat admin.
- `chat-types.ts`: `MessageContentType +'sticker'`; ChatMessage +`sensitive/album/burn/trapUrl/trapClicks`; MessageUpdatePayload +field v48; AppSettings +6 kunci.

---

## v49 — Popup Ukuran Normal Seragam (Task 65)

**Masalah:** semua popup (Dialog/AlertDialog) menyesuaikan ukurannya dengan isi — isi sedikit jadi pendek, isi banyak jadi tinggi, sehingga tiap popup berbeda-beda ukurannya.

**Solusi — satu ukuran "normal" untuk SEMUA popup:**
- Komponen dasar `src/components/ui/dialog.tsx` & `src/components/ui/alert-dialog.tsx`: `h-[min(85dvh,640px)]` + `w-[calc(100vw-2rem)] sm:w-[640px]` + `rounded-2xl` + `overflow-y-auto` — ukuran TIDAK bergantung isi.
- Isi sedikit → popup tetap berukuran normal (tidak menyusut). Isi banyak → isi di-scroll **di dalam** popup (overflow internal), popup tidak ikut memanjang.
- Sweep 36 tag `<DialogContent>`/`<AlertDialogContent>` di 16 file komponen: semua kelas ukuran lama (`max-w-*`, `sm:max-w-*`, `max-h-*`, `w-full`, `overflow-y-auto`) dihapus — ukuran kini dikendalikan satu pintu di komponen dasar (tailwind-merge menjamin kelas pemakaian tetap bisa menimpa gaya non-ukuran seperti p-0/bg-black/flex).
- Dialog berstruktur (viewer media, viewer tautan, panel media user, Account 360) tetap memakai tata letak flex internal — bingkai popup tetap, area dalam menyesuaikan.
- Layar kunci admin (overlay penuh) & menu menempel (popover/picker/dropdown) tidak diubah — bukan popup modal.
- Skrip: `.zscripts/t65-sweep-popup.ts` (pola sweep untuk pengembangan berikutnya).

---

## v50 — Ganti Nama Tampilan Admin (Task 66)

**Masalah:** nama "Admin" yang tampil pada pengguna (header obrolan, kartu profil) adalah konstanta hardcoded `ADMIN_NAME = 'Admin'` di server — tidak ada UI untuk menggantinya, dan daftar pengguna dashboard menyaring `role='user'` sehingga akun Admin tidak muncul di sana.

**Solusi:**
- **Server** (`index.ts`, SERVICE_VERSION 'v50'):
  - Helper `adminName()` — nama tampilan Admin kini **dinamis dari DB** (tabel `users`, baris admin) dengan cache in-memory + `invalidateAdminName()`; fallback ke konstanta bawaan.
  - Payload yang tadinya memakai konstanta kini dinamis: fallback partner `user:auth`, `originName` teruskan pesan, `senderName` daftar file panel media. Nama pengirim pesan memang selalu JOIN live (`u.name`) sehingga bubble lama otomatis ikut berganti.
  - `admin:account_set` kini **boleh menarget akun Admin sendiri** asalkan patch hanya `{name}` (patch lain tetap FORBIDDEN); nama "Admin" tetap tidak boleh dipakai USER biasa (NAME_RESERVED), tapi admin boleh kembali ke "Admin".
  - Broadcast baru **`admin:renamed {name}` ke semua klien** — header obrolan user terbarui live tanpa refresh; `users:changed` tetap untuk room admin.
- **Klien:**
  - `AdminPanel.tsx`: **kartu profil sidebar kini bisa diklik** (avatar + nama + ikon pensil) → dialog "Ganti nama saya"; item baru **"Ganti nama saya"** di menu ⋮ Panel aplikasi; nama di kartu dinamis (state `myName`), inisial avatar ikut berganti; listener `admin:renamed` (sinkron antar sesi admin).
  - `Messenger.tsx` (user): listener `admin:renamed` → perbarui header partner & daftar percakapan live.
- Verifikasi: verify-integrity segmen v50 (+6 cek; cek versi generik dibuat future-proof `'v`/`rescue-v`).

---

## v51 — Nama Sama Tidak Bisa Membuka Chat Orang Lain (Task 67)

**Masalah:** dua orang bisa bernama sama (mis. dua "kevin"). Sistem mencocokkan login berdasarkan nama — jika "kevin" pertama sudah pernah chat dengan Admin, orang baru yang mengetik "kevin" berpotensi dibawa ke chat milik kevin pertama.

**Solusi (lapisan-lapisan):**
- **Server** (`index.ts`, SERVICE_VERSION 'v51'):
  - Keunikan nama sudah dijamin sebelumnya di SEMUA jalur penamaan (daftar mandiri via kode undangan, `admin:user_create`, rename `admin:account_set` — semua case-insensitive, error NAME_TAKEN) → dua akun TIDAK mungkin bernama sama, chat tidak akan pernah tercampur antar akun.
  - **Anti-pembajakan nama (`ACCOUNT_UNCLAIMED`)**: akun warisan yang belum punya kredensial apa pun (password & PIN kosong) kini TIDAK bisa dimasuki dari perangkat baru hanya dengan mengetik namanya — hanya perangkat yang sudah terikat akun itu (pemilik asli) yang lolos; orang lain ditolak + menerima `suggestion` nama bebas.
  - Helper `suggestFreeName(base)` — cari nama alternatif bebas "kevin (2)", "kevin (3)" … (case-insensitive, hindari reserved Admin, hormati MAX_NAME_LENGTH).
  - `public:check_name` kini mengembalikan `suggestion` ketika `exists:true` → UI login bisa menawarkan pendaftaran nama alternatif sejak awal.
- **Klien** (`chat-types.ts`, `Messenger.tsx`):
  - Kode error baru `ACCOUNT_UNCLAIMED` + field `suggestion` pada ack error & check-name.
  - Kartu login: begitu nama terdeteksi milik akun lain, muncul kotak peringatan jelas — "Nama ini sudah dipakai akun lain. Punya akunnya? Masukkan password. Bukan kamu? Chat pemilik akun tidak bisa dibuka orang lain." + tombol **"Daftar sebagai 'kevin (2)'"** (satu klik mengganti nama → kembali mode pendaftaran dengan kode undangan).
  - Error `ACCOUNT_UNCLAIMED` ditangani dengan pesan pendidikatif + saran; pesan `PASSWORD_REQUIRED` diperjelas ("Bukan akun Anda? Chat pemiliknya tidak bisa dibuka; daftar dengan nama lain.").
- **Hasil:** orang baru bernama sama TIDAK dapat membuka chat milik pemilik nama pertama — harus memastikan password (akun terlindungi), tidak bisa mewarisi akun tanpa kredensial dari perangkat asing, dan selalu ditawari jalur pendaftaran nama alternatif yang jelas.

---

## v52 — Paket 11 Fitur: AI + Interaksi + Infrastruktur (Task 68)

**Permintaan:** tambahkan semua fitur usulan KECUALI kategori operasional/toko — jadi: AI (ringkas, draf, TTS; transkripsi suara ternyata sudah ada sejak v7), interaksi (polling, mini-game, lokasi/kontak), infrastruktur (2FA TOTP, widget embed, backup harian).

**Fitur:**
- **📝 Ringkasan AI** (`admin:ai_summary`): admin ringkas 120 pesan terakhir via LLM (z-ai SDK, helper `llmComplete` yang sudah ada) — bullet kebutuhan/status/tindak lanjut, tampil di dialog.
- **✨ Draf balasan AI** (`admin:ai_draft`): 30 pesan terakhir jadi konteks → draf balasan pihak Admin → diisi ke composer untuk disunting & dikirim manual.
- **🔊 Balasan suara TTS** (`admin:tts_send`): teks composer ≤1000 kar → WAV (voice `tongtong`) → pesan suara (`Balasan suara AI.wav`) dengan transkrip = teks sumber.
- **📊 Polling/kuis** (`poll:create` admin, `poll:vote` keduanya): tabel `poll_votes` (1 suara/user, bisa diganti), hasil agregat (count/persentase) live via `message:updated` + ikut history (`toChatMessage`), bar hasil di kartu ChatBubble.
- **🎮 Mini-game** (`game:play`): dadu ⚀–⚅, koin 🪙, batu-gunting-kertas ✊✋✌️ melawan server — hasil acak server, kartu besar di bubble.
- **📍 Lokasi & 👤 Kontak** (`rich:send`): lokasi dari GPS perangkat (geolocation API) → kartu koordinat + tautan Google Maps; kontak (nama/telepon/catatan) → kartu + salin nomor + tautan wa.me.
- **🔐 2FA TOTP admin**: RFC 6238 implementasi mandiri (base32 + HMAC-SHA1, toleransi ±30 dtk) — setup QR (`otpauth://`, qrcode.react), aktif/nonaktif wajib kode; `admin:auth` menuntut `totp` saat aktif (TOTP_REQUIRED/INVALID_TOTP), field kode muncul di form login.
- **🪟 Widget embed**: `GET /api/embed.js` → skrip tombol chat melayang untuk website lain (iframe 380×620 → `/?embed=1`); Messenger mode embed menyembunyikan tombol install & footer.
- **💾 Backup DB harian otomatis**: `VACUUM INTO backups/chatkita-db-YYYY-MM-DD.db` tiap hari (cek tiap 10 menit, persist `last_backup_day`), retensi 14 berkas + audit.
- **Pengaman**: `messages:send` MENOLAK type poll/game/location/contact dari klien (anti-pemalsuan JSON) — hanya event khusus yang memvalidasi isi; `snippetOf` menampilkan preview rapi (📊/🎮/📍/👤) untuk daftar & push.

## v53 — Paritas Fitur Chat User ↔ Admin (Task 69)

**Permintaan:** "sinkronkan semua fitur yang ada di chat user, dengan admin" — semua fitur komposer sisi user kini juga dimiliki sisi admin (dan sebaliknya), sehingga kedua sisi setara.

**Fitur:**
- **Server — `poll:create` dibuka untuk user**: sebelumnya admin-only; kini semua **peserta percakapan** (admin atau user) boleh membuat polling; pemilik pesan = pengirim (bubble tampil di sisi yang benar); cooldown 15 dtk/pengirim anti-spam; audit `poll_create` mencatat pembuatnya.
- **Admin — Stiker & GIF** (16 stiker SVG + GIF lokal, dua tab) — sebelumnya hanya user.
- **Admin — Kamera langsung** (`CameraCapture` diekspor dari Messenger dan dipakai bersama) — foto webcam → pipeline foto normal.
- **Admin — Sensitif (blur penerima)** + **Set album…** — checkbox & dialog di menu +; flag dikirim pada foto/file/antrian (`sensitive`, `album`) — server v48 sudah mendukung field ini untuk semua pengirim.
- **Admin — Banyak file (antrian)** — multi-pilih/drop/paste clipboard → chip antrian + progres + "Kirim semua" (caption teks composer jadi caption item pertama).
- **Admin — Tempel (paste) file dari clipboard** di input teks → masuk antrian.
- **User — Buat polling/kuis** 📊 — menu + dialog di sisi user (dulu hanya bisa memilih); hasil tetap live dua arah via `poll:vote`.
- Tetap admin-only (by design): **AI asisten** (Ringkasan/Draf/TTS), karena merupakan perkakas operasional pemilik.

**File kunci:** `mini-services/chat-service/index.ts` (poll:create), `src/components/chat/AdminPanel.tsx` (6 fitur paritas), `src/components/chat/Messenger.tsx` (poll user + `export function CameraCapture`).


## v54 — Popup Jadi Halaman/Panel (Task 70)

**Permintaan:** "buat yang popup sekarang jadikan halaman/panel, jangan popup lagi".

Perubahan **satu pintu** pada komponen dasar — seluruh ~40 popup di aplikasi (user & admin) ikut berubah tanpa menyentuh tiap pemakaian:

- **`DialogContent`** (`src/components/ui/dialog.tsx`) bukan lagi kotak melayang di tengah layar:
  - **Desktop:** panel menempel kanan setinggi layar (`inset-y-0 right-0`), lebar 640px, sudut kiri membulat (`sm:rounded-l-2xl`), border kiri + `shadow-2xl`, animasi **slide dari/ke kanan** (`slide-in-from-right` / `slide-out-to-right`).
  - **Mobile:** **halaman penuh** (`w-full`, 100vw×100dvh) — terasa pindah halaman, bukan popup.
  - **Overlay gelap `bg-black/50` → `bg-transparent`**: layar belakang tidak lagi digelapkan; klik di luar panel tetap menutup (perilaku Radix dipertahankan).
- **`AlertDialogContent`** (konfirmasi) bukan lagi popup tengah:
  - **Mobile:** sheet menempel dasar layar (`inset-x-0 bottom-0`, sudut atas membulat, tinggi alami maks 85dvh, `safe-area-inset-bottom`).
  - **Desktop:** panel bawah di tengah (lebar 640, melayang 24px dari dasar, slide dari/ke bawah).
- **Sweep `rounded-2xl`** dari semua tag `<DialogContent>`/`<AlertDialogContent>` (12 file, ~36 tag) via `.zscripts/t70-sweep-panel.ts` — bentuk kini 100% dikendalikan komponen dasar; dialog wajib-password juga kehilangan ukuran kecil lama (`max-w-sm`) agar ikut panel standar.
- Konten dalam panel tidak diubah: judul, deskripsi, footer, tombol X kanan-atas tetap. Kasus khusus tetap benar: media-viewer gelap (`bg-black`), link-viewer `p-0`, Account 360 `flex` internal dengan scroll sendiri, QR, polling, terjadwal, dsb.
- Tinggi tetap `h-[min(85dvh,640px)]` era v49 diganti tinggi penuh/natural — aturan v49 (popup seragam) bermuara ke **panel seragam**.

**E2E (gateway :81, agent-browser):** admin desktop 1440×900 — dialog ganti-nama & Media & konfirmasi reset terukur panel kanan `x=800, w=640, h=900`, overlay `rgba(0,0,0,0)`; user mobile 390×844 (UjiV49) — panel media & link-viewer jadi **halaman penuh (0,0,390×844)**; AlertDialog "Batalkan pesan terjadwal?" jadi sheet bawah: mobile `w=390, bottomGap=0`, desktop `x=400, w=640, bottomGap=24`, tinggi alami; alur jadwal→batal dua arah lulus; konsol 0 error dua sesi.

**File kunci:** `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`, `.zscripts/t70-sweep-panel.ts`, sweep 12 file komponen chat.


## v55 — Ukuran Pesan Media Diperbaiki (Task 71)

**Permintaan:** "perbaiki ukuran ini" + screenshot gelembung media (kartu file, kartu audio, foto) di mana foto melebar hampir selebar area chat (~490px, mengikuti batas gelembung 65–85%) sementara kartu file/audio hanya 224–288px — dan di layar lebih sempit foto berpotensi **meluber keluar gelembung** karena `img`/`video` hanya dibatasi `max-h-64 w-auto` tanpa batas lebar.

Perubahan (satu komponen bersama — `src/components/chat/ChatBubble.tsx`, berlaku di panel user & admin):

- **Foto** (`type === "image"` & file gambar): tambah `max-w-[min(100%,20rem)]` — lebar maksimum **320px** (konsisten dengan keluarga kartu media; sebelumnya tak berbatas) dan `100%` mencegah luber di viewport sempit.
- **Video** (`fileKind === "video"`): batas yang sama `max-w-[min(100%,20rem)]`.
- Tinggi tetap `max-h-64` (256px); foto lanskap kini ~320×167, foto potret tetap ~170×256 — proporsi terjaga, klik masih membuka media-viewer layar penuh.
- Kartu file, kartu audio, voice note, polling, game, lokasi, kontak tidak berubah (memang sudah 224–288px).

**E2E:** foto lebar (rasio ~1.9:1) dikirim di chat UjiV49↔admin; lebar `img` terukur ≤320px di viewport mobile 390×844 & desktop 1440×900; gelembung tidak meluber; konsol 0 error.

**File kunci:** `src/components/chat/ChatBubble.tsx`.


## v56 — Gelembung Media Merangkul Isi + Kartu "Media Tidak Tersedia" (Task 72)

**Permintaan:** "kenapa jadi gini?" + screenshot gelembung foto hijau yang lebar (~460px) dengan **ruang kosong besar** di sisi gambar yang hanya 320px (v55).

**Akar bug:** v55 membatasi lebar `<img>` (`max-w-[min(100%,20rem)]`), tapi lebar GELEMBUNG dihitung browser dari **ukuran intrinsik media** — persentase `100%` di dalam `max-width` diabaikan saat intrinsic sizing — sehingga gambar 1200px tanpa thumbnail tetap "mengklaim" ~492px lebar: gambar dirender 320px, gelembung tetap ~504px → 170px ruang kosong. Terlihat pada pesan lama pra-v8 (tanpa thumbnail) dan pesan gambar besar mana pun.

**Perbaikan** (`src/components/chat/ChatBubble.tsx`, berlaku user & admin):

- **Cap di WRAPPER gelembung** khusus foto/video: `max-w-[min(85%,21rem)] sm:min(75%,21rem) md:min(65%,21rem)` via flag `isMediaBubble` — gelembung maks 336px, merangkul img 320px (sisa 2px padding). Diukur E2E: bubble 504→**336px**.
- **Kartu "Media tidak tersedia"** — `onError` pada `<img>` & `<video>`: bila file media hilang (404, mis. terhapus di luar aplikasi), tampil kartu ikon + nama file + label "Media tidak tersedia" (bukan gambar rusak/pemutar kosong).

**Temuan opsional terkait (bukan bug kode):** file media lama di `db/media/` hilang akibat rollback checkpoint sandbox (folder tidak di-track git sesuai desain commit 2157ee4; backup harian via `make-backup.sh` memang menyertakan tar media, tetapi rollback terjadi SEBELUM tar media pertama dibuat). Pesan lama yang medianya 404 kini tampil rapi sebagai kartu di atas. Tindakan: backup manual dijalankan ulang (tar media kembali aktif begitu ada file di `db/media`).

**E2E:** pesan image tanpa thumbnail dikirim via socket (`.zscripts/t72-notumb.ts`, gambar 1200×625) → sebelum fix bubble 504px (170px kosong), sesudah fix **336px merangkul img 320px**; pesan lama 404 → kartu "Media tidak tersedia" 302px; konsol 0 error.

**File kunci:** `src/components/chat/ChatBubble.tsx`, `.zscripts/t72-notumb.ts`.


## v57 — Tombol Play Slideshow & Tutup Viewer Tidak Bertumpuk (Task 73)

**Permintaan:** "ini fungsi tombol play untuk apa?" + screenshot lingkaran gelap berikon ▶ di pojok kanan-atas viewer media, dengan ikon × menempel di tepinya.

**Jawaban fungsi:** tombol ▶ = **slideshow** (v48) — memutar otomatis semua foto/video dalam percakapan, maju ke media berikutnya tiap 3 detik; muncul hanya bila percakapan punya ≥2 media (bersama chip "3 / 12"). Ikon × di sebelahnya = tombol tutup viewer.

**Bug yang ditemukan dari screenshot:** tombol slideshow (`right-3 top-3`, 36px) BERTUMPUK dengan × bawaan DialogContent (`top-4 right-4`, ikon 16px) — keduanya di pojok kanan-atas sehingga tampak seperti satu tombol aneh dengan "tanduk" ×.

**Perbaikan** (`src/components/chat/media-viewer.tsx`):

- `showCloseButton={false}` pada DialogContent viewer — × bawaan 16px dilepas.
- Grup kanan-atas baru `absolute right-3 top-3 flex gap-2` berisi: tombol slideshow (perilaku & gaya tetap) + tombol tutup kustom `aria-label="Tutup pratinjau"` — dua lingkaran gelap 36px seragam berdampingan rapi; target sentuh × naik dari 16px → 36px.

**File kunci:** `src/components/chat/media-viewer.tsx`.


## v58 — Panel Dialog Menumpuk dari Atas (Anti Celah Raksasa) + Viewer Isi Penuh (Task 74)

**Permintaan:** "kenapa ini berjarak begini?" + 5 screenshot: Audit log, Kata terlarang, Ganti nama saya, Keamanan 2FA (semuanya panel admin dengan celah kosong raksasa antara judul/deskripsi/isi/footer), plus viewer media yang menyisakan ruang kosong di bawah bar Unduh.

**Akar bug:** sejak v54, `DialogContent` = panel kanan SETINGGI LAYAR (`inset-y-0`) dengan display **grid**. Default `align-content` grid = **stretch** → baris-baris auto DIRENTANGKAN untuk mengisi tinggi panel, sisa ruang vertikal dibagi rata ke semua baris → tiap elemen "melayang" dengan celah besar di panel pendek. (Viewer media lolos karena override display jadi flex — tapi ia punya masalah sendiri: panggung 72vh tetap menyisakan ruang kosong di bawah footer.)

**Perbaikan:**

- `src/components/ui/dialog.tsx` — base panel ditambah **`content-start`**: baris menumpuk dari ATAS, sisa ruang tinggal rapi di dasar panel (pola drawer standar). Satu perubahan base memperbaiki SEMUA dialog panel (user + admin) sekaligus. Overflow-y-auto tetap untuk konten panjang.
- `src/components/chat/media-viewer.tsx` — panggung foto/video/PDF dari `h-[72vh]` tetap → **`min-h-0 w-full flex-1`**: panggung mengisi seluruh sisa panel, bar footer (nama/reaksi/Unduh) kini nempel di dasar; media tetap object-contain (justru tampil lebih besar di layar tinggi).

**File kunci:** `src/components/ui/dialog.tsx`, `src/components/chat/media-viewer.tsx`.

## v59 — Media Permanen di Database (Blob chat.db, Disk Jadi Cache) (Task 75)

**Permintaan:** "saya ingin menggunakan database supaya media tidak terhapus otomatis oleh server, bagusnya apa?"

**Diagnosa (bukti nyata):** retensi memang sudah mati sejak v36 (boot log "retensi: tidak pernah (media permanen)", env `MEDIA_RETENTION_DAYS` tidak diset, settings retensi per-jenis 0/0/0) — server ChatKita TIDAK menghapus media. Tetapi audit integritas menemukan **16 dari 19 file media yang masih direferensikan pesan hidup HILANG dari disk**. Akar masalahnya BUKAN server, melainkan lingkungan sandbox yang di-reset: `chat.db` (database) ikut ter-commit otomatis tiap sesi sehingga PESAN selamat, sedangkan `db/media/` di-gitignore sehingga FILE-nya hilang tiap reset (log /tmp/chat-service.log lahir baru 01:39 = bukti reset pagi itu).

**Keputusan arsitektur:** simpan byte media SEBAGAI BLOB di dalam `chat.db` (tabel `media_blobs`) — database yang sudah ter-commit + ter-backup otomatis (git bundle + push GitHub tiap commit). `db/media/` diturunkan statusnya menjadi **cache tulis-lulus**: cepat untuk streaming/Range/ETag, tapi bukan lagi sumber kebenaran. (Alternatif yang DITOLAK: BLOB di custom.db Prisma — siklus hidup media ada di chat-service, jadi satu tempat; un-gitignore db/media — riwayat git membengkak per versi file.)

**Server (`mini-services/chat-service/index.ts`, v59):**

- Migrasi `CREATE TABLE IF NOT EXISTS media_blobs (name PK, mime, size, data BLOB, created_at)`.
- `storeMediaBlob(name)` — salin file disk → blob (dedup: nama = hash SHA-256 isi, baris yang sudah ada dilewati; idempoten). Dipanggil saat: pesan media dikirim (media + thumbnail), TTS suara dibuat, cheat inject media, dan boot (backfill).
- `restoreMediaBlobToDisk(name)` — tulis balik blob → disk.
- `backfillAndRestoreMedia()` saat boot (2,5 dtk): (1) backfill blob untuk semua media yang direferensikan pesan hidup, (2) pulihkan file disk yang hilang. Log: `[media-blob] boot: backfill N blob, pulihkan M file disk`.
- `releaseMediaFile` — kini menghapus blob juga (siklus hidup serempak); file disk yang memang sudah hilang tidak lagi membatalkan proses.
- Endpoint HTTP baru `GET /http/media_blob?name=…` (validasi nama ketat; 400/404) — dipakai Next.js sebagai fallback.

**Next.js (`src/app/api/media/[name]/route.ts`):**

- Saat file tidak ada di disk → `restoreFromBlob()`: tarik blob dari `http://127.0.0.1:3003/http/media_blob`, tulis kembali ke disk (re-materialize), lanjut melayani normal (ETag/Range/immutable tetap utuh).

**E2E terverifikasi:** upload UI UjiV49 → blob otomatis tercatat di chat.db saat kirim; file disk dihapus → `GET /api/media` HTTP 200 + file terpulihkan byte-identik; restart service → boot memulihkan file dari blob; foto lama tetap tampil; konsol bersih; verify-integrity 411/411.

**Batas yang jujur:** 16 file korban reset LAMA tidak bisa dipulihkan (belum pernah masuk blob/backup) — pesannya tampil kartu "Media tidak tersedia" (v56). Mulai v59, media baru dijamin selamat.

**File kunci:** `mini-services/chat-service/index.ts`, `src/app/api/media/[name]/route.ts`, `scripts/verify-integrity.sh`.

## v60 — Fitur Game Dihapus + Terjemahan & Transkrip VN Khusus Admin (Task 76)

**Permintaan:** "hapus fitur game keseluruhan. buat fitur terjemahan, dan transkip vn, untuk saat ini hanya pada admin"

**Penghapusan fitur game (dadu/koin/batu-gunting-kertas):**

- Server: event `game:play` dihapus; tipe `'game'` dibuang dari union MessageType; blokir pemalsuan tipe di `messages:send` disesuaikan; label preview & baris konteks AI dibersihkan. Migrasi sekali-jalan: 3 pesan game legacy diturunkan jadi teks `🎮 Mini-game (fitur dihapus)`.
- Klien: menu "🎮 Main game" (user + admin) dihapus; `gameDataOf`/`GameContent` dibuang dari chat-utils; kartu game & tipe di ChatBubble dibersihkan; tipe `"game"` dihapus dari MessageContentType.

**Terjemahan AI — kini KHUSUS ADMIN:**

- Sebelumnya `message:translate` terbuka untuk semua peserta dan hasilnya disiarkan ke kedua sisi. Kini: hanya admin (`me === ADMIN_ID`); hasil disimpan (cache kolom `messages.translation`); `message:updated` HANYA ke room `admins`.
- Serializer riwayat `toChatMessage(row, viewerAdmin)` — transkrip & terjemahan HANYA disertakan untuk viewer admin (user tidak pernah menerimanya, di riwayat maupun live).
- Sisi user: tombol "Terjemahkan", state, dan wiring dihapus dari Messenger.

**Transkrip VN — ON-DEMAND, KHUSUS ADMIN (baru):**

- Dulu ASR berjalan OTOMATIS untuk setiap pesan suara dan hasilnya disiarkan ke semua pihak (boros kuota AI + bocor ke user). Kini event baru `message:transcribe` (admin-only): admin mengetuk bubble suara → tombol "Transkripsikan" → ASR (`zai.audio.asr`) → hasil tampil inline `📝` di bubble + tersimpan (kolom `messages.transcript`) + disiarkan hanya ke admin. Sumber byte: disk dulu, fallback blob permanen chat.db (v59).
- ChatBubble: tombol aksi "Transkripsikan/Transkrip" + indikator "Mentranskripsikan…"; pemanggilan & indikator di AdminPanel (TranscribeAck). Panggilan transkrip otomatis (kirim, forward, terjadwal) dihapus.

**E2E terverifikasi:** menu "Main game" hilang di kedua sisi; pesan game legacy termigrasi (0 tersisa); admin mengetuk pesan Inggris → 🌐 "Halo admin, ini adalah pesan bahasa Inggris untuk tes terjemahan v60."; admin mengetuk VN → 📝 transkrip tampil; setelah reload panel, keduanya langsung tampil dari riwayat; sesi user TIDAK menampilkan 🌐/📝 sama sekali; konsol bersih; verify 417/417; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts`, `src/components/chat/{ChatBubble,Messenger,AdminPanel}.tsx`, `src/lib/{chat-types,chat-utils}.ts`.

## v61 — Pratinjau Peta Statis di Kartu Lokasi (Task 77)

**Permintaan:** "apakah ini bisa dibuat previewnya mapnya langsung diaplikasi?" (screenshot kartu lokasi "Lokasi saya" dengan koordinat -5.42118, 105.27967)

**Jawaban: bisa — sekarang peta tampil langsung di bubble.** Sebelumnya kartu lokasi hanya menampilkan label + koordinat + tombol "Buka di Google Maps" (peta baru terlihat setelah keluar aplikasi). Kini setiap pesan `type: 'location'` merender **peta statis sungguhan di dalam bubble**.

**Implementasi — komponen `MiniMap` (`src/components/chat/mini-map.tsx`):**

- Peta dirakit langsung di klien dari **tile resmi OpenStreetMap zoom 15** (256 px, tanpa API key, tanpa layanan pihak ketiga berbayar). Grid tile dihitung via proyeksi Web Mercator; titik lokasi **selalu tepat di pusat kontainer** (anchor `calc(50% + offset)`), sehingga pin menunjuk koordinat yang persis — aman untuk kontainer ≤ 240×128 (kartu `w-60`).
- **Pin merah** (ikon `MapPin` fill) menandai titik; **atribusi "© OpenStreetMap"** wajib tampil di pojok (kepatuhan kebijakan tile).
- **Degradasi anggun:** satu tile saja gagal dimuat (offline/timeout) → `onError` menyembunyikan seluruh peta dan kartu jatuh kembali ke tata letak lama (label + koordinat + tombol) — tidak pernah ada peta setengah jadi.
- Seluruh peta adalah **tautan ke Google Maps** (`https://maps.google.com/?q=lat,lng`, tab baru) dengan `aria-label` deskriptif; tombol teks tetap ada di bawahnya. Offset tile dibulatkan (`Math.round`) agar antar-tile selalu rapat tanpa celah subpiksel.
- Tidak ada CSP di proyek → `img-src` eksternal aman; tile di-`loading="lazy"` sehingga hanya dimuat saat kartu terlihat.

**Integrasi:** satu titik — kartu lokasi di `ChatBubble.tsx` (baris blok `type === "location"`), yang dipakai bersama oleh **Messenger (user) dan AdminPanel (admin)**, jadi pratinjau langsung muncul di kedua sisi tanpa perubahan server. Perubahan chat-service hanya bump versi.

**E2E terverifikasi (agent-browser, login UjiV49):** pesan lokasi id 329 (-5.42119, 105.27967 — persis screenshot permintaan) dan id 309 (Jakarta) keduanya merender peta; **8/8 tile termuat, 0 gagal** (`naturalWidth === 256`); pin & atribusi tampak; href peta → `https://maps.google.com/?q=-5.4211857939110075,105.2796700953496`; konsol bersih; tetap 8/8 setelah reload (post-fix rounding). Verify **425/425**; lint 0/0.

**File kunci:** `src/components/chat/mini-map.tsx` (baru), `src/components/chat/ChatBubble.tsx`, `mini-services/chat-service/index.ts` (bump), `src/instrumentation.ts` (rescue-v61).

## v62 — Tautan Masuk (Magic Link) Buatan Admin (Task 78)

**Permintaan:** "tolong buatkan saya fitur user bisa login dari link khusus yang dibuat admin untuk user aplikasi ini, buat kode linknya jangan bisa dibaca oleh publik"

**Fitur baru:** admin membuat **tautan masuk khusus untuk satu akun user**. User membuka tautan di perangkatnya → **langsung masuk tanpa password**. Kode tautan didesain mustahil dibaca/ditebak publik.

**Keamanan kode link ("jangan bisa dibaca publik"):**

- Token acak **256-bit** (`ckl_` + 43 karakter base64url, `crypto.getRandomValues`) — jauh lebih kuat dari kode undangan karena tidak pernah diketik tangan, selalu via tautan.
- **Token asli TIDAK PERNAH disimpan server** — hanya hash SHA-256-nya (terverifikasi: DB berisi hex 64 char); bocornya DB pun tidak membuka akses.
- Token penuh **hanya muncul sekali** di ack `admin:link_create` (kartu "hanya ditampilkan sekali, salin sekarang"); daftar admin hanya menampilkan cuplikan 10 char; tidak pernah dikirim ke user lain, tidak dicetak ke log (log hanya id+username), tidak masuk audit penuh.
- **URL langsung dibersihkan** dari address bar/riwayat browser via `history.replaceState` saat tautan dibuka.
- **Sekali pakai** — pemakaian ulang hanya ditoleransi bagi perangkat yang sama (idempoten untuk pemilik); perangkat lain mendapat pesan "Tautan ini sudah pernah digunakan di perangkat lain."
- **Rate-limit** penukaran: maks 10 percobaan / 60 detik / socket.
- Hormati aturan **1 perangkat 1 akun**: tautan tidak bisa dipakai merebut perangkat yang sudah terikat akun lain (DEVICE_TAKEN).

**Server (`mini-services/chat-service/index.ts`):**

- Tabel baru `login_links` (id, token_hash UNIQUE, token_preview, user_id, label, created_at, expires_at, used_at, used_device, revoked_at) + bersih-bersih riwayat kedaluwarsa >30 hari saat boot.
- `public:link_login` (pre-login): tukar token → identitas akun `{userId, name}` → klien lanjut lewat `user:auth` jalur sesi-tersimpan (reuse penuh alur login: bind perangkat, login_events, aktivitas, riwayat).
- Admin-only (adminGuard + audit): `admin:link_create` {name, label?, ttlHours 1–720 default 24}, `admin:link_list` (tanpa token), `admin:link_revoke` {id}, `admin:link_delete` {id}.

**Klien:**

- Messenger: baca `?masuk=<token>` saat connect (sebelum kartu login), bersihkan URL, emit `public:link_login`, sukses → auto-login; gagal → pesan jelas (LINK_USED/LINK_EXPIRED/LINK_REVOKED/DEVICE_TAKEN/RATE_LIMITED/LINK_INVALID) di kartu login + indikator "Memverifikasi tautan masuk dari admin…".
- Dashboard tab Pengguna: kartu **"Tautan masuk"** (1 tautan = 1 akun) — form nama akun tujuan + masa berlaku (1 jam/8 jam/1 hari/3 hari/7 hari) + catatan; hasil create = kartu URL sekali-tampil + tombol Salin; daftar dengan status (aktif/terpakai/kedaluwarsa/dicabut), cabut, hapus.

**E2E terverifikasi (agent-browser, 3 sesi):** admin buat tautan UjiV49 → URL `ckl_…` 43 char tampil sekali; DB berisi hash-only (hex 64, preview 10 char); sesi baru buka tautan → **auto-login UjiV49**, URL bersih jadi `/`, sesi tersimpan, chat tampil; DB: used=1 + used_device terisi; log server tanpa token; sesi ketiga buka tautan sama → ditolak "Tautan ini sudah pernah digunakan di perangkat lain." + kembali ke form login; konsol bersih. Verify **440/440**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts`, `src/components/chat/Messenger.tsx`, `src/components/chat/admin-dashboard.tsx`, `src/lib/chat-types.ts`.

## v63 — Anti-Nama-Sama: Jalur Pemulihan "Lupa Password" (Task 79)

**Konteks:** pertanyaan desain "bagusnya dibuat kayak mana ya jika ada nama yang sama? apa mainkan dipassword?" — Model terpasang (v27/v51) **sudah memainkan password**: nama = identitas unik (case-insensitive), password = bukti kepemilikan; nama ganda tidak dibiarkan — cek live saat mengetik (`public:check_name`) + saran "rvg (2)" (`suggestFreeName`). Dianalisis tiga model: (1) **nama unik + password** (sekarang) — daftar chat & riwayat selalu tak ambigu, anti-penyaruhan; (2) nama sama diperbolehkan, password menentukan akun — daftar chat ambigu, butuh lencana pembeda di banyak UI, membuka rekayasa sosial; (3) nama bebas + @handle unik ala Telegram/Discord — rapi tapi menambah konsep baru, overkill untuk skala aplikasi. Keputusan: pertahankan model (1), tutup celah informasinya.

**Celah yang ditambal:** pemilik asli yang **lupa password** tidak pernah diberi tahu jalur pemulihan (admin bisa reset via `admin:user_reset_password` sejak v27) — kotak peringatan malah mendorongnya mendaftar "rvg (2)" → fragmentasi akun & chat lama tak tersentuh.

**Perubahan (klien saja; server hanya bump versi):**
- Kotak peringatan nama-dipakai: "…Masukkan password di atas — **lupa password? Minta admin me-reset akunmu.** Bukan kamu? …"
- Pesan `INVALID_PASSWORD`: "Nama atau password salah. **Lupa password? Minta admin me-reset akunmu.**"

**E2E terverifikasi (agent-browser):** ketik "rvg" (akun existing di DB) → label berubah "Nama akun", kode undangan disembunyikan, kotak amber + saran "rvg (2)" + hint reset tampil; submit password salah → "Nama atau password salah. Lupa password? Minta admin me-reset akunmu." (verbatim via DOM); konsol bersih. Verify **447/447**; lint 0/0.

**File kunci:** `src/components/chat/Messenger.tsx`, `mini-services/chat-service/index.ts` (bump), `src/instrumentation.ts` (rescue-v63), `scripts/verify-integrity.sh` (+7 cek; 2 cek literal v62 → penanda historis).

## v64 — Akses Multi-Perangkat per Akun (Task 80)

**Permintaan:** "sekarang buat perakun bisa login di banyak perangkat" + screenshot error "Perangkat ini terikat ke akun lain — masukkan password untuk melanjutkan."

**Akar masalah:** tabel `devices` (v27) = 1 perangkat 1 akun, append-only. Sesi tersimpan (restore tanpa password) ditolak server bila perangkat terikat akun lain → akun kedua di perangkat yang sama harus mengetik password SETIAP reload.

**Solusi — tabel `device_logins` (many-to-many):**
- Pasangan `(device_id, user_id)` = "kredensial akun ini pernah dibuktikan di perangkat ini". Pasangan inilah yang membolehkan restore sesi tanpa password.
- **Satu akun boleh banyak perangkat** (maks `DEVICE_LIMIT_PER_USER` = 8) **dan satu perangkat boleh menampung banyak akun**.
- Backfill idempoten saat boot: semua ikatan lama otomatis jadi pasangan akses (data lama tak terganggu).
- Pasangan dibuat saat: pendaftaran, login fresh dengan kredensial benar (termasuk di perangkat milik akun lain), dan penukaran tautan masuk (magic link kini boleh dipakai di perangkat yang menampung akun lain — yang dibatasi hanya kuota perangkat per akun).
- `devices` tetap penanda PENDAFTARAN (1 perangkat 1 pendaftaran — anti-abuse kode undangan) + jangkar anti-pembajakan akun warisan; restore di perangkat terikat akun lain tanpa pasangan tetap wajib password (celah salin localStorage tetap tertutup).
- Admin: lepas-perangkat / paksa-keluar / hapus akun kini membersihkan kedua tabel; statistik jumlah perangkat (dashboard & kendali akun) dihitung dari pasangan.

**Klien (copy):** "Perangkat ini terikat ke akun lain — masukkan password untuk melanjutkan." → "Perangkat ini **belum terikat ke akun ini** — masukkan password **sekali untuk mengikatnya**."; pesan DEVICE_TAKEN diarahkan ke batas perangkat + minta admin melepas perangkat lama.

**E2E terverifikasi (agent-browser, 1 browser = 1 perangkat):** login UjiV49/uji49 → keluar → login UjiV64/uji64 (password; pendaftaran perangkat tetap milik UjiV49, pasangan UjiV64 dibuat) → **reload → sesi UjiV64 langsung terbuka tanpa password, tanpa pesan perangkat** (localStorage `chatkita:user` = UjiV64, tak ada form login); DB memuat pasangan UjiV64 + backfill ikatan lama (ASU, UjiV49 multi-perangkat); konsol bersih. Verify **457/457**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts`, `src/components/chat/Messenger.tsx`, `src/instrumentation.ts` (rescue-v64), `scripts/verify-integrity.sh` (+10 cek).

## v65 — Sembunyikan Form Pendaftaran saat Ditutup Admin (Task 81)

**Permintaan:** "buat admin bisa setting/sembunyikan form daftar. buat sekarang aplikasi hanya ada form login / login dari link, form daftarnya/masuk dengan nama lain di setting sembunyi dulu saat ini."

**Fakta penting:** saklar admin **sudah ada sejak v10/v13** — Dashboard → Pengaturan → "Akses & pendaftaran" → *Buka pendaftaran* (setting `allowRegistration`, server menolak daftar dengan `REGISTRATION_CLOSED`). Yang belum ada: UI login **masih menampilkan** form daftar lalu menolak saat submit — jelek UX-nya.

**Perubahan v65 (klien + keadaan awal):**
- Derivasi `registrationOpen = appSettings?.allowRegistration ?? false` — termuat lewat `public:settings` (pre-login) & **live** lewat broadcast `app:settings:update`; default *tutup* bila settings belum termuat (aman, sesuai keadaan sekarang).
- Saat ditutup, seluruh jalur pendaftaran disembunyikan dari UI login:
  - kolom **Kode undangan** diganti catatan "Pendaftaran akun baru sedang ditutup admin — masuk dengan akun yang sudah ada, atau pakai tautan khusus dari admin."
  - tombol **"Masuk dengan nama lain"** (pembuka form daftar) hilang total di kartu lanjut.
  - tombol saran **"Daftar sebagai …"** di kotak amber hilang; copy diganti pemberitahuan tutup (hint reset v63 tetap).
  - label nama → "Nama akun"; footer → "…butuh akses baru? Minta admin mengirim tautan masuk."
  - pesan error `ACCOUNT_UNCLAIMED`/`PASSWORD_REQUIRED` tak lagi mengarahkan "daftar dengan nama lain" saat ditutup.
- Keadaan awal ditutup: `settings.allowRegistration='0'` di chat.db (sesuai permintaan "saat ini").
- Jalur yang tetap hidup saat ditutup: login akun lama (nama+password/PIN), kartu lanjut, dan **login dari link** (?masuk=…) — persis "hanya form login / login dari link".
- Dashboard: deskripsi toggle diperbarui (menutup pendaftaran kini juga menyembunyikan form daftar).

**E2E terverifikasi (agent-browser, 2 sesi):** peramban segar saat ditutup → tanpa kolom undangan/tombol daftar, catatan tutup tampil; login UjiV49/uji49 tetap sukses → keluar → kartu lanjut tanpa tombol daftar; admin Dashboard v65 → Pengaturan → nyalakan *Buka pendaftaran* → DB jadi '1' & sesi user **live** (tanpa reload) menampilkan kembali tombol + kolom undangan; matikan lagi → semua tersembunyi live; konsol kedua sesi bersih. Verify **467/467**; lint 0/0.

**File kunci:** `src/components/chat/Messenger.tsx`, `src/components/chat/admin-dashboard.tsx`, `mini-services/chat-service/index.ts` (bump + blok komentar), `src/instrumentation.ts` (rescue-v65), `scripts/verify-integrity.sh` (+10 cek; 2 cek literal v64 → penanda historis), chat.db (settings.allowRegistration='0').

## v66 — Paksa Logout & Hapus Akun Mengeluarkan User Real-Time (Task 82)

**Permintaan:** "jika user dipaksa logout maka otomatis keluar juga. jika akun user dihapus maka user otomatis keluar, dan otomatis juga hapus dari localstoragenya supaya bisa login dengan akun lain."

**Kondisi awal:**
- Paksa logout (v40) sudah mengeluarkan user — tapi lewat reload paksa penuh & tanpa alasan.
- **Lubang nyata:** `admin:account_delete` & `admin:user_delete` tidak mengirim `session:revoked` (account_delete bahkan tidak memutus socket) — aplikasi user yang online tampak masih masuk setelah akunnya dihapus.

**Perubahan v66:**
- Server: helper `revokeSessionsOf(userId, reason)` = emit `session:revoked {by:'admin', reason:'forced'|'deleted'}` + putus seluruh socket user. Dipakai oleh `admin:user_force_logout` ('forced'), `admin:user_delete` ('deleted', dulu hanya putus diam-diam), dan `admin:account_delete` ('deleted', BARU — dulu tidak menyentuh socket sama sekali).
- Klien: handler `session:revoked` ditulis ulang — reset total state TANPA reload (pola applyAuthAck-gagal): form login tampil seketika di tempat, nama & mode ikut direset. `reason` menentukan: *forced* → sesi dibuang, nama-terakhir DIPERTAHANKAN (kartu lanjut tetap ada, balas dengan password); *deleted* → sesi + nama-terakhir (`chatkita:last-name`) DIBUANG dari localStorage → form kosong, tak ada kartu akun mati, langsung bisa masuk akun lain. Pesan: "Sesi diakhiri oleh admin — silakan masuk kembali." / "Akun ini telah dihapus oleh admin — silakan masuk dengan akun lain."
- Bug tersembunyi yang terbongkar: setelah server memutus socket paksa, klien socket.io **tidak pernah reconnect sendiri** di jalur gateway (dulu tertutupi oleh reload v40) → handler kini memanggil `socket.connect()` eksplisit setelah 500 ms; kartu lanjut aktif kembali dalam ±2 detik.

**E2E terverifikasi (agent-browser, 2 sesi):** UjiV49 online → admin Kendali akun → Paksa logout → user SEKETIKA kembali ke form (pesan merah "Sesi diakhiri oleh admin", `chatkita:user` null, nama-terakhir utuh, kartu lanjut aktif lagi, tap → minta password ikat perangkat); UjiV64 login di perangkat sama → admin Hapus akun permanen → user SEKETIKA keluar dengan pesan "Akun ini telah dihapus oleh admin — silakan masuk dengan akun lain.", `chatkita:user` & `chatkita:last-name` NULL, form kosong, socket tersambung ulang, langsung login UjiV49 pada form yang sama → sukses; DB: UjiV64 lenyap, UjiV49 utuh. Verify **479/479**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (revokeSessionsOf + 3 handler), `src/components/chat/Messenger.tsx` (handler reset real-time + reconnect), `src/lib/chat-types.ts` (SessionRevokedPayload), `src/instrumentation.ts` (rescue-v66), `scripts/verify-integrity.sh` (+13 cek; 2 cek literal v65 → penanda historis).

---

### v67 (Task 83) — Sisa sesi perangkat-offline ikut beres: kartu "Ketuk untuk lanjut" akun mati dibuang otomatis

**Permintaan:** "ketika masih dichat akun user udah kehapus jika dihapus admin, tapi jika user sudah keluar akunnya malah ga kehapus. bagusnya gimana" (+ screenshot kartu "jawat — Ketuk untuk lanjut" yang masih muncul padahal akunnya sudah dihapus).

**Diagnosis:** Penghapusan akun DI SERVER memang selalu tuntas (DB dibersihkan entah user online/offline — v29/v66). Yang "tidak kehapus" hanyalah **sisa localStorage di perangkat** (`chatkita:last-name`) penyebab kartu lanjut basi — karena `session:revoked` mustahil sampai ke perangkat yang tidak terhubung. Tak ada cara membersihkan localStorage jarak jauh tanpa koneksi; praktik standar (Telegram Web dkk): **klien memvalidasi sesi tersimpan setiap kali kembali**.

**Perubahan v67 (klien-only + bump server):**
- Helper `purgeLastAccount(goneName)`: buang `chatkita:last-name` + `chatkita:user`, reset form (nama/mode/password/kode), set catatan `goneAccount`.
- Validasi 3 titik memakai `public:check_name` (v28, dipakai ulang — tanpa event baru): (1) **efek layar-login** — setiap login screen muncul dengan kartu lanjut & socket tersambung, nama divalidasi sekali; akun hilang → kartu dibuang otomatis; (2) **ketukan kartu** — tap kartu ke akun mati (server menolak `REGISTRATION_CLOSED`) → purge + catatan spesifik, bukan pesan "pendaftaran ditutup" yang menyesatkan; (3) **restore gagal** — sesi tersimpan menunjuk akun yang sudah dihapus → applyAuthAck memvalidasi via check_name sebelum menampilkan "Sesi berakhir" generik.
- Catatan amber di form login: "Akun “X” telah dihapus oleh admin — silakan masuk dengan akun lain."
- `goneAccount` dibersihkan saat auth sukses (2 jalur) & logout sukarela.

**E2E terverifikasi (agent-browser, 2 sesi):** UjiV49 login → keluar sukarela → kartu lanjut + `chatkita:last-name` ada → admin hapus UjiV49 (DB: lenyap) → perangkat user di-RELOAD → kartu HILANG, catatan amber "Akun “UjiV49” telah dihapus oleh admin…", `chatkita:last-name` & `chatkita:user` NULL, form kosong → tautan masuk UjiBrowser59 dibuat admin → dibuka di perangkat sama → auto-login sukses (sesi = UjiBrowser59) → regresi v66: admin paksa-logout UjiBrowser59 online → user seketika ke form "Sesi diakhiri oleh admin", kartu lanjut DIPERTAHANKAN (desain 'forced'), log "[force-logout] 1 perangkat dilepas, 1 socket diputus". Verify **487/487**; lint 0/0.

**File kunci:** `src/components/chat/Messenger.tsx` (purgeLastAccount + 3 titik validasi + catatan goneAccount), `mini-services/chat-service/index.ts` (bump v67 + komentar), `src/instrumentation.ts` (rescue-v67), `scripts/verify-integrity.sh` (+9 cek; 2 cek literal v66 → penanda historis).

---

### v68 (Task 84) — Kartu "Ketuk untuk lanjut" akhirnya menepati janji: perangkat terikat masuk tanpa password

**Permintaan:** "ini kenapa 'Perangkat ini belum terikat ke akun ini — masukkan password sekali untuk mengikatnya.'. padahal barusan keluar mau login lagi" (+ screenshot akun rvg).

**Diagnosis (bug desain, dibuktikan lewat DB):** kartu "Ketuk untuk lanjut" hanya mengirim **nama** (tanpa `userId`) → server menganggapnya login baru (`sessionRestore=false`) → akun ber-password selalu kena `PASSWORD_REQUIRED` — **gate password tidak pernah mengecek pasangan `device_logins`**, padahal pasangan (perangkat↔akun) yang dibuat v64 justru adalah bukti kredensial per perangkat. Bukti: DB menunjukkan perangkat user rvg SUDAH terikat (`device_logins` ada) — pesan "belum terikat… sekali" menyesatkan; kenyataannya password diminta **setiap** ketuk kartu, bukan sekali.

**Perubahan v68 (server-only + bump):**
- Password gate (`user.password_hash && !sessionRestore`, tanpa password dikirim): cek dulu pasangan `device_logins (deviceId, user.id)` → **ada → langsung lolos** (`trustedDeviceLogin=true`), **tidak ada → `PASSWORD_REQUIRED`** (pesan klien "belum terikat… sekali untuk mengikatnya" kini akurat: memang belum terikat; masuk password sekali → pasangan dibuat → berikutnya mulus).
- Password tetap diverifikasi normal bila dikirim; rate-limit & audit tak berubah.
- Audit/activity: login via kartu tercatat `restore` / "sesi dipulihkan" (bukan "login baru").
- Pencabutan admin tetap bermakna: force-logout / lepas kunci perangkat menghapus pasangan → kartu kembali meminta password sekali.

**E2E terverifikasi (agent-browser, 3 sesi):** akun uji UjiV68 (buat via admin, pw uji68) → login password (ikat) → keluar → **ketuk kartu → masuk TANPA password** ✅ (2 putaran) → perangkat baru t84c: nama saja → ditolak "Akun ini memakai password" ✅ → password sekali → masuk → keluar → kartu → **mulus tanpa password** ✅ → regresi: admin paksa-logout UjiV68 → t84a terkick live ("Sesi diakhiri oleh admin", log "2 perangkat dilepas, 2 socket diputus", pasangan DB = 0) → ketuk kartu → pesan "Perangkat ini belum terikat…" muncul (kini benar) ✅. Verify **493/493**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (bypass pasangan di password gate + audit + bump v68), `src/instrumentation.ts` (rescue-v68), `scripts/verify-integrity.sh` (+6 cek; 2 cek literal v67 → penanda historis).

---

### v69 (Task 85) — Konsol Database: admin mengedit DB lengkap dari aplikasi, anti-bocor berlapis

**Permintaan:** "buat admin bisa edit database lengkap dari aplikasi langsung, buat jangan sampai bocor."

**Perubahan v69 (server + klien):**
- Menu admin baru: **⋮ → "Konsol database"** → dialog penuh: daftar tabel+view (dengan jumlah baris), browser isi tabel (60 baris/halaman, filter WHERE, DDL collapsible), **edit sel** (klik sel → editor + opsi NULL), **tambah baris**, **hapus baris**, dan **SQL bebas** (multi-statement; SELECT → hasil ≤400 baris, lainnya dieksekusi; Ctrl+Enter).
- **Anti-bocor berlapis:**
  1. **Step-up password** — membuka konsol meminta password admin **lagi** (`admin:db_unlock`, rate-limit 5/60 dtk sendiri, TOTP ikut dituntut bila 2FA aktif); konsol **terkunci kembali** setiap dialog ditutup (`admin:db_lock`).
  2. **Masking kolom sensitif default-aktif** — kolom password/token/hash/secret/salt/vapid dkk. tampil `••••••••` di grid (toggle "Sembunyikan nilai sensitif" per sesi) sehingga **screenshot tidak membocorkan nilai**.
  3. **Anti-injection identifier** — nama tabel divalidasi ke `sqlite_master`, kolom ke `PRAGMA table_info`, identifier di-quote, nilai via prepared statement, filter WHERE dibatasi satu ekspresi.
  4. **Cadangan fisik otomatis** — sebelum **tulisan pertama** tiap sesi buka, `VACUUM INTO backups/dbconsole-<stamp>.db` dibuat (retensi 10); tombol "Cadangkan" tersedia kapan saja.
  5. **Audit total** — unlock (termasuk gagal), lock, backup, edit sel, insert, delete, dan SQL semua masuk `audit_log`.
- Sisi non-admin: semua event `admin:db_*` menolak dengan `UNAUTHORIZED` (harus admin:auth) lalu `DB_LOCKED` (harus unlock); UI konsol hanya ada di panel admin.
- Objek internal SQLite (`sqlite_%`) tidak ditampilkan; view ditandai baca-saja (edit via SQL).

**E2E terverifikasi:** uji keamanan socket **22/22** (non-admin ditolak, DB_LOCKED default, password salah ditolak, injection tabel/kolom ditolak, siklus CREATE→INSERT→SELECT→edit→DELETE→DROP→lock mulus, berkas backup fisik terbentuk); browser: gerbang step-up → skema 15 objek/79 MB → masking users 20 sel •••• default, toggle reveal 0↔20 → CREATE+INSERT multi-statement + auto-backup tercatat → edit sel live di grid → DROP bersih → "Kunci konsol" kembali minta password; sisi user (UjiV68) tanpa menu/konsol; audit_log memuat seluruh jejak. Verify **512/512**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (helper + 8 handler admin:db_* + bump v69), `src/components/chat/db-console.tsx` (BARU), `src/components/chat/AdminPanel.tsx` (menu + mount), `src/lib/chat-types.ts` (8 tipe + katalog), `src/instrumentation.ts` (rescue-v69), `scripts/verify-integrity.sh` (+18 cek; 2 cek literal v68 → penanda historis).

---

### v70 (Task 86) — Panel Besar Jadi Fullscreen: Konsol Database, Dashboard, Kendali Akun, Viewer Media, dll.

**Permintaan:** "buat panel databasenya fullscreen, dan panel yang butuh fullscreen lainnya buat jadi fullscreen."

**Mekanisme (satu pintu):** `DialogContent` (src/components/ui/dialog.tsx) kini punya prop **`fullscreen`** — panel menutup seluruh layar (`inset-0 h-dvh w-full`, tanpa sudut membulat, animasi **fade** bukan slide-kanan, padding bawah menghormati safe-area iOS). Mobile tetap bisa menggulir bila blok tetap melebihi layar (`overflow-y-auto` → `md:overflow-hidden`). Dialog kecil (konfirmasi, form, kamera, dsb.) TIDAK berubah — tetap panel kanan 640px.

**Panel yang jadi fullscreen (10):**
1. **Konsol database** (db-console) — tabel data mengisi sisa tinggi layar (`flex-1` tanpa cap max-h-96), daftar tabel ikut memanjang (max-h-44 mobile, penuh desktop), langkah unlock dipusatkan di kanvas penuh (`justify-center`); sub-dialog edit sel & tambah baris TETAP panel kecil.
2. **Dashboard Aplikasi** (admin-dashboard) — 10 tab memakai seluruh layar.
3. **Kendali akun penuh** (account-control-dialog) — konten panjang tetap menggulir (`md:overflow-y-auto`).
4. **Viewer media** (media-viewer) — panggung foto/video/PDF memakai seluruh layar (black stage).
5. **Galeri media user** (user-media-panel "Media, File & Tautan").
6. **Galeri media admin** (user-media-dialog).
7. **Manajemen pengguna** (user-manager) — daftar user & X-Ray memakai sisa layar (742px vs 384px sebelumnya).
8. **Audit log** (admin-tools) — 100 entri memakai sisa layar (746px vs 384px).
9. **Pencarian pesan** (admin-tools) — hasil memakai sisa layar.
10. **Forensik** (admin-tools) — jejak pesan memakai sisa layar.

**Detail teknis:** konflik padding ditangani eksplisit (dashboard `p-0 pb-0 sm:p-0`, viewer `pb-3 sm:pb-4`) agar `pb-[safe-area]` tak menyisakan celah; tabel konsol memakai grid `md:grid-cols-[14rem_1fr] md:grid-rows-1` + `min-h-0` berantai agar area baris scroll internal sempurna. Tanpa perubahan event/logika server (bump versi saja).

**E2E terverifikasi (agent-browser, desktop 1440×900 + mobile 390×844):** Dashboard full=true 1440×900 & 390×844; Konsol database fullscreen + unlock terpusat (pass y=509/844) + tabel users mengisi sisa layar (444px desktop) + masking password_hash •••• tetap aktif + sub-dialog edit sel tetap 512px panel kanan + "Kunci konsol" kembali minta password; Kendali akun penuh — rvg fullscreen dengan 4 tab; Manajemen pengguna fullscreen (list 742px, 11 user) + X-Ray 780px; Audit log fullscreen (list 746px, 100 item); galeri media admin fullscreen (grid 6 media) → viewer video fullscreen (footer Unduh nempel dasar); regresi dialog kecil "Ganti nama saya" tetap 640px panel kanan (x=800); mobile: dashboard & konsol DB full tanpa scroll halaman (`scrollHeight<=innerHeight`); konsol browser bersih (0 error selain 404 media kedaluwarsa). Verify **529/529**; lint 0/0.

**File kunci:** `src/components/ui/dialog.tsx` (prop fullscreen), `src/components/chat/db-console.tsx`, `admin-dashboard.tsx`, `account-control-dialog.tsx`, `media-viewer.tsx`, `user-media-panel.tsx`, `user-media-dialog.tsx`, `user-manager.tsx`, `admin-tools.tsx` (Forensik/Pencarian/Audit), `mini-services/chat-service/index.ts` (bump v70), `src/instrumentation.ts` (rescue-v70), `scripts/verify-integrity.sh` (+17 cek; 2 cek literal v69 → penanda historis).

### v71 (Task 87) — Lapis Animasi Halus Seluruh Aplikasi (smooth, tidak lebay)

**Permintaan:** "berikan ide animasi pada aplikasi lengkap, yang smooth tapi ga lebay" → disetujui "tambahkan semuanya".

**Fondasi (globals.css):** 5 keyframes ChatKita (`ck-fade-up/ck-fade-in/ck-slide-down/ck-pop/ck-shake`), utility `anim-*`, stagger anak (`.anim-stagger > *` 40 ms bertingkat), stagger baris (`.row-enter` + `--i` cap 10), crossfade view (`.view-enter`), blur-up gambar (`.img-blur-up`), **micro-press global** (semua tombol scale 0.97 saat ditekan, transition-property diperluas bukan diganti), dan SEMUA dimatikan bila `prefers-reduced-motion: reduce`. Aturan besi: hanya `transform`+`opacity`, 150–300 ms, ease-out `[0.22,1,0.36,1]`.

**Per area:**
1. **Chat (ChatBubble)** — bubble sendiri settle scale 0.98→1 (0.18 s soft-out); centang Terkirim→Dibaca crossfade (key remount); tombstone "Pesan ini dihapus" & "Media kedaluwarsa" fade-in; chip "· diedit" fade-in; foto blur-up: `opacity-0` → fade 0.3 s begitu `onLoad` (key per sumber).
2. **Messenger** — layar login entrance berjenjang (brand → kartu → tiap field form, stagger 40 ms); error login shake ringan 3 px sekali (replay per pesan); tombol lompat + angka unread pop (key per angka); indikator mengetik fade-in; chip balas & edit slide-down 0.2 s; titik online transition-colors 300 ms; status partner crossfade per ganti teks.
3. **Shell (page.tsx)** — crossfade lembut chat ↔ admin (key per view).
4. **Panel admin (AdminPanel)** — daftar percakapan **FLIP reorder** via framer-motion `motion.button layout` (pesan baru menggeser daftar dengan meluncur, 0.22 s); badge unread pop tiap bertambah; titik online transisi halus.
5. **Manajemen pengguna (user-manager)** — loading spinner diganti **skeleton 6 baris**; baris user masuk stagger.
6. **Dashboard admin (admin-dashboard)** — kartu tautan masuk fade-up; tombol Salin → ikon centang + "Tersalin" 1,5 detik.
7. **Pratinjau tautan (link-preview)** — thumbnail fade-in.

**Sudah ada sebelumnya (tidak diubah):** enter bubble via framer-motion (v-anterior), TypingDots, fullscreen dialog fade/zoom (v70), toast sonner.

**E2E terverifikasi (agent-browser, gateway :81):** login UjiV68 — stagger brand+form aktif (`ck-fade-up`, delay 0.04 s), micro-press tombol aktif (transition transform 0.15 s), blob float utuh; kirim pesan → bubble terender + centang; chip "Balas" → `ck-slide-down` terukur; admin — daftar percakapan `motion.button` (style framer aktif), badge unread `ck-pop` (UjiV68 naik ke puncak dgn badge 1), Manajemen pengguna 11 baris `row-enter` dgn `--i` 0..10 + `ck-fade-up`; konsol browser 0 error di 2 sesi. Verify **552/552**; lint 0/0.

**File kunci:** `src/app/globals.css` (sistem animasi + micro-press), `src/app/page.tsx` (view crossfade), `src/components/chat/ChatBubble.tsx`, `Messenger.tsx`, `AdminPanel.tsx`, `user-manager.tsx`, `admin-dashboard.tsx`, `link-preview.tsx`, `mini-services/chat-service/index.ts` (bump v71), `src/instrumentation.ts` (rescue-v71), `scripts/verify-integrity.sh` (+23 cek; 2 cek literal v70 → penanda historis).

### v72 (Task 88) — Ilusi Global (semua user) + Ilusi II: 14 ilusi baru per-user

**Konteks:** lanjutan tab Ilusi (v45–v47) dan permintaan "tambahkan semuanya, pisahkan fitur ilusi per semua user dan per user". Prinsip tak berubah: ilusi hanya mengubah PERSEPSI — data asli tak tersentuh, admin melihat kebenaran, semua perubahan ter-audit.

**Ilusi GLOBAL (SEMUA user) — tab baru "Ilusi Global" di Dashboard Aplikasi (`admin-ilusi-global.tsx`), tersimpan JSON di `settings.illusion_global` via `admin:illusion_get/set` (adminGuard + audit `illusion_set`):**
1. **Admin tak terlihat** (`adminInvisible`) — Admin offline total di mata semua user: `isOnline` → false, last seen disembunyikan (`lastSeenFor` → null), sinyal mengetik tidak pernah diteruskan (gate di handler `typing`), bacaan Admin tak pernah dikabarkan (gate di `broadcastRead`).
2. **Last seen Admin tampak lebih tua** (`presenceStaleMin` 0–1440 menit) — geser mundur timestamp last seen Admin yang dilihat user.
3. **✓✓ tertunda** (`checksDelayMin` 0–720 menit) — bacaan Admin baru "terungkap" ke user setelah jeda: `registerDelayedRead`/`effectivePartnerRead` (memori) men-saring `partnerLastReadId` + event `read:update` ditunda; DB tetap tuntas sehingga unread admin benar.
4. **Ilusi "mengirim…"** (`sendDelayMs` 500–60000 ms) — echo pesan ke pengirim ditahan (`senderEchoDelayMs` di `insertAndFanOut`), composer menampilkan "⏳ Mengargar…" selama jeda.
5. **Zona waktu ilusi** (`tsShiftMin` -720..720) — semua timestamp yang dilihat user digeser.
6. **Push hantu berkala** (`phantomPushMin` 1–720) — `schedulePhantomPush` mengirim toast "💬 Pesan baru" (online) + web push (offline) tanpa pesan sungguhan.

**Ilusi II PER-USER — tab Ilusi di Kendali Akun (`account-control-dialog.tsx`, blok "Ilusi II — v72", via `admin:account_set`):**
1. **Last seen beku** (`lastSeenFrozen`) — di mata admin selalu "5 menit lalu".
2. **Presence berdenyut** (`pulsingPresence`) — online/offline deterministik per jendela 2 menit (`pulsingOnline`).
3. **Baru saja aktif** (`recentlyActive`) — last seen selalu 45 detik lalu.
4. **✓✓ tertunda** (`delayedChecksMin`) — versi per-user dari centang tertunda (efektif = max(global, per-user)).
5. **Hapus semu** (`deletionMirage`) — user menghapus → di layarnya "dihapus", lawan bicara (admin) TETAP melihat pesannya: tombstone hanya dikirim ke pengirim (`tombstoneMessage(actorId)`), halaman riwayat direstorasi utk viewer ≠ pengirim (`getMessagesPage`).
6. **Badge "Dilihat ✓" palsu** (`seenBadge`) — chip "· Dilihat" di bubble sendiri; ack `messages:send` membawa `ownSeenBadge`, tak pernah bocor ke pihak lain.
7. **Sinyal lemah** (`weakSignalMs`) — versi per-user dari ilusi mengirim.
8. **Gagal kirim sesekali** (`sendFailEvery`) — tiap pesan ke-N tampil gagal: `failCounter` (memori) + `suppressSelfEcho` menahan echo pengirim; pesan asli tetap terkirim ke lawan.
9. **Delay pesan masuk** (`incomingDelayMs`) — pesan dari Admin tiba terlambat di layar user ini (`later()` per-penerima).
10. **Badge belum-baca hantu** (`phantomUnread`) — judul tab/favicon selalu +1.
11. **Selalu di atas** (`alwaysTop`) — percakapan forceTop diurutkan pertama di dialog Teruskan.
12. **Banner "mode terbatas"** (`limitedBanner`) — banner kuning psikologis di layar user (bisa ditutup).
13. **Alias nama** (`adminAlias`) — nama user tampil beda HANYA di mata admin (`adminAliasOf` dipakai daftar percakapan + dashboard stats).
14. **Zona waktu ilusi** (`tsShiftMin`) — versi per-user (dijumlahkan dgn global, clamp ±12 jam).

**Kanal klien:** event push `illusion:flags` (payload `IllusionFlagsPayload`: tsShiftMin/phantomUnread/limitedBanner) dikirim saat login sukses, saat `admin:account_set` target berubah, dan saat `admin:illusion_set` (rebroadcast ke semua user online). Messenger menggeser `createdAt` saat pesan masuk ke state (`shiftIso`/`shiftMessages`) sehingga bubble + pemisah tanggal konsisten; bendera direset saat sesi berakhir.

**E2E terverifikasi (agent-browser, 2 sesi gateway :81):** tab "Ilusi Global" tampil + simpan (`settings.illusion_global` terisi + audit `[ilusi-global]`); adminInvisible ON → user melihat Admin offline; alias "Timo Verifikasi" muncul di sidebar admin (kembali "rvg" setelah dihapus); phantomUnread → judul "(1) ChatKita"; limitedBanner → banner tampil live + persisten; tsShift +60 → pesan 04.15 tampil 05.15; seenBadge → chip "· Dilihat" (tak bocor ke admin); weakSignal 5 dtk + sendFailEvery 2 → "Mengirim…" lalu banner gagal, pesan tetap sampai ke admin; hapus semu → user "Pesan ini dihapus", admin tetap melihat isi (bug fanout tombstone ke admins ditemukan & diperbaiki saat E2E); state uji dibersihkan (flags rvg di-null-kan, 3 pesan uji dihapus, global dikosongkan). Verify **581/581**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (GlobalIllusions + 14 bendera + 2 handler + efek di isOnline/lastSeenFor/insertAndFanOut/tombstone/getMessagesPage/messages:read + bump v72), `src/components/chat/admin-ilusi-global.tsx` (BARU), `admin-dashboard.tsx` (tab "ilusiglobal"), `account-control-dialog.tsx` (blok Ilusi II), `Messenger.tsx` (listener illusion:flags + shift + banner + status kirim + badge judul + sort teruskan), `ChatBubble.tsx` (prop ownSeenBadge), `src/lib/chat-types.ts` (14 tipe bendera + GlobalIllusions + ack + payload + MessageAck/ConversationOverview), `src/instrumentation.ts` (rescue-v72), `scripts/verify-integrity.sh` (+29 cek; cek literal v71 → penanda historis).

---

## v73 (Task 89) — Album media: kirim banyak media menyatu satu gelembung

**Masalah:** mengirim banyak foto/video sekaligus membanjiri chat dengan banyak gelembung tunggal (satu media = satu bubble).

**Solusi:** deretan media berurutan dari pengirim yang sama dikelompokkan menjadi SATU gelembung album (gaya WhatsApp) — murni di lapisan render, pesan tetap tersimpan & ditangani server satu-per-satu sehingga hapus/reaksi/burn/galeri/lompat-ke-pesan tetap per pesan.

**Aturan pengelompokan** (`src/lib/chat-album.ts` — BARU):
- Layak album: `type:image` atau `type:file` bermime `video/*`; bukan pesan terhapus, media kedaluwarsa, maupun pending moderasi.
- Harus berurutan: pengirim sama, jeda antar pesan ≤ `ALBUM_GAP_MS` (2 menit), tak terputus pesan jenis lain; run ≥ 2 → album, sisanya bubble tunggal.

**Render album** (`src/components/chat/ChatAlbum.tsx` — BARU):
- Grid 2 kolom `aspect-square`; komposisi 3 media = 2 atas + 1 lebar (2:1); maks `ALBUM_MAX_TILES` (6) tile — sisanya overlay "+N media" yang membuka media ke-7 di viewer.
- Ketuk tile → viewer media penuh (burn-on-view tetap terpicu per pesan); anchor `data-mid` per tile → lompat-ke-pesan tetap akurat.
- Tombol ⌄ per tile (selalu terlihat di sentuh, hover di desktop) → baris aksi pesan itu: Reaksi, Balas, Teruskan, Sematkan, Bintangi, Metadata, Hapus (moderasi), Hapus — semua fitur per-pesan tetap utuh.
- Blur sensitif, hemat data ("ketuk untuk memuat"), blur-up, badge video, badge reaksi ringkas, chip "Hancur setelah dilihat", label album (v48) tetap berfungsi per tile.
- Baris waktu: "N foto / N video / N foto · M video · HH.MM" (`albumCountLabel`) + ✓✓ bila semua sudah dibaca; caption media ikut tampil di bawah grid; konteks balasan jadi chip ringkas.

**Wiring:** `Messenger.tsx` & `AdminPanel.tsx` memetakan `groupAlbumRuns(visibleMessages)`; pemisah hari memakai jangkar album; divider "Pesan baru" admin melintasi album (`item.msgs.some(...unreadDividerId)`); pesan yang dihapus lewat album keluar dari grup live (regresi aman).

**E2E terverifikasi (agent-browser, gateway :81):** 4 foto seed → 1 album "4 foto · 05.05 ✓" grid 2×2 (user kanan, admin kiri); ketuk tile → viewer "foto-uji-album-2.jpg"; ⌄ → "Media 2/4 · Reaksi/Balas/Bintangi/Hapus"; reaksi ❤️ → badge di tile; hapus media 4 → album menyusut live jadi "3 foto" (tombstone di luar album); admin: aksi Metadata → dialog "foto-uji-album-2.jpg" (Pengirim UjiV48); mobile 390px: layout 2+1 lebar, ⌄ selalu tampak, divider "Pesan baru" melintasi album. State uji dibersihkan (pesan seed dihapus, hash password uji dipulihkan). Verify **600/600**; lint 0/0.

**File kunci:** `src/lib/chat-album.ts` (BARU), `src/components/chat/ChatAlbum.tsx` (BARU), `Messenger.tsx` + `AdminPanel.tsx` (wiring album), `mini-services/chat-service/index.ts` (bump v73), `src/instrumentation.ts` (rescue-v73), `scripts/verify-integrity.sh` (+21 cek; cek literal v72 versi → konversi v73).

---

## v74 (Task 90) — Kedaluwarsa media per percakapan (TTL khusus satu chat)

**Konteks:** kedaluwarsa media sebelumnya hanya global — retensi per jenis (Foto/Video/File, v48) atau env `MEDIA_RETENTION_DAYS` (v8). Admin belum bisa menjadikan media **satu percakapan tertentu** hangus otomatis dengan batas waktu sendiri.

**Solusi:** admin menetapkan TTL media per percakapan dari menu ⋮ "Menu lainnya" → grup **"Kedaluwarsa media"** di header chat: Permanen (ikuti global) · 1 jam · 6 jam · 24 jam · 3 hari · 7 hari · 30 hari.

**Perilaku server** (`mini-services/chat-service/index.ts`):
- Kolom baru `conversations.media_ttl_hours` (INTEGER DEFAULT 0; 0 = ikuti pengaturan global) — migrasi idempoten `addColumn`.
- Event **`admin:conversation_ttl`** {conversationId, ttlHours} (admin-only): validasi 0..8760 jam → simpan → bila TTL > 0 **langsung menyapu** media lama yang sudah melewati batas di percakapan itu (`expireMediaInConversation`) → broadcast `conversation:ttl` ke kedua ruang user + admins → push ulang daftar percakapan kedua pihak → audit `conversation_ttl` → ack {ttlHours, label, swept}.
- **`expireMediaInConversation`**: redaksi payload foto/video/file/voice (content, thumb, nama, ukuran, mime) → batu nisan "⏳ Media kedaluwarsa" (teks/caption tetap) → `message:updated` live ke semua pihak → file disk dibebaskan hanya bila tak ada rujukan lain (`releaseMediaFile`). Return jumlah yang disapu.
- **`sweepConversationMedia`**: siklus periodik 30 menit (bersama sweep per jenis v48) untuk semua percakapan ber-TTL.
- **`admin:cleanup`** (tombol "Bersihkan media lama") kini mencakup sweep per jenis + per percakapan — sapu manual tak lagi setengah jalan.
- `user:auth` ack + `getConversationsFor` kini menyertakan `mediaTtlHours`.

**Perilaku klien:**
- **AdminPanel**: grup pilihan TTL di "Menu lainnya" (item aktif disorot) + chip indikator amber "⏳ Media hangus otomatis: {label}" di header chat + toast hasil ("— N media lama langsung disapu").
- **Messenger (user)**: chip indikator yang sama di header (baca `mediaTtlHours` dari ack login, update live via `conversation:ttl`); media yang hangus berubah jadi batu nisan live; album (v73) otomatis larut karena media kedaluwarsa tak layak album.
- **Fix paritas**: handler `message:updated` AdminPanel kini me-merge field v48 (`mediaExpiredAt`, `sensitive`, `burn`, `trapUrl`, `trapClicks`) yang selama ini hanya ada di sisi user — sweep/ burn kini tercermin live juga di panel admin.

**E2E terverifikasi (agent-browser, 2 sesi gateway :81):** (1) jalur per jenis — set "Foto (hari)"=1 → "Bersihkan media lama" → 2 foto berusia 2 hari jadi "Media kedaluwarsa" live (log `[retensi-v48] 20 media`), dikembalikan ke 0; (2) jalur per percakapan — 3 foto berusia 2 jam di chat UjiV74B → admin pilih "1 jam" → toast "3 media lama langsung disapu", log `[ttl-percakapan] … → 1 jam (3 media)`, album larut jadi 6 batu nisan di admin, **sisi user menerima chip + batu nisan live tanpa reload**; state uji dibersihkan (2 akun uji + percakapan dihapus, retensi kembali 0). Verify **621/621**; lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (kolom + expireMediaInConversation + sweepConversationMedia + admin:conversation_ttl + cleanup + bump v74), `AdminPanel.tsx` (menu TTL + chip + fix paritas message:updated), `Messenger.tsx` (state TTL + listener + chip), `src/lib/chat-types.ts` (mediaTtlHours + ConversationTtlPayload/Ack), `src/lib/chat-utils.ts` (mediaTtlLabel), `src/instrumentation.ts` (rescue-v74), `scripts/verify-integrity.sh` (+21 cek; cek literal v73 → konversi historis).

---

## v75 (Task 91) — Mode privat: sembunyikan masuk & pendaftaran (akses hanya via tautan)

**Konteks:** halaman masuk ChatKita selalu memperlihatkan form masuk/daftar ke siapa pun yang membuka URL. Pemilik ingin instansinya privat: **pendaftaran & login disembunyikan dari publik, akses hanya lewat tautan**, dan bisa disetel sendiri.

**Solusi:** saklar **"Mode privat 🔒"** di Dashboard → Pengaturan → kartu "Akses & pendaftaran" + **kode rahasia tautan undangan** dengan pratinjau `https://domain/?masuk=<kode>` + tombol salin.

**Perilaku server** (`mini-services/chat-service/index.ts`):
- Setting baru `authHidden` ('1'/'0', ikut `getAppSettings()` → tersiarkan live via `app:settings:update`) dan `authSecret` (**tidak pernah** masuk broadcast publik — hanya jalur admin `admin:settings:get/set`).
- Event pra-login **`public:gate_unlock`** {code}: validasi kode di server (rate limit per-socket 700 ms; `GATE_INVALID`/`RATE_LIMITED`). Kode dibandingkan di server supaya tidak bisa dicuri dari sisi klien.
- Persist aman: `authSecret` hanya ditimpa bila admin memang mengirimnya di patch (saklar tidak lagi menghapus kode); saat mode diaktifkan dengan kode kosong → server membuat kode acak `base64url` 8 karakter (`randomBytes(6)`).
- Validasi kode: maks 64 karakter, charset `[A-Za-z0-9._-]`.
- Pendaftaran akun baru tetap wajib kode undangan (v27) & tautan `ckl_` (v62) tetap berfungsi — keduanya sudah rahasia sejak awal.

**Perilaku klien:**
- **Messenger**: saat `authHidden` aktif dan gembok terkunci, SELURUH form masuk/daftar diganti **layar gembok** ("Aplikasi privat" + ikon Lock + kolom "Punya kode akses? Tempel di sini" + tombol Buka). Terbuka via: (1) tautan `/?masuk=<kode>` — divalidasi server, URL langsung dibersihkan; (2) kode manual; (3) tautan `ckl_` admin; (4) perangkat dengan sesi tersimpan tidak pernah melihat gembok (auto re-auth). Status buka disimpan di **sessionStorage** (`chatkita:gateOk`) — hilang saat tab ditutup, sesi baru butuh tautan lagi. Live: admin menyalakan/mematikan → semua klien berubah tanpa reload.
- **admin-dashboard**: kartu Mode privat (saklar + kolom kode + pratinjau tautan + tombol Salin dengan feedback "Tersalin" 1,5 dtk + catatan keamanan).

**Bug ditemukan & diperbaiki saat E2E:** patch `admin:settings:set` dari saklar (hanya `authHidden`) sempat menimpa `authSecret` tersimpan menjadi kosong lalu memicu regenerasi acak — kode `uji-v75` tiba-tiba jadi `Comi1QI5` → tautan lama gagal (`GATE_INVALID`). Fix: `authSecret` hanya ditulis bila ada di payload; regenerasi hanya bila DB memang kosong.

**E2E terverifikasi (agent-browser, 5 sesi gateway :81):** admin set kode `uji-v75` → saklar ON (state "checked", "Tersimpan ✓"); sesi baru → layar gembok (form hilang); `/?masuk=uji-v75` → form tampil + `gateOk=1` + URL bersih; kode salah via kolom manual → "Kode salah" (gembok bertahan); kode benar manual → terbuka; **broadcast live**: klien terkunci berubah FORM↔GEMBOK tanpa reload saat admin toggle OFF/ON; toggle 2× tidak menghapus kode (DB terverifikasi); kode final `kita-rahasia` + tautan final tampil & berfungsi; mobile 390px gembok rapi. Verify **644/644** (+26 cek, 3 anchor live v74 → v75); lint 0/0.

**File kunci:** `mini-services/chat-service/index.ts` (setting + public:gate_unlock + persist aman + bump v75), `Messenger.tsx` (layar gembok + unlock URL/manual/sessionStorage + state gateLocked), `admin-dashboard.tsx` (kartu Mode privat + kode + tautan), `src/lib/chat-types.ts` (authHidden + authSecret di AppSettingsAck + GateUnlockAck), `src/instrumentation.ts` (rescue-v75), `scripts/verify-integrity.sh` (+26 cek).

---

## Penyebaran produksi (Task 92) — file & panduan

Tanpa perubahan kode server (versi tetap **v75**), disetujui user ("boleh"):

- **DEPLOY.md** — panduan lengkap Bahasa Indonesia: Opsi A (VPS + Bun + systemd + Caddy, HTTPS otomatis) & Opsi B (Docker Compose: web/chat/caddy), lengkap dengan swap untuk VPS 1GB, ufw, init skema Prisma, opsi mulai bersih, update anti-konflik (chat.db/custom.db ter-track git → backup → `git fetch`+`reset --hard` → restore data), backup/restore (sqlite `.backup` + rsync media + `docker compose cp`), checklist keamanan & troubleshooting.
- **Dockerfile** multi-stage: target `web` (Next.js 16 standalone via Bun, symlink db→/data, `prisma db push` otomatis saat boot pertama, HEALTHCHECK) & target `chat` (socket.io + bun:sqlite, HEALTHCHECK endpoint socket.io).
- **docker-compose.yml**: volume `chatkita_data` DIPAKAI BERSAMA web & chat (MEDIA_DIR chat = `../../db/media` = folder media web) sehingga media konsisten; `chatdata` untuk kode + chat.db (+WAL persisten); entrypoint chat menyinkronkan kode dari image ke volume agar upgrade aman; `ADMIN_PASSWORD` wajib diisi di `.env` compose.
- **deploy/**: `chatkita-web.service` & `chatkita-chat.service` (User=chatkita, EnvironmentFile, tanpa `--hot`), `chatkita.env.example`, `Caddyfile` (produksi host, routing `?XTransformPort`), `Caddyfile.docker` (`{$DOMAIN}` → chat:3003/web:3000), entrypoint web & chat, `.dockerignore`.
- Catatan: Docker tidak tersedia di sandbox → compose & entrypoint tervalidasi sintaks (YAML + `sh -n`) saja; build penuh diuji nanti di VPS.
