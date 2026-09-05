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

### v41 — Paket AI Khusus Admin (Task 60-a)
- **Permintaan**: "buat ai hanya pada admin untuk sementara ini. tambahkan semua kecuali nomor 10, 13" — dari 26 ide fitur: semua kecuali Level & XP (#10) dan Kuis trivia (#13); 8 fitur AI dibatasi khusus admin. v41 = paket AI; v42–v44 menyusul (fitur chat, admin & sistem, call WebRTC).
- **Arsitektur**: SDK `z-ai-web-dev-sdk` sudah terbukti hidup di chat-service (dipakai transkrip suara + translate sejak v5/v8) → SEMUA AI dijalankan di chat-service langsung (LLM/ASR/TTS/VLM/Text-to-Image), tanpa API route proxy. Klien hanya mengirim event `admin:ai_*` (adminGuard + audit).
- **Server — 4 helper AI baru + 9 event** (semua adminGuard + audit, fail-open bila AI tidak bisa dihubungi):
  - Helper: `llmChat` (LLM multi-giliran), `ttsSpeak` (TTS voice "tongtong" → WAV base64), `vlmCaption` (deskripsi foto via createVision), `imageGenerateAI` (text-to-image, whitelist 7 ukuran), `imageDataUrlOf` (baca foto db/media → data URL), `aiCaptionCache` (cache VLM per file), `aiImageCache` (cache generate 15 menit), `getAiModerationState`/`aiModerateNewMessage`.
  - `admin:ai_summary` — ringkasan percakapan hidup (maks 80 pesan, termasuk transcript suara/caption) → paragraf + maks 5 poin + "Keputusan & janji".
  - `admin:ai_suggest` — 3 saran balasan pendek untuk admin dari 30 pesan terakhir.
  - `admin:ai_assistant` — chat bebas "ChatKita AI" multi-turn (maks 20 giliran, riwayat di sisi klien).
  - `admin:ai_tts` — bacakan pesan teks → WAV base64 (diputar klien via data URL).
  - `admin:ai_transcribe` — transkrip ulang pesan suara → kolom `transcript` + `message:updated` (pola sama dengan transkrip otomatis).
  - `admin:ai_media_search` — cari foto dengan bahasa sehari-hari: VLM caption 24 foto terakhir (cache) + LLM ranking → hits {messageId, mediaUrl, senderName, caption}.
  - `admin:ai_image_generate` + `admin:ai_image_send` — buat gambar dari teks (pratinjau base64, cache 15 menit) lalu kirim sebagai pesan foto ASLI via `insertAndFanOut` + `attachMediaMeta` (file PNG sha256[:32] ke db/media, kuota admin dicek, caption "🎨 AI: …").
  - `admin:ai_moderation` — get/set moderasi otomatis global `{ enabled, mode: 'censor'|'block' }` (setting `aiModeration`).
- **Moderasi AI pasca-kirim**: hook di `messages:send` (hanya teks dari user; pesan pending lewat jalur persetujuan manual) — TIDAK menahan pengiriman; LLM menjawab AMAN / BLOK / SENSOR: mode censor mengganti konten versi bersih + `message:updated`; mode block mem-tombstone pesan + `moderation:rejected` ke user. Intel ke room admin: event baru `admin:ai_flag` (action, reason, snippet, senderName).
- **Klien**: komponen baru `admin-ai.tsx` — `AdminAIDialog` (5 tab: Ringkasan, Asisten, Cari Media, Gambar, Moderasi) + `AISuggestChips` (3 chip saran AI di atas composer + tombol muat-ulang); AdminPanel: pill "🤖 AI" di toolbar percakapan, chip saran, handler TTS per-pesan (Audio data URL, stop saat ganti), handler transkrip per-pesan, pembuka MediaViewer dari hasil pencarian media (galeri 1 item), listener `admin:ai_flag` → notice; ChatBubble: prop baru `onSpeak/speaking/onTranscribe/transcribing` — tombol "Bacakan AI" di baris aksi (pesan teks) dan "Transkrip AI" di bawah voice player (bila belum ada transcript); chat-types: seksi protokol "Kategori C2" + 10 tipe baru.
- **Operasional**: 3 proses `bun --hot index.ts` liar (warisan rollback) ditemukan & dimatikan sebelum edit (aturan Task 55 diterapkan); chat-service v41 naik bersih via start manual (`bun --hot index.ts` → /tmp/chat-service.log).
- Verifikasi: verify-integrity seksi "v41" (26 cek; 2 cek versi v40 dipindah, total 251). Lint 0/0.

### v42 — 10 Fitur Chat: Polling, Pesan Menghilang, Pengingat, Statistik, Arsip, Status, PDF (Task 60-b)
- **Konteks**: batch ke-2 dari 24 fitur disetujui (fitur #9, 11, 12, 14–20; AI = v41; admin & sistem = v43; call = v44). Dikerjakan subagent + penyelesaian main agent (subagent terputus konteks setelah kode jadi).
- **Server**: tabel baru `poll_votes(message_id, user_id, option_idx, PK(message_id,user_id))`, `reminders(id, user_id, message_id, conversation_id, remind_at, done)`, `conversation_prefs(user_id, conversation_id, archived_at, PK)`; kolom baru `messages.expires_at` (self-destruct), `messages.repeat_rule` ('daily'|'weekly'), `users.status_text` (≤60). Event baru: `user:mystats` (buildUserInsight v37 untuk diri sendiri), `messages:poll_create` (pertanyaan 1–200 + 2–6 opsi → pesan type text dengan meta poll, fan-out manual), `messages:poll_vote` (1 suara/user, bisa pindah → INSERT OR REPLACE + `poll:update` {counts,total} ke semua pihak), `conversation:ttl` (adminGuard+audit; settings `ttl:<convId>` = 0/1/24/168 jam + broadcast `conversation:ttl:update`), `messages:remind`/`messages:remind_cancel` (maks 50 aktif/user, partisipan), `conversation:archive_self` (arsip sisi user, pushConversationsTo), `user:status` (status_text + `user:status:update` ke admins + push conversations). messages:send mengisi expires_at bila ttl percakapan aktif. Sweeper baru (timer existing): `sweepExpiredMessages` (60 dtk — tombstone via pipeline resmi + `message:updated` {deleted:true}) dan `sweepReminders` (30 dtk — `reminder:due` ke room pembuat). deliverDueScheduled v22/v40 diperluas: pesan dengan repeat_rule membuat kembaran baru (scheduled_at +1 hari / +7 hari) setelah terkirim — jadwal berulang tanpa timer tambahan. `toChatMessage` membawa `poll` (dgn counts agregat) + `expiresAt`; conversations overview membawa `ttlHours` + `archivedSelf`; partner membawa `statusText`.
- **Klien**: `chat-utils.ts` — `applySlashCommand` (/dadu → "🎲 Dadu: N (1–6)", /koin → Kepala/Ekor, /me teks → "✦ Nama teks", /shrug → ¯\_(ツ)_/¯) dipakai Messenger & AdminPanel sebelum emit; `chat-types.ts` — ChatPoll + field protokol v42; `ChatBubble.tsx` — kartu POLLING (pertanyaan + tombol opsi + bar persentase live + total suara) & action "Ingatkan saya" (Bell → 1 jam/Besok 09.00/Pekan depan); `my-stats-dialog.tsx` BARU — "Statistikku" (KPI + streak 🔥 + jam aktif) di menu ⋯ Messenger; Messenger: chip "⏳ Pesan menghilang aktif", seksi Arsip (archivedSelf), input Status custom, listener reminder:due/poll:update/ttl:update, "Unduh PDF" (print-view 0 dependensi); AdminPanel: pilihan Pesan menghilang di toolbar, jadwal "Berulang" di user-controls-v40, Unduh PDF di Ekspor.
- **E2E**: polling admin + vote fixture user → hasil live; /dadu /koin /me; reminder 1 jam + sweeper; self-destruct: expires_at dimajukan via DB → sweeper menjadikan "Pesan ini dihapus"; statistik user; status custom; arsip; PDF print-view. (Detail hasil di worklog Task 60-b.)
- Verifikasi: verify-integrity seksi "v42" (30 cek; 2 cek versi v41 dipindah, total 278). Lint 0/0.

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
