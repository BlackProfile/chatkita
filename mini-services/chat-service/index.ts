/**
 * ChatKita chat-service — socket.io mini service (port 3003)
 *
 * Model (v7 — pure private messenger, like WhatsApp/Telegram):
 *   users(role, pin_hash) ──< conversations ──< messages
 *     messages: type text|image|voice|file|system, reply_to_id, duration_ms,
 *               transcript (AI speech-to-text), deleted_at (soft delete),
 *               edited_at/translation, file_name/file_size/mime_type
 *               (file messages only)
 *   + per-user read state (reads) → ✓✓ receipts broadcast live
 *   + settings table (only Web Push VAPID keys are stored server-side)
 *
 * Every person who opens the app logs in with a name and gets a private
 * 1-on-1 chat with the Admin account (the app owner), like messaging any
 * contact. The Admin sees ALL conversations in one list, like WhatsApp Web.
 *
 * v7 — file sharing (documents, video, audio, archives, …):
 *   Large files are uploaded OUT-OF-BAND. The bytes never touch this
 *   service: the client POSTs them to the Next.js HTTP route POST /api/upload
 *   (stored on disk under db/media/<random-name>), which returns the public
 *   URL path "/api/media/<storedName>". The chat message then carries
 *   type 'file' with that path as `content` plus the metadata
 *   fileName/fileSize/mimeType, which this service validates (path-only
 *   URL matching /api/media/<name>, name 1–255 chars, type/subtype mime,
 *   size ≤ 25 MiB) and stores in messages.file_name/file_size/mime_type.
 *   GET /api/media/<name> (Next.js route) streams the bytes back for
 *   preview/download. Web Push bodies for file messages render as
 *   "📎 <fileName>" via snippetOf.
 *
 * Feature set (pure messenger):
 *   - Text | image | voice | file messages (+ replies, media size caps)
 *   - Emoji reactions (message_reactions, one per user per message)
 *   - Edit own text messages (15-min window, edited_at marker)
 *   - Delete for everyone (soft delete + content redaction)
 *   - Live ✓✓ read receipts (`read:update` broadcast)
 *   - Presence (users' online state visible to the admins room ONLY)
 *   - Typing relay between the two participants
 *   - Pin a message per conversation (banner on both sides)
 *   - Archive / unarchive conversations (a new user message auto-unarchives)
 *   - Voice-note transcription (z-ai-web-dev-sdk ASR → message:updated)
 *   - On-demand AI translation (messages.translation, cached)
 *   - Web Push notifications when the recipient has no live socket
 *     (VAPID keys generated once, stored in settings; subscriptions in
 *     push_subscriptions; dead endpoints pruned on 404/410)
 *   - Optional account PIN (SHA-256) protecting name-only logins
 *
 * v11 — admin power features (server side):
 *   - Intel: admin:xray (ip/ua/platform), message forensics (deleted_content
 *     keeps the original text of deleted messages), edit history (edit_history),
 *     side-effect-free peek, global search, per-user stats, conversation/user
 *     export (txt/json, ≤ 5000 messages)
 *   - Session control: kick / freeze / mute / slowmode / mediablock with
 *     send-side enforcement (FROZEN → MUTED → MEDIA_BLOCKED → SLOW_MODE /
 *     RATE_LIMITED → QUOTA_EXCEEDED) and live `user:restricted` pushes
 *   - Fake signals: fake typing, always_online, fake last seen for users,
 *     fake read receipts (no persistence), quick replies, mirror typing
 *   - Moderation: admin delete any message, reset whole conversation,
 *     audit_log table + admin:audit, export_user, admin pin (any message),
 *     keyword scanner (silent flag → admin:flagged + admin:flagged_list)
 *
 * Removed in v6 (v4/v5 customer-service tooling, no longer here): CRM
 * labels/notes, pre-chat topics, operating hours, quick replies, SLA
 * alerts, chatbot menu, star ratings, broadcast, CSV/print export,
 * stats, AI auto-reply/suggestions/summary, `public:settings:update`.
 * Historical SQLite columns (users.label/note/topic, messages.kind) and
 * the old ratings table are left in existing databases but unused.
 *
 * Persistence: bun:sqlite (WAL mode) at ./chat.db
 * Connection path MUST stay '/' — the Caddy gateway forwards
 * /?XTransformPort=3003 to this port.
 */

import { createServer } from 'http'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { Server, type Socket as IoSocket } from 'socket.io'
import ZAI from 'z-ai-web-dev-sdk'
import webpush from 'web-push'
import exifr from 'exifr'
import { zipSync } from 'fflate'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = 3003 // hardcoded — gateway routes XTransformPort=3003 here
/** v22 — paket pulihan: bintangi/teruskan/jadwalkan pesan + badge unread.
 *  v23 — custom login admin: password ter-hash di DB + ganti dari dashboard + rate limit.
 *  v24 — autologin admin: event admin:password_peek (cek password tanpa sesi) untuk UX login otomatis.
 *  v26 — peta penyimpanan: metadata media (dimensi/durasi/halaman) + admin:storage_map + admin:media_scan.
 *  v27 — 1 orang 1 akun: password wajib (bcrypt) + kode undangan sekali pakai + kunci perangkat
 *        (1 perangkat 1 akun) + admin kelola kode/buat akun/reset password/lepas perangkat
 *        + notifikasi perubahan utk akun lama.
 *  v28 — UX login: public:check_name (cek nama pre-login) supaya kolom kode undangan
 *        otomatis disembunyikan ketika yang mengetik adalah akun yang sudah ada.
 *  v29 — reset & hapus menyeluruh: hapus semua bintang (messages:unstar_all),
 *        batalkan semua terjadwal (messages:schedule_cancel_all), admin hapus
 *        akun permanen (admin:user_delete), hapus kode undangan belum terpakai,
 *        bersihkan audit, reset pengaturan default.
 *  v30 — bersihkan chat kedua sisi KHUSUS ADMIN: event conversation:clear (user)
 *        dihapus dari protokol. Satu-satunya jalur menghapus riwayat percakapan
 *        adalah admin:reset_conversation dari panel admin (audit + broadcast).
 *  v31 — UX lampiran: pratinjau INLINE tanpa popup (chip ala foto di atas
 *        composer), teks composer ikut terkirim sebagai caption media, menu
 *        lampiran dipecah per jenis (foto/video/audio/file), dan file audio
 *        dibedakan dari voice note di bubble chat.
 *  v32 — tautan pesan BISA DIKLIK & TERBUKA LANGSUNG: semua URL di teks
 *        pesan/caption jadi <a target=_blank> (LinkifiedText) dan kartu
 *        pratinjau tautan langsung membuka tautan — tanpa popup dialog.
 *  v33 — thumbnail pratinjau tautan: YouTube tak lagi kosong hitam —
 *        thumbnail dari CDN statis i.ytimg.com + judul asli via oEmbed;
 *        kartu minimal tetap muncul meski fetch halaman diblokir bot
 *        (providerFallback); TikTok di-enrich via oEmbed. (Perubahan di
 *        API Next /api/link-preview; versi hanya label rilis.)
 *  v34 — penampil tautan IN-APP: ketukan pada kartu pratinjau maupun
 *        tautan di teks membuka popup di dalam aplikasi — YouTube diputar
 *        via embed youtube-nocookie (16:9, autoplay), TikTok via embed v2;
 *        situs lain tampil sebagai info (thumbnail+judul+deskripsi);
 *        tombol "Buka di browser" & "Salin" selalu tersedia. (Perubahan
 *        sisi klien; versi hanya label rilis.)
 *  v35 — METADATA MEDIA UNTUK ADMIN: EXIF foto (GPS/lokasi, kamera, lensa,
 *        tanggal jepret, ISO/f/eksposur/fokal, software, orientasi) dibaca
 *        server via exifr saat pesan media dikirim (meta_json), event baru
 *        admin:message_meta mengembalikan metadata lengkap + info file
 *        (enrichment live untuk media lama + persist); video MP4 kini juga
 *        dapat videoCreated (mvhd creation time).
 *  v36 — MEDIA PERMANEN: retensi otomatis DINONAKTIFKAN (0 hari) — foto/
 *        video/voice/file tidak lagi dihapus otomatis oleh sweeper; disk
 *        file + pesan tetap utuh selamanya. Env MEDIA_RETENTION_DAYS masih
 *        bisa diisi 1–365 bila retensi diinginkan kembali; tombol admin
 *        "Bersihkan media lama" tetap ada (kini hanya VACUUM karena tidak
 *        ada media yang kedaluwarsa).
 *  v37 — INSIGHT PER-PENGGUNA UNTUK ADMIN: event baru admin:user_insight
 *        mengembalikan agregat percakapan user↔admin (total pesan/media/
 *        karakter, histogram jam & hari WIB, hari aktif, streak, jeda
 *        terpanjang), kecepatan membalas berpasangan (cap 12 jam), % baca,
 *        reaksi, tren 7 vs 7 hari, plus 4–8 butir "ide" otomatis Bahasa
 *        Indonesia (jam paling aktif, media favorit, saran disapa, dll).
 *  v38 — KONTROL USER LENGKAP DARI TOOLBAR PERCAKAPAN: pill "🎭 Cheat"
 *        (pusat cheat per-user — memakai event cheat v25 yang sudah ada),
 *        pill "🖼 Media" + event baru admin:user_media (daftar media hidup
 *        percakapan + total per sisi), admin:media_delete (tombstone satu
 *        media via pipeline resmi + bebaskan file disk + kuota otomatis
 *        longgar), dan admin:media_delete_all (scope "user" = semua media
 *        milik user / "all" = seluruh percakapan); pill "💡 Insight"
 *        membuka insight v37 langsung dari konteks percakapan.
 *  v39 — KENDALI PER-USER TAMBAHAN (paket akun, panel X-Ray): event baru
 *        admin:user_rename (ganti nama tampilan/login user, validasi unik
 *        sama dengan pembuatan akun), admin:bulk_delete_user (tombstone
 *        SEMUA pesan hidup milik user di seluruh percakapan via pipeline
 *        resmi + bebaskan file disk media + kuota longgar otomatis),
 *        admin:user_bot (bot balasan otomatis ATAS NAMA ADMIN per-user —
 *        teks + jeda 0–120 dtk, tersimpan di DB, satu timer pending/user),
 *        admin:user_push (web push custom ke semua langganan user), dan
 *        admin:user_quota (kuota media khusus per-user MiB, 0 = default
 *        global 250 MiB — dicek di messages:send). Semua ter-audit.
 *  v40 — PUSAT KENDALI PER-USER level berikutnya (19 fitur permintaan user):
 *        MODERASI — filter kata per-user (blok/sensor), mode persetujuan
 *        pra-kirim (messages.pending + admin:moderate approve/reject),
 *        blokir media PER JENIS (foto/video/voice/file), paksa logout semua
 *        perangkat (hapus devices + session:revoked). INSIGHT — catatan &
 *        tag admin per user (vip/perhatian/masalah), leaderboard (pesan,
 *        media, aktifitas, balas tercepat), banding 2 user (insight A vs B),
 *        riwayat login historis (tabel login_events), feed aktivitas live
 *        (admin:activity). OTOMASI — pesan terjadwal admin ke user (reuse
 *        kolom scheduled_at + deliverDueScheduled), balasan cepat per-user,
 *        pengingat otomatis (nudge saat user diam X hari), auto-bersih chat
 *        per-user (tombstone pesan > X hari). MEDIA & KEAMANAN — unduh ZIP
 *        semua media user (fflate), peringatan kuota 80%/95% ke admin,
 *        kunci percakapan dgn PIN per-user (admin harus buka kunci sekali
 *        per socket). Semua event adminGuard + audit. */
const SERVICE_VERSION = 'v40'
const BOOT_AT = Date.now()
const ADMIN_ID = 'admin'
const ADMIN_NAME = 'Admin'
const MAX_NAME_LENGTH = 40
const MAX_MESSAGE_LENGTH = 1000
/** v8 — messages per history page (auth/history/older); older pages load
 *  on demand via `messages:older` instead of one huge payload. */
const HISTORY_PAGE_SIZE = 50
/** Max data-URL payload for LEGACY image/voice messages (base64 chars).
 *  v8 clients upload to /api/upload instead; data URLs still accepted. */
const MAX_MEDIA_LENGTH = 2_500_000
/** v7 — max size of out-of-band file messages in bytes (25 MiB). The
 * /api/upload route enforces the same cap; this is the message-side check. */
const MAX_FILE_BYTES = 26_214_400
/** v8 — per-account media retention: disk media older than this is swept
 *  (payload redacted → "media kedaluwarsa" tombstone). Days, env-overridable.
 *  v36 — 0 = TIDAK PERNAH (media disimpan PERMANEN — tidak ada penghapusan
 *  otomatis). Default kini 0; env MEDIA_RETENTION_DAYS=1..365 mengaktifkan
 *  retensi lagi bila suatu saat dibutuhkan. */
const rawRetentionDays = Number(process.env.MEDIA_RETENTION_DAYS)
const RETENTION_DAYS =
  Number.isFinite(rawRetentionDays) && rawRetentionDays >= 0
    ? Math.min(365, Math.floor(rawRetentionDays))
    : 0
const RETENTION_MS = RETENTION_DAYS * 86_400_000
/** v8 — per-account storage quota for disk media (sum of messages.file_size). */
const QUOTA_BYTES = 268_435_456 // 250 MiB
/** v8 — per-account send rate limits (sliding 1-minute window). */
const RATE_TEXT_PER_MIN = 30
const RATE_MEDIA_PER_MIN = 12
/** v8 — media directory shared with the Next.js /api/upload + /api/media
 *  routes (project-root relative so the sweeper can free disk space). */
const MEDIA_DIR = resolve(import.meta.dir, '../../db/media')
/** v7 — file messages: `content` must be the bare /api/media/<name> URL
 * path returned by POST /api/upload (no protocol/host, no whitespace). */
const FILE_URL_PATTERN = /^\/api\/media\/[A-Za-z0-9._-]{1,120}$/
/** v7 — file messages: mimeType must be a bare type/subtype token (≤ 100). */
const MIME_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/
/** v7 — file messages: display-name limit (characters). */
const MAX_FILE_NAME_LENGTH = 255
/** Fixed reaction palette (v5). */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const
/** Window in which a sender may edit their own text message. */
const EDIT_WINDOW_MS = 15 * 60_000

/* ------------------------------------------------------------------ */
/* Storage (bun:sqlite, WAL)                                           */
/* ------------------------------------------------------------------ */

const DB_PATH = join(import.meta.dir, 'chat.db')
const db = new Database(DB_PATH)
db.run('PRAGMA journal_mode = WAL')

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
  )
`)

db.run('CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations(user_a_id, user_b_id)')

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id)')

db.run(`
  CREATE TABLE IF NOT EXISTS reads (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)

/** Idempotent column migrations (v3 → v4). */
const addColumn = (table: string, column: string, ddl: string) => {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
    console.log(`Migrated: ${table}.${column} added`)
  } catch {
    /* column already exists */
  }
}
addColumn('messages', 'type', "TEXT NOT NULL DEFAULT 'text'")
addColumn('messages', 'reply_to_id', 'INTEGER')
addColumn('messages', 'duration_ms', 'INTEGER')
addColumn('messages', 'transcript', 'TEXT')
addColumn('messages', 'deleted_at', 'INTEGER')
addColumn('users', 'pin_hash', 'TEXT')
/* v5 migrations */
addColumn('messages', 'edited_at', 'INTEGER')
addColumn('messages', 'translation', 'TEXT')
addColumn('conversations', 'archived_at', 'INTEGER')
addColumn('conversations', 'pinned_message_id', 'INTEGER')
/* v6 — the CRM columns (users.label/note/topic) and the rating-marker
 * column (messages.kind) are no longer added, read, nor written. Existing
 * databases keep the dormant columns; they are never dropped. */
/* v7 migrations — file sharing (out-of-band via /api/upload + /api/media) */
addColumn('messages', 'file_name', 'TEXT')
addColumn('messages', 'file_size', 'INTEGER')
addColumn('messages', 'mime_type', 'TEXT')
/* v8 migrations — server lightening (thumbnails + retention tombstones) */
addColumn('messages', 'thumb_url', 'TEXT')
addColumn('messages', 'media_expired_at', 'INTEGER')
/* v11 migrations — admin power features.
 * deleted_content keeps the ORIGINAL text of deleted messages (forensics);
 * edit_history keeps previous revisions of edited messages (JSON array);
 * flagged marks messages whose text matched an admin keyword.
 * users.* columns power the session-control features (kick/freeze/mute/
 * slowmode/mediablock). bun:sqlite has no ALTER guard — addColumn try/catches. */
addColumn('messages', 'deleted_content', 'TEXT')
addColumn('messages', 'edit_history', 'TEXT')
addColumn('messages', 'flagged', 'INTEGER DEFAULT 0')
addColumn('users', 'frozen', 'INTEGER DEFAULT 0')
addColumn('users', 'muted_until', 'INTEGER DEFAULT 0')
addColumn('users', 'slow_mode', 'INTEGER DEFAULT 0')
addColumn('users', 'media_blocked', 'INTEGER DEFAULT 0')
/* v39 — kendali per-user: kuota media khusus + bot balasan otomatis. */
addColumn('users', 'media_quota_mb', 'INTEGER DEFAULT 0')
addColumn('users', 'bot_reply_on', 'INTEGER DEFAULT 0')
addColumn('users', 'bot_reply_text', 'TEXT')
addColumn('users', 'bot_reply_delay_ms', 'INTEGER DEFAULT 3000')
/* v20 — caption teks opsional yang menyertai pesan media (foto/file). */
addColumn('messages', 'caption', 'TEXT')
/* v22 — paket pulihan: bintang (per-user), teruskan, pesan terjadwal. */
addColumn('messages', 'starred_by', 'TEXT')
addColumn('messages', 'forwarded_from', 'TEXT')
addColumn('messages', 'scheduled_at', 'INTEGER')
addColumn('messages', 'delivered_at', 'INTEGER')
/* v26 — metadata media (dimensi/durasi/halaman) untuk Peta Penyimpanan. */
addColumn('messages', 'meta_json', 'TEXT')
/* v27 — 1 orang 1 akun: password akun + asal-usul pendaftaran. */
addColumn('users', 'password_hash', 'TEXT')
addColumn('users', 'password_set_at', 'INTEGER')
addColumn('users', 'created_via', 'TEXT')
/* v40 — pusat kendali per-user: moderasi, catatan, otomasi, keamanan. */
addColumn('users', 'word_filter', 'TEXT')
addColumn('users', 'word_filter_action', "TEXT DEFAULT 'block'")
addColumn('users', 'approval_mode', 'INTEGER DEFAULT 0')
addColumn('users', 'blocked_media_types', "TEXT DEFAULT ''")
addColumn('users', 'admin_note', 'TEXT')
addColumn('users', 'tag', "TEXT DEFAULT ''")
addColumn('users', 'quick_replies', 'TEXT')
addColumn('users', 'nudge_days', 'INTEGER DEFAULT 0')
addColumn('users', 'nudge_text', 'TEXT')
addColumn('users', 'nudge_last_at', 'INTEGER DEFAULT 0')
addColumn('users', 'auto_clean_days', 'INTEGER DEFAULT 0')
addColumn('users', 'pin_lock', 'TEXT')
/* v40 — moderasi pra-kirim: pesan user menunggu persetujuan admin. */
addColumn('messages', 'pending', 'INTEGER DEFAULT 0')
db.run(`
  CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    kind TEXT NOT NULL DEFAULT 'login'
  )
`)
db.run('CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, at)')
/* v27 — perangkat terikat (1 perangkat maks 1 akun, append-only;
 * admin bisa melepas lewat dashboard). */
db.run(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bound_at INTEGER NOT NULL
  )
`)
/* v27 — kode undangan sekali pakai (1 kode = 1 akun). */
db.run(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    label TEXT,
    used_by TEXT,
    used_at INTEGER
  )
`)

/** v11 — audit trail of admin actions (admin:audit). */
db.run(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

/* ------------------------------ row types ------------------------------ */

interface UserRow {
  id: string
  name: string
  role: string
  created_at: number
  last_seen_at: number
  pin_hash?: string | null
  /* v27 — 1 orang 1 akun: password (bcrypt) + jejak pendaftaran. */
  password_hash?: string | null
  password_set_at?: number | null
  created_via?: string | null
  /* v11 — session control columns (0 = off). */
  frozen?: number | null
  muted_until?: number | null
  slow_mode?: number | null
  media_blocked?: number | null
  /* v39 — kuota media khusus (MiB; 0 = default global) + bot balasan otomatis. */
  media_quota_mb?: number | null
  bot_reply_on?: number | null
  bot_reply_text?: string | null
  bot_reply_delay_ms?: number | null
  /* v40 — pusat kendali per-user. */
  word_filter?: string | null
  word_filter_action?: string | null
  approval_mode?: number | null
  blocked_media_types?: string | null
  admin_note?: string | null
  tag?: string | null
  quick_replies?: string | null
  nudge_days?: number | null
  nudge_text?: string | null
  nudge_last_at?: number | null
  auto_clean_days?: number | null
  pin_lock?: string | null
}

interface ConversationRow {
  id: string
  user_a_id: string
  user_b_id: string
  created_at: number
  last_message_at: number
  archived_at?: number | null
  pinned_message_id?: number | null
}

/* v27 — perangkat terikat 1 perangkat ↔ 1 akun. */
interface DeviceRow {
  device_id: string
  user_id: string
  bound_at: number
}

/* v27 — kode undangan sekali pakai. */
interface InviteCodeRow {
  code: string
  created_by: string
  created_at: number
  label?: string | null
  used_by?: string | null
  used_at?: number | null
}

interface MessageRow {
  id: number
  conversation_id: string
  sender_id: string
  content: string
  created_at: number
  type?: string
  reply_to_id?: number | null
  duration_ms?: number | null
  transcript?: string | null
  deleted_at?: number | null
  edited_at?: number | null
  translation?: string | null
  /* v7 — file-message metadata (type 'file' only; redacted on delete). */
  file_name?: string | null
  file_size?: number | null
  mime_type?: string | null
  /* v8 — tiny preview URL for photos/videos; retention tombstone stamp. */
  thumb_url?: string | null
  media_expired_at?: number | null
  /* v11 — forensics / edit history / keyword flag. */
  deleted_content?: string | null
  edit_history?: string | null
  flagged?: number | null
  /* v20 — caption teks opsional yang menyertai pesan media (foto/file). */
  caption?: string | null
  /* v22 — bintang per-user (JSON array userId), asal-forward, terjadwal. */
  starred_by?: string | null
  forwarded_from?: string | null
  scheduled_at?: number | null
  delivered_at?: number | null
  /* v26 — metadata media (JSON: width/height/durationMs/pages). */
  meta_json?: string | null
  /* v40 — 1 = pesan menunggu persetujuan admin (moderasi pra-kirim). */
  pending?: number | null
}

/* ------------------------------ API types ------------------------------ */

interface ChatMessageApi {
  id: number
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  type: 'text' | 'image' | 'voice' | 'file' | 'system'
  replyToId?: number
  replyTo?: { id: number; senderId: string; snippet: string; type: string }
  durationMs?: number
  transcript?: string
  deletedAt?: string
  editedAt?: string
  translation?: string
  /** file messages: original file name (display only). */
  fileName?: string
  /** v20 — caption teks opsional yang ikut dikirim bersama media. */
  caption?: string
  /** file messages: size in bytes. */
  fileSize?: number
  /** file messages: MIME type (e.g. application/pdf, video/mp4). */
  mimeType?: string
  /** v8 — tiny preview image (<30 KB) for photos & videos. */
  thumbUrl?: string
  /** v8 — media was removed by the retention sweeper (tombstone). */
  mediaExpiredAt?: string
  /** Emoji reactions grouped by emoji with the reacting user ids. */
  reactions?: { emoji: string; userIds: string[] }[]
  /** v22 — userId yang membintangi pesan ini (viewer membandingkan id-nya). */
  starredBy?: string[]
  /** v22 — pesan terjadwal: ISO waktu kirim otomatis (hilang setelah terkirim). */
  scheduledAt?: string
  /** v22 — label "Diteruskan dari …" pada pesan hasil forward. */
  forwardedFrom?: string
  /** v40 — true saat menunggu persetujuan admin (moderasi pra-kirim). */
  pending?: boolean
}

interface PartnerInfoApi {
  id: string
  name: string
  online: boolean
  lastSeenAt: string | null
}

interface ConversationOverviewApi {
  id: string
  partner: PartnerInfoApi
  lastMessage:
    | {
        id: number
        senderId: string
        content: string
        createdAt: string
        type: string
        deleted: boolean
        fileName?: string
        mediaExpired?: boolean
        /** v20 — caption teks yang menyertai pesan media terakhir. */
        caption?: string
      }
    | null
  lastMessageAt: string
  unread: number
  /** How far the PARTNER has read → powers ✓✓ on own bubbles. */
  partnerLastReadId: number
  /** v5 — archive state (admin side). */
  archived?: boolean
  /** v5 — pinned message (banner on both sides). */
  pinnedMessageId?: number | null
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null
  /** v11 — rich pinned snapshot incl. the sender display name. */
  pinnedMessage?: { messageId: number; senderId: string; senderName: string; snippet: string; type: string } | null
}

/* ------------------- settings helpers (VAPID keys only) ------------------- */

const getSetting = (key: string): string | undefined =>
  (db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null)?.value

const setSetting = (key: string, value: string) => {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )
}

/** v23 — hash password admin (bcrypt via Bun.password). Null = fallback bawaan admin123. */
const getAdminPasswordHash = (): string | null => {
  const h = getSetting('adminPasswordHash')
  return typeof h === 'string' && h.length > 0 ? h : null
}

/** v23 — verifikasi password admin terhadap hash tersimpan / fallback bawaan. */
const verifyAdminPassword = (password: string): Promise<boolean> => {
  const storedHash = getAdminPasswordHash()
  if (storedHash) return Bun.password.verify(password, storedHash)
  return Promise.resolve(password === (process.env.ADMIN_PASSWORD || 'admin123'))
}

/** v23 — anti brute-force login admin: jendela global 60 dtk + batas per-socket. */
const ADMIN_FAIL_WINDOW_MS = 60_000
const ADMIN_FAIL_MAX_PER_WINDOW = 10
const ADMIN_FAIL_MAX_PER_SOCKET = 5
const adminAuthFails = { windowStart: 0, count: 0 }
const adminAuthSocketFails = new Map<string, number>()

/** v24 — anti brute-force untuk admin:password_peek (cek password autologin, tanpa sesi).
 *  CATATAN: JANGAN pakai nama 'admin:peek' — itu event LAMA (v10, peek isi
 *  percakapan tanpa mark-read). Nama ini sengaja beda supaya tidak tabrakan.
 *  Counter sengaja TERPISAH dari admin:auth supaya mengetik bertahap di form
 *  autologin tidak mengunci login sungguhan. Tetap dibatasi agar tidak menjadi
 *  celah brute-force: maks 30 gagal/socket/menit + 120 gagal global/menit. */
const ADMIN_PEEK_WINDOW_MS = 60_000
const ADMIN_PEEK_MAX_PER_WINDOW = 120
const ADMIN_PEEK_MAX_PER_SOCKET = 30
const adminPeekFails = { windowStart: 0, count: 0 }
const adminPeekSocketFails = new Map<string, number>()

/* ------- v27 — 1 orang 1 akun: password + undangan + perangkat ------- */

/** v27 — batas panjang password (bcrypt backend membaca maks 72 byte). */
const MIN_PASSWORD_LENGTH = 4
const MAX_PASSWORD_LENGTH = 72
/** v27 — batas aman perangkat terikat per akun (admin bisa melepas). */
const DEVICE_LIMIT_PER_USER = 8

/** v27 — hash password user (bcrypt, sama seperti admin). */
const hashUserPassword = (password: string) =>
  Bun.password.hashSync(password, { algorithm: 'bcrypt', cost: 10 })

/** v27 — anti brute-force login user: per-nama, jendela 60 dtk, maks 10 gagal. */
const USER_PW_WINDOW_MS = 60_000
const USER_PW_MAX_FAILS = 10
const userPwFails = new Map<string, { windowStart: number; count: number }>()
const userPwBlocked = (key: string): boolean => {
  const rec = userPwFails.get(key)
  if (!rec) return false
  if (Date.now() - rec.windowStart > USER_PW_WINDOW_MS) {
    userPwFails.delete(key)
    return false
  }
  return rec.count >= USER_PW_MAX_FAILS
}
const userPwRecordFail = (key: string) => {
  const rec = userPwFails.get(key)
  const t = Date.now()
  if (!rec || t - rec.windowStart > USER_PW_WINDOW_MS) {
    userPwFails.set(key, { windowStart: t, count: 1 })
    return
  }
  rec.count += 1
}
const userPwClear = (key: string) => {
  userPwFails.delete(key)
}

/** v27 — kode undangan sekali pakai: CK-XXXXX-XXXX (tanpa karakter membingungkan). */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const randomInviteChunk = (len: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length]
  return out
}
const makeInviteCode = () => `CK-${randomInviteChunk(5)}-${randomInviteChunk(4)}`

/* ------------- v10 — application settings (admin dashboard) ------------- */

/** App-wide settings editable from the admin dashboard (persisted). */
interface AppSettingsApi {
  appName: string
  welcomeMessage: string
  maintenanceMode: boolean
  maintenanceNote: string
  // v13 — app behaviour controls (dashboard "Pengaturan").
  /** When false, brand-new names cannot register (existing users still log in). */
  allowRegistration: boolean
  /** Effective per-message text cap for users (admin always gets the hard max). */
  maxMessageLength: number
  /** Per-file upload cap for users, in MiB (admin exempt). */
  maxUploadMb: number
  allowImages: boolean
  allowVoice: boolean
  allowFiles: boolean
  allowLinks: boolean
  /** Client-side link preview cards on text messages. */
  linkPreview: boolean
  allowReactions: boolean
  /** When false, read receipts are never broadcast (local unread state still works). */
  readReceipts: boolean
  /** Global minimum seconds between two user messages (0 = off; admin exempt). */
  slowmodeSeconds: number
}

const APP_SETTING_LIMITS = {
  appName: 40,
  welcomeMessage: 200,
  maintenanceNote: 200,
  maxMessageLength: { min: 50, max: MAX_MESSAGE_LENGTH },
  maxUploadMb: { min: 1, max: 25 },
  slowmodeSeconds: { min: 0, max: 60 },
} as const

/**
 * v29 — kunci pengaturan aplikasi yang DIHAPUS oleh admin:settings:reset
 * agar kembali ke default. HANYA daftar ini — kunci lain di tabel settings
 * (hash password admin, vapid%, notice_v27_sent, cheat, keywords, dst.)
 * TIDAK boleh ikut terhapus.
 */
const APP_SETTING_RESET_KEYS = [
  'appName',
  'welcomeMessage',
  'maintenanceMode',
  'maintenanceNote',
  'allowRegistration',
  'maxMessageLength',
  'maxUploadMb',
  'allowImages',
  'allowVoice',
  'allowFiles',
  'allowLinks',
  'linkPreview',
  'allowReactions',
  'readReceipts',
  'slowmodeSeconds',
] as const

const getNumSetting = (key: string, dflt: number): number => {
  const v = Number(getSetting(key))
  return Number.isFinite(v) && v >= 0 ? v : dflt
}

const clampNum = (v: number, lim: { min: number; max: number }): number =>
  Math.min(lim.max, Math.max(lim.min, Math.round(v)))

const getAppSettings = (): AppSettingsApi => ({
  appName: getSetting('appName') ?? 'ChatKita',
  welcomeMessage: getSetting('welcomeMessage') ?? '',
  maintenanceMode: getSetting('maintenanceMode') === '1',
  maintenanceNote:
    getSetting('maintenanceNote') ??
    'Sedang dalam pemeliharaan — beberapa fitur mungkin terbatas.',
  // v13 — behaviour defaults (everything open, generous caps).
  allowRegistration: getSetting('allowRegistration') !== '0',
  maxMessageLength: clampNum(getNumSetting('maxMessageLength', MAX_MESSAGE_LENGTH), {
    min: APP_SETTING_LIMITS.maxMessageLength.min,
    max: APP_SETTING_LIMITS.maxMessageLength.max,
  }),
  maxUploadMb: clampNum(getNumSetting('maxUploadMb', 25), {
    min: APP_SETTING_LIMITS.maxUploadMb.min,
    max: APP_SETTING_LIMITS.maxUploadMb.max,
  }),
  allowImages: getSetting('allowImages') !== '0',
  allowVoice: getSetting('allowVoice') !== '0',
  allowFiles: getSetting('allowFiles') !== '0',
  allowLinks: getSetting('allowLinks') !== '0',
  linkPreview: getSetting('linkPreview') !== '0',
  allowReactions: getSetting('allowReactions') !== '0',
  readReceipts: getSetting('readReceipts') !== '0',
  slowmodeSeconds: clampNum(getNumSetting('slowmodeSeconds', 0), {
    min: APP_SETTING_LIMITS.slowmodeSeconds.min,
    max: APP_SETTING_LIMITS.slowmodeSeconds.max,
  }),
})

/** Fan out the freshest app settings to EVERY connected client. */
const broadcastAppSettings = () => {
  io.emit('app:settings:update', getAppSettings())
}

/* -------- v11 — fake-signal settings + shared string helpers -------- */

/** settings row as boolean ('1' = true). */
const getBoolSetting = (key: string): boolean => getSetting(key) === '1'

/**
 * v21 — fitur yang default-nya TERBUKA ketika baris settings belum ada
 * (konsisten dengan getAppSettings yang memakai `!== '0'`). Tanpa ini,
 * setelah reset/Pusat-restore (settings kosong) pendaftaran, reaksi,
 * kirim media, read receipts, dll. jadi TERKUNCI.
 */
const DEFAULT_OPEN_BOOL_KEYS = new Set([
  'allowRegistration',
  'allowImages',
  'allowVoice',
  'allowFiles',
  'allowLinks',
  'linkPreview',
  'allowReactions',
  'readReceipts',
])

/** settings row as boolean; key hilang → ikut default per fitur. */
const getBoolSettingDefaulted = (key: string): boolean => {
  const raw = getSetting(key)
  if (raw === undefined || raw === '') return DEFAULT_OPEN_BOOL_KEYS.has(key)
  return raw === '1'
}

/** Parsed quick_replies / keywords JSON arrays (validated on write). */
const getSettingList = (key: string): string[] => {
  try {
    const raw = getSetting(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * v11 — lastSeen string of `userId` as seen by `viewerId`. When a fake
 * last-seen string is configured, USERS see the fake value for the ADMIN;
 * the admin always sees the real timestamp.
 */
const lastSeenFor = (viewerId: string, userId: string, realIso: string | null): string | null => {
  if (userId === ADMIN_ID && viewerId !== ADMIN_ID) {
    const fake = getSetting('fake_last_seen')
    if (typeof fake === 'string' && fake.length > 0) return fake
  }
  return realIso
}

/** First keyword (case-insensitive substring) matching `content`, if any. */
const matchedKeyword = (content: string): string | null => {
  const lower = content.toLowerCase()
  for (const keyword of getSettingList('keywords')) {
    if (keyword.length > 0 && lower.includes(keyword.toLowerCase())) return keyword
  }
  return null
}

/** Directory size helper (bytes) for the dashboard storage panel. */
const dirStats = (dir: string): { bytes: number; files: number } => {
  let bytes = 0
  let files = 0
  try {
    for (const entry of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, entry))
        if (st.isFile()) {
          bytes += st.size
          files += 1
        }
      } catch {
        /* file vanished mid-scan */
      }
    }
  } catch {
    /* directory missing yet */
  }
  return { bytes, files }
}

/**
 * v10 — aggregated dashboard stats for `admin:dashboard`.
 * All aggregation happens in SQL; days are UTC epoch-day buckets.
 */
/** v13 — userId → ts of last message, backing the global user slowmode. */
const globalSlowAt = new Map<string, number>()

const dashboardStats = () => {
  const nowMs = now()
  const DAY_MS = 86_400_000

  const scalar = (sql: string, ...params: (string | number)[]): number =>
    Number((db.query(sql).get(...params) as { v: number | null } | undefined)?.v ?? 0)

  const users = scalar("SELECT COUNT(*) AS v FROM users WHERE role = 'user'")
  const conversations = scalar('SELECT COUNT(*) AS v FROM conversations')
  const messages = scalar('SELECT COUNT(*) AS v FROM messages')
  const deletedMessages = scalar('SELECT COUNT(*) AS v FROM messages WHERE deleted_at IS NOT NULL')
  const last24h = scalar('SELECT COUNT(*) AS v FROM messages WHERE created_at >= ?', nowMs - DAY_MS)
  const last7d = scalar('SELECT COUNT(*) AS v FROM messages WHERE created_at >= ?', nowMs - 7 * DAY_MS)

  const byTypeRows = db
    .query('SELECT type, COUNT(*) AS c FROM messages GROUP BY type')
    .all() as { type: string | null; c: number }[]
  const byType: Record<string, number> = { text: 0, image: 0, voice: 0, file: 0, system: 0 }
  for (const r of byTypeRows) {
    const key = r.type && r.type in byType ? r.type : 'text'
    byType[key] += r.c
  }

  // Daily series — last 14 UTC days, zero-filled.
  const dailyRows = db
    .query(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS c
       FROM messages WHERE created_at >= ? GROUP BY day`
    )
    .all(nowMs - 13 * DAY_MS) as { day: number; c: number }[]
  const dailyMap = new Map(dailyRows.map((r) => [r.day, r.c]))
  const dayPoint = (epochDay: number, map: Map<number, number>) => ({
    date: new Date(epochDay * DAY_MS).toISOString().slice(0, 10),
    count: map.get(epochDay) ?? 0,
  })
  const daily: { date: string; count: number }[] = []
  for (let i = 13; i >= 0; i -= 1) {
    daily.push(dayPoint(Math.floor(nowMs / DAY_MS) - i, dailyMap))
  }

  // v13 — 30-day series (range toggle in the analytics tab).
  const daily30Rows = db
    .query(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS c
       FROM messages WHERE created_at >= ? GROUP BY day`
    )
    .all(nowMs - 29 * DAY_MS) as { day: number; c: number }[]
  const daily30Map = new Map(daily30Rows.map((r) => [r.day, r.c]))
  const daily30: { date: string; count: number }[] = []
  for (let i = 29; i >= 0; i -= 1) {
    daily30.push(dayPoint(Math.floor(nowMs / DAY_MS) - i, daily30Map))
  }

  // v13 — registrations per day (14 days, zero-filled) for the growth chart.
  const newUsersRows = db
    .query(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS c
       FROM users WHERE role = 'user' AND created_at >= ? GROUP BY day`
    )
    .all(nowMs - 13 * DAY_MS) as { day: number; c: number }[]
  const newUsersMap = new Map(newUsersRows.map((r) => [r.day, r.c]))
  const newUsersDaily: { date: string; count: number }[] = []
  for (let i = 13; i >= 0; i -= 1) {
    newUsersDaily.push(dayPoint(Math.floor(nowMs / DAY_MS) - i, newUsersMap))
  }

  // Hour-of-day distribution over the last 7 days (0-23, UTC).
  const hourlyRows = db
    .query(
      `SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS c
       FROM messages WHERE created_at >= ? GROUP BY h`
    )
    .all(nowMs - 7 * DAY_MS) as { h: number; c: number }[]
  const hourly: number[] = Array.from({ length: 24 }, () => 0)
  for (const r of hourlyRows) {
    if (r.h >= 0 && r.h < 24) hourly[r.h] = r.c
  }

  // v13 — weekday distribution over the last 28 days (0=Sun..6=Sat).
  const weekdayRows = db
    .query(
      `SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) AS d, COUNT(*) AS c
       FROM messages WHERE created_at >= ? GROUP BY d`
    )
    .all(nowMs - 27 * DAY_MS) as { d: number; c: number }[]
  const weekday: number[] = Array.from({ length: 7 }, () => 0)
  for (const r of weekdayRows) {
    if (r.d >= 0 && r.d < 7) weekday[r.d] = r.c
  }

  // v13 — user vs admin message share (excl. system broadcasts).
  const bySenderRows = db
    .query(
      `SELECT CASE WHEN sender_id = ? THEN 'admin' ELSE 'user' END AS s, COUNT(*) AS c
       FROM messages WHERE type != 'system' AND deleted_at IS NULL GROUP BY s`
    )
    .all(ADMIN_ID) as { s: string; c: number }[]
  const bySender = { user: 0, admin: 0 }
  for (const r of bySenderRows) {
    if (r.s === 'admin') bySender.admin = r.c
    else bySender.user = r.c
  }

  // v13 — average admin response time: for every user message in the last
  // 7 days, find the earliest later admin message in the same conversation;
  // ignore lags beyond 6h so offline gaps don't skew the average.
  let avgResponseMs: number | null = null
  try {
    const respRow = db
      .query(
        `SELECT AVG(lag) AS v FROM (
           SELECT MIN(m2.created_at - m1.created_at) AS lag
           FROM messages m1
           JOIN messages m2
             ON m2.conversation_id = m1.conversation_id
            AND m2.sender_id = ?
            AND m2.created_at >= m1.created_at
            AND m2.deleted_at IS NULL
           WHERE m1.sender_id != ? AND m1.type != 'system'
             AND m1.deleted_at IS NULL AND m1.created_at >= ?
           GROUP BY m1.id
         ) WHERE lag >= 0 AND lag < 21600000`
      )
      .get(ADMIN_ID, ADMIN_ID, nowMs - 7 * DAY_MS) as { v: number | null }
    avgResponseMs = typeof respRow?.v === 'number' ? Math.round(respRow.v) : null
  } catch {
    avgResponseMs = null
  }

  // v13 — engagement counters.
  const reactionsTotal = scalar('SELECT COUNT(*) AS v FROM message_reactions')
  const repliesTotal = scalar('SELECT COUNT(*) AS v FROM messages WHERE reply_to_id IS NOT NULL')
  const editsTotal = scalar('SELECT COUNT(*) AS v FROM messages WHERE edited_at IS NOT NULL')
  const pushSubs = scalar('SELECT COUNT(*) AS v FROM push_subscriptions')
  const newUsers7d = scalar(
    "SELECT COUNT(*) AS v FROM users WHERE role = 'user' AND created_at >= ?",
    nowMs - 7 * DAY_MS
  )
  const firstMessageAtRow = db
    .query('SELECT MIN(created_at) AS v FROM messages')
    .get() as { v: number | null }
  const firstMessageAt =
    typeof firstMessageAtRow?.v === 'number' ? new Date(firstMessageAtRow.v).toISOString() : null

  const topUsers = (
    db
      .query(
        `SELECT u.id, u.name, u.last_seen_at,
           (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) AS c,
           (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.type != 'text') AS media,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.sender_id = u.id) AS last_msg
         FROM users u WHERE u.role = 'user'
         ORDER BY c DESC, u.name ASC LIMIT 10`
      )
      .all() as {
      id: string
      name: string
      last_seen_at: number
      c: number
      media: number
      last_msg: number | null
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    messages: r.c,
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    online: isOnline(r.id),
    ...(typeof r.media === 'number' ? { mediaCount: r.media } : {}),
    ...(r.last_msg ? { lastMessageAt: new Date(r.last_msg).toISOString() } : {}),
  }))

  const allUsers = (
    db
      .query(
        `SELECT u.id, u.name, u.created_at, u.last_seen_at,
           u.password_hash IS NOT NULL AS has_pw,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS dev,
           (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) AS c,
           (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.type != 'text') AS media,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.sender_id = u.id) AS last_msg
         FROM users u WHERE u.role = 'user'
         ORDER BY u.last_seen_at DESC LIMIT 100`
      )
      .all() as {
      id: string
      name: string
      created_at: number
      last_seen_at: number
      has_pw: number
      dev: number
      c: number
      media: number
      last_msg: number | null
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    joinedAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    messages: r.c,
    online: isOnline(r.id),
    hasPassword: r.has_pw === 1,
    devices: r.dev,
    ...(typeof r.media === 'number' ? { mediaCount: r.media } : {}),
    ...(r.last_msg ? { lastMessageAt: new Date(r.last_msg).toISOString() } : {}),
  }))

  const mediaRow = db
    .query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(file_size), 0) AS b FROM messages
       WHERE file_size IS NOT NULL AND deleted_at IS NULL AND media_expired_at IS NULL`
    )
    .get() as { c: number; b: number }

  let dbBytes = 0
  let walBytes = 0
  try {
    dbBytes = statSync(DB_PATH).size
    walBytes = statSync(`${DB_PATH}-wal`).size
  } catch {
    /* WAL may not exist */
  }
  const media = dirStats(MEDIA_DIR)

  let onlineUsers = 0
  for (const [id, sockets] of onlineSockets) {
    if (id !== ADMIN_ID && sockets.size > 0) onlineUsers += 1
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    version: SERVICE_VERSION,
    uptimeMs: nowMs - BOOT_AT,
    totals: {
      users,
      conversations,
      messages,
      deletedMessages,
      last24h,
      last7d,
      byType,
      onlineUsers,
      mediaCount: Number(mediaRow.c),
      mediaBytes: Number(mediaRow.b),
      // v13 — engagement extras.
      newUsers7d,
      reactionsTotal,
      repliesTotal,
      editsTotal,
      pushSubs,
    },
    daily,
    daily30,
    newUsersDaily,
    hourly,
    weekday,
    bySender,
    avgResponseMs,
    firstMessageAt,
    topUsers,
    users: allUsers,
    storage: {
      dbBytes,
      walBytes,
      mediaBytes: media.bytes,
      mediaFiles: media.files,
      quotaBytes: QUOTA_BYTES,
      retentionDays: Math.round(RETENTION_MS / DAY_MS),
    },
  }
}

/* --------------------- Web Push (v5, offline delivery) --------------------- */

let VAPID_PUBLIC = ''
try {
  const pub = getSetting('vapidPublic')
  const priv = getSetting('vapidPrivate')
  if (pub && priv) {
    VAPID_PUBLIC = pub
    webpush.setVapidDetails('mailto:admin@chatkita.local', pub, priv)
  } else {
    const keys = webpush.generateVAPIDKeys()
    VAPID_PUBLIC = keys.publicKey
    setSetting('vapidPublic', keys.publicKey)
    setSetting('vapidPrivate', keys.privateKey)
    webpush.setVapidDetails('mailto:admin@chatkita.local', keys.publicKey, keys.privateKey)
    console.log('VAPID keys generated and stored')
  }
} catch (err) {
  console.error('VAPID bootstrap failed (push disabled):', (err as Error)?.message ?? err)
}

interface PushPayload {
  title: string
  body: string
  /** URL to open/focus when the notification is clicked. */
  url: string
}

/** Fire-and-forget push to every stored subscription of `userId`. */
const pushSend = async (userId: string, payload: PushPayload) => {
  if (!VAPID_PUBLIC) return
  try {
    const subs = db
      .query('SELECT * FROM push_subscriptions WHERE user_id = ?')
      .all(userId) as Array<{ endpoint: string; p256dh: string; auth: string }>
    if (subs.length === 0) return
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 3600 }
          )
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [s.endpoint])
          }
        }
      })
    )
  } catch (err) {
    console.error('Push send error:', (err as Error)?.message ?? err)
  }
}

/** Push a new message to `recipientId` when they have no live socket. */
const pushNewMessageIfOffline = (recipientId: string, senderName: string, body: string) => {
  if (isOnline(recipientId)) return
  const isAdmin = recipientId === ADMIN_ID
  void pushSend(recipientId, {
    title: isAdmin ? `${senderName} · ChatKita` : senderName,
    body,
    url: isAdmin ? '/?admin' : '/',
  })
}

/* ------------------------------ helpers ------------------------------ */

const now = () => Date.now()

/** v22 — parse kolom starred_by (JSON array userId) dengan aman. */
const starredByOf = (raw: string | null | undefined): string[] => {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const toChatMessage = (row: MessageRow): ChatMessageApi => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  content: row.deleted_at ? '' : row.content,
  createdAt: new Date(row.created_at).toISOString(),
  type: (row.type as ChatMessageApi['type']) ?? 'text',
  ...(row.reply_to_id ? { replyToId: row.reply_to_id } : {}),
  ...(row.duration_ms ? { durationMs: row.duration_ms } : {}),
  ...(row.transcript ? { transcript: row.transcript } : {}),
  ...(row.deleted_at ? { deletedAt: new Date(row.deleted_at).toISOString() } : {}),
  ...(row.edited_at ? { editedAt: new Date(row.edited_at).toISOString() } : {}),
  ...(row.translation && !row.deleted_at ? { translation: row.translation } : {}),
  // v7 — file metadata; like content, it is NEVER emitted once deleted.
  ...(row.file_name && !row.deleted_at ? { fileName: row.file_name } : {}),
  ...(typeof row.file_size === 'number' && !row.deleted_at ? { fileSize: row.file_size } : {}),
  ...(row.mime_type && !row.deleted_at ? { mimeType: row.mime_type } : {}),
  // v20 — caption ikut media (tidak pernah dikirim setelah dihapus).
  ...(row.caption && !row.deleted_at ? { caption: row.caption } : {}),
  // v22 — bintang per-user, label forward, dan pesan terjadwal (yang belum
  // terkirim membawa scheduledAt; setelah delivered_at terisi field hilang).
  ...(row.starred_by ? { starredBy: starredByOf(row.starred_by) } : {}),
  ...(row.forwarded_from && !row.deleted_at ? { forwardedFrom: row.forwarded_from } : {}),
  // v40 — badge antrean moderasi (hanya terlihat admin sampai disetujui).
  ...((row.pending ?? 0) === 1 && !row.deleted_at ? { pending: true } : {}),
  ...(row.scheduled_at && !row.delivered_at && !row.deleted_at
    ? { scheduledAt: new Date(row.scheduled_at).toISOString() }
    : {}),
  // v8 — thumbnail + retention tombstone (never emitted after delete).
  ...(row.thumb_url && !row.deleted_at && !row.media_expired_at
    ? { thumbUrl: row.thumb_url }
    : {}),
  ...(row.media_expired_at && !row.deleted_at
    ? { mediaExpiredAt: new Date(row.media_expired_at).toISOString() }
    : {}),
})

/** Human-readable one-liner for previews and reply quotes. */
const snippetOf = (
  row: Pick<
    MessageRow,
    'type' | 'content' | 'deleted_at' | 'file_name' | 'media_expired_at' | 'caption'
  >
): string => {
  if (row.deleted_at) return 'Pesan ini dihapus'
  if (row.media_expired_at) return '⏳ Media kedaluwarsa'
  const type = row.type ?? 'text'
  // v20 — caption menang atas label generik untuk foto/file.
  if (type === 'image') return row.caption || '📷 Foto'
  if (type === 'voice') return '🎤 Pesan suara'
  if (type === 'file') return row.caption || `📎 ${row.file_name ?? 'File'}`
  return row.content
}

/** Grouped reactions for one message (message:updated payloads). */
const reactionsFor = (messageId: number): { emoji: string; userIds: string[] }[] => {
  const rows = db
    .query('SELECT user_id, emoji FROM message_reactions WHERE message_id = ?')
    .all(messageId) as Array<{ user_id: string; emoji: string }>
  const byEmoji = new Map<string, string[]>()
  for (const r of rows) {
    const users = byEmoji.get(r.emoji) ?? []
    users.push(r.user_id)
    byEmoji.set(r.emoji, users)
  }
  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }))
}

/** Attach grouped reactions to a batch of messages (single query). */
const attachReactions = (rows: MessageRow[], messages: ChatMessageApi[]) => {
  if (rows.length === 0) return
  const placeholders = rows.map(() => '?').join(',')
  const reRows = db
    .query(
      `SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`
    )
    .all(...rows.map((r) => r.id)) as Array<{ message_id: number; user_id: string; emoji: string }>
  if (reRows.length === 0) return
  const byMsg = new Map<number, Map<string, string[]>>()
  for (const r of reRows) {
    let byEmoji = byMsg.get(r.message_id)
    if (!byEmoji) {
      byEmoji = new Map()
      byMsg.set(r.message_id, byEmoji)
    }
    const users = byEmoji.get(r.emoji) ?? []
    users.push(r.user_id)
    byEmoji.set(r.emoji, users)
  }
  for (const msg of messages) {
    const byEmoji = byMsg.get(msg.id)
    if (byEmoji && byEmoji.size > 0) {
      msg.reactions = [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }))
    }
  }
}

/** Snapshot of the conversation's pinned message (or null). */
const pinnedSnapshotOf = (conversation: ConversationRow) => {
  const pid = conversation.pinned_message_id
  if (!pid) return null
  const row = db
    .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(pid, conversation.id) as MessageRow | null
  if (!row) return null
  return {
    id: row.id,
    senderId: row.sender_id,
    snippet: snippetOf(row),
    type: row.type ?? 'text',
  }
}

/** Fetch reply-quote snapshots for a batch of messages (single query). */
const attachReplyPreviews = (rows: MessageRow[], messages: ChatMessageApi[]) => {
  const ids = [...new Set(rows.filter((r) => r.reply_to_id).map((r) => r.reply_to_id as number))]
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const originals = db
    .query(
      `SELECT id, sender_id, content, type, deleted_at, file_name, media_expired_at FROM messages WHERE id IN (${placeholders})`
    )
    .all(...ids) as Array<
    Pick<MessageRow, 'id' | 'sender_id' | 'content' | 'type' | 'deleted_at' | 'file_name' | 'media_expired_at'>
  >
  const byId = new Map(originals.map((o) => [o.id, o]))
  for (const m of messages) {
    if (!m.replyToId) continue
    const o = byId.get(m.replyToId)
    if (o) m.replyTo = { id: o.id, senderId: o.sender_id, snippet: snippetOf(o), type: o.type ?? 'text' }
  }
}

const toPartnerInfo = (user: UserRow, viewerId?: string): PartnerInfoApi => ({
  id: user.id,
  name: user.name,
  online: isOnline(user.id),
  // v11 — users may see a fake last-seen for the admin (fake_last_seen).
  lastSeenAt: lastSeenFor(viewerId ?? user.id, user.id, new Date(user.last_seen_at).toISOString()),
})

/** Ordered pair so a conversation between two users is unique. */
const pairKey = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])

const findUserById = (id: string): UserRow | null =>
  (db.query('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null) ?? null

/** Lookup restricted to one role (the admin account is unreachable via login). */
const findUserByRoleAndId = (id: string, role: string): UserRow | null =>
  (db.query('SELECT * FROM users WHERE id = ? AND role = ?').get(id, role) as UserRow | null) ?? null

const findUserByRoleAndName = (name: string, role: string): UserRow | null =>
  (db
    .query('SELECT * FROM users WHERE lower(name) = lower(?) AND role = ? LIMIT 1')
    .get(name, role) as UserRow | null) ?? null

const getConversation = (conversationId: string): ConversationRow | null =>
  (db
    .query('SELECT * FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationRow | null) ?? null

const findConversationBetween = (a: string, b: string): ConversationRow | null => {
  const [low, high] = pairKey(a, b)
  return (
    (db
      .query('SELECT * FROM conversations WHERE user_a_id = ? AND user_b_id = ?')
      .get(low, high) as ConversationRow | null) ?? null
  )
}

/** Get-or-create the (only) conversation between a user and the admin. */
const ensureConversationWithAdmin = (userId: string): ConversationRow => {
  const existing = findConversationBetween(userId, ADMIN_ID)
  if (existing) return existing
  const [a, b] = pairKey(userId, ADMIN_ID)
  const id = crypto.randomUUID()
  const ts = now()
  db.run(
    'INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)',
    [id, a, b, ts, ts]
  )
  console.log(`Conversation ${id} ensured: ${a} <-> ${b}`)
  return { id, user_a_id: a, user_b_id: b, created_at: ts, last_message_at: ts, archived_at: null, pinned_message_id: null }
}

const getPartnerId = (conversation: ConversationRow, userId: string) =>
  conversation.user_a_id === userId ? conversation.user_b_id : conversation.user_a_id

const isParticipant = (conversation: ConversationRow, userId: string) =>
  conversation.user_a_id === userId || conversation.user_b_id === userId

const getPartnerUser = (conversation: ConversationRow, userId: string): UserRow => {
  const partner = findUserById(getPartnerId(conversation, userId))
  if (!partner) throw new Error(`Partner of conversation ${conversation.id} missing`)
  return partner
}

/**
 * One history page (v8): the newest `limit` messages of `conversationId`,
 * optionally ending just before `beforeId` (exclusive), ascending. Reply
 * previews + reactions are attached and `hasMore` reports whether even
 * older pages exist — clients load them via `messages:older` on demand.
 */
const getMessagesPage = (
  conversationId: string,
  beforeId?: number,
  limit = HISTORY_PAGE_SIZE,
  /* v22 — pesan terjadwal orang lain yang belum terkirim disembunyikan. */
  viewerId?: string
): { messages: ChatMessageApi[]; hasMore: boolean } => {
  // v40 — pesan pending (moderasi pra-kirim) disembunyikan dari viewer user;
  // admin tetap melihatnya agar bisa menyetujui/menolak.
  const pendingHide = viewerId && viewerId !== ADMIN_ID ? ' AND (pending IS NULL OR pending = 0)' : ''
  const viewerFilter = viewerId
    ? ` AND (scheduled_at IS NULL OR delivered_at IS NOT NULL OR sender_id = ?)${pendingHide}`
    : ''
  const fetched = (
    beforeId
      ? (db
          .query(
            `SELECT * FROM (
               SELECT * FROM messages WHERE conversation_id = ? AND id < ?${viewerFilter}
               ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`
          )
          .all(...(viewerId ? [conversationId, beforeId, viewerId] : [conversationId, beforeId]), limit + 1) as MessageRow[])
      : (db
          .query(
            `SELECT * FROM (
               SELECT * FROM messages WHERE conversation_id = ?${viewerFilter}
               ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`
          )
          .all(...(viewerId ? [conversationId, viewerId] : [conversationId]), limit + 1) as MessageRow[])
  )
  const hasMore = fetched.length > limit
  // The extra row is the OLDEST of the DESC fetch → drop it (ASC order).
  const rows = hasMore ? fetched.slice(1) : fetched
  const messages = rows.map(toChatMessage)
  attachReplyPreviews(rows, messages)
  attachReactions(rows, messages)
  return { messages, hasMore }
}

/** Current last_read_message_id for (conversation, user). */
const getReadUpTo = (conversationId: string, userId: string): number =>
  ((db
    .query('SELECT last_read_message_id FROM reads WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId) as { last_read_message_id?: number } | null)
    ?.last_read_message_id ?? 0)

/** Upsert reads.last_read_message_id = GREATEST(existing, upTo). */
const markRead = (conversationId: string, userId: string, upTo?: number) => {
  const target =
    upTo ??
    ((db
      .query('SELECT MAX(id) AS max_id FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { max_id: number | null }).max_id ?? 0)
  db.run(
    `INSERT INTO reads (conversation_id, user_id, last_read_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(conversation_id, user_id)
     DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
    [conversationId, userId, target]
  )
  return target
}

/**
 * Tell the OTHER side how far `readerId` has read, so their own bubbles
 * upgrade ✓ → ✓✓ in real time. Users' reads interest the admins room;
 * the admin's reads interest the human user.
 */
const broadcastRead = (conversation: ConversationRow, readerId: string, target: number) => {
  const payload = { conversationId: conversation.id, userId: readerId, lastReadMessageId: target }
  if (readerId === ADMIN_ID) {
    io.to(`user:${getPartnerId(conversation, readerId)}`).emit('read:update', payload)
  } else {
    io.to('admins').emit('read:update', payload)
  }
}

/** Full conversation list for one user, newest activity first. Includes
 *  zero-message conversations (LEFT JOIN) so a fresh user shows up. */
const getConversationsFor = (userId: string): ConversationOverviewApi[] => {
  const rows = db
    .query(
      `SELECT
        c.id,
        c.last_message_at,
        c.archived_at,
        c.pinned_message_id,
        CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END AS partner_id,
        p.name AS partner_name,
        p.last_seen_at AS partner_last_seen,
        lm.id AS last_id,
        lm.sender_id AS last_sender,
        lm.content AS last_content,
        lm.created_at AS last_at,
        lm.type AS last_type,
        lm.deleted_at AS last_deleted,
        lm.file_name AS last_file_name,
        lm.media_expired_at AS last_media_expired,
        lm.caption AS last_caption,
        pm.id AS pin_id,
        pm.sender_id AS pin_sender,
        pm.content AS pin_content,
        pm.type AS pin_type,
        pm.deleted_at AS pin_deleted,
        pm.file_name AS pin_file_name,
        pu.name AS pin_sender_name,
        (SELECT r.last_read_message_id FROM reads r
          WHERE r.conversation_id = c.id
            AND r.user_id = (CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END)
        ) AS partner_read,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id != $me
            AND m.deleted_at IS NULL
            AND (m.scheduled_at IS NULL OR m.delivered_at IS NOT NULL)
            AND m.id > COALESCE(
              (SELECT r.last_read_message_id FROM reads r
               WHERE r.conversation_id = c.id AND r.user_id = $me), 0)
        ) AS unread
      FROM conversations c
      JOIN users p
        ON p.id = (CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END)
      LEFT JOIN messages lm
        ON lm.id = (SELECT m2.id FROM messages m2
                    WHERE m2.conversation_id = c.id
                      AND (m2.scheduled_at IS NULL OR m2.delivered_at IS NOT NULL)
                      AND ($me = 'admin' OR m2.pending IS NULL OR m2.pending = 0)
                    ORDER BY m2.id DESC LIMIT 1)
      LEFT JOIN messages pm
        ON pm.id = c.pinned_message_id
      LEFT JOIN users pu
        ON pu.id = pm.sender_id
      WHERE c.user_a_id = $me OR c.user_b_id = $me
      ORDER BY c.last_message_at DESC`
    )
    .all({ $me: userId }) as Array<{
    id: string
    last_message_at: number
    archived_at: number | null
    pinned_message_id: number | null
    partner_id: string
    partner_name: string
    partner_last_seen: number
    last_id: number | null
    last_sender: string | null
    last_content: string | null
    last_at: number | null
    last_type: string | null
    last_deleted: number | null
    last_file_name: string | null
    last_media_expired: number | null
    last_caption: string | null
    pin_id: number | null
    pin_sender: string | null
    pin_content: string | null
    pin_type: string | null
    pin_deleted: number | null
    pin_file_name: string | null
    pin_sender_name: string | null
    partner_read: number | null
    unread: number
  }>

  return rows.map((r) => ({
    id: r.id,
    partner: {
      id: r.partner_id,
      name: r.partner_name,
      online: isOnline(r.partner_id),
      // v11 — a user viewer may get the admin's fake last-seen here.
      lastSeenAt: lastSeenFor(userId, r.partner_id, new Date(r.partner_last_seen).toISOString()),
    },
    lastMessage:
      r.last_id != null
        ? {
            id: r.last_id,
            senderId: r.last_sender as string,
            content: r.last_deleted ? '' : (r.last_content as string),
            createdAt: new Date(r.last_at as number).toISOString(),
            type: r.last_type ?? 'text',
            deleted: !!r.last_deleted,
            ...(r.last_file_name && !r.last_deleted
              ? { fileName: r.last_file_name }
              : {}),
            ...(r.last_caption && !r.last_deleted ? { caption: r.last_caption } : {}),
            ...(r.last_media_expired != null && !r.last_deleted
              ? { mediaExpired: true }
              : {}),
          }
        : null,
    lastMessageAt: new Date(r.last_message_at).toISOString(),
    unread: r.unread,
    partnerLastReadId: r.partner_read ?? 0,
    archived: r.archived_at != null,
    pinnedMessageId: r.pinned_message_id ?? null,
    pinned:
      r.pin_id != null
        ? {
            id: r.pin_id,
            senderId: r.pin_sender as string,
            snippet: snippetOf({
              type: r.pin_type ?? 'text',
              content: r.pin_content ?? '',
              deleted_at: r.pin_deleted,
              file_name: r.pin_file_name,
            }),
            type: r.pin_type ?? 'text',
          }
        : null,
    // v11 — rich pinned snapshot (sender display name included).
    pinnedMessage:
      r.pin_id != null
        ? {
            messageId: r.pin_id,
            senderId: r.pin_sender as string,
            senderName: r.pin_sender_name ?? '',
            snippet: snippetOf({
              type: r.pin_type ?? 'text',
              content: r.pin_content ?? '',
              deleted_at: r.pin_deleted,
              file_name: r.pin_file_name,
            }),
            type: r.pin_type ?? 'text',
          }
        : null,
  }))
}

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

const onlineSockets = new Map<string, Set<string>>() // userId -> socket ids

/**
 * v11 — `always_online` fake signal: the ADMIN counts as online even with
 * zero live sockets while the setting is on.
 */
const isOnline = (userId: string) => {
  if (userId === ADMIN_ID && getBoolSetting('always_online')) return true
  return (onlineSockets.get(userId)?.size ?? 0) > 0
}

/** Adds a socket for the user. Returns true if the user just came online. */
const addOnlineSocket = (userId: string, socketId: string) => {
  const set = onlineSockets.get(userId) ?? new Set<string>()
  const becameOnline = set.size === 0
  set.add(socketId)
  onlineSockets.set(userId, set)
  return becameOnline
}

/** Removes a socket. Returns true if the user just went offline. */
const removeOnlineSocket = (userId: string, socketId: string) => {
  const set = onlineSockets.get(userId)
  if (!set) return false
  set.delete(socketId)
  if (set.size === 0) {
    onlineSockets.delete(userId)
    return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Message persistence + fan-out (human sends: text/image/voice/file)  */
/* ------------------------------------------------------------------ */

type MessageType = 'text' | 'image' | 'voice' | 'file' | 'system'

/* ------------------------------------------------------------------ */
/* v8 guards — per-account rate limits + storage quota                 */
/* ------------------------------------------------------------------ */

/** Sliding 1-minute windows per user + bucket ("text" / "media"). */
const rateBuckets = new Map<string, number[]>()
const rateAllowed = (userId: string, bucket: string, max: number): boolean => {
  const key = `${bucket}:${userId}`
  const cutoff = now() - 60_000
  const stamps = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff)
  if (stamps.length >= max) {
    rateBuckets.set(key, stamps) // keep pruned list even when rejected
    return false
  }
  stamps.push(now())
  rateBuckets.set(key, stamps)
  if (rateBuckets.size > 5000) rateBuckets.clear() // crude memory cap
  return true
}

/** Total bytes of live disk media owned by `userId` (v8 storage quota). */
const storedMediaBytes = (userId: string): number =>
  ((db
    .query(
      `SELECT COALESCE(SUM(file_size), 0) AS total FROM messages
       WHERE sender_id = ? AND file_size IS NOT NULL
         AND deleted_at IS NULL AND media_expired_at IS NULL`
    )
    .get(userId) as { total: number | null })?.total ?? 0)

/** v39 — kuota media efektif: kuota khusus per-user (MiB) bila diatur
 * admin (admin:user_quota), selain itu default global QUOTA_BYTES. */
const effectiveQuotaBytes = (
  user?: Pick<UserRow, 'media_quota_mb'> | null
): number => {
  const mb = Math.max(0, Math.round(user?.media_quota_mb ?? 0))
  return mb > 0 ? mb * 1024 * 1024 : QUOTA_BYTES
}

/* ------------------------------------------------------------------ */
/* Pusat (v20) — reset aplikasi & pemulihan backup                     */
/* ------------------------------------------------------------------ */

/** Kolom messages yang dipulihkan dari backup (urutan = urutan INSERT). */
const RESTORE_MESSAGE_COLUMNS = [
  'id',
  'conversation_id',
  'sender_id',
  'content',
  'created_at',
  'type',
  'reply_to_id',
  'duration_ms',
  'transcript',
  'deleted_at',
  'edited_at',
  'translation',
  'file_name',
  'file_size',
  'mime_type',
  'thumb_url',
  'media_expired_at',
  'deleted_content',
  'edit_history',
  'flagged',
  'caption',
] as const

const scalarCount = (sql: string): number =>
  Number((db.query(sql).get() as { v: number | null } | undefined)?.v ?? 0)

/**
 * v20 — hapus seluruh data chat: pesan, reaksi, baca, percakapan, langganan
 * push, pengguna non-admin, dan pengaturan (kunci vapid dipertahankan).
 * TANPA transaksi — pemanggil yang membungkus BEGIN/COMMIT sesuai konteks.
 */
const wipeChatData = (): {
  messages: number
  conversations: number
  users: number
  settings: number
} => {
  const before = {
    messages: scalarCount('SELECT COUNT(*) AS v FROM messages'),
    conversations: scalarCount('SELECT COUNT(*) AS v FROM conversations'),
    users: scalarCount(`SELECT COUNT(*) AS v FROM users WHERE id != '${ADMIN_ID}'`),
    settings: scalarCount('SELECT COUNT(*) AS v FROM settings'),
  }
  db.run('DELETE FROM messages')
  db.run('DELETE FROM message_reactions')
  db.run('DELETE FROM reads')
  db.run('DELETE FROM conversations')
  db.run('DELETE FROM push_subscriptions')
  db.run(`DELETE FROM users WHERE id != '${ADMIN_ID}'`)
  db.run(`DELETE FROM settings WHERE key NOT LIKE 'vapid%'`)
  // AUTOINCREMENT messages mulai lagi dari 1 setelah reset/restore.
  db.run(`DELETE FROM sqlite_sequence WHERE name = 'messages'`)
  return before
}

/** v20 — hapus semua file media di db/media; kembalikan (jumlah, byte). */
const purgeMediaFiles = (): { count: number; bytes: number } => {
  let count = 0
  let bytes = 0
  try {
    for (const entry of readdirSync(MEDIA_DIR)) {
      try {
        const path = join(MEDIA_DIR, entry)
        const st = statSync(path)
        if (!st.isFile()) continue
        bytes += st.size
        unlinkSync(path)
        count += 1
      } catch {
        /* satu file gagal — lanjutkan sisanya */
      }
    }
  } catch {
    /* direktori tidak ada — tidak ada yang dihapus */
  }
  return { count, bytes }
}

/* Validasi longgar baris backup: baris rusak dilewati, sisanya dipulihkan. */
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isValidBackupUser = (u: unknown): u is Record<string, unknown> =>
  !!u && typeof u === 'object' && isStr((u as Record<string, unknown>).id) &&
  isStr((u as Record<string, unknown>).name)

const isValidBackupConversation = (c: unknown): c is Record<string, unknown> => {
  if (!c || typeof c !== 'object') return false
  const r = c as Record<string, unknown>
  return (
    isStr(r.id) &&
    isStr(r.user_a_id) &&
    isStr(r.user_b_id) &&
    isNum(r.created_at) &&
    isNum(r.last_message_at)
  )
}

const isValidBackupMessage = (m: unknown): m is Record<string, unknown> => {
  if (!m || typeof m !== 'object') return false
  const r = m as Record<string, unknown>
  return (
    isNum(r.id) &&
    (r.id as number) > 0 &&
    isStr(r.conversation_id) &&
    isStr(r.sender_id) &&
    typeof r.content === 'string' &&
    isNum(r.created_at)
  )
}

const isValidBackupSetting = (s: unknown): s is { key: string; value: string } => {
  if (!s || typeof s !== 'object') return false
  const r = s as Record<string, unknown>
  return isStr(r.key) && typeof r.value === 'string' && !r.key.startsWith('vapid')
}


const insertAndFanOut = (
  conversation: ConversationRow,
  senderId: string,
  content: string,
  type: MessageType,
  opts: {
    replyToId?: number
    durationMs?: number
    /* v7/v8 — media metadata (file always; image/voice when disk-backed). */
    fileName?: string
    fileSize?: number
    mimeType?: string
    /* v8 — tiny preview URL for photos/videos. */
    thumbUrl?: string
    /* v11 — 1 when the text matched an admin keyword (silent flag). */
    flagged?: number
    /* v20 — caption teks opsional untuk pesan foto/file. */
    caption?: string
    /* v22 — label "Diteruskan dari …" untuk pesan hasil forward admin. */
    forwardedFrom?: string
    /* v25 — Pusat Cheat: timestamp custom untuk pesan spoof/backdate. */
    ts?: number
  } = {}
): ChatMessageApi => {
  const ts = opts.ts ?? now()
  const hasMediaMeta = type === 'file' || type === 'image' || type === 'voice'
  const hasCaption = type === 'file' || type === 'image'
  const result = db.run(
    'INSERT INTO messages (conversation_id, sender_id, content, created_at, type, reply_to_id, duration_ms, file_name, file_size, mime_type, thumb_url, flagged, caption, forwarded_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      conversation.id,
      senderId,
      content,
      ts,
      type,
      opts.replyToId ?? null,
      opts.durationMs ?? null,
      hasMediaMeta ? (opts.fileName ?? null) : null,
      hasMediaMeta && typeof opts.fileSize === 'number' ? opts.fileSize : null,
      hasMediaMeta ? (opts.mimeType ?? null) : null,
      opts.thumbUrl ?? null,
      opts.flagged ?? 0,
      hasCaption ? (opts.caption ?? null) : null,
      opts.forwardedFrom ?? null,
    ]
  )
  db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [ts, conversation.id])
  const id = Number(result.lastInsertRowid)
  markRead(conversation.id, senderId, id) // sender has "read" up to own message

  const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow
  const message = toChatMessage(row)
  attachReplyPreviews([row], [message])

  // (`user:admin` is empty — the admins room carries admin-side delivery.)
  io.to(`user:${conversation.user_a_id}`).emit('message:new', message)
  io.to(`user:${conversation.user_b_id}`).emit('message:new', message)
  io.to('admins').emit('message:new', message)
  pushConversationsTo(conversation.user_a_id)
  pushConversationsTo(conversation.user_b_id)

  // Web Push for recipients with zero live sockets (v5).
  if (type !== 'system') {
    const senderName = findUserById(senderId)?.name ?? 'ChatKita'
    const body = snippetOf(row)
    for (const rid of [conversation.user_a_id, conversation.user_b_id]) {
      if (rid === senderId) continue
      pushNewMessageIfOffline(rid, senderName, body)
    }
  }
  return message
}

/* v39 — bot balasan otomatis per-user: ketika user mengirim pesan ke
 * percakapan yang memuat Admin, server membalas ATAS NAMA ADMIN dengan teks
 * yang disiapkan admin setelah jeda tertentu. Konfigurasi per-user disimpan
 * di DB (users.bot_reply_*, diatur via admin:user_bot). Satu timer pending
 * per user — pesan beruntun tidak menumpuk balasan. */
const pendingBotTimers = new Map<string, ReturnType<typeof setTimeout>>()
const clearBotTimer = (userId: string) => {
  const t = pendingBotTimers.get(userId)
  if (t) {
    clearTimeout(t)
    pendingBotTimers.delete(userId)
  }
}
const scheduleBotReply = (userRow: UserRow, conversation: ConversationRow) => {
  if ((userRow.bot_reply_on ?? 0) !== 1) return
  const text = (userRow.bot_reply_text ?? '').trim()
  if (!text) return
  if (pendingBotTimers.has(userRow.id)) return
  const delayMs = Math.min(120_000, Math.max(0, Math.round(userRow.bot_reply_delay_ms ?? 3000)))
  const timer = setTimeout(() => {
    pendingBotTimers.delete(userRow.id)
    const fresh = findUserById(userRow.id)
    if (!fresh || (fresh.bot_reply_on ?? 0) !== 1) return
    insertAndFanOut(conversation, ADMIN_ID, text, 'text')
    console.log(`[bot] balasan otomatis -> ${fresh.name} (jeda ${Math.round(delayMs / 1000)} dtk)`)
  }, delayMs)
  pendingBotTimers.set(userRow.id, timer)
}

/* ------------------------------------------------------------------ */
/* v40 — pusat kendali per-user: shared helpers                        */
/* ------------------------------------------------------------------ */

/** Parse daftar kata terlarang user (dipisah baris baru / koma). */
const wordFilterWords = (user: Pick<UserRow, 'word_filter'>): string[] =>
  (user.word_filter ?? '')
    .split(/[\n,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && w.length <= 60)
    .slice(0, 100)

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * v40 — terapkan filter kata ke teks pesan. 'block' → return null (pesan
 * ditolak); 'censor' → return teks dengan kata yang cocok jadi '***'.
 */
const applyWordFilter = (
  user: Pick<UserRow, 'word_filter' | 'word_filter_action'>,
  text: string
): { blocked: boolean; text: string } => {
  const words = wordFilterWords(user)
  if (words.length === 0) return { blocked: false, text }
  const action = user.word_filter_action === 'censor' ? 'censor' : 'block'
  const lower = text.toLowerCase()
  const hit = words.find((w) => lower.includes(w.toLowerCase()))
  if (!hit) return { blocked: false, text }
  if (action === 'block') return { blocked: true, text }
  const pattern = new RegExp(words.map(escapeRegExp).join('|'), 'gi')
  return { blocked: false, text: text.replace(pattern, '***') }
}

/** v40 — peringatan kuota 80% / 95%: sekali per ambang per user per boot. */
const quotaWarnLevel = new Map<string, number>()
const maybeEmitQuotaWarn = (sender: UserRow) => {
  const quota = effectiveQuotaBytes(sender)
  if (quota <= 0) return
  const used = storedMediaBytes(sender.id)
  const pct = (used / quota) * 100
  const level = pct >= 95 ? 95 : pct >= 80 ? 80 : 0
  const prev = quotaWarnLevel.get(sender.id) ?? 0
  if (level > prev) {
    quotaWarnLevel.set(sender.id, level)
    io.to('admins').emit('admin:quota_warn', {
      userId: sender.id,
      userName: sender.name,
      pct: level,
      usedBytes: used,
      quotaBytes: quota,
    })
    console.log(`[kuota] ${sender.name} mencapai ${level}% (${used}/${quota} B)`)
  } else if (level === 0 && prev > 0) {
    quotaWarnLevel.delete(sender.id) // longgar lagi → boleh memperingatkan lagi
  }
}

/** v40 — feed aktivitas live: catatan singkat aksi user ke room admin. */
const emitActivity = (userId: string, kind: 'login' | 'message' | 'read', detail: string) => {
  try {
    io.to('admins').emit('admin:activity', {
      userId,
      kind,
      detail: detail.slice(0, 160),
      at: new Date(now()).toISOString(),
    })
  } catch {
    /* feed tidak boleh menggagalkan alur utama */
  }
}

/** v40 — percakapan 1-on-1 admin↔user (dibuat bila belum ada). */
const adminConversationWith = (userId: string): ConversationRow =>
  ensureConversationWithAdmin(userId)

/** v40 — kirim pesan teks ATAS NAMA ADMIN ke user tertentu (dipakai bot,
 * balasan cepat, pesan terjadwal, dan pengingat otomatis). */
const sendAsAdminToUser = (userId: string, text: string): ChatMessageApi | null => {
  const clean = text.trim()
  if (!clean) return null
  const conv = adminConversationWith(userId)
  return insertAndFanOut(conv, ADMIN_ID, clean, 'text')
}

/** v40 — cek kunci PIN percakapan utk admin: true bila percakapan ini
 * dikunci oleh admin dan socket ini belum membuka kuncinya. */
const isConvLockedForAdmin = (socket: IoSocket, conversation: ConversationRow): boolean => {
  const partnerId =
    conversation.user_a_id === ADMIN_ID ? conversation.user_b_id : conversation.user_a_id
  if (partnerId === ADMIN_ID) return false
  const partner = findUserById(partnerId)
  if (!partner?.pin_lock) return false
  const unlocked = socket.data?.unlockedPin as Set<string> | undefined
  return !(unlocked?.has(partnerId) ?? false)
}

/** v40 — kumpulkan media HIDUP milik user (semua percakapan) untuk ZIP. */
const collectUserMediaFiles = (
  userId: string
): { files: { name: string; bytes: Uint8Array }[]; totalBytes: number; skipped: number } => {
  const rows = db
    .query(
      `SELECT DISTINCT m.content FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.deleted_at IS NULL AND m.media_expired_at IS NULL
         AND m.type IN ('image','voice','file') AND m.file_name IS NOT NULL
         AND (c.user_a_id = ? OR c.user_b_id = ?)`
    )
    .all(userId, userId) as Array<{ content: string }>
  const files: { name: string; bytes: Uint8Array }[] = []
  let totalBytes = 0
  let skipped = 0
  for (const r of rows) {
    const name = r.content.split('/api/media/')[1]
    if (!name || name.includes('..') || name.includes('/')) {
      skipped += 1
      continue
    }
    try {
      const bytes = readFileSync(join(MEDIA_DIR, name))
      files.push({ name, bytes })
      totalBytes += bytes.byteLength
    } catch {
      skipped += 1
    }
  }
  return { files, totalBytes, skipped }
}

/* ------------------------------------------------------------------ */
/* AI helpers (z-ai-web-dev-sdk) — voice transcription + translation   */
/* ------------------------------------------------------------------ */

let zaiPromise: ReturnType<typeof ZAI.create> | null = null
const getZai = () => {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise
}

const llmComplete = async (system: string, user: string, maxLen = 700): Promise<string | null> => {
  try {
    const zai = await getZai()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion?.choices?.[0]?.message?.content?.trim()
    zaiPromise = null // don't pin a possibly-unhealthy instance forever
    return text && text.length > 0 ? text.slice(0, maxLen) : null
  } catch (err) {
    zaiPromise = null
    console.error('LLM error:', (err as Error)?.message ?? err)
    return null
  }
}

const asrTranscribe = async (dataUrl: string): Promise<string | null> => {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const zai = await getZai()
    const res = await zai.audio.asr.create({ file_base64: base64 })
    zaiPromise = null
    const text = res?.text?.trim()
    return text && text.length > 0 ? text.slice(0, 500) : null
  } catch (err) {
    zaiPromise = null
    console.error('ASR error:', (err as Error)?.message ?? err)
    return null
  }
}

/**
 * Resolve voice-message content into a data URL for the ASR engine.
 * Legacy rows carry data URLs directly; v8 rows point at db/media files,
 * whose bytes are read from the SHARED media directory on demand.
 */
const voiceDataUrlOf = (content: string): string | null => {
  if (content.startsWith('data:')) return content
  const m = /^\/api\/media\/([A-Za-z0-9._-]{1,120})$/.exec(content)
  if (!m) return null
  try {
    const bytes = readFileSync(join(MEDIA_DIR, m[1]))
    if (bytes.length === 0 || bytes.length > 25_000_000) return null
    const name = m[1]
    const mime = /\.(ogg|oga|opus)$/.test(name)
      ? 'audio/ogg'
      : /\.(mp4|m4a)$/.test(name)
        ? 'audio/mp4'
        : /\.wav$/.test(name)
          ? 'audio/wav'
          : 'audio/webm'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Best-effort voice-note transcription → `message:updated` broadcast. */
const transcribeVoice = async (messageId: number, conversationId: string, content: string) => {
  const dataUrl = voiceDataUrlOf(content)
  if (!dataUrl) return
  const text = await asrTranscribe(dataUrl)
  if (!text) return
  db.run('UPDATE messages SET transcript = ? WHERE id = ? AND deleted_at IS NULL', [text, messageId])
  const payload = { id: messageId, conversationId, transcript: text }
  const conv = getConversation(conversationId)
  if (!conv) return
  io.to(`user:${conv.user_a_id}`).emit('message:updated', payload)
  io.to(`user:${conv.user_b_id}`).emit('message:updated', payload)
  io.to('admins').emit('message:updated', payload)
  console.log(`Transcribed message ${messageId}: "${text.slice(0, 40)}…"`)
}

/* ------------------------------------------------------------------ */
/* v8 — retention sweeper (media aging) + SQLite housekeeping          */
/* ------------------------------------------------------------------ */

/** Stored media file name from a /api/media/<name> URL (null otherwise). */
const mediaNameOf = (content: string | null | undefined): string | null => {
  if (!content) return null
  const m = /^\/api\/media\/([A-Za-z0-9._-]{1,120})$/.exec(content)
  return m ? m[1] : null
}

/* ------------------------------------------------------------------ */
/* v26 — Pembaca metadata media (header file) untuk Peta Penyimpanan   */
/* ------------------------------------------------------------------ */

interface MediaMeta {
  width?: number
  height?: number
  durationMs?: number
  pages?: number
  /* v35 — waktu pembuatan video (mvhd creation time, MP4/MOV). */
  videoCreated?: string
  /* v35 — EXIF foto (GPS/kamera/lensa/tanggal/pencahayaan) via exifr. */
  exif?: ExifMeta
}

/** v35 — bagian EXIF yang disimpan (field opsional, semuanya best-effort). */
interface ExifMeta {
  gps?: { lat: number; lon: number }
  takenAt?: string
  make?: string
  model?: string
  lens?: string
  software?: string
  orientation?: number
  iso?: number
  fNumber?: number
  exposureTime?: number
  focalLength?: number
}

/** Baca header file media (maks 4 MiB) tanpa memuat seluruh file. */
const readMediaHeader = (name: string): Buffer | null => {
  try {
    const fd = openSync(join(MEDIA_DIR, name), 'r')
    try {
      const buf = Buffer.alloc(4 * 1024 * 1024)
      const bytes = readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, bytes)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

/** Dimensi gambar: PNG / GIF / WebP / JPEG (dari magic bytes). */
const parseImageMeta = (buf: Buffer): MediaMeta => {
  const meta: MediaMeta = {}
  try {
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      meta.width = buf.readUInt32BE(16)
      meta.height = buf.readUInt32BE(20)
    } else if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
      meta.width = buf.readUInt16LE(6)
      meta.height = buf.readUInt16LE(8)
    } else if (
      buf.length > 30 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    ) {
      const chunk = buf.toString('ascii', 12, 16)
      if (chunk === 'VP8X') {
        meta.width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
        meta.height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      } else if (chunk === 'VP8 ') {
        meta.width = buf.readUInt16LE(26) & 0x3fff
        meta.height = buf.readUInt16LE(28) & 0x3fff
      } else if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21)
        meta.width = (b & 0x3fff) + 1
        meta.height = ((b >> 14) & 0x3fff) + 1
      }
    } else if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG — pindai marker SOFn.
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++
          continue
        }
        const marker = buf[off + 1]
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          meta.height = buf.readUInt16BE(off + 5)
          meta.width = buf.readUInt16BE(off + 7)
          break
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
          off += 2
          continue
        }
        off += 2 + buf.readUInt16BE(off + 2)
      }
    }
  } catch {
    /* header tidak terbaca — biarkan kosong */
  }
  return meta
}

/** v35 — detik sejak 1904 (epoch MP4) → ISO 8601; undefined bila tak wajar. */
const MP4_EPOCH_OFFSET_S = 2_082_844_800 // 1904-01-01 → 1970-01-01
const mp4TimeToIso = (secs: number): string | undefined => {
  const ms = (secs + MP4_EPOCH_OFFSET_S) * 1000
  if (!Number.isFinite(ms) || ms < 946_684_800_000 || ms > Date.now() + 86_400_000) {
    return undefined
  }
  return new Date(ms).toISOString()
}

/** MP4/MOV — dimensi (tkhd) + durasi (mvhd), dipindai di 4 MiB pertama. */
const parseMp4Meta = (buf: Buffer): MediaMeta => {
  const meta: MediaMeta = {}
  try {
    const mvhd = buf.indexOf('mvhd')
    if (mvhd > 0) {
      const version = buf[mvhd + 4]
      if (version === 1) {
        // v35 — creation time (detik sejak 1904) → ISO.
        const created = Number(buf.readBigUInt64BE(mvhd + 12))
        const createdIso = created > 0 ? mp4TimeToIso(created) : undefined
        if (createdIso) meta.videoCreated = createdIso
        const timescale = buf.readUInt32BE(mvhd + 24)
        const duration = Number(buf.readBigUInt64BE(mvhd + 28))
        if (timescale > 0 && duration > 0) {
          meta.durationMs = Math.round((duration / timescale) * 1000)
        }
      } else {
        // v35 — creation time versi 0 (32-bit).
        const created = buf.readUInt32BE(mvhd + 12)
        const createdIso = created > 0 ? mp4TimeToIso(created) : undefined
        if (createdIso) meta.videoCreated = createdIso
        const timescale = buf.readUInt32BE(mvhd + 16)
        const duration = buf.readUInt32BE(mvhd + 20)
        if (timescale > 0 && duration > 0) {
          meta.durationMs = Math.round((duration / timescale) * 1000)
        }
      }
    }
    const tkhd = buf.indexOf('tkhd')
    if (tkhd > 0) {
      const version = buf[tkhd + 4]
      // 'tkhd' berada pada offset box+4 → width (fixed 16.16) ada di box+80
      // (v0) / box+88 (v1) = tkhd_idx+76 / tkhd_idx+84.
      const base = version === 1 ? tkhd + 84 : tkhd + 76
      const w = buf.readUInt32BE(base) / 65536
      const h = buf.readUInt32BE(base + 4) / 65536
      if (w > 0 && h > 0) {
        meta.width = Math.round(w)
        meta.height = Math.round(h)
      }
    }
  } catch {
    /* box tidak lengkap */
  }
  return meta
}

/** PDF — perkiraan jumlah halaman dari /Count pertama. */
const parsePdfMeta = (buf: Buffer): MediaMeta => {
  const meta: MediaMeta = {}
  try {
    const text = buf.toString('latin1', 0, Math.min(buf.length, 262_144))
    const m = /\/Count\s+(\d+)/.exec(text)
    if (m) meta.pages = Number(m[1])
  } catch {
    /* abaikan */
  }
  return meta
}

/** Metadata lengkap satu file media (null bila file hilang/tak dikenali). */
const extractMediaMeta = (name: string | null | undefined): MediaMeta | null => {
  if (!name) return null
  const buf = readMediaHeader(name)
  if (!buf || buf.length < 12) return null
  let meta: MediaMeta = {}
  if (buf.length > 8 && buf.toString('ascii', 4, 8) === 'ftyp') meta = parseMp4Meta(buf)
  else if (buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-') meta = parsePdfMeta(buf)
  else meta = parseImageMeta(buf)
  if (meta.durationMs != null && meta.durationMs <= 0) delete meta.durationMs
  return Object.keys(meta).length > 0 ? meta : null
}

/* v35 — EXIF foto (GPS/kamera/dst.) via exifr — best-effort, gagal = diam. */

/** True bila buffer tampak seperti gambar ber-EXIF (JPEG/HEIC/TIFF). */
const isExifCapableImage = (buf: Buffer): boolean => {
  if (buf.length < 12) return false
  // JPEG (FFD8), TIFF (II*/MM*), HEIC/HEIF/AVIF (ftyp + brand heic/heif/avif/mif1)
  if (buf[0] === 0xff && buf[1] === 0xd8) return true
  if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4d && buf[1] === 0x4d)) return true
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase()
    return /^(heic|heix|heif|mif1|msf1|avif)/.test(brand)
  }
  return false
}

/**
 * v35 — baca EXIF terpilih dari buffer gambar. Hanya tag yang relevan untuk
 * moderasi (lokasi, perangkat, waktu, pencahayaan) — hasil dibatasi ukurannya
 * (string ≤80 char) agar meta_json tetap ramping. Semua gagal → undefined.
 */
const extractExifMeta = async (buf: Buffer): Promise<ExifMeta | undefined> => {
  try {
    const parsed = (await exifr.parse(buf, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      reviveValues: true,
      translateValues: false,
    })) as Record<string, unknown> | undefined
    if (!parsed || typeof parsed !== 'object') return undefined
    const out: ExifMeta = {}
    const lat = typeof parsed.latitude === 'number' && Number.isFinite(parsed.latitude)
      ? Number(parsed.latitude.toFixed(7))
      : undefined
    const lon = typeof parsed.longitude === 'number' && Number.isFinite(parsed.longitude)
      ? Number(parsed.longitude.toFixed(7))
      : undefined
    // GPS 0,0 persis hampir selalu artinya "tidak ada sinyal" — abaikan.
    if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
      out.gps = { lat, lon }
    }
    const str = (v: unknown): string | undefined => {
      const s = typeof v === 'string' ? v.trim().slice(0, 80) : ''
      return s.length > 0 ? s : undefined
    }
    out.make = str(parsed.Make)
    out.model = str(parsed.Model)
    out.lens = str(parsed.LensModel)
    out.software = str(parsed.Software)
    if (typeof parsed.Orientation === 'number') out.orientation = parsed.Orientation
    if (typeof parsed.ISO === 'number' && Number.isFinite(parsed.ISO)) out.iso = parsed.ISO
    if (typeof parsed.FNumber === 'number' && Number.isFinite(parsed.FNumber)) {
      out.fNumber = Number(parsed.FNumber.toFixed(2))
    }
    if (typeof parsed.ExposureTime === 'number' && Number.isFinite(parsed.ExposureTime)) {
      out.exposureTime = parsed.ExposureTime
    }
    if (typeof parsed.FocalLength === 'number' && Number.isFinite(parsed.FocalLength)) {
      out.focalLength = Number(parsed.FocalLength.toFixed(1))
    }
    const takenRaw = parsed.DateTimeOriginal ?? parsed.CreateDate
    if (takenRaw instanceof Date && !Number.isNaN(takenRaw.getTime())) {
      out.takenAt = takenRaw.toISOString()
    }
    return Object.keys(out).length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

/**
 * v35 — simpan metadata media pesan (dimensi/durasi/halaman + videoCreated
 * + EXIF foto). Async karena exifr; dipanggil fire-and-forget saat pesan
 * media dikirim. Gagal = diam (meta dasar tetap tersimpan bila terbaca).
 */
const attachMediaMeta = async (messageId: number, content: string): Promise<void> => {
  try {
    const name = mediaNameOf(content)
    if (!name) return
    const meta = extractMediaMeta(name)
    const buf = readMediaHeader(name)
    if (meta && buf && isExifCapableImage(buf)) {
      const exif = await extractExifMeta(buf)
      if (exif) meta.exif = exif
    }
    if (meta && Object.keys(meta).length > 0) {
      db.run('UPDATE messages SET meta_json = ? WHERE id = ?', [JSON.stringify(meta), messageId])
    }
  } catch {
    /* metadata bersifat pelengkap — jangan pernah gagalkan pengiriman */
  }
}

/** Live references (content or thumb_url) to a stored media file. */
const mediaRefCount = (name: string): number =>
  ((db
    .query(
      `SELECT
        (SELECT COUNT(*) FROM messages
          WHERE content = ? AND deleted_at IS NULL AND media_expired_at IS NULL) +
        (SELECT COUNT(*) FROM messages
          WHERE thumb_url = ? AND deleted_at IS NULL AND media_expired_at IS NULL)
       AS refs`
    )
    .get(`/api/media/${name}`, `/api/media/${name}`) as { refs: number } | null)?.refs ?? 0)

/** Delete the disk file when nothing references it anymore (SHA-256 dedup
 *  means several messages may share one file — never delete shared copies). */
const releaseMediaFile = (name: string | null) => {
  if (!name) return
  try {
    if (mediaRefCount(name) === 0) {
      unlinkSync(join(MEDIA_DIR, name))
      console.log(`[retensi] file media dihapus: ${name}`)
    }
  } catch {
    /* missing file or still referenced — fine */
  }
}

/**
 * Expire media older than RETENTION_MS: redact payloads (content, thumb,
 * metadata), keep the message + text transcript as a "kedaluwarsa"
 * tombstone, free disk space, and notify both sides live.
 */
const sweepExpiredMedia = () => {
  // v36 — retensi 0 = media PERMANEN: tidak ada media yang dibersihkan.
  if (RETENTION_MS === 0) return
  const cutoff = now() - RETENTION_MS
  const rows = db
    .query(
      `SELECT id, conversation_id, content, thumb_url FROM messages
       WHERE media_expired_at IS NULL AND deleted_at IS NULL
         AND type IN ('image', 'voice', 'file') AND created_at < ?`
    )
    .all(cutoff) as Array<Pick<MessageRow, 'id' | 'conversation_id' | 'content' | 'thumb_url'>>
  if (rows.length === 0) return
  const ts = now()
  for (const row of rows) {
    // Redact FIRST so the row's own reference no longer counts in
    // mediaRefCount() — otherwise a single-message file is never freed.
    db.run(
      `UPDATE messages SET content = '', thumb_url = NULL, file_name = NULL,
         file_size = NULL, mime_type = NULL, media_expired_at = ? WHERE id = ?`,
      [ts, row.id]
    )
    const conv = getConversation(row.conversation_id)
    if (conv) {
      const payload = {
        id: row.id,
        conversationId: row.conversation_id,
        content: '',
        mediaExpiredAt: new Date(ts).toISOString(),
      }
      io.to(`user:${conv.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conv.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
    }
    // Then free the disk files when nothing live references them anymore.
    releaseMediaFile(mediaNameOf(row.content))
    releaseMediaFile(mediaNameOf(row.thumb_url))
  }
  console.log(`[retensi] ${rows.length} media kedaluwarsa dibersihkan`)
}

/** WAL checkpoint + VACUUM — return disk space and keep the DB lean. */
const dbMaintenance = () => {
  try {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    db.run('VACUUM')
    console.log('[maintenance] wal_checkpoint + VACUUM selesai')
  } catch (err) {
    console.error('[maintenance] gagal:', (err as Error)?.message ?? err)
  }
}

/* ------------------------------------------------------------------ */
/* Socket.io server                                                    */
/* ------------------------------------------------------------------ */

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ChatKita chat-service is running')
})

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  // image/voice messages travel as base64 data URLs; file bytes never pass
  // through here (out-of-band via POST /api/upload)
  maxHttpBufferSize: 6e6,
})

type AckFn = (res: unknown) => void

/**
 * Wraps a handler with flexible ack extraction (last function argument)
 * and a try/catch that acks SERVER_ERROR on unexpected exceptions.
 * The socket is bound via closure (handlers are created per connection).
 */
const handler =
  (socket: IoSocket, fn: (data: any, ack: AckFn) => void) =>
  (...args: unknown[]) => {
    const last = args[args.length - 1]
    const ack: AckFn = typeof last === 'function' ? (last as AckFn) : () => {}
    const data =
      args.length > 0 && typeof args[0] === 'object' && args[0] !== null ? args[0] : {}
    try {
      fn(data, ack)
    } catch (err) {
      console.error('Handler error:', err)
      ack({ ok: false, error: 'SERVER_ERROR' })
    }
  }

/** Authenticated user id for a socket (set by `user:auth` / `admin:auth`). */
const authedUserId = (socket: IoSocket): string | null => {
  const id = socket.data?.userId
  return typeof id === 'string' && id.length > 0 && !!findUserById(id) ? id : null
}

/**
 * Push the freshest conversation list to every socket in `userId`'s scope.
 * The admin's list goes to the `admins` room (covers all admin sockets);
 * a normal user's list goes to their personal room.
 */
const pushConversationsTo = (userId: string) => {
  const list = getConversationsFor(userId)
  if (userId === ADMIN_ID) io.to('admins').emit('conversations:update', list)
  else io.to(`user:${userId}`).emit('conversations:update', list)
}

const pinHash = (pin: string, userId: string) =>
  createHash('sha256').update(`${userId}:${pin}`).digest('hex')

/* ------------------------------------------------------------------ */
/* v11 — admin power features: shared helpers                          */
/* ------------------------------------------------------------------ */

/** Cap for export payloads (admin:export_conversation / admin:export_user). */
const MAX_EXPORT_MESSAGES = 5000
/** edit_history keeps at most this many previous revisions. */
const MAX_EDIT_HISTORY_ENTRIES = 50

/** v11 — append-only audit trail (admin:audit). Detail is trimmed hard. */
const audit = (action: string, detail: string) => {
  try {
    db.run('INSERT INTO audit_log (action, detail, at) VALUES (?, ?, ?)', [
      action,
      detail.slice(0, 400),
      now(),
    ])
  } catch (err) {
    console.error('[audit] gagal:', (err as Error)?.message ?? err)
  }
}

/* -------------------- v11 — connection metadata (xray) -------------------- */

interface ConnMeta {
  ip: string | null
  userAgent: string | null
  firstSeen: number
  socketIds: Set<string>
}

/** userId → last connection metadata. Memory only; cleaned on disconnect. */
const connMeta = new Map<string, ConnMeta>()

const firstForwardedIp = (socket: IoSocket): string | null => {
  const fwd = socket.handshake.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd : null
  const first = raw?.split(',')[0]?.trim()
  if (first) return first
  return typeof socket.handshake.address === 'string' ? socket.handshake.address : null
}

/** Remember ip / user-agent / socket ids for `userId` at auth time. */
const trackConnMeta = (socket: IoSocket, userId: string) => {
  const ip = firstForwardedIp(socket)
  const uaHeader = socket.handshake.headers['user-agent']
  const userAgent = typeof uaHeader === 'string' ? uaHeader : null
  const meta =
    connMeta.get(userId) ?? { ip, userAgent, firstSeen: now(), socketIds: new Set<string>() }
  meta.socketIds.add(socket.id)
  if (ip) meta.ip = ip
  if (userAgent) meta.userAgent = userAgent
  connMeta.set(userId, meta)
}

/** Drop one socket id; the whole entry is cleared with the user's last socket. */
const dropConnMeta = (userId: string, socketId: string) => {
  const meta = connMeta.get(userId)
  if (!meta) return
  meta.socketIds.delete(socketId)
  if (meta.socketIds.size === 0) connMeta.delete(userId)
}

/** Coarse platform guess derived from the user-agent string. */
const platformOf = (userAgent: string | null): string => {
  if (!userAgent) return 'unknown'
  if (/android/i.test(userAgent)) return 'Android'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS'
  if (/windows/i.test(userAgent)) return 'Windows'
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS'
  if (/linux/i.test(userAgent)) return 'Linux'
  return 'other'
}

/* ------------------ v11 — session control (restrictions) ------------------ */

/** Current restriction state of a user row (the admin is never restricted). */
const restrictionsOf = (user: UserRow) => ({
  frozen: (user.frozen ?? 0) === 1,
  mutedUntil:
    (user.muted_until ?? 0) > now() ? new Date(user.muted_until as number).toISOString() : null,
  slowMode: user.slow_mode ?? 0,
  mediaBlocked: (user.media_blocked ?? 0) === 1,
})

/**
 * Push `user:restricted` (fresh state) to every socket of `userId`.
 * Restriction-change handlers always push (so the UI can clear stale state);
 * the auth-time push only fires when at least one restriction is ACTIVE
 * (a clean login must not receive a pointless restriction event).
 */
const pushRestrictedTo = (userId: string, onlyWhenActive = false) => {
  const user = findUserById(userId)
  if (!user || userId === ADMIN_ID) return
  const state = restrictionsOf(user)
  const anyActive = state.frozen || !!state.mutedUntil || state.slowMode > 0 || state.mediaBlocked
  if (onlyWhenActive && !anyActive) return
  io.to(`user:${userId}`).emit('user:restricted', state)
}

/** Seconds until the oldest stamp in the user's sliding window expires. */
const rateRetryAfterSeconds = (userId: string, bucket: string): number => {
  const stamps = rateBuckets.get(`${bucket}:${userId}`) ?? []
  if (stamps.length === 0) return 1
  const oldest = Math.min(...stamps)
  return Math.max(1, Math.ceil((oldest + 60_000 - now()) / 1000))
}

/* --------------- v11 — shared delete pipeline (forensics-safe) --------------- */
/**
 * Soft-delete one message with the EXACT existing pipeline, extended for
 * v11 forensics: the original content is preserved in `deleted_content`
 * BEFORE redaction (only on the first delete — never overwritten later).
 * Broadcasts the same `message:updated` tombstone the old inline code sent.
 */
const tombstoneMessage = (row: MessageRow, conversation: ConversationRow, ts: number) => {
  db.run(
    `UPDATE messages SET
       deleted_content = CASE WHEN deleted_at IS NULL AND content != '' THEN content ELSE deleted_content END,
       content = '', transcript = NULL, file_name = NULL, file_size = NULL, mime_type = NULL,
       deleted_at = COALESCE(deleted_at, ?)
     WHERE id = ?`,
    [ts, row.id]
  )
  const payload = {
    id: row.id,
    conversationId: conversation.id,
    deletedAt: new Date(ts).toISOString(),
    content: '',
    type: row.type ?? 'text',
  }
  io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
  io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
  io.to('admins').emit('message:updated', payload)
  pushConversationsTo(conversation.user_a_id)
  pushConversationsTo(conversation.user_b_id)
}

/**
 * v29 — kosongkan SELURUH pesan satu percakapan memakai pipeline yang sama
 * dengan admin:reset_conversation: batch tombstone (original → deleted_content),
 * bebaskan file media yang tak lagi direferensikan, lalu lepas pin.
 * Return jumlah pesan yang dihapus. v30 — dipakai SATU-SATUNYA oleh
 * admin:reset_conversation (membersihkan chat kedua sisi khusus admin).
 */
const wipeConversationMessages = (conversation: ConversationRow): number => {
  const rows = db
    .query(
      'SELECT id, content, thumb_url FROM messages WHERE conversation_id = ? AND deleted_at IS NULL'
    )
    .all(conversation.id) as Array<Pick<MessageRow, 'id' | 'content' | 'thumb_url'>>
  const ts = now()
  if (rows.length > 0) {
    // Batched variant of the shared tombstone: originals land in
    // deleted_content, then everything is redacted in one statement.
    db.run(
      `UPDATE messages SET
         deleted_content = CASE WHEN content != '' THEN content ELSE deleted_content END,
         content = '', transcript = NULL, file_name = NULL, file_size = NULL, mime_type = NULL,
         deleted_at = ?
       WHERE conversation_id = ? AND deleted_at IS NULL`,
      [ts, conversation.id]
    )
    // Free disk media that no live message references anymore.
    for (const r of rows) {
      releaseMediaFile(mediaNameOf(r.content))
      releaseMediaFile(mediaNameOf(r.thumb_url))
    }
  }
  // A wiped conversation has nothing to pin anymore.
  applyConversationPin(conversation, null)
  return rows.length
}

/* ---------------------------- v11 — pin core ---------------------------- */

/**
 * Shared pin core for `conversation:pin` (v5) and the v11 `admin:pin` /
 * `admin:unpin` events. `messageId = null` clears the pin. Emits BOTH the
 * legacy `conversation:update` payload and the richer `conversation:pinned`.
 */
const applyConversationPin = (
  conversation: ConversationRow,
  messageId: number | null
): 'ok' | 'not_found' => {
  let pinned: { id: number; senderId: string; snippet: string; type: string } | null = null
  if (messageId != null) {
    const row = db
      .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, conversation.id) as MessageRow | null
    if (!row) return 'not_found'
    db.run('UPDATE conversations SET pinned_message_id = ? WHERE id = ?', [
      messageId,
      conversation.id,
    ])
    pinned = { id: row.id, senderId: row.sender_id, snippet: snippetOf(row), type: row.type ?? 'text' }
  } else {
    db.run('UPDATE conversations SET pinned_message_id = NULL WHERE id = ?', [conversation.id])
  }
  const pinnedMessage = pinned
    ? {
        messageId: pinned.id,
        senderId: pinned.senderId,
        senderName: findUserById(pinned.senderId)?.name ?? 'Admin',
        snippet: pinned.snippet,
        type: pinned.type,
      }
    : null
  const legacyPayload = {
    conversationId: conversation.id,
    pinnedMessageId: pinned?.id ?? null,
    pinned,
  }
  const payload = { conversationId: conversation.id, pinnedMessageId: pinned?.id ?? null, pinnedMessage }
  for (const userId of [conversation.user_a_id, conversation.user_b_id]) {
    io.to(`user:${userId}`).emit('conversation:update', legacyPayload)
    io.to(`user:${userId}`).emit('conversation:pinned', payload)
  }
  io.to('admins').emit('conversation:update', legacyPayload)
  io.to('admins').emit('conversation:pinned', payload)
  pushConversationsTo(conversation.user_a_id)
  pushConversationsTo(conversation.user_b_id)
  return 'ok'
}

/* -------------------------- v11 — intel builders -------------------------- */

/** Shared profile builder for `admin:xray` and `admin:export_user`. */
const buildXrayProfile = (userId: string) => {
  const user = findUserById(userId)
  if (!user) return null
  const counts = db
    .query(
      `SELECT COUNT(*) AS messages,
              COALESCE(SUM(CASE WHEN type IN ('image','voice','file') THEN 1 ELSE 0 END), 0) AS media,
              COALESCE(SUM(CASE WHEN file_size IS NOT NULL AND deleted_at IS NULL AND media_expired_at IS NULL THEN file_size ELSE 0 END), 0) AS bytes,
              MAX(created_at) AS last_at
         FROM messages WHERE sender_id = ?`
    )
    .get(userId) as { messages: number; media: number; bytes: number; last_at: number | null }
  const meta = connMeta.get(userId)
  return {
    id: user.id,
    name: user.name,
    createdAt: new Date(user.created_at).toISOString(),
    lastSeen: new Date(user.last_seen_at).toISOString(),
    online: isOnline(user.id),
    socketCount: onlineSockets.get(user.id)?.size ?? 0,
    messageCount: Number(counts.messages ?? 0),
    mediaCount: Number(counts.media ?? 0),
    mediaBytes: Number(counts.bytes ?? 0),
    lastMessageAt: counts.last_at ? new Date(counts.last_at).toISOString() : null,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
    platform: platformOf(meta?.userAgent ?? null),
    /* v39 — kendali per-user: kuota khusus + bot balasan otomatis. */
    mediaQuotaMb: Math.max(0, Math.round(user.media_quota_mb ?? 0)),
    botReplyOn: (user.bot_reply_on ?? 0) === 1,
    botReplyText: (user.bot_reply_text ?? '').trim() || null,
    botReplyDelaySec: Math.min(
      120,
      Math.max(0, Math.round((user.bot_reply_delay_ms ?? 3000) / 1000))
    ),
    /* v40 — pusat kendali per-user. */
    adminNote: (user.admin_note ?? '').trim() || null,
    tag: ['vip', 'attention', 'problem'].includes(user.tag ?? '') ? (user.tag as string) : '',
    wordFilter: (user.word_filter ?? '').trim() || null,
    wordFilterAction: user.word_filter_action === 'censor' ? 'censor' : 'block',
    approvalMode: (user.approval_mode ?? 0) === 1,
    blockedMediaTypes: (user.blocked_media_types ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    quickReplies: (() => {
      try {
        const arr = JSON.parse(user.quick_replies ?? '[]')
        return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 20) : []
      } catch {
        return []
      }
    })(),
    nudgeDays: Math.max(0, Math.round(user.nudge_days ?? 0)),
    nudgeText: (user.nudge_text ?? '').trim() || null,
    autoCleanDays: Math.max(0, Math.round(user.auto_clean_days ?? 0)),
    pinLockSet: !!user.pin_lock,
  }
}

/** Shared per-user stats builder (admin:user_stats / admin:export_user). */
const buildUserStats = (userId: string) => {
  const nowMs = now()
  const DAY_MS = 86_400_000
  const dailyRows = db
    .query(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS c
       FROM messages WHERE sender_id = ? AND deleted_at IS NULL AND created_at >= ?
       GROUP BY day`
    )
    .all(userId, nowMs - 13 * DAY_MS) as { day: number; c: number }[]
  const dailyMap = new Map(dailyRows.map((r) => [r.day, r.c]))
  const perDay: { day: string; count: number }[] = []
  for (let i = 13; i >= 0; i -= 1) {
    const epochDay = Math.floor(nowMs / DAY_MS) - i
    perDay.push({
      day: new Date(epochDay * DAY_MS).toISOString().slice(0, 10),
      count: dailyMap.get(epochDay) ?? 0,
    })
  }
  const hourlyRows = db
    .query(
      `SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS c
       FROM messages WHERE sender_id = ? AND deleted_at IS NULL AND created_at >= ?
       GROUP BY h`
    )
    .all(userId, nowMs - 7 * DAY_MS) as { h: number; c: number }[]
  const topHours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  for (const r of hourlyRows) {
    if (r.h >= 0 && r.h < 24) topHours[r.h].count = r.c
  }
  const totals = db
    .query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN type IN ('image','voice','file') THEN 1 ELSE 0 END), 0) AS media
         FROM messages WHERE sender_id = ? AND deleted_at IS NULL`
    )
    .get(userId) as { total: number; media: number }
  return {
    perDay,
    topHours,
    total: Number(totals.total ?? 0),
    media: Number(totals.media ?? 0),
  }
}

/* ------------------- v37 — insight per-pengguna (admin) ------------------- */

/** WIB (UTC+7): jam/hari insight mengikuti kebiasaan pengguna Indonesia. */
const WIB_OFFSET_MS = 7 * 3_600_000
const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const MONTH_NAMES_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const MEDIA_TYPE_LABEL_ID: Record<string, string> = {
  image: 'foto',
  voice: 'catatan suara',
  file: 'file',
  video: 'video',
}

/** ms → teks durasi ringkas Indonesia (61_000 → "1 menit", 90d → "3 jam"). */
const fmtDurId = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} dtk`
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} menit`
  const h = Math.round(ms / 3_600_000)
  if (h < 24) return `${h} jam`
  return `${Math.round(h / 24)} hari`
}

const fmtBytesId = (b: number) =>
  b >= 1_048_576
    ? `${(b / 1_048_576).toFixed(1)} MB`
    : b >= 1024
      ? `${Math.round(b / 1024)} KB`
      : `${b} B`

/** Tanggal Indonesia ringkas (WIB): 4 Sep 2026. */
const fmtDayId = (ms: number) => {
  const d = new Date(ms + WIB_OFFSET_MS)
  return `${d.getUTCDate()} ${MONTH_NAMES_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * v37 — bangun "insight" satu pengguna utk panel admin: agregat pesan
 * percakapan user↔admin (totals, histogram jam/hari WIB, streak, jeda
 * terpanjang), kecepatan membalas berpasangan (cap 12 jam), persentase
 * baca, reaksi, tren 7 vs 7 hari, plus 4–8 butir "ide" otomatis berbahasa
 * Indonesia. null bila user/percakapan tidak ada.
 */
const buildUserInsight = (userId: string) => {
  const DAY = 86_400_000
  const nowMs = now()
  const user = db
    .query('SELECT id, name, role, created_at, last_seen_at FROM users WHERE id = ?')
    .get(userId) as
    | { id: string; name: string; role: string; created_at: number; last_seen_at: number }
    | undefined
  if (!user) return null
  const conv = db
    .query(
      `SELECT id FROM conversations
       WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')`
    )
    .get(userId, userId) as { id: string } | undefined
  if (!conv) return null

  const rows = db
    .query(
      `SELECT id, sender_id, type, content, file_size, created_at
       FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all(conv.id) as Array<{
    id: number
    sender_id: string
    type: string
    content: string
    file_size: number | null
    created_at: number
  }>

  let userMsgs = 0
  let adminMsgs = 0
  let mediaCount = 0
  let mediaBytes = 0
  let textChars = 0
  let firstAt: number | null = null
  let lastAt: number | null = null
  const byType: Record<string, number> = {}
  const hours = Array.from({ length: 24 }, () => 0)
  const weekdays = Array.from({ length: 7 }, () => 0)
  const activeDays = new Set<number>()

  for (const r of rows) {
    if (firstAt === null) firstAt = r.created_at
    lastAt = r.created_at
    if (r.sender_id === userId) {
      userMsgs += 1
      const t = r.type || 'text'
      byType[t] = (byType[t] ?? 0) + 1
      if (t === 'text') textChars += r.content.length
      if (t === 'image' || t === 'voice' || t === 'file') {
        mediaCount += 1
        mediaBytes += r.file_size ?? 0
      }
      const wib = new Date(r.created_at + WIB_OFFSET_MS)
      hours[wib.getUTCHours()] += 1
      weekdays[wib.getUTCDay()] += 1
      activeDays.add(Math.floor((r.created_at + WIB_OFFSET_MS) / DAY))
    } else {
      adminMsgs += 1
    }
  }

  // Kecepatan membalas: pasangan pesan bergantian (user→admin / admin→user),
  // jeda ≤ 12 jam dihitung (jeda semalam tidak dianggap "membalas").
  const RESP_CAP = 12 * 3_600_000
  const userRes: number[] = []
  const adminRes: number[] = []
  let silenceMs = 0
  for (let i = 1; i < rows.length; i += 1) {
    const delta = rows[i].created_at - rows[i - 1].created_at
    if (delta > silenceMs) silenceMs = delta
    if (delta <= 0 || delta > RESP_CAP) continue
    const fromUser = rows[i - 1].sender_id === userId
    const toUser = rows[i].sender_id === userId
    if (fromUser && !toUser) adminRes.push(delta)
    else if (!fromUser && toUser) userRes.push(delta)
  }
  const avgOf = (a: number[]) =>
    a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null

  // Streak: hari WIB berturut-turut dengan pesan user (berakhir hari ini/kemarin).
  const todayWib = Math.floor((nowMs + WIB_OFFSET_MS) / DAY)
  let streakDays = 0
  if (activeDays.size > 0) {
    let cursor = activeDays.has(todayWib) ? todayWib : todayWib - 1
    while (activeDays.has(cursor)) {
      streakDays += 1
      cursor -= 1
    }
  }

  // Persentase pesan admin yang sudah dibaca user.
  const readRow = db
    .query('SELECT last_read_message_id FROM reads WHERE conversation_id = ? AND user_id = ?')
    .get(conv.id, userId) as { last_read_message_id: number } | undefined
  const lastRead = Number(readRow?.last_read_message_id ?? 0)
  const readCount = rows.filter((r) => r.sender_id !== userId && r.id <= lastRead).length
  const readPct = adminMsgs > 0 ? Math.round((readCount / adminMsgs) * 100) : 0

  // Reaksi dalam percakapan ini: diberi user vs diterima user.
  const rec = db
    .query(
      `SELECT
        (SELECT COUNT(*) FROM message_reactions r
          JOIN messages m ON m.id = r.message_id
          WHERE m.conversation_id = ? AND r.user_id = ?) AS given,
        (SELECT COUNT(*) FROM message_reactions r
          JOIN messages m ON m.id = r.message_id
          WHERE m.conversation_id = ? AND m.sender_id = ?) AS received`
    )
    .get(conv.id, userId, conv.id, userId) as { given: number; received: number }

  // Tren 7 hari terakhir vs 7 hari sebelumnya (pesan user).
  let last7 = 0
  let prev7 = 0
  for (const r of rows) {
    if (r.sender_id !== userId) continue
    if (r.created_at >= nowMs - 7 * DAY && r.created_at < nowMs) last7 += 1
    else if (r.created_at >= nowMs - 14 * DAY && r.created_at < nowMs - 7 * DAY) prev7 += 1
  }
  const trendPct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : last7 > 0 ? 100 : 0

  const peakHour = hours.indexOf(Math.max(...hours))
  const peakHourCount = hours[peakHour]
  const peakDay = weekdays.indexOf(Math.max(...weekdays))
  const favType = Object.entries(byType)
    .filter(([t]) => MEDIA_TYPE_LABEL_ID[t])
    .sort((a, b) => b[1] - a[1])[0]
  const firstName = user.name.split(' ')[0]
  const userAvg = avgOf(userRes)
  const adminAvg = avgOf(adminRes)

  /* Butir "ide"/observasi — terurut prioritas, maks 8. */
  const insights: string[] = []
  if (firstAt)
    insights.push(
      `Berteman sejak ${fmtDayId(firstAt)} (${Math.max(1, Math.floor((nowMs - firstAt) / DAY))} hari kenalan di aplikasi)`
    )
  if (peakHourCount > 0)
    insights.push(
      `Jam paling aktif: ${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 1) % 24).padStart(2, '0')}:00 WIB (${peakHourCount} pesan)`
    )
  if (weekdays[peakDay] > 0)
    insights.push(`Hari paling ramai: ${DAY_NAMES_ID[peakDay]} (${weekdays[peakDay]} pesan)`)
  if (userAvg !== null && userRes.length >= 3)
    insights.push(`Rata-rata membalas dalam ${fmtDurId(userAvg)} (${userRes.length} balasan terukur)`)
  if (adminAvg !== null && adminRes.length >= 3)
    insights.push(`Kamu biasanya membalas ${firstName} dalam ${fmtDurId(adminAvg)}`)
  if (prev7 > 0 || last7 > 0) {
    if (prev7 === 0) insights.push(`Minggu ini ${last7} pesan — mulai aktif minggu ini`)
    else if (trendPct > 0) insights.push(`Minggu ini ${last7} pesan, naik ${trendPct}% dari minggu lalu — pelihara ritmenya`)
    else if (trendPct < 0) insights.push(`Minggu ini ${last7} pesan, turun ${Math.abs(trendPct)}% dari minggu lalu — mungkin perlu disapa`)
    else insights.push(`Minggu ini ${last7} pesan — stabil, sama seperti minggu lalu`)
  }
  if (favType)
    insights.push(
      `Media favorit: ${MEDIA_TYPE_LABEL_ID[favType[0]]} (${favType[1]}x${mediaBytes > 0 ? `, total ${fmtBytesId(mediaBytes)}` : ''})`
    )
  if (adminMsgs > 0)
    insights.push(
      `${readPct}% pesan kamu sudah dibaca${rec.given > 0 ? ` · ${firstName} memberi ${rec.given} reaksi` : ''}`
    )
  if (streakDays >= 2) insights.push(`Streak aktif ${streakDays} hari berturut-turut 🔥`)
  if (textChars >= 1000) insights.push(`Total ${Math.round(textChars / 100) / 10} ribu karakter ditulis`)
  if (lastAt !== null && nowMs - lastAt > 2 * DAY)
    insights.push(`Terakhir chat ${Math.floor((nowMs - lastAt) / DAY)} hari lalu — coba sapa lagi 👋`)

  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      createdAt: new Date(user.created_at).toISOString(),
      lastSeenAt: new Date(user.last_seen_at).toISOString(),
    },
    conversationId: conv.id,
    totals: {
      userMessages: userMsgs,
      adminMessages: adminMsgs,
      mediaCount,
      mediaBytes,
      textChars,
      firstMessageAt: firstAt !== null ? new Date(firstAt).toISOString() : null,
      lastMessageAt: lastAt !== null ? new Date(lastAt).toISOString() : null,
      byType,
    },
    activity: {
      hours,
      weekdays,
      activeDays: activeDays.size,
      streakDays,
      longestSilenceMs: silenceMs,
    },
    responses: {
      userAvgMs: userAvg,
      adminAvgMs: adminAvg,
      userSamples: userRes.length,
      adminSamples: adminRes.length,
    },
    reads: { adminMessages: adminMsgs, readCount, readPct },
    reactions: { given: Number(rec.given ?? 0), received: Number(rec.received ?? 0) },
    trend: { last7, prev7, pct: trendPct },
    insights: insights.slice(0, 8),
  }
}

/** Latest tombstoned messages (admin:forensics) — newest deletions first. */
const forensicsItems = (conversationId: string | null) => {
  const sql = `SELECT m.id, m.conversation_id, m.type, m.content, m.deleted_content, m.created_at, m.deleted_at, u.name AS sender_name
                 FROM messages m LEFT JOIN users u ON u.id = m.sender_id
                WHERE m.deleted_at IS NOT NULL ${
                  conversationId ? 'AND m.conversation_id = ?' : ''
                }
                ORDER BY m.deleted_at DESC, m.id DESC LIMIT 100`
  const rows = (conversationId ? db.query(sql).all(conversationId) : db.query(sql).all()) as Array<{
    id: number
    conversation_id: string
    type: string | null
    content: string
    deleted_content: string | null
    created_at: number
    deleted_at: number
    sender_name: string | null
  }>
  return rows.map((r) => ({
    messageId: r.id,
    conversationId: r.conversation_id,
    senderName: r.sender_name ?? 'Tidak diketahui',
    type: r.type ?? 'text',
    // v11 keeps the original in deleted_content; older tombstones are empty.
    content: r.deleted_content ?? (r.content || ''),
    createdAt: new Date(r.created_at).toISOString(),
    deletedAt: new Date(r.deleted_at).toISOString(),
  }))
}

/** Global case-insensitive content search (admin:search), newest first. */
const searchItems = (query: string) => {
  const rows = db
    .query(
      `SELECT m.id, m.conversation_id, m.content, m.type, m.created_at, m.file_name,
              u.name AS sender_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.deleted_at IS NULL AND instr(lower(m.content), lower(?)) > 0
        ORDER BY m.id DESC LIMIT 100`
    )
    .all(query) as Array<{
    id: number
    conversation_id: string
    content: string
    type: string | null
    created_at: number
    file_name: string | null
    sender_name: string | null
  }>
  const convNames = new Map<string, string>()
  const needle = query.toLowerCase()
  return rows.map((r) => {
    let conversationName = convNames.get(r.conversation_id)
    if (conversationName === undefined) {
      const conv = getConversation(r.conversation_id)
      conversationName = conv ? (findUserById(getPartnerId(conv, ADMIN_ID))?.name ?? '') : ''
      convNames.set(r.conversation_id, conversationName)
    }
    const idx = r.content.toLowerCase().indexOf(needle)
    const start = Math.max(0, idx - 40)
    const excerpt = r.content.slice(start, start + 140)
    const snippet = `${start > 0 ? '…' : ''}${excerpt}${
      start + 140 < r.content.length ? '…' : ''
    }`
    return {
      messageId: r.id,
      conversationId: r.conversation_id,
      senderName: r.sender_name ?? '',
      type: r.type ?? 'text',
      snippet,
      createdAt: new Date(r.created_at).toISOString(),
      conversationName,
    }
  })
}

/* ------------------------- v11 — export builders ------------------------- */

/** txt transcript timestamp, e.g. "[12/08/2025 14:03]". */
const exportStamp = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `[${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}]`
}

/** File-name-safe slug of a display name. */
const sanitizeFileNamePart = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'chat'

/** Full conversation transcript (admin:export_conversation). */
const buildConversationExport = (conversation: ConversationRow, format: 'txt' | 'json') => {
  const rows = db
    .query(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(conversation.id, MAX_EXPORT_MESSAGES) as MessageRow[]
  const nameById = new Map<string, string>()
  for (const uid of [conversation.user_a_id, conversation.user_b_id]) {
    nameById.set(uid, findUserById(uid)?.name ?? uid)
  }
  const partnerName =
    nameById.get(getPartnerId(conversation, ADMIN_ID)) ?? nameById.get(ADMIN_ID) ?? 'pengguna'
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `chatkita-${sanitizeFileNamePart(partnerName)}-${date}.${format}`
  if (format === 'json') {
    const content = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        conversationId: conversation.id,
        participants: [...nameById.entries()].map(([id, name]) => ({ id, name })),
        messages: rows.map((r) => ({
          id: r.id,
          senderId: r.sender_id,
          senderName: nameById.get(r.sender_id) ?? r.sender_id,
          type: r.type ?? 'text',
          content: r.deleted_at ? '' : r.content,
          deletedContent: r.deleted_content ?? null,
          deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
          createdAt: new Date(r.created_at).toISOString(),
          fileName: r.file_name ?? null,
          fileSize: r.file_size ?? null,
          mimeType: r.mime_type ?? null,
        })),
      },
      null,
      2
    )
    return { format, fileName, content, count: rows.length }
  }
  const lines: string[] = [
    'Transkrip percakapan ChatKita',
    `Percakapan: ${conversation.id}`,
    `Partisipan: ${[...nameById.values()].join(' & ')}`,
    `Diekspor: ${new Date().toISOString()}`,
    `Jumlah pesan: ${rows.length}`,
    '',
  ]
  for (const r of rows) {
    const who = nameById.get(r.sender_id) ?? r.sender_id
    const what = r.deleted_at
      ? `[dihapus]${r.deleted_content ? ` (asli: ${r.deleted_content.slice(0, 200)})` : ''}`
      : snippetOf(r)
    lines.push(`${exportStamp(r.created_at)} ${who}: ${what}`)
  }
  return { format, fileName, content: lines.join('\n'), count: rows.length }
}

/** JSON dump of one user (profile + stats + messages) for admin:export_user. */
const buildUserExport = (userId: string) => {
  const user = findUserById(userId)
  const rows = db
    .query(
      `SELECT * FROM (SELECT * FROM messages WHERE sender_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`
    )
    .all(userId, MAX_EXPORT_MESSAGES) as MessageRow[]
  const content = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      profile: buildXrayProfile(userId),
      stats: buildUserStats(userId),
      messages: rows.map(toChatMessage),
    },
    null,
    2
  )
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `chatkita-user-${sanitizeFileNamePart(user?.name ?? userId)}-${date}.json`
  return { fileName, content, count: rows.length }
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)

  /* ---------------------- public config (pre-login) ---------------------- */

  socket.on('public:settings', handler(socket, (_data, ack) => {
    // Pre-login Web Push config: just the VAPID public key ("" when push
    // is unavailable). v10 — also carries the public app settings so the
    // login card can show the app name + maintenance notice.
    ack({ ok: true, pushPublicKey: VAPID_PUBLIC, app: getAppSettings() })
  }))

  /* v28 — cek nama pre-login (tanpa sesi): "apakah nama ini sudah dipakai
   * akun?" Dipakai kartu login utk menyembunyikan kolom kode undangan saat
   * user lama masuk (kode undangan hanya utk pendaftaran akun baru).
   * Kebocoran informasi sengaja dibatasi: hanya boolean exists — sinyal yang
   * sama yang sudah diberikan pesan error login (PASSWORD_REQUIRED dsb).
   * Nama reserved "Admin" dianggap exists (tidak bisa didaftarkan). */
  socket.on('public:check_name', handler(socket, (data, ack) => {
    const name = typeof data?.name === 'string' ? data.name.trim() : ''
    const exists =
      name.length >= 1 &&
      name.length <= MAX_NAME_LENGTH &&
      (name.toLowerCase() === ADMIN_NAME.toLowerCase() ||
        !!findUserByRoleAndName(name, 'user'))
    ack({ ok: true, exists })
  }))

  /* ---------------------------- auth ---------------------------- */

  socket.on(
    'user:auth',
    handler(socket, (data, ack) => {
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
        ack({ ok: false, error: 'INVALID_NAME' })
        return
      }
      if (name.toLowerCase() === ADMIN_NAME.toLowerCase()) {
        console.log(`Rejected reserved name "${name}" (socket ${socket.id})`)
        ack({ ok: false, error: 'NAME_RESERVED' })
        return
      }

      /* v27 — 1 orang 1 akun: kredensial baru.
       * deviceId: UUID stabil dari localStorage klien (kunci 1 perangkat 1 akun).
       * password: wajib utk akun yang sudah punya password & utk pendaftaran baru.
       * inviteCode: wajib utk pendaftaran akun baru (kode sekali pakai). */
      const deviceIdRaw =
        typeof data?.deviceId === 'string' ? data.deviceId.trim() : ''
      const deviceId = /^[\w-]{8,80}$/.test(deviceIdRaw) ? deviceIdRaw : ''
      const password = typeof data?.password === 'string' ? data.password : ''
      const inviteCode =
        typeof data?.inviteCode === 'string'
          ? data.inviteCode.trim().toUpperCase()
          : ''

      // Find-or-create among role='user' rows only:
      // 1) stored userId login, 2) case-insensitive name, 3) create.
      let user: UserRow | null =
        typeof data?.userId === 'string' && data.userId.length > 0
          ? findUserByRoleAndId(data.userId, 'user')
          : null
      // A userId login is only trusted without PIN when the name matches
      // the stored account (it was validated when the session was created).
      if (user && user.name.toLowerCase() !== name.toLowerCase()) user = null
      if (!user) user = findUserByRoleAndName(name, 'user')
      /* v27 — sesi tersimpan (userId + nama cocok) = restore: melewati gate
       * password/PIN seperti semula. Login baru harus membuktikan kredensial. */
      const sessionRestore = !!(
        user &&
        typeof data?.userId === 'string' &&
        data.userId === user.id
      )

      if (!user) {
        // v13 — registration may be closed from the dashboard (Pengaturan → Akses).
        if (!getBoolSettingDefaulted('allowRegistration')) {
          console.log(`Rejected new registration "${name}" (registration closed)`)
          ack({ ok: false, error: 'REGISTRATION_CLOSED' })
          return
        }
        /* v27 — 1 orang 1 akun: pendaftaran butuh password + kode undangan
         * sekali pakai + perangkat yang belum pernah terdaftar. */
        if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
          ack({ ok: false, error: password ? 'WEAK_PASSWORD' : 'PASSWORD_REQUIRED' })
          return
        }
        if (!inviteCode) {
          ack({ ok: false, error: 'INVITE_REQUIRED' })
          return
        }
        const invite = db
          .query('SELECT * FROM invite_codes WHERE code = ?')
          .get(inviteCode) as InviteCodeRow | undefined
        if (!invite) {
          ack({ ok: false, error: 'INVITE_INVALID' })
          return
        }
        if (invite.used_by) {
          ack({ ok: false, error: 'INVITE_USED' })
          return
        }
        if (!deviceId) {
          ack({ ok: false, error: 'DEVICE_REQUIRED' })
          return
        }
        const deviceTaken = db
          .query('SELECT user_id FROM devices WHERE device_id = ?')
          .get(deviceId) as { user_id: string } | undefined
        if (deviceTaken) {
          console.log(`Rejected registration "${name}" — device already bound (socket ${socket.id})`)
          ack({ ok: false, error: 'DEVICE_TAKEN' })
          return
        }
        const id = crypto.randomUUID()
        const ts = now()
        const passwordHash = hashUserPassword(password)
        db.run(
          "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
          [id, name, ts, ts, passwordHash, ts]
        )
        db.run('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?', [
          id,
          ts,
          inviteCode,
        ])
        db.run('INSERT INTO devices (device_id, user_id, bound_at) VALUES (?, ?, ?)', [
          deviceId,
          id,
          ts,
        ])
        user = {
          id,
          name,
          role: 'user',
          created_at: ts,
          last_seen_at: ts,
          password_hash: passwordHash,
          password_set_at: ts,
          created_via: 'self',
        }
        console.log(`New user registered: "${name}" (${id}) via kode undangan`)
      } else {
        /* v27 — password gate: akun yang sudah punya password harus
         * membuktikannya saat login baru (sesi tersimpan tetap lolos).
         * Rate limit per-nama mencegah brute-force. */
        if (user.password_hash && !sessionRestore) {
          if (!password) {
            ack({ ok: false, error: 'PASSWORD_REQUIRED' })
            return
          }
          if (userPwBlocked(user.name.toLowerCase())) {
            ack({ ok: false, error: 'TOO_MANY_ATTEMPTS' })
            return
          }
          const pwOk = Bun.password.verifySync(password, user.password_hash)
          if (!pwOk) {
            userPwRecordFail(user.name.toLowerCase())
            console.log(`Rejected login "${user.name}" — wrong password (socket ${socket.id})`)
            ack({ ok: false, error: 'INVALID_PASSWORD' })
            return
          }
          userPwClear(user.name.toLowerCase())
        }
        // PIN gate: fresh (name-only) logins must present the PIN (akun lama
        // yang memakai PIN dan belum punya password).
        if (!user.password_hash && user.pin_hash) {
          const pin = typeof data?.pin === 'string' ? data.pin : ''
          const cameFromSession =
            typeof data?.userId === 'string' &&
            data.userId.length > 0 &&
            data.userId === user.id &&
            typeof data?.name === 'string' &&
            data.name.toLowerCase() === user.name.toLowerCase()
          if (!cameFromSession) {
            if (!pin) {
              ack({ ok: false, error: 'PIN_REQUIRED', hasPin: true })
              return
            }
            if (pinHash(pin, user.id) !== user.pin_hash) {
              ack({ ok: false, error: 'INVALID_PIN', hasPin: true })
              return
            }
          }
        }
        /* v27 — kunci perangkat: bind perangkat ke akun saat login (maks
         * DEVICE_LIMIT_PER_USER). Sesi restore di perangkat yang sudah
         * terikat akun LAIN tidak sah bila tak bisa membuktikan password
         * (menutup celah salin localStorage antar browser). */
        if (deviceId) {
          const bound = db
            .query('SELECT user_id FROM devices WHERE device_id = ?')
            .get(deviceId) as { user_id: string } | undefined
          if (bound && bound.user_id !== user.id) {
            if (sessionRestore && !password) {
              ack({ ok: false, error: user.password_hash ? 'PASSWORD_REQUIRED' : 'DEVICE_TAKEN' })
              return
            }
            // Login fresh dengan password benar di perangkat milik akun lain
            // tetap diizinkan (lintas perangkat via kredensial) — perangkat
            // TETAP terikat ke akun asal (tidak berpindah).
          } else if (!bound) {
            const devCount = db
              .query('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?')
              .get(user.id) as { c: number }
            if (devCount.c < DEVICE_LIMIT_PER_USER) {
              db.run('INSERT INTO devices (device_id, user_id, bound_at) VALUES (?, ?, ?)', [
                deviceId,
                user.id,
                now(),
              ])
            }
          }
        }
        const ts = now()
        db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [ts, user.id])
        user.last_seen_at = ts
      }

      // A user's single conversation is the one with the admin.
      const conversation = ensureConversationWithAdmin(user.id)
      // The user is looking at the chat right now → mark everything read.
      const readUpTo = markRead(conversation.id, user.id)
      // v13 — receipt broadcast honours the dashboard switch.
      if (getBoolSettingDefaulted('readReceipts')) {
        broadcastRead(conversation, user.id, readUpTo)
      }

      socket.data.userId = user.id
      socket.join(`user:${user.id}`)
      // v11 — remember connection metadata (ip/user-agent) for admin:xray.
      trackConnMeta(socket, user.id)
      const becameOnline = addOnlineSocket(user.id, socket.id)
      if (becameOnline) {
        // User presence is private: only the admins room may know.
        io.to('admins').emit('presence:update', {
          userId: user.id,
          online: true,
          lastSeenAt: null,
        })
      }

      console.log(`User "${user.name}" authenticated (socket ${socket.id})`)

      // v40 — riwayat login historis + feed aktivitas live.
      try {
        const uaHeader = socket.handshake.headers['user-agent']
        db.run(
          'INSERT INTO login_events (user_id, at, ip, user_agent, kind) VALUES (?, ?, ?, ?, ?)',
          [
            user.id,
            now(),
            firstForwardedIp(socket),
            typeof uaHeader === 'string' ? uaHeader.slice(0, 300) : null,
            sessionRestore ? 'restore' : 'login',
          ]
        )
      } catch {
        /* riwayat tidak boleh menggagalkan login */
      }
      emitActivity(user.id, 'login', sessionRestore ? 'sesi dipulihkan' : 'login baru')
      const admin = findUserById(ADMIN_ID) // seeded on boot — always exists
      const page = getMessagesPage(conversation.id)
      ack({
        ok: true,
        user: { id: user.id, name: user.name, hasPin: !!user.pin_hash },
        /* v27 — akun lama tanpa password → klien wajib menampilkan modal
         * pemasangan password (tak bisa ditutup sampai dipasang). */
        mustSetPassword: !user.password_hash,
        conversationId: conversation.id,
        partner: admin
          ? toPartnerInfo(admin, user.id)
          : { id: ADMIN_ID, name: ADMIN_NAME, online: false, lastSeenAt: null },
        messages: page.messages,
        // v8 — older pages load on demand via `messages:older`.
        hasMore: page.hasMore,
        // How far the admin has read → ✓✓ on my sent messages.
        partnerLastReadId: getReadUpTo(conversation.id, ADMIN_ID),
        // VAPID public key for Web Push ("" when push is unavailable).
        pushPublicKey: VAPID_PUBLIC,
        pinnedMessageId: conversation.pinned_message_id ?? null,
        pinned: pinnedSnapshotOf(conversation),
      })

      // A (newly registered) user must immediately appear in the admin sidebar.
      pushConversationsTo(ADMIN_ID)
      // v11 — a restricted user learns their restriction state right after
      // login (only sent when at least one restriction is active).
      pushRestrictedTo(user.id, true)
    })
  )

  socket.on(
    'admin:auth',
    handler(socket, (data, ack) => {
      const password = typeof data?.password === 'string' ? data.password : ''
      // v23 — password custom ter-hash di settings; kosong = fallback bawaan admin123.
      const storedHash = getAdminPasswordHash()
      // v23 — anti brute-force: jendela global 60 dtk + batas per-socket.
      const nowMs = Date.now()
      if (nowMs - adminAuthFails.windowStart > ADMIN_FAIL_WINDOW_MS) {
        adminAuthFails.windowStart = nowMs
        adminAuthFails.count = 0
      }
      const socketFails = adminAuthSocketFails.get(socket.id) ?? 0
      if (
        adminAuthFails.count >= ADMIN_FAIL_MAX_PER_WINDOW ||
        socketFails >= ADMIN_FAIL_MAX_PER_SOCKET
      ) {
        console.warn(`Admin login rate-limited (socket ${socket.id})`)
        ack({ ok: false, error: 'RATE_LIMITED' })
        return
      }
      const check = storedHash
        ? Bun.password.verify(password, storedHash)
        : Promise.resolve(password === (process.env.ADMIN_PASSWORD || 'admin123'))
      void check.then((match) => {
        if (!match) {
          adminAuthFails.count += 1
          adminAuthSocketFails.set(socket.id, socketFails + 1)
          if (adminAuthSocketFails.size > 1000) adminAuthSocketFails.clear()
          console.log(`Rejected admin login (wrong password, socket ${socket.id})`)
          ack({ ok: false, error: 'UNAUTHORIZED' })
          return
        }
        adminAuthFails.count = 0
        adminAuthSocketFails.delete(socket.id)

        socket.data.userId = ADMIN_ID
        socket.join('admins')
        // v11 — remember connection metadata (ip/user-agent) for admin:xray.
        trackConnMeta(socket, ADMIN_ID)
        const becameOnline = addOnlineSocket(ADMIN_ID, socket.id)
        if (becameOnline) {
          // Admin presence is public by design.
          io.emit('presence:update', { userId: ADMIN_ID, online: true, lastSeenAt: null })
        }

        console.log(`Admin authenticated (socket ${socket.id})`)
        ack({
          ok: true,
          conversations: getConversationsFor(ADMIN_ID),
          usingDefault: storedHash === null,
        })
      })
    })
  )

  // v24 — autologin admin: klien mengetik password → form mengecek kebenaran
  // lewat event ini (TANPA membuka sesi admin). Ack hanya { ok } — tidak ada
  // data percakapan. Gagal dihitung ke counter peek (terpisah & lebih longgar
  // dari admin:auth) supaya mengetik bertahap tidak memicu RATE_LIMITED login.
  // NAMA UNIK: 'admin:peek' sudah terpakai event v10 (peek isi percakapan).
  socket.on(
    'admin:password_peek',
    handler(socket, (data, ack) => {
      const password = typeof data?.password === 'string' ? data.password : ''
      // Password terpendek yang sah = 6 kar (aturan admin:password_change v23),
      // jadi input lebih pendek pasti salah — tidak perlu dihitung sebagai fail.
      if (password.length < 6) {
        ack({ ok: false, error: 'TOO_SHORT' })
        return
      }
      const nowMs = Date.now()
      if (nowMs - adminPeekFails.windowStart > ADMIN_PEEK_WINDOW_MS) {
        adminPeekFails.windowStart = nowMs
        adminPeekFails.count = 0
      }
      const socketPeekFails = adminPeekSocketFails.get(socket.id) ?? 0
      if (
        adminPeekFails.count >= ADMIN_PEEK_MAX_PER_WINDOW ||
        socketPeekFails >= ADMIN_PEEK_MAX_PER_SOCKET
      ) {
        console.warn(`Admin peek rate-limited (socket ${socket.id})`)
        ack({ ok: false, error: 'RATE_LIMITED' })
        return
      }
      const storedHash = getAdminPasswordHash()
      const check = storedHash
        ? Bun.password.verify(password, storedHash)
        : Promise.resolve(password === (process.env.ADMIN_PASSWORD || 'admin123'))
      void check.then((match) => {
        if (!match) {
          adminPeekFails.count += 1
          adminPeekSocketFails.set(socket.id, socketPeekFails + 1)
          if (adminPeekSocketFails.size > 1000) adminPeekSocketFails.clear()
          ack({ ok: false, error: 'UNAUTHORIZED' })
          return
        }
        // Benar — reset counter socket ini (pola sama dengan admin:auth).
        adminPeekSocketFails.delete(socket.id)
        ack({ ok: true })
      })
    })
  )

  /* --------------------------- messaging --------------------------- */

  socket.on(
    'messages:history',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      if (!isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      // v40 — kunci PIN percakapan: admin wajib membuka kunci sekali per socket.
      if (me === ADMIN_ID && isConvLockedForAdmin(socket, conversation)) {
        const lockedUserId =
          conversation.user_a_id === ADMIN_ID ? conversation.user_b_id : conversation.user_a_id
        ack({ ok: false, error: 'PIN_LOCKED', userId: lockedUserId })
        return
      }
      const lastReadBefore = getReadUpTo(conversation.id, me)
      // v10 — admin ghost mode: reading leaves read receipts untouched
      // (users keep seeing ✓ instead of ✓✓ for their sent messages).
      const ghost = me === ADMIN_ID && socket.data?.ghost === true
      // v13 — local unread state always updates; the receipt broadcast is
      // what draws ✓✓ on the partner's side and respects `readReceipts`.
      const readUpTo = markRead(conversation.id, me)
      if (!ghost && getBoolSettingDefaulted('readReceipts')) {
        broadcastRead(conversation, me, readUpTo)
      }
      const partner = getPartnerUser(conversation, me)
      const page = getMessagesPage(conversation.id, undefined, HISTORY_PAGE_SIZE, me)
      ack({
        ok: true,
        messages: page.messages,
        // v8 — older pages load on demand via `messages:older`.
        hasMore: page.hasMore,
        partner: toPartnerInfo(partner, me),
        partnerLastReadId: getReadUpTo(conversation.id, partner.id),
        // v5 — where I had read BEFORE this call → "new messages" divider.
        lastReadBefore,
        pinnedMessageId: conversation.pinned_message_id ?? null,
        pinned: pinnedSnapshotOf(conversation),
      })
      pushConversationsTo(me)
    })
  )

  // v8 — pagination: load one OLDER history page ("Muat pesan lama").
  socket.on(
    'messages:older',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      if (!isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      // v40 — kunci PIN percakapan juga berlaku untuk halaman lama.
      if (me === ADMIN_ID && isConvLockedForAdmin(socket, conversation)) {
        const lockedUserId =
          conversation.user_a_id === ADMIN_ID ? conversation.user_b_id : conversation.user_a_id
        ack({ ok: false, error: 'PIN_LOCKED', userId: lockedUserId })
        return
      }
      const beforeId = Number(data?.beforeId)
      if (!Number.isInteger(beforeId) || beforeId <= 0) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      // Read state is intentionally NOT touched by paging through history.
      ack({ ok: true, ...getMessagesPage(conversation.id, beforeId, HISTORY_PAGE_SIZE, me) })
    })
  )

  socket.on(
    'messages:send',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      if (!isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }

      const type = (typeof data?.type === 'string' ? data.type : 'text') as MessageType
      const content = typeof data?.content === 'string' ? data.content : ''

      // v13 — app-level feature switches from the dashboard (users only).
      const appSet = getAppSettings()
      if (me !== ADMIN_ID) {
        if (type === 'image' && !appSet.allowImages) {
          ack({ ok: false, error: 'FORBIDDEN' })
          return
        }
        if (type === 'voice' && !appSet.allowVoice) {
          ack({ ok: false, error: 'FORBIDDEN' })
          return
        }
        if (type === 'file' && !appSet.allowFiles) {
          ack({ ok: false, error: 'FORBIDDEN' })
          return
        }
      }

      // v11 — admin session control, enforced in order:
      // frozen → muted → mediaBlocked (rate/slowmode/quota checks follow below).
      const senderRow = me !== ADMIN_ID ? findUserById(me) : null
      if (senderRow) {
        if ((senderRow.frozen ?? 0) === 1) {
          ack({ ok: false, error: 'FROZEN' })
          return
        }
        const mutedUntil = senderRow.muted_until ?? 0
        if (mutedUntil > now()) {
          ack({
            ok: false,
            error: 'MUTED',
            remainingSeconds: Math.max(1, Math.ceil((mutedUntil - now()) / 1000)),
          })
          return
        }
        if (type !== 'text' && (senderRow.media_blocked ?? 0) === 1) {
          ack({ ok: false, error: 'MEDIA_BLOCKED' })
          return
        }
        // v40 — blokir media PER JENIS (foto/video/voice/file) per-user.
        const blockedTypes = (senderRow.blocked_media_types ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
        if (type !== 'text' && blockedTypes.includes(type)) {
          ack({ ok: false, error: 'MEDIA_TYPE_BLOCKED', mediaType: type })
          return
        }
      }

      let trimmed: string
      let fileMeta: { fileName: string; fileSize: number; mimeType: string } | null = null
      let thumbUrlRef: string | undefined
      let captionRef: string | undefined

      if (type === 'text') {
        trimmed = content.trim()
        // v13 — dynamic per-message cap (dashboard setting; admin keeps hard max).
        const textMax = me !== ADMIN_ID ? appSet.maxMessageLength : MAX_MESSAGE_LENGTH
        if (trimmed.length < 1 || trimmed.length > textMax) {
          ack({ ok: false, error: 'INVALID_MESSAGE' })
          return
        }
        // v13 — links can be disallowed for users (admin always may).
        if (me !== ADMIN_ID && !appSet.allowLinks && /https?:\/\/|www\./i.test(trimmed)) {
          ack({ ok: false, error: 'FORBIDDEN' })
          return
        }
        // v40 — filter kata per-user: blokir total atau sensor otomatis '***'.
        if (senderRow) {
          const wf = applyWordFilter(senderRow, trimmed)
          if (wf.blocked) {
            ack({ ok: false, error: 'WORD_BLOCKED' })
            return
          }
          trimmed = wf.text
        }
      } else if (type === 'image' || type === 'voice' || type === 'file') {
        trimmed = content
        const legacyPattern =
          type === 'image'
            ? /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/
            : type === 'voice'
              ? /^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,[A-Za-z0-9+/=]+$/
              : null
        if (legacyPattern?.test(trimmed)) {
          // v7 legacy in-band data URL — still accepted, size-capped.
          if (trimmed.length > MAX_MEDIA_LENGTH) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
        } else {
          // v8 — disk media produced by POST /api/upload: URL + REQUIRED
          // metadata; bytes live in db/media, only metadata rides the socket.
          if (!FILE_URL_PATTERN.test(trimmed)) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
          const fileName = typeof data?.fileName === 'string' ? data.fileName.trim() : ''
          if (fileName.length < 1 || fileName.length > MAX_FILE_NAME_LENGTH) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
          const mimeType = typeof data?.mimeType === 'string' ? data.mimeType : ''
          if (mimeType.length > 100 || !MIME_TYPE_PATTERN.test(mimeType)) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
          const fileSize = data?.fileSize
          // v13 — per-file cap for users comes from the dashboard (MiB).
          const fileCap = me !== ADMIN_ID ? appSet.maxUploadMb * 1_048_576 : MAX_FILE_BYTES
          if (
            typeof fileSize !== 'number' ||
            !Number.isInteger(fileSize) ||
            fileSize < 0 ||
            fileSize > fileCap
          ) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
          fileMeta = { fileName, fileSize, mimeType }
          // v8 — optional tiny preview image for photos/videos.
          const thumbUrl = typeof data?.thumbUrl === 'string' ? data.thumbUrl : ''
          if (thumbUrl) {
            if (!FILE_URL_PATTERN.test(thumbUrl)) {
              ack({ ok: false, error: 'INVALID_MESSAGE' })
              return
            }
            thumbUrlRef = thumbUrl
          }
        }
      } else {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }

      // v20 — caption opsional: teks di composer ikut terkirim bersama media.
      if (type === 'image' || type === 'file') {
        const rawCaption = typeof data?.caption === 'string' ? data.caption.trim() : ''
        if (rawCaption) {
          const capMax = me !== ADMIN_ID ? appSet.maxMessageLength : MAX_MESSAGE_LENGTH
          if (rawCaption.length > capMax) {
            ack({ ok: false, error: 'INVALID_MESSAGE' })
            return
          }
          captionRef = rawCaption
        }
      }

      // v22 — kirim terjadwal opsional (epoch ms): minimal +10 detik, maks +30 hari.
      let scheduledAtMs: number | undefined
      if (data?.scheduledAt != null) {
        const t = Number(data.scheduledAt)
        if (!Number.isFinite(t) || t < now() + 10_000 || t > now() + 30 * 86_400_000) {
          ack({ ok: false, error: 'INVALID_SCHEDULE' })
          return
        }
        scheduledAtMs = Math.round(t)
      }

      // Optional reply target must belong to the same conversation.
      let replyToId: number | undefined
      if (data?.replyToId != null) {
        const rid = Number(data.replyToId)
        const target =
          Number.isInteger(rid) && rid > 0
            ? (db
                .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
                .get(rid, conversation.id) as MessageRow | null)
            : null
        if (!target) {
          ack({ ok: false, error: 'INVALID_MESSAGE' })
          return
        }
        replyToId = rid
      }

      const durationMs =
        type === 'voice' && Number.isFinite(Number(data?.durationMs))
          ? Math.min(300000, Math.max(0, Math.round(Number(data.durationMs))))
          : undefined

      // v8 guards — per-account flood & storage protection.
      // v13 — global user slowmode from the dashboard (0 = off): minimum
      // seconds between two messages of the same user (memory, per boot).
      if (me !== ADMIN_ID && appSet.slowmodeSeconds > 0) {
        const lastAt = globalSlowAt.get(me) ?? 0
        const waitMs = appSet.slowmodeSeconds * 1000 - (now() - lastAt)
        if (waitMs > 0) {
          ack({
            ok: false,
            error: 'SLOW_MODE',
            remainingSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
          })
          return
        }
        globalSlowAt.set(me, now())
      }
      // v11 — a personal slow_mode tightens the TEXT limit; hitting it acks
      // SLOW_MODE (with the retry window) instead of the generic RATE_LIMITED.
      if (type === 'text') {
        const slowMode = senderRow?.slow_mode ?? 0
        const textLimit = slowMode > 0 ? Math.min(slowMode, RATE_TEXT_PER_MIN) : RATE_TEXT_PER_MIN
        if (!rateAllowed(me, 'text', textLimit)) {
          if (slowMode > 0 && slowMode < RATE_TEXT_PER_MIN) {
            ack({
              ok: false,
              error: 'SLOW_MODE',
              remainingSeconds: rateRetryAfterSeconds(me, 'text'),
            })
          } else {
            ack({ ok: false, error: 'RATE_LIMITED' })
          }
          return
        }
      } else if (!rateAllowed(me, 'media', RATE_MEDIA_PER_MIN)) {
        ack({ ok: false, error: 'RATE_LIMITED' })
        return
      } else if (
        fileMeta &&
        storedMediaBytes(me) + fileMeta.fileSize > effectiveQuotaBytes(senderRow)
      ) {
        ack({ ok: false, error: 'QUOTA_EXCEEDED' })
        return
      }

      // v11 — keyword scanner: silent flag only; the send is NEVER blocked
      // or altered. The first matching keyword wins.
      const flagKeyword = type === 'text' ? matchedKeyword(trimmed) : null

      // v22 — pesan terjadwal: disimpan sekarang, HANYA pengirim melihatnya
      // (chip ⏰), lalu dipancarkan ke semua pihak saat waktunya tiba.
      if (scheduledAtMs) {
        const result = db.run(
          'INSERT INTO messages (conversation_id, sender_id, content, created_at, type, reply_to_id, duration_ms, file_name, file_size, mime_type, thumb_url, flagged, caption, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            conversation.id,
            me,
            trimmed,
            now(),
            type,
            replyToId ?? null,
            durationMs ?? null,
            type === 'file' || type === 'image' || type === 'voice' ? (fileMeta?.fileName ?? null) : null,
            (type === 'file' || type === 'image' || type === 'voice') && fileMeta ? fileMeta.fileSize : null,
            type === 'file' || type === 'image' || type === 'voice' ? (fileMeta?.mimeType ?? null) : null,
            thumbUrlRef ?? null,
            flagKeyword ? 1 : 0,
            captionRef ?? null,
            scheduledAtMs,
          ]
        )
        const row = db
          .query('SELECT * FROM messages WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as MessageRow
        const message = toChatMessage(row)
        // v26 — metadata media untuk pesan terjadwal juga.
        if (type === 'image' || type === 'file') {
          void attachMediaMeta(Number(result.lastInsertRowid), message.content)
        }
        attachReplyPreviews([row], [message])
        if (me === ADMIN_ID) io.to('admins').emit('message:new', message)
        else io.to(`user:${me}`).emit('message:new', message)
        ack({ ok: true, message })
        console.log(
          `[${me.slice(0, 8)}] terjadwal ${new Date(scheduledAtMs).toISOString()} (${type})`
        )
        return
      }

      // v40 — mode persetujuan (moderasi pra-kirim): pesan user disimpan
      // dengan pending=1, HANYA room admin yang menerima — user menerima ack
      // pending:true dan pesan baru tampil setelah admin menyetujui.
      if (senderRow && (senderRow.approval_mode ?? 0) === 1) {
        const result = db.run(
          'INSERT INTO messages (conversation_id, sender_id, content, created_at, type, reply_to_id, duration_ms, file_name, file_size, mime_type, thumb_url, flagged, caption, pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
          [
            conversation.id,
            me,
            trimmed,
            now(),
            type,
            replyToId ?? null,
            durationMs ?? null,
            type === 'file' || type === 'image' || type === 'voice' ? (fileMeta?.fileName ?? null) : null,
            (type === 'file' || type === 'image' || type === 'voice') && fileMeta ? fileMeta.fileSize : null,
            type === 'file' || type === 'image' || type === 'voice' ? (fileMeta?.mimeType ?? null) : null,
            thumbUrlRef ?? null,
            flagKeyword ? 1 : 0,
            captionRef ?? null,
          ]
        )
        const row = db
          .query('SELECT * FROM messages WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as MessageRow
        const message = toChatMessage(row)
        attachReplyPreviews([row], [message])
        io.to('admins').emit('message:new', message)
        ack({ ok: true, message, pending: true })
        audit('moderation_pending', `${senderRow.name} → antre (#${message.id})`)
        console.log(`[moderasi] pesan #${message.id} menunggu persetujuan (${senderRow.name})`)
        return
      }

      const message = insertAndFanOut(conversation, me, trimmed, type, {
        replyToId,
        durationMs,
        ...(fileMeta ?? {}),
        ...(thumbUrlRef ? { thumbUrl: thumbUrlRef } : {}),
        ...(captionRef ? { caption: captionRef } : {}),
        ...(flagKeyword ? { flagged: 1 } : {}),
      })
      // v26 — baca metadata media (dimensi/durasi/halaman) dari file di disk.
      if (type === 'image' || type === 'file') {
        void attachMediaMeta(message.id, message.content)
      }
      ack({ ok: true, message })

      // v40 — peringatan kuota 80%/95% + feed aktivitas live (user saja).
      if (senderRow && fileMeta) maybeEmitQuotaWarn(senderRow)
      if (me !== ADMIN_ID) {
        emitActivity(me, 'message', type === 'text' ? trimmed : (fileMeta?.fileName ?? type))
      }

      // v39 — bot balasan otomatis per-user (hanya percakapan yang memuat
      // Admin; konfigurasi via admin:user_bot).
      if (senderRow && isParticipant(conversation, ADMIN_ID)) {
        scheduleBotReply(senderRow, conversation)
      }

      // v11 — keyword hit → live intel to the admins room.
      if (flagKeyword) {
        io.to('admins').emit('admin:flagged', {
          messageId: message.id,
          conversationId: conversation.id,
          senderName: senderRow?.name ?? findUserById(me)?.name ?? me,
          snippet: trimmed.slice(0, 140),
          keyword: flagKeyword,
          createdAt: message.createdAt,
        })
      }

      // Voice notes: transcribe in the background (data URL or db/media file).
      if (type === 'voice') void transcribeVoice(message.id, conversation.id, trimmed)

      // v5 — a new user message pulls the conversation out of the archive.
      if (me !== ADMIN_ID && conversation.archived_at != null) {
        db.run('UPDATE conversations SET archived_at = NULL WHERE id = ?', [conversation.id])
        conversation.archived_at = null
        pushConversationsTo(ADMIN_ID)
      }

      console.log(
        `[${me.slice(0, 8)}] -> ${conversation.id.slice(0, 8)} (${type}): ${
          type === 'text' ? trimmed.slice(0, 60) : (fileMeta?.fileName ?? trimmed.slice(0, 60))
        }${fileMeta ? ` (${fileMeta.fileSize}b)` : ''}`
      )
    })
  )

  socket.on(
    'messages:delete',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      const row =
        Number.isInteger(id) && id > 0
          ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
          : null
      if (!row) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      if (!conversation || !isParticipant(conversation, me) || row.sender_id !== me) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      if (row.deleted_at) {
        ack({ ok: true })
        return
      }
      const ts = now()
      // v11 — shared delete pipeline: the ORIGINAL content is preserved in
      // messages.deleted_content (forensics) before the tombstone redaction.
      tombstoneMessage(row, conversation, ts)
      ack({ ok: true })
      console.log(`Message ${id} deleted by ${me.slice(0, 8)}`)
    })
  )

  socket.on(
    'messages:read',
    handler(socket, (data) => {
      const me = authedUserId(socket)
      if (!me) return
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation || !isParticipant(conversation, me)) return
      // v10 — ghost mode: no read receipts are sent while active.
      if (me === ADMIN_ID && socket.data?.ghost === true) return
      const readUpTo = markRead(conversation.id, me)
      // v13 — receipts broadcast honours the dashboard switch.
      if (getBoolSettingDefaulted('readReceipts')) {
        broadcastRead(conversation, me, readUpTo)
      }
      if (me !== ADMIN_ID) emitActivity(me, 'read', 'membaca pesan')
      pushConversationsTo(me)
    })
  )

  socket.on(
    'typing',
    handler(socket, (data) => {
      const me = authedUserId(socket)
      if (!me) return
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation || !isParticipant(conversation, me)) return
      const partnerId = getPartnerId(conversation, me)
      const payload = {
        conversationId: conversation.id,
        isTyping: data?.isTyping === true,
      }
      // The `user:admin` room is empty; when the partner is the admin the
      // relay must additionally reach the `admins` room.
      io.to(`user:${partnerId}`).emit('partner:typing', payload)
      if (partnerId === ADMIN_ID) io.to('admins').emit('partner:typing', payload)
      // v11 — mirror_mode fake signal: when a USER types to the admin, the
      // user ALSO sees "Admin sedang mengetik" (user-side audience only).
      if (
        getBoolSetting('mirror_mode') &&
        me !== ADMIN_ID &&
        isParticipant(conversation, ADMIN_ID)
      ) {
        io.to(`user:${me}`).emit('partner:typing', {
          conversationId: conversation.id,
          isTyping: data?.isTyping === true,
        })
      }
    })
  )

  /* ------------------- v5: reactions / edit / translate ------------------- */

  socket.on(
    'message:react',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      const emoji = typeof data?.emoji === 'string' ? data.emoji : ''
      if (!Number.isInteger(id) || id <= 0 || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
      if (!row || row.deleted_at) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      if (!conversation || !isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      // v13 — reactions can be switched off for users (admin keeps the power).
      if (me !== ADMIN_ID && !getBoolSettingDefaulted('allowReactions')) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      const existing = db
        .query('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
        .get(id, me) as { emoji: string } | null
      if (existing && existing.emoji === emoji) {
        db.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [id, me])
      } else {
        db.run(
          'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji',
          [id, me, emoji]
        )
      }
      ack({ ok: true })
      const payload = { id, conversationId: conversation.id, reactions: reactionsFor(id) }
      io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
    })
  )

  socket.on(
    'messages:star',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      if (!Number.isInteger(id) || id <= 0) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
      if (!row || row.deleted_at) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      if (!conversation || !isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      // v22 — toggle bintang per-user (kolom starred_by = JSON array userId).
      const list = starredByOf(row.starred_by)
      const starred = !list.includes(me)
      const next = starred ? [...list, me] : list.filter((x) => x !== me)
      db.run('UPDATE messages SET starred_by = ? WHERE id = ?', [
        next.length ? JSON.stringify(next) : null,
        id,
      ])
      ack({ ok: true, starred })
      const payload = { id, conversationId: conversation.id, starredBy: next }
      io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
    })
  )

  socket.on(
    'messages:starred',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation || !isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      // v22 — daftar pesan berbintang milik pemanggil dalam percakapan ini.
      const rows = db
        .query(
          'SELECT * FROM messages WHERE conversation_id = ? AND starred_by IS NOT NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 200'
        )
        .all(conversation.id) as MessageRow[]
      const mine = rows.filter((r) => starredByOf(r.starred_by).includes(me))
      const messages = mine.map((r) => toChatMessage(r))
      attachReplyPreviews(mine, messages)
      ack({ ok: true, messages })
    })
  )

  socket.on(
    'messages:forward',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      // v22 — forward pesan ke percakapan lain (khusus admin, multi-kontak).
      if (me !== ADMIN_ID) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      const id = Number(data?.messageId)
      const src =
        Number.isInteger(id) && id > 0
          ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
          : null
      if (!src || src.deleted_at || src.scheduled_at) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const srcConv = getConversation(src.conversation_id)
      if (!srcConv || !isParticipant(srcConv, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      const targetType = (src.type ?? 'text') as MessageType
      if (targetType === 'system' || !src.content) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const target =
        typeof data?.targetConversationId === 'string'
          ? getConversation(data.targetConversationId)
          : null
      if (!target || !isParticipant(target, me)) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const originName =
        src.sender_id === ADMIN_ID ? ADMIN_NAME : (findUserById(src.sender_id)?.name ?? 'Pengguna')
      const message = insertAndFanOut(target, me, src.content, targetType, {
        durationMs: src.duration_ms ?? undefined,
        fileName: src.file_name ?? undefined,
        fileSize: typeof src.file_size === 'number' ? src.file_size : undefined,
        mimeType: src.mime_type ?? undefined,
        thumbUrl: src.thumb_url ?? undefined,
        caption: src.caption ?? undefined,
        forwardedFrom: originName,
      })
      ack({ ok: true, message })
      if (targetType === 'voice') void transcribeVoice(message.id, target.id, src.content)
      console.log(`Forward pesan ${id} → ${target.id.slice(0, 8)} (dari ${originName})`)
    })
  )

  socket.on(
    'messages:schedule_cancel',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      const row =
        Number.isInteger(id) && id > 0
          ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
          : null
      // v22 — batalkan pesan terjadwal milik sendiri SEBELUM waktunya tiba.
      if (!row || row.sender_id !== me || !row.scheduled_at || row.delivered_at) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      db.run('DELETE FROM messages WHERE id = ?', [id])
      ack({ ok: true })
      if (conversation) {
        const payload = { id, conversationId: conversation.id }
        io.to(`user:${conversation.user_a_id}`).emit('message:scheduled_cancelled', payload)
        io.to(`user:${conversation.user_b_id}`).emit('message:scheduled_cancelled', payload)
        io.to('admins').emit('message:scheduled_cancelled', payload)
      }
      console.log(`Pesan terjadwal ${id} dibatalkan oleh ${me.slice(0, 8)}`)
    })
  )

  socket.on(
    'message:edit',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      const content = typeof data?.content === 'string' ? data.content.trim() : ''
      if (!Number.isInteger(id) || id <= 0 || content.length < 1 || content.length > MAX_MESSAGE_LENGTH) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
      if (!row || row.deleted_at) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      if (
        !conversation ||
        !isParticipant(conversation, me) ||
        row.sender_id !== me ||
        (row.type ?? 'text') !== 'text'
      ) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      if (now() - row.created_at > EDIT_WINDOW_MS) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      const ts = now()
      // v11 — keep the previous text as an edit_history revision (forensics).
      let history: { text: string; at: number }[] = []
      try {
        const parsed = row.edit_history ? JSON.parse(row.edit_history) : []
        if (Array.isArray(parsed)) {
          history = parsed.filter(
            (e): e is { text: string; at: number } =>
              !!e && typeof e === 'object' && typeof (e as any).text === 'string'
          )
        }
      } catch {
        /* corrupt history — start fresh */
      }
      history.push({ text: row.content, at: row.edited_at ?? row.created_at })
      if (history.length > MAX_EDIT_HISTORY_ENTRIES) {
        history = history.slice(-MAX_EDIT_HISTORY_ENTRIES)
      }
      db.run('UPDATE messages SET content = ?, edited_at = ?, edit_history = ? WHERE id = ?', [
        content,
        ts,
        JSON.stringify(history),
        id,
      ])
      ack({ ok: true })
      const payload = {
        id,
        conversationId: conversation.id,
        content,
        editedAt: new Date(ts).toISOString(),
      }
      io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
      pushConversationsTo(conversation.user_a_id)
      pushConversationsTo(conversation.user_b_id)
      console.log(`Message ${id} edited by ${me.slice(0, 8)}`)
    })
  )

  socket.on(
    'message:translate',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const id = Number(data?.messageId)
      const row =
        Number.isInteger(id) && id > 0
          ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
          : null
      if (!row || row.deleted_at || (row.type ?? 'text') !== 'text') {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const conversation = getConversation(row.conversation_id)
      if (!conversation || !isParticipant(conversation, me)) {
        ack({ ok: false, error: 'FORBIDDEN' })
        return
      }
      if (row.translation) {
        ack({ ok: true, translation: row.translation })
        return
      }
      llmComplete(
        'Terjemahkan teks pesan berikut ke bahasa Indonesia. Jawab HANYA hasil terjemahannya ' +
          'tanpa penjelasan, tanpa tanda kutip, tanpa markdown. Pertahankan emoji yang ada.',
        row.content,
        800
      ).then((translation) => {
        if (!translation) {
          // Soft failure: the contract allows `translation: null` on success
          // (there is no AI_UNAVAILABLE error code in the shared contract).
          ack({ ok: true, translation: null })
          return
        }
        db.run('UPDATE messages SET translation = ? WHERE id = ?', [translation, id])
        ack({ ok: true, translation })
        const payload = { id, conversationId: conversation.id, translation }
        io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
        io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
        io.to('admins').emit('message:updated', payload)
      })
    })
  )

  /* ------------------ v5: pin / archive ------------------ */

  socket.on(
    'conversation:pin',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      // v11 — the pin core is shared with admin:pin / admin:unpin; it emits
      // both the legacy conversation:update and the new conversation:pinned.
      const messageId = data?.messageId != null ? Number(data.messageId) : null
      if (messageId != null && (!Number.isInteger(messageId) || messageId <= 0)) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const result = applyConversationPin(conversation, messageId)
      if (result === 'not_found') {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const fresh = getConversation(conversation.id)
      ack({
        ok: true,
        conversationId: conversation.id,
        pinnedMessageId: fresh?.pinned_message_id ?? null,
        pinned: pinnedSnapshotOf(fresh ?? conversation),
      })
    })
  )

  socket.on(
    'conversation:archive',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const conversation =
        typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
      if (!conversation) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      const archived = data?.archived !== false
      db.run('UPDATE conversations SET archived_at = ? WHERE id = ?', [
        archived ? now() : null,
        conversation.id,
      ])
      conversation.archived_at = archived ? now() : null
      ack({ ok: true, conversationId: conversation.id, archived })
      io.to('admins').emit('conversation:archive:update', {
        conversationId: conversation.id,
        archived,
      })
      pushConversationsTo(ADMIN_ID)
      console.log(`Conversation ${conversation.id.slice(0, 8)} ${archived ? 'archived' : 'unarchived'}`)
    })
  )

  /* ------------------------- v5: web push ------------------------- */

  socket.on(
    'push:subscribe',
    handler(socket, (data) => {
      const me = authedUserId(socket)
      if (!me) return
      const sub = data?.subscription
      const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
      const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : ''
      const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : ''
      if (!endpoint || !p256dh || !auth) return
      db.run(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
        [endpoint.slice(0, 500), me, p256dh.slice(0, 300), auth.slice(0, 300), now()]
      )
      console.log(`Push subscription stored for ${me.slice(0, 8)}`)
    })
  )

  /* ------------------------------------------------------------------ */
  /* v10 — admin dashboard: stats / settings / broadcast / backup         */
  /* ------------------------------------------------------------------ */

  /** Every event below is admin-only (socket must have passed admin:auth). */
  const adminGuard = (ack: AckFn): boolean => {
    if (authedUserId(socket) !== ADMIN_ID) {
      ack({ ok: false, error: 'UNAUTHORIZED' })
      return false
    }
    return true
  }

  socket.on('admin:dashboard', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    ack({ ok: true, stats: dashboardStats() })
  }))

  socket.on('admin:settings:get', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    ack({ ok: true, settings: getAppSettings() })
  }))

  socket.on('admin:settings:set', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const next: AppSettingsApi = getAppSettings()
    let touched = ''
    if (typeof data?.appName === 'string') {
      const v = data.appName.trim()
      if (v.length < 1 || v.length > APP_SETTING_LIMITS.appName) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      next.appName = v
      touched += ' appName'
    }
    if (typeof data?.welcomeMessage === 'string') {
      next.welcomeMessage = data.welcomeMessage.trim().slice(0, APP_SETTING_LIMITS.welcomeMessage)
      touched += ' welcome'
    }
    if (typeof data?.maintenanceMode === 'boolean') {
      next.maintenanceMode = data.maintenanceMode
      touched += ' maintenance'
    }
    if (typeof data?.maintenanceNote === 'string') {
      next.maintenanceNote = data.maintenanceNote.trim().slice(0, APP_SETTING_LIMITS.maintenanceNote)
      touched += ' maintNote'
    }
    // v13 — behaviour settings (booleans default true → stored '0' when off).
    if (typeof data?.allowRegistration === 'boolean') {
      next.allowRegistration = data.allowRegistration
      touched += ' registration'
    }
    if (typeof data?.maxMessageLength === 'number' && Number.isFinite(data.maxMessageLength)) {
      next.maxMessageLength = clampNum(data.maxMessageLength, APP_SETTING_LIMITS.maxMessageLength)
      touched += ' maxLen'
    }
    if (typeof data?.maxUploadMb === 'number' && Number.isFinite(data.maxUploadMb)) {
      next.maxUploadMb = clampNum(data.maxUploadMb, APP_SETTING_LIMITS.maxUploadMb)
      touched += ' maxUpload'
    }
    for (const key of [
      'allowImages',
      'allowVoice',
      'allowFiles',
      'allowLinks',
      'linkPreview',
      'allowReactions',
      'readReceipts',
    ] as const) {
      if (typeof data?.[key] === 'boolean') {
        next[key] = data[key]
        touched += ` ${key}`
      }
    }
    if (typeof data?.slowmodeSeconds === 'number' && Number.isFinite(data.slowmodeSeconds)) {
      next.slowmodeSeconds = clampNum(data.slowmodeSeconds, APP_SETTING_LIMITS.slowmodeSeconds)
      touched += ' slowmode'
    }
    setSetting('appName', next.appName)
    setSetting('welcomeMessage', next.welcomeMessage)
    setSetting('maintenanceMode', next.maintenanceMode ? '1' : '0')
    setSetting('maintenanceNote', next.maintenanceNote)
    // v13 — persist behaviour keys.
    setSetting('allowRegistration', next.allowRegistration ? '1' : '0')
    setSetting('maxMessageLength', String(next.maxMessageLength))
    setSetting('maxUploadMb', String(next.maxUploadMb))
    setSetting('allowImages', next.allowImages ? '1' : '0')
    setSetting('allowVoice', next.allowVoice ? '1' : '0')
    setSetting('allowFiles', next.allowFiles ? '1' : '0')
    setSetting('allowLinks', next.allowLinks ? '1' : '0')
    setSetting('linkPreview', next.linkPreview ? '1' : '0')
    setSetting('allowReactions', next.allowReactions ? '1' : '0')
    setSetting('readReceipts', next.readReceipts ? '1' : '0')
    setSetting('slowmodeSeconds', String(next.slowmodeSeconds))
    broadcastAppSettings()
    // v11 — audit trail.
    audit('settings', `appName=${next.appName}; maintenance=${next.maintenanceMode};${touched}`)
    console.log(`App settings updated${touched ? ` (${touched.trim()})` : ''}`)
    ack({ ok: true, settings: next })
  }))

  /**
   * v23 — Custom login admin: ganti password admin (hash bcrypt di settings).
   * Wajib verifikasi password sekarang; sesi socket yang sudah auth tetap berlaku.
   */
  socket.on('admin:password_change', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const current = typeof data?.currentPassword === 'string' ? data.currentPassword : ''
    const next = typeof data?.newPassword === 'string' ? data.newPassword : ''
    if (next.length < 6 || next.length > 64) {
      ack({ ok: false, error: 'WEAK_PASSWORD' })
      return
    }
    void verifyAdminPassword(current).then((ok) => {
      if (!ok) {
        console.log(`Rejected admin password change (wrong current password, socket ${socket.id})`)
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const hash = Bun.password.hashSync(next, { algorithm: 'bcrypt', cost: 10 })
      setSetting('adminPasswordHash', hash)
      adminAuthFails.count = 0
      adminAuthSocketFails.clear()
      audit('password', 'password admin diganti dari dashboard')
      console.log('Admin password changed (dashboard)')
      ack({ ok: true })
    })
  }))

  /**
   * Siaran / Pengumuman — one system message fanned out to EVERY
   * conversation (admin appears as the system announcer).
   */
  socket.on('admin:broadcast', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    const kind = data?.kind === 'pengumuman' ? 'pengumuman' : 'siaran'
    if (text.length < 1 || text.length > 500) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const content =
      kind === 'pengumuman' ? `📢 Pengumuman: ${text}` : `📣 Siaran: ${text}`
    const rows = db.query('SELECT * FROM conversations').all() as ConversationRow[]
    for (const conversation of rows) {
      insertAndFanOut(conversation, ADMIN_ID, content, 'system')
    }
    console.log(`${kind} broadcast to ${rows.length} conversation(s)`)
    // v11 — audit trail.
    audit('broadcast', `${kind}: ${content}`)
    ack({ ok: true, count: rows.length, kind })
  }))

  /* ------------------------------------------------------------------ */
  /* v27 — 1 orang 1 akun: kode undangan + kelola akun                   */
  /* ------------------------------------------------------------------ */

  const inviteRowToInfo = (r: InviteCodeRow) => ({
    code: r.code,
    label: r.label ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    usedBy: r.used_by ?? null,
    ...(r.used_by ? { usedByName: findUserById(r.used_by)?.name ?? null } : {}),
    usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
  })

  /** Daftar semua kode undangan (terbaru dulu). */
  socket.on('admin:invite_list', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const rows = db
      .query('SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT 200')
      .all() as InviteCodeRow[]
    ack({ ok: true, invites: rows.map(inviteRowToInfo) })
  }))

  /** Buat 1–20 kode undangan sekali pakai sekaligus. */
  socket.on('admin:invite_create', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const count = Math.max(1, Math.min(20, Number(data?.count) || 1))
    const label = typeof data?.label === 'string' ? data.label.trim().slice(0, 60) : ''
    const created = []
    for (let i = 0; i < count; i++) {
      const code = makeInviteCode()
      db.run(
        'INSERT INTO invite_codes (code, created_by, created_at, label) VALUES (?, ?, ?, ?)',
        [code, ADMIN_ID, now(), label || null]
      )
      const row = db
        .query('SELECT * FROM invite_codes WHERE code = ?')
        .get(code) as InviteCodeRow
      created.push(inviteRowToInfo(row))
    }
    audit('invite_create', `${count} kode undangan dibuat${label ? ` (${label})` : ''}`)
    console.log(`Admin created ${count} invite code(s)`)
    ack({ ok: true, created })
  }))

  /** Hapus satu kode undangan (terpakai maupun belum). */
  socket.on('admin:invite_delete', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : ''
    const res = db.run('DELETE FROM invite_codes WHERE code = ?', [code])
    if (res.changes === 0) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    audit('invite_delete', `kode ${code} dihapus`)
    ack({ ok: true })
  }))

  /** Admin membuat akun langsung (tanpa kode undangan, tanpa perangkat). */
  socket.on('admin:user_create', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const name = typeof data?.name === 'string' ? data.name.trim() : ''
    const password = typeof data?.password === 'string' ? data.password : ''
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      ack({ ok: false, error: 'INVALID_NAME' })
      return
    }
    if (name.toLowerCase() === ADMIN_NAME.toLowerCase()) {
      ack({ ok: false, error: 'NAME_RESERVED' })
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      ack({ ok: false, error: 'WEAK_PASSWORD' })
      return
    }
    if (findUserByRoleAndName(name, 'user')) {
      ack({ ok: false, error: 'NAME_TAKEN' })
      return
    }
    const id = crypto.randomUUID()
    const ts = now()
    db.run(
      "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'admin')",
      [id, name, ts, ts, hashUserPassword(password), ts]
    )
    ensureConversationWithAdmin(id)
    pushConversationsTo(ADMIN_ID)
    audit('user_create', `akun "${name}" dibuat admin dari dashboard`)
    console.log(`Admin created user "${name}" (${id})`)
    ack({ ok: true, userId: id, name })
  }))

  /** Reset password user dari dashboard (mis. user lupa password). */
  socket.on('admin:user_reset_password', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const password = typeof data?.password === 'string' ? data.password : ''
    const target = userId ? findUserById(userId) : null
    if (!target || target.role !== 'user') {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      ack({ ok: false, error: 'WEAK_PASSWORD' })
      return
    }
    db.run('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?', [
      hashUserPassword(password),
      now(),
      target.id,
    ])
    userPwClear(target.name.toLowerCase())
    audit('user_reset_password', `password "${target.name}" direset admin`)
    ack({ ok: true })
  }))

  /** Lepas seluruh kunci perangkat milik user (mis. user ganti HP). */
  socket.on('admin:user_unbind_devices', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const target = userId ? findUserById(userId) : null
    if (!target || target.role !== 'user') {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const res = db.run('DELETE FROM devices WHERE user_id = ?', [target.id])
    audit('user_unbind_devices', `${res.changes} perangkat dilepas dari "${target.name}"`)
    ack({ ok: true, removed: res.changes })
  }))

  /* ---------------------------------------------------------------- */
  /* v29 — RESET & HAPUS MENYELURUH                                    */
  /* ---------------------------------------------------------------- */

  /**
   * v29 — lepas SEMUA bintang milik pemanggil dalam percakapannya
   * (starred_by per-user; bintang pihak lain tidak tersentuh). Tiap pesan
   * yang berubah di-broadcast message:updated ber-starredBy agar chip
   * bintang di chat kedua pihak ikut berubah tanpa reload.
   */
  socket.on('messages:unstar_all', handler(socket, (_data, ack) => {
    const me = authedUserId(socket)
    if (!me) {
      ack({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const conv = db
      .query('SELECT * FROM conversations WHERE user_a_id = ? OR user_b_id = ?')
      .get(me, me) as ConversationRow | null
    if (!conv || !isParticipant(conv, me)) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const rows = db
      .query(
        'SELECT id, starred_by FROM messages WHERE conversation_id = ? AND starred_by IS NOT NULL AND deleted_at IS NULL'
      )
      .all(conv.id) as Array<Pick<MessageRow, 'id' | 'starred_by'>>
    let cleared = 0
    for (const r of rows) {
      const list = starredByOf(r.starred_by)
      if (!list.includes(me)) continue
      const next = list.filter((x) => x !== me)
      db.run('UPDATE messages SET starred_by = ? WHERE id = ?', [
        next.length ? JSON.stringify(next) : null,
        r.id,
      ])
      cleared++
      const payload = { id: r.id, conversationId: conv.id, starredBy: next }
      io.to(`user:${conv.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conv.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
    }
    console.log(`User ${me.slice(0, 8)} unstarred all: ${cleared} messages`)
    ack({ ok: true, cleared })
  }))

  /**
   * v29 — batalkan SEMUA pesan terjadwal milik pemanggil yang belum
   * terkirim (hard delete, sama dengan messages:schedule_cancel per id).
   */
  socket.on('messages:schedule_cancel_all', handler(socket, (_data, ack) => {
    const me = authedUserId(socket)
    if (!me) {
      ack({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const rows = db
      .query(
        'SELECT id, conversation_id FROM messages WHERE sender_id = ? AND scheduled_at IS NOT NULL AND delivered_at IS NULL'
      )
      .all(me) as Array<Pick<MessageRow, 'id' | 'conversation_id'>>
    for (const r of rows) {
      db.run('DELETE FROM messages WHERE id = ?', [r.id])
      const conv = getConversation(r.conversation_id)
      if (conv) {
        const payload = { id: r.id, conversationId: conv.id }
        io.to(`user:${conv.user_a_id}`).emit('message:scheduled_cancelled', payload)
        io.to(`user:${conv.user_b_id}`).emit('message:scheduled_cancelled', payload)
        io.to('admins').emit('message:scheduled_cancelled', payload)
      }
    }
    if (rows.length > 0) {
      console.log(`User ${me.slice(0, 8)} cancelled ${rows.length} scheduled message(s)`)
    }
    ack({ ok: true, cancelled: rows.length })
  }))

  /** v29 — hapus SEMUA kode undangan yang belum terpakai sekali jalan. */
  socket.on('admin:invites_clear_unused', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const res = db.run('DELETE FROM invite_codes WHERE used_by IS NULL')
    audit('invite_clear_unused', `${res.changes} kode belum terpakai dihapus`)
    console.log(`Admin cleared ${res.changes} unused invite code(s)`)
    ack({ ok: true, removed: res.changes })
  }))

  /**
   * v29 — bersihkan jejak audit. Sengaja tetap menulis SATU entri baru
   * (audit_clear) setelah hapus supaya selalu ada jejak kapan log dibersihkan.
   */
  socket.on('admin:audit_clear', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const cnt = (db.query('SELECT COUNT(*) AS c FROM audit_log').get() as { c: number }).c
    db.run('DELETE FROM audit_log')
    audit('audit_clear', `${cnt} entri log dihapus admin`)
    console.log(`Admin cleared audit log: ${cnt} entries`)
    ack({ ok: true, removed: cnt })
  }))

  /**
   * v29 — kembalikan SEMUA pengaturan aplikasi ke default (hapus baris
   * kunci di APP_SETTING_RESET_KEYS; kunci lain — password admin, vapid,
   * dsb. — tidak tersentuh). Default diterapkan otomatis oleh getAppSettings.
   */
  socket.on('admin:settings:reset', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    for (const key of APP_SETTING_RESET_KEYS) {
      db.run('DELETE FROM settings WHERE key = ?', [key])
    }
    broadcastAppSettings()
    audit('settings_reset', 'pengaturan aplikasi dikembalikan ke default')
    console.log('Admin reset app settings to defaults')
    ack({ ok: true, settings: getAppSettings() })
  }))

  /**
   * v29 — hapus PERMANEN akun user + seluruh datanya (kebalikan
   * admin:user_create): pesan & reaksi & reads percakapannya, file media
   * yang tak lagi direferensikan, percakapan, perangkat, langganan push,
   * lalu baris user. Socket user langsung diputus. Kode undangan yang
   * pernah dipakai dibiarkan sebagai catatan sejarah. Akun admin tidak
   * bisa dihapus lewat event ini.
   */
  socket.on('admin:user_delete', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const target = userId ? findUserById(userId) : null
    if (!target || target.role !== 'user') {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    // Putuskan semua socket user lebih dulu (mencegah re-auth selama hapus).
    io.in(`user:${target.id}`).disconnectSockets(true)
    const convs = db
      .query('SELECT * FROM conversations WHERE user_a_id = ? OR user_b_id = ?')
      .all(target.id, target.id) as ConversationRow[]
    let deletedMessages = 0
    for (const conv of convs) {
      const mediaRows = db
        .query('SELECT content, thumb_url FROM messages WHERE conversation_id = ?')
        .all(conv.id) as Array<Pick<MessageRow, 'content' | 'thumb_url'>>
      db.run(
        'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)',
        [conv.id]
      )
      deletedMessages += db.run('DELETE FROM messages WHERE conversation_id = ?', [conv.id]).changes
      db.run('DELETE FROM reads WHERE conversation_id = ?', [conv.id])
      db.run('DELETE FROM conversations WHERE id = ?', [conv.id])
      for (const m of mediaRows) {
        releaseMediaFile(mediaNameOf(m.content))
        releaseMediaFile(mediaNameOf(m.thumb_url))
      }
    }
    db.run('DELETE FROM devices WHERE user_id = ?', [target.id])
    db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [target.id])
    db.run('DELETE FROM users WHERE id = ?', [target.id])
    audit(
      'user_delete',
      `akun "${target.name}" dihapus permanen (${deletedMessages} pesan, ${convs.length} percakapan)`
    )
    console.log(`Admin DELETED user "${target.name}" (${target.id}) — ${deletedMessages} messages`)
    // Beri tahu semua sesi admin agar overview/dashboard menyegarkan diri.
    io.to('admins').emit('users:changed', { userId: target.id, removed: true })
    pushConversationsTo(ADMIN_ID)
    ack({ ok: true, deletedMessages, conversations: convs.length })
  }))

  /** Full JSON backup (users, conversations, messages, app settings). */
  socket.on('admin:backup', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const settingsRows = (
      db.query('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    ).filter((r) => !r.key.startsWith('vapid')) // never export push secrets
    // v11 — audit trail.
    audit('backup', 'dump JSON penuh')
    ack({
      ok: true,
      exportedAt: new Date().toISOString(),
      version: SERVICE_VERSION,
      users: db.query('SELECT id, name, role, created_at, last_seen_at FROM users').all(),
      conversations: db.query('SELECT * FROM conversations').all(),
      messages: db.query('SELECT * FROM messages ORDER BY id ASC').all(),
      settings: settingsRows,
    })
  }))

  /**
   * v20 — Pusat: reset aplikasi. Menghapus SEMUA pesan, percakapan, pengguna
   * (kecuali Admin), pengaturan, langganan push, dan file media di db/media.
   * Jejak audit dipertahankan demi akuntabilitas.
   */
  socket.on('admin:reset_all', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    let wiped: ReturnType<typeof wipeChatData>
    try {
      db.run('BEGIN')
      wiped = wipeChatData()
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      console.error('admin:reset_all failed:', (err as Error)?.message ?? err)
      ack({ ok: false, error: 'RESET_FAILED' })
      return
    }
    const media = purgeMediaFiles()
    audit(
      'reset',
      `Pusat: reset aplikasi — ${wiped.messages} pesan, ${wiped.conversations} percakapan, ${wiped.users} pengguna dihapus, ${media.count} file media (${(media.bytes / 1_048_576).toFixed(1)} MiB) dibebaskan`
    )
    io.emit('app:reset')
    pushConversationsTo(ADMIN_ID)
    ack({ ok: true, deleted: wiped, mediaFiles: media.count, freedBytes: media.bytes })
  }))

  /**
   * v20 — Pusat: pulihkan backup JSON penuh (hasil admin:backup). Metadata
   * saja — file media tidak ikut dalam backup. Baris rusak dilewati.
   */
  socket.on('admin:restore', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const backup = (data?.backup ?? null) as Record<string, unknown> | null
    if (!backup || typeof backup !== 'object') {
      ack({ ok: false, error: 'INVALID_BACKUP' })
      return
    }
    const rawUsers = Array.isArray(backup.users) ? backup.users : []
    const rawConversations = Array.isArray(backup.conversations) ? backup.conversations : []
    const rawMessages = Array.isArray(backup.messages) ? backup.messages : []
    const rawSettings = Array.isArray(backup.settings) ? backup.settings : []
    const users = rawUsers.filter(isValidBackupUser)
    const conversations = rawConversations.filter(isValidBackupConversation)
    const messages = rawMessages.filter(isValidBackupMessage)
    const settings = rawSettings.filter(isValidBackupSetting)
    // Akun Admin wajib ada setelah pemulihan.
    if (!users.some((u) => u.id === ADMIN_ID)) {
      users.unshift({
        id: ADMIN_ID,
        name: ADMIN_NAME,
        role: 'admin',
        created_at: now(),
        last_seen_at: now(),
      })
    }

    try {
      db.run('BEGIN')
      wipeChatData()
      for (const u of users) {
        // OR REPLACE: baris Admin sengaja dipertahankan wipeChatData —
        // data admin dari backup menimpanya.
        db.run(
          'INSERT OR REPLACE INTO users (id, name, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
          [
            u.id,
            u.name,
            u.role === 'admin' ? 'admin' : 'user',
            isNum(u.created_at) ? u.created_at : now(),
            isNum(u.last_seen_at) ? u.last_seen_at : now(),
          ]
        )
      }
      for (const c of conversations) {
        db.run(
          'INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at, archived_at, pinned_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            c.id,
            c.user_a_id,
            c.user_b_id,
            c.created_at,
            c.last_message_at,
            isNum(c.archived_at) ? c.archived_at : null,
            isNum(c.pinned_message_id) ? c.pinned_message_id : null,
          ]
        )
      }
      const cols = RESTORE_MESSAGE_COLUMNS.join(', ')
      const marks = RESTORE_MESSAGE_COLUMNS.map(() => '?').join(', ')
      for (const m of messages) {
        const values = RESTORE_MESSAGE_COLUMNS.map((col) => {
          const v = m[col]
          return v === undefined ? null : v
        })
        db.run(`INSERT INTO messages (${cols}) VALUES (${marks})`, values)
      }
      for (const s of settings) {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [s.key, s.value])
      }
      const maxId = scalarCount('SELECT COALESCE(MAX(id), 0) AS v FROM messages')
      if (maxId > 0) {
        db.run('INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)', [
          'messages',
          maxId,
        ])
      }
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      console.error('admin:restore failed:', (err as Error)?.message ?? err)
      ack({ ok: false, error: 'RESTORE_FAILED' })
      return
    }

    audit(
      'restore',
      `Pusat: pulihkan backup ${typeof backup.exportedAt === 'string' ? backup.exportedAt : '?'} — ${users.length} pengguna, ${conversations.length} percakapan, ${messages.length} pesan, ${settings.length} pengaturan`
    )
    io.emit('app:reset')
    pushConversationsTo(ADMIN_ID)
    ack({
      ok: true,
      restored: {
        users: users.length,
        conversations: conversations.length,
        messages: messages.length,
        settings: settings.length,
      },
      skipped:
        rawUsers.length -
        users.length +
        (rawConversations.length - conversations.length) +
        (rawMessages.length - messages.length),
    })
  }))

  /** Manual WAL checkpoint + VACUUM with before/after disk sizes. */
  socket.on('admin:vacuum', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const sizeOf = (p: string): number => {
      try {
        return statSync(p).size
      } catch {
        return 0
      }
    }
    const before = { dbBytes: sizeOf(DB_PATH), walBytes: sizeOf(`${DB_PATH}-wal`) }
    dbMaintenance()
    const after = { dbBytes: sizeOf(DB_PATH), walBytes: sizeOf(`${DB_PATH}-wal`) }
    // v11 — audit trail.
    audit('vacuum', `db ${before.dbBytes} → ${after.dbBytes} bytes`)
    ack({ ok: true, before, after })
  }))

  /**
   * v13 — runtime info + audit tail for the Sistem tab: memory, runtime
   * version, live socket count, push subscriptions and the last audit rows.
   */
  socket.on('admin:system', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const mem = process.memoryUsage()
    const auditRows = db
      .query('SELECT action, detail, at FROM audit_log ORDER BY at DESC LIMIT 30')
      .all() as { action: string; detail: string; at: number }[]
    const scalarSys = (sql: string): number =>
      Number((db.query(sql).get() as { v: number | null } | undefined)?.v ?? 0)
    let onlineUserCount = 0
    for (const [id, sockets] of onlineSockets) {
      if (id !== ADMIN_ID && sockets.size > 0) onlineUserCount += 1
    }
    const auditCount = scalarSys('SELECT COUNT(*) AS v FROM audit_log')
    const pushSubs = scalarSys('SELECT COUNT(*) AS v FROM push_subscriptions')
    const flaggedCount = scalarSys('SELECT COUNT(*) AS v FROM messages WHERE flagged = 1')
    const keywords = getSettingList('keywords').length
    ack({
      ok: true,
      system: {
        generatedAt: new Date().toISOString(),
        runtime: typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`,
        platform: `${process.platform} ${process.arch}`,
        pid: process.pid,
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        socketClients: io.engine?.clientsCount ?? 0,
        onlineUsers: onlineUserCount,
        auditCount,
        pushSubs,
        flaggedCount,
        keywords,
        audit: auditRows.map((r) => ({
          action: r.action,
          detail: r.detail,
          at: new Date(r.at).toISOString(),
        })),
      },
    })
  }))

  /* ------------------------------------------------------------------ */
  /* v26 — Peta penyimpanan + pemindaian metadata media                  */
  /* ------------------------------------------------------------------ */

  socket.on('admin:storage_map', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    let dbBytes = 0
    let walBytes = 0
    try {
      dbBytes = statSync(DB_PATH).size
      walBytes = statSync(`${DB_PATH}-wal`).size
    } catch {
      /* WAL mungkin tidak ada */
    }
    const media = dirStats(MEDIA_DIR)

    const rows = db
      .query(
        `SELECT id, sender_id, conversation_id, type, mime_type, file_name, file_size, created_at, meta_json
         FROM messages
         WHERE file_size IS NOT NULL AND deleted_at IS NULL AND media_expired_at IS NULL`
      )
      .all() as (MessageRow & { meta_json?: string | null })[]

    const bucketOf = (r: MessageRow): string => {
      const m = (r.mime_type ?? '').toLowerCase()
      if (r.type === 'voice' || m.startsWith('audio/')) return 'audio'
      if (r.type === 'image' || m.startsWith('image/')) return 'image'
      if (m.startsWith('video/')) return 'video'
      if (m === 'application/pdf') return 'pdf'
      return 'file'
    }
    const parseMeta = (raw?: string | null): MediaMeta | null => {
      if (!raw) return null
      try {
        const v = JSON.parse(raw)
        return v && typeof v === 'object' ? (v as MediaMeta) : null
      } catch {
        return null
      }
    }

    const byType: Record<string, { count: number; bytes: number }> = {}
    const byUserMap = new Map<string, { count: number; bytes: number }>()
    let logicalBytes = 0
    let withMeta = 0
    let withoutMeta = 0
    for (const r of rows) {
      const size = Number(r.file_size ?? 0)
      logicalBytes += size
      const bucket = bucketOf(r)
      byType[bucket] ??= { count: 0, bytes: 0 }
      byType[bucket].count++
      byType[bucket].bytes += size
      const u = byUserMap.get(r.sender_id) ?? { count: 0, bytes: 0 }
      u.count++
      u.bytes += size
      byUserMap.set(r.sender_id, u)
      if (parseMeta(r.meta_json)) withMeta++
      else withoutMeta++
    }

    const largest = [...rows]
      .sort((a, b) => Number(b.file_size ?? 0) - Number(a.file_size ?? 0))
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        type: r.type ?? 'file',
        fileName: r.file_name ?? r.content,
        mime: r.mime_type ?? '',
        size: Number(r.file_size ?? 0),
        senderId: r.sender_id,
        senderName: findUserById(r.sender_id)?.name ?? r.sender_id,
        conversationId: r.conversation_id,
        createdAt: new Date(Number(r.created_at)).toISOString(),
        meta: parseMeta(r.meta_json),
      }))

    const byUser = [...byUserMap.entries()]
      .map(([id, v]) => ({ id, name: findUserById(id)?.name ?? id, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12)

    audit('storage_map', `${rows.length} media, ${media.files} file di disk`)
    ack({
      ok: true,
      map: {
        generatedAt: new Date().toISOString(),
        storage: {
          dbBytes,
          walBytes,
          mediaBytes: media.bytes,
          mediaFiles: media.files,
          quotaBytes: QUOTA_BYTES,
        },
        logicalBytes,
        byType,
        byUser,
        largest,
        coverage: { withMeta, withoutMeta },
      },
    })
  }))

  // Pindai media yang belum punya metadata → baca header file → isi meta_json.
  socket.on('admin:media_scan', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const pending = db
      .query(
        `SELECT id, content FROM messages
         WHERE meta_json IS NULL AND deleted_at IS NULL AND media_expired_at IS NULL
           AND (type = 'image' OR type = 'file') AND content LIKE '/api/media/%'
         LIMIT 500`
      )
      .all() as { id: number; content: string }[]
    let filled = 0
    for (const r of pending) {
      const meta = extractMediaMeta(mediaNameOf(r.content))
      if (meta) {
        db.run('UPDATE messages SET meta_json = ? WHERE id = ?', [JSON.stringify(meta), r.id])
        filled++
      }
    }
    const remaining = Number(
      (
        db
          .query(
            `SELECT COUNT(*) AS v FROM messages
             WHERE meta_json IS NULL AND deleted_at IS NULL AND media_expired_at IS NULL
               AND (type = 'image' OR type = 'file') AND content LIKE '/api/media/%'`
          )
          .get() as { v: number }
      ).v
    )
    audit('media_scan', `${filled}/${pending.length} terisi, sisa ${remaining}`)
    ack({ ok: true, scanned: pending.length, filled, remaining })
  }))

  /**
   * v35 — metadata lengkap satu pesan media untuk panel admin: isi meta_json
   * + info file (nama/jenis/ukuran/pengirim/waktu). Bila EXIF belum ada tapi
   * file masih di disk (pesan lama), baca SEKARANG dan persist (enrichment).
   * Khusus admin — user tidak pernah bisa memanggil ini.
   */
  socket.on('admin:message_meta', handler(socket, async (data, ack) => {
    if (!adminGuard(ack)) return
    const messageId = Number((data as { messageId?: unknown })?.messageId)
    if (!Number.isInteger(messageId) || messageId <= 0) {
      ack({ ok: false, error: 'invalid-id' })
      return
    }
    const row = db
      .query(
        `SELECT m.id, m.conversation_id, m.type, m.content, m.file_name,
                m.file_size, m.mime_type, m.created_at, m.meta_json,
                m.deleted_at, m.media_expired_at, m.sender_id,
                u.name AS sender_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`
      )
      .get(messageId) as
      | (Pick<MessageRow, 'id' | 'conversation_id' | 'type' | 'content' | 'file_name' |
           'file_size' | 'mime_type' | 'created_at' | 'deleted_at' | 'media_expired_at' | 'sender_id'>
        & { meta_json: string | null; sender_name: string | null })
      | undefined
    if (!row) {
      ack({ ok: false, error: 'not-found' })
      return
    }
    const mediaName = mediaNameOf(row.content)
    const isMedia =
      ['image', 'file', 'voice'].includes(row.type) && mediaName != null
    if (!isMedia || mediaName == null) {
      ack({ ok: false, error: 'not-media' })
      return
    }
    let meta: MediaMeta = {}
    try {
      meta = row.meta_json ? (JSON.parse(row.meta_json) as MediaMeta) : {}
    } catch {
      meta = {}
    }
    // Enrichment live: EXIF gambar belum tersimpan & file masih ada → baca +
    // simpan supaya pemanggilan berikutnya instan. Semua best-effort.
    try {
      const buf = readMediaHeader(mediaName)
      let enriched = false
      if (buf && buf.length >= 12 && isExifCapableImage(buf) && !meta.exif) {
        const exif = await extractExifMeta(buf)
        if (exif) {
          meta.exif = exif
          enriched = true
        }
      }
      if (!meta.width && buf) {
        const base = extractMediaMeta(mediaName)
        if (base) {
          meta = { ...base, ...meta, exif: meta.exif ?? base.exif }
          enriched = true
        }
      }
      if (enriched && !row.deleted_at && !row.media_expired_at) {
        db.run('UPDATE messages SET meta_json = ? WHERE id = ?', [
          JSON.stringify(meta),
          messageId,
        ])
      }
    } catch {
      /* enrichment pelengkap — respons tetap dikirim dengan meta yang ada */
    }
    audit('message_meta', `#${messageId} (${row.type})`)
    ack({
      ok: true,
      meta,
      file: {
        messageId: row.id,
        mediaName,
        fileName: row.file_name ?? null,
        mimeType: row.mime_type ?? null,
        fileSize: row.file_size ?? null,
        senderId: row.sender_id,
        senderName: row.sender_name ?? (row.sender_id === ADMIN_ID ? ADMIN_NAME : null),
        conversationId: row.conversation_id,
        createdAt: new Date(row.created_at).toISOString(),
        deleted: !!row.deleted_at,
        expired: !!row.media_expired_at,
      },
    })
  }))

  /** v37 — insight per-pengguna: statistik + ide otomatis utk admin. */
  socket.on('admin:user_insight', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = String((data as { userId?: unknown })?.userId ?? '')
    if (!userId || userId === ADMIN_ID) {
      ack({ ok: false, error: 'invalid-id' })
      return
    }
    const result = buildUserInsight(userId)
    if (!result) {
      ack({ ok: false, error: 'not-found' })
      return
    }
    audit('user_insight', result.user.name)
    ack({ ok: true, insight: result })
  }))

  /**
   * v13 — run the retention sweep right now (expire old media + free disk
   * files) so the admin does not have to wait for the periodic timer.
   */
  socket.on('admin:cleanup', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const before = dirStats(MEDIA_DIR)
    sweepExpiredMedia()
    dbMaintenance()
    const after = dirStats(MEDIA_DIR)
    audit('cleanup', `media ${(before.bytes / 1048576).toFixed(1)} → ${(after.bytes / 1048576).toFixed(1)} MiB`)
    ack({
      ok: true,
      before: { bytes: before.bytes, files: before.files },
      after: { bytes: after.bytes, files: after.files },
    })
  }))

  /** Admin ghost mode toggle (no read receipts while on). */
  socket.on('admin:ghost', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    socket.data.ghost = data?.on === true
    // v11 — audit trail.
    audit('ghost', socket.data.ghost ? 'on' : 'off')
    console.log(`Ghost mode ${socket.data.ghost ? 'ON' : 'OFF'} (socket ${socket.id})`)
    ack({ ok: true, ghost: socket.data.ghost })
  }))

  /* ------------------------------------------------------------------ */
  /* v11 — admin power features                                          */
  /* ------------------------------------------------------------------ */

  /** Loads the target user for restriction events (never the admin itself). */
  const restrictionTarget = (data: any, ack: AckFn): UserRow | null => {
    const target = typeof data?.userId === 'string' ? findUserById(data.userId) : null
    if (!target) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return null
    }
    if (target.id === ADMIN_ID) {
      ack({ ok: false, error: 'FORBIDDEN' })
      return null
    }
    return target
  }

  /** Fresh restriction snapshot after a users-table update. */
  const freshRestrictions = (userId: string) => {
    const fresh = findUserById(userId) as UserRow
    return restrictionsOf(fresh)
  }

  /* v11 — intel / x-ray ---------------------------- */

  socket.on('admin:xray', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const profile = userId ? buildXrayProfile(userId) : null
    if (!profile) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    ack({ ok: true, profile })
  }))

  socket.on('admin:forensics', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversationId =
      typeof data?.conversationId === 'string' && data.conversationId ? data.conversationId : null
    if (conversationId && !getConversation(conversationId)) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    ack({ ok: true, items: forensicsItems(conversationId) })
  }))

  socket.on('admin:edit_history', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    let items: { text: string; at: string }[] = []
    try {
      const parsed = row.edit_history ? JSON.parse(row.edit_history) : []
      if (Array.isArray(parsed)) {
        items = parsed
          .filter((e): e is { text: string; at: number } => !!e && typeof e === 'object' && typeof (e as any).text === 'string')
          .map((e) => ({ text: e.text, at: new Date(e.at ?? row.created_at).toISOString() }))
      }
    } catch {
      /* corrupt history — report empty */
    }
    ack({ ok: true, items })
  }))

  socket.on('admin:peek', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    // Explicit no-side-effect read: no markRead, no receipts, no broadcasts.
    const page = getMessagesPage(conversation.id)
    ack({ ok: true, conversationId: conversation.id, messages: page.messages, hasMore: page.hasMore })
  }))

  socket.on('admin:search', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const query = typeof data?.query === 'string' ? data.query.trim() : ''
    if (query.length < 2 || query.length > 100) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    ack({ ok: true, items: searchItems(query) })
  }))

  socket.on('admin:user_stats', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    ack({ ok: true, ...buildUserStats(target.id) })
  }))

  socket.on('admin:export_conversation', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const format = data?.format === 'json' ? 'json' : data?.format === 'txt' ? 'txt' : null
    if (!format) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const dump = buildConversationExport(conversation, format)
    audit('export_conversation', `${format}: ${dump.count} pesan (${conversation.id.slice(0, 8)})`)
    ack({ ok: true, ...dump })
  }))

  socket.on('admin:export_user', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const dump = buildUserExport(target.id)
    audit('export_user', `${target.name}: ${dump.count} pesan`)
    ack({ ok: true, format: 'json', ...dump })
  }))

  /* v11 — session control -------------------------- */

  socket.on('admin:kick', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const sockets = onlineSockets.get(target.id)?.size ?? 0
    // Force-close every socket in the user's personal room. The client will
    // auto-reconnect (documented behavior — this is a "disconnect whip").
    io.in(`user:${target.id}`).disconnectSockets(true)
    audit('kick', `${target.name} (${sockets} socket)`)
    console.log(`Kicked ${target.name}: ${sockets} socket(s)`)
    ack({ ok: true, sockets })
  }))

  socket.on('admin:freeze', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const on = data?.on !== false
    db.run('UPDATE users SET frozen = ? WHERE id = ?', [on ? 1 : 0, target.id])
    pushRestrictedTo(target.id)
    audit('freeze', `${target.name}: ${on ? 'BEKU' : 'lepas'}`)
    ack({ ok: true, frozen: on, restricted: freshRestrictions(target.id) })
  }))

  socket.on('admin:mute', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const minutes = Number(data?.minutes)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    // minutes = 0 clears an active mute early (extension beyond the 1–1440 spec).
    const mutedUntil = minutes > 0 ? now() + minutes * 60_000 : 0
    db.run('UPDATE users SET muted_until = ? WHERE id = ?', [mutedUntil, target.id])
    pushRestrictedTo(target.id)
    audit('mute', `${target.name}: ${minutes} menit`)
    ack({
      ok: true,
      mutedUntil: mutedUntil > 0 ? new Date(mutedUntil).toISOString() : null,
      restricted: freshRestrictions(target.id),
    })
  }))

  socket.on('admin:slowmode', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const perMinute = Number(data?.perMinute)
    if (![0, 1, 2, 3, 5, 10].includes(perMinute)) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    db.run('UPDATE users SET slow_mode = ? WHERE id = ?', [perMinute, target.id])
    pushRestrictedTo(target.id)
    audit('slowmode', `${target.name}: ${perMinute}/menit`)
    ack({ ok: true, perMinute, restricted: freshRestrictions(target.id) })
  }))

  socket.on('admin:mediablock', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const on = data?.on !== false
    db.run('UPDATE users SET media_blocked = ? WHERE id = ?', [on ? 1 : 0, target.id])
    pushRestrictedTo(target.id)
    audit('mediablock', `${target.name}: ${on ? 'BLOK media' : 'lepas'}`)
    ack({ ok: true, mediaBlocked: on, restricted: freshRestrictions(target.id) })
  }))

  /* v11 — fake signals ----------------------------- */

  socket.on('admin:fake_typing', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation || !isParticipant(conversation, ADMIN_ID)) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    // Same event shape the user side already understands from real admin typing.
    io.to(`user:${getPartnerId(conversation, ADMIN_ID)}`).emit('partner:typing', {
      conversationId: conversation.id,
      isTyping: data?.on === true,
    })
    ack({ ok: true })
  }))

  socket.on('admin:always_online', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const on = data?.on !== false
    setSetting('always_online', on ? '1' : '0')
    audit('always_online', on ? 'on' : 'off')
    ack({ ok: true, alwaysOnline: on })
  }))

  socket.on('admin:fake_last_seen', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const value = typeof data?.value === 'string' ? data.value.trim() : ''
    if (value.length > 40) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    setSetting('fake_last_seen', value) // '' = off
    audit('fake_last_seen', value ? `"${value}"` : 'off')
    ack({ ok: true, fakeLastSeen: value })
  }))

  socket.on('admin:fake_receipts', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const target =
      (db
        .query('SELECT MAX(id) AS max_id FROM messages WHERE conversation_id = ?')
        .get(conversation.id) as { max_id: number | null }).max_id ?? 0
    const count = Number(
      (db
        .query('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
        .get(conversation.id) as { c: number }).c
    )
    // Pure illusion: broadcast the receipt WITHOUT touching reads in the DB.
    if (target > 0) broadcastRead(conversation, ADMIN_ID, target)
    ack({ ok: true, count, lastReadMessageId: target })
  }))

  /* ------------------------------------------------------------------ */
  /* v25 — PUSAT CHEAT: seluruh fitur cheat admin dikumpulkan satu tempat */
  /* ------------------------------------------------------------------ */

  /** Percakapan user↔admin milik sebuah user (null bila tidak ada). */
  const cheatConvOf = (userId: string): ConversationRow | null => {
    if (!userId || userId === ADMIN_ID) return null
    const conv = db
      .query('SELECT * FROM conversations WHERE user_a_id = ? OR user_b_id = ?')
      .get(userId, userId) as ConversationRow | null
    if (!conv || !isParticipant(conv, ADMIN_ID)) return null
    return conv
  }

  /**
   * Validasi epoch ms cheat (backdate/ubah waktu): maksimal 90 hari ke
   * belakang dan 1 hari ke depan. `null` = tidak ada/invalid (ack terkirim).
   */
  const cheatTsOf = (raw: unknown, ack: AckFn): number | null => {
    if (raw == null) return now()
    const t = Number(raw)
    if (!Number.isFinite(t) || t > now() + 86_400_000 || t < now() - 90 * 86_400_000) {
      ack({ ok: false, error: 'INVALID_SCHEDULE' })
      return null
    }
    return Math.round(t)
  }

  // Peek percakapan target untuk UI Pusat Cheat: daftar pesan + keadaan
  // seluruh saklar cheat (tanpa efek samping — tidak menandai dibaca).
  socket.on('admin:cheat_peek', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const conv = cheatConvOf(userId)
    if (!conv) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const page = getMessagesPage(conv.id)
    ack({
      ok: true,
      conversationId: conv.id,
      messages: page.messages,
      hasMore: page.hasMore,
      cheatState: {
        alwaysOnline: getBoolSetting('always_online'),
        mirror: getBoolSetting('mirror_mode'),
        ghost: socket.data.ghost === true,
        fakeLastSeen: getSetting('fake_last_seen') ?? '',
      },
    })
  }))

  // Kirim pesan TEKS atas nama user lain (spoof), dengan backdate opsional
  // (maks 90 hari ke belakang). Persis pesan asli: insert DB + fan-out
  // message:new + push notifikasi — penerima tidak bisa membedakannya.
  socket.on('admin:cheat_send', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    if (!userId || text.length < 1 || text.length > MAX_MESSAGE_LENGTH) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const conv = cheatConvOf(userId)
    if (!conv) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const ts = cheatTsOf(data?.createdAt, ack)
    if (ts == null) return
    const message = insertAndFanOut(conv, userId, text, 'text', { ts })
    audit('cheat_send', `${findUserById(userId)?.name ?? userId}: "${text.slice(0, 40)}"`)
    ack({ ok: true, message })
    console.log(`[cheat] spoof as ${userId.slice(0, 8)} -> ${conv.id.slice(0, 8)}`)
  }))

  // Edit isi pesan TEKS siapa saja (tanpa jendela waktu, tanpa cek pengirim);
  // teks lama tetap dicatat di edit_history agar ForensicsDialog melihatnya.
  socket.on('admin:cheat_edit', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const content = typeof data?.text === 'string' ? data.text.trim() : ''
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      content.length < 1 ||
      content.length > MAX_MESSAGE_LENGTH
    ) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
    if (!row || row.deleted_at || (row.type ?? 'text') !== 'text') {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    let history: { text: string; at: number }[] = []
    try {
      const parsed = row.edit_history ? JSON.parse(row.edit_history) : []
      if (Array.isArray(parsed)) {
        history = parsed.filter(
          (e): e is { text: string; at: number } =>
            !!e && typeof e === 'object' && typeof (e as any).text === 'string'
        )
      }
    } catch {
      /* riwayat korup — mulai baru */
    }
    history.push({ text: row.content, at: row.edited_at ?? row.created_at })
    if (history.length > MAX_EDIT_HISTORY_ENTRIES) {
      history = history.slice(-MAX_EDIT_HISTORY_ENTRIES)
    }
    const ts = now()
    db.run('UPDATE messages SET content = ?, edited_at = ?, edit_history = ? WHERE id = ?', [
      content,
      ts,
      JSON.stringify(history),
      id,
    ])
    audit('cheat_edit', `#${id}: "${content.slice(0, 40)}"`)
    ack({ ok: true })
    const payload = {
      id,
      conversationId: conversation.id,
      content,
      editedAt: new Date(ts).toISOString(),
    }
    io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
    io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
    io.to('admins').emit('message:updated', payload)
    pushConversationsTo(conversation.user_a_id)
    pushConversationsTo(conversation.user_b_id)
    console.log(`[cheat] edit message ${id}`)
  }))

  // Reaksi emoji atas nama user lain (toggle, mekanisme sama dgn message:react).
  socket.on('admin:cheat_react', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const emoji = typeof data?.emoji === 'string' ? data.emoji : ''
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !(REACTION_EMOJIS as readonly string[]).includes(emoji)
    ) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
    if (!row || row.deleted_at) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation || !isParticipant(conversation, userId)) {
      ack({ ok: false, error: 'FORBIDDEN' })
      return
    }
    const existing = db
      .query('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
      .get(id, userId) as { emoji: string } | null
    if (existing && existing.emoji === emoji) {
      db.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [id, userId])
    } else {
      db.run(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji',
        [id, userId, emoji]
      )
    }
    audit('cheat_react', `#${id} ${emoji} sebagai ${findUserById(userId)?.name ?? userId}`)
    ack({ ok: true })
    const payload = { id, conversationId: conversation.id, reactions: reactionsFor(id) }
    io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
    io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
    io.to('admins').emit('message:updated', payload)
  }))

  // Ubah waktu (created_at) pesan siapa saja — backdate/forward-date; klien
  // memperbarui chip waktu + pemisah hari lewat message:updated.createdAt.
  socket.on('admin:cheat_time', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    if (!Number.isInteger(id) || id <= 0) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const ts = cheatTsOf(data?.createdAt, ack)
    if (ts == null) return
    const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
    if (!row || row.deleted_at) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    db.run('UPDATE messages SET created_at = ? WHERE id = ?', [ts, id])
    audit('cheat_time', `#${id} -> ${new Date(ts).toISOString()}`)
    ack({ ok: true })
    const payload = {
      id,
      conversationId: conversation.id,
      createdAt: new Date(ts).toISOString(),
    }
    io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
    io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
    io.to('admins').emit('message:updated', payload)
    pushConversationsTo(conversation.user_a_id)
    pushConversationsTo(conversation.user_b_id)
    console.log(`[cheat] time message ${id} -> ${new Date(ts).toISOString()}`)
  }))

  /* ------------------------------------------------------------------ */
  /* v38 — KONTROL USER LENGKAP: media control per-user (toolbar admin)  */
  /* ------------------------------------------------------------------ */

  /** Parser meta_json ringan (dimensi/halaman) untuk daftar media. */
  const mediaMetaDims = (
    raw?: string | null
  ): { width?: number; height?: number; pages?: number } => {
    if (!raw) return {}
    try {
      const m = JSON.parse(raw) as { width?: unknown; height?: unknown; pages?: unknown }
      const num = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
      return { width: num(m.width), height: num(m.height), pages: num(m.pages) }
    } catch {
      return {}
    }
  }

  /**
   * v38 — tombstone SATU pesan media memakai pipeline hapus resmi (isi asli
   * disimpan ke deleted_content untuk forensik), lalu bebaskan file disk
   * saat tak ada lagi pesan hidup yang mereferensikannya (SHA-256 dedup
   * aware). Kuota longgar otomatis karena storedMediaBytes hanya menghitung
   * baris hidup. Return file_size lama sebagai ukuran pembebasan.
   */
  const mediaTombstoneRow = (
    row: MessageRow,
    conversation: ConversationRow,
    ts: number
  ): number => {
    const freed = row.file_size ?? 0
    tombstoneMessage(row, conversation, ts)
    releaseMediaFile(mediaNameOf(row.content))
    releaseMediaFile(mediaNameOf(row.thumb_url))
    return freed
  }

  // Daftar SEMUA media hidup di percakapan user↔admin (terbaru dulu) +
  // total per sisi — read-only, untuk pill "🖼 Media" di toolbar admin.
  socket.on('admin:user_media', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const conv = cheatConvOf(userId)
    if (!conv) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const rows = db
      .query(
        `SELECT id, sender_id, type, content, file_name, file_size, mime_type,
                thumb_url, caption, duration_ms, created_at, meta_json
         FROM messages
         WHERE conversation_id = ? AND deleted_at IS NULL AND media_expired_at IS NULL
           AND type IN ('image', 'voice', 'file')
         ORDER BY created_at DESC, id DESC`
      )
      .all(conv.id) as Array<
        Pick<
          MessageRow,
          | 'id'
          | 'sender_id'
          | 'type'
          | 'content'
          | 'file_name'
          | 'file_size'
          | 'mime_type'
          | 'thumb_url'
          | 'caption'
          | 'duration_ms'
          | 'created_at'
          | 'meta_json'
        >
      >
    let bytes = 0
    let fromUserBytes = 0
    let fromUserCount = 0
    const items = rows.map((r) => {
      const size = r.file_size ?? 0
      bytes += size
      if (r.sender_id === userId) {
        fromUserBytes += size
        fromUserCount += 1
      }
      return {
        messageId: r.id,
        senderId: r.sender_id,
        fromUser: r.sender_id === userId,
        type: (r.type ?? 'file') as 'image' | 'voice' | 'file',
        url: r.content,
        thumbUrl: r.thumb_url ?? undefined,
        fileName: r.file_name ?? undefined,
        fileSize: r.file_size ?? undefined,
        mimeType: r.mime_type ?? undefined,
        caption: r.caption ?? undefined,
        durationMs: r.duration_ms ?? undefined,
        createdAt: new Date(r.created_at).toISOString(),
        ...mediaMetaDims(r.meta_json),
      }
    })
    ack({
      ok: true,
      conversationId: conv.id,
      items,
      totals: { count: rows.length, bytes, fromUserCount, fromUserBytes },
    })
  }))

  // Hapus SATU media (pipeline hapus resmi: tombstone + bebaskan file disk;
  // isi asli tetap tersimpan di deleted_content untuk forensik).
  socket.on('admin:media_delete', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row || row.deleted_at || row.media_expired_at) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const type = row.type ?? 'text'
    if (type !== 'image' && type !== 'voice' && type !== 'file') {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const freed = mediaTombstoneRow(row, conversation, now())
    const senderName = findUserById(row.sender_id)?.name ?? row.sender_id
    audit('media_delete', `${senderName}: ${type} #${id} (${freed} B)`)
    console.log(`[media-control] #${id} (${type}) deleted by ADMIN, freed ${freed} B`)
    ack({ ok: true, messageId: id, freedBytes: freed })
  }))

  // Hapus SEMUA media percakapan (scope "user" = hanya yang dikirim user
  // target; scope "all" = seluruh media percakapan dua sisi).
  socket.on('admin:media_delete_all', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const userId = typeof data?.userId === 'string' ? data.userId : ''
    const conv = cheatConvOf(userId)
    if (!conv) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const scope = data?.scope === 'all' ? 'all' : 'user'
    const rows = (
      scope === 'user'
        ? db
            .query(
              `SELECT * FROM messages
               WHERE conversation_id = ? AND sender_id = ?
                 AND deleted_at IS NULL AND media_expired_at IS NULL
                 AND type IN ('image', 'voice', 'file')`
            )
            .all(conv.id, userId)
        : db
            .query(
              `SELECT * FROM messages
               WHERE conversation_id = ?
                 AND deleted_at IS NULL AND media_expired_at IS NULL
                 AND type IN ('image', 'voice', 'file')`
            )
            .all(conv.id)
    ) as MessageRow[]
    const ts = now()
    let freed = 0
    for (const row of rows) {
      freed += mediaTombstoneRow(row, conv, ts)
    }
    if (rows.length > 0) {
      pushConversationsTo(conv.user_a_id)
      pushConversationsTo(conv.user_b_id)
    }
    audit(
      'media_delete_all',
      `${findUserById(userId)?.name ?? userId}: ${rows.length} media (scope ${scope}, ${freed} B)`
    )
    console.log(`[media-control] ${rows.length} media cleared (scope ${scope}), freed ${freed} B`)
    ack({ ok: true, deleted: rows.length, freedBytes: freed })
  }))

  /* ------------------------------------------------------------------ */
  /* v39 — KENDALI PER-USER TAMBAHAN: rename, bulk delete, bot balasan,  */
  /*       push custom, kuota khusus (panel X-Ray Manajemen pengguna)    */
  /* ------------------------------------------------------------------ */

  // Ganti nama tampilan/login user (aturan sama dengan admin:user_create).
  socket.on('admin:user_rename', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const name = typeof data?.name === 'string' ? data.name.trim() : ''
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      ack({ ok: false, error: 'INVALID_NAME' })
      return
    }
    if (name.toLowerCase() === ADMIN_NAME.toLowerCase()) {
      ack({ ok: false, error: 'NAME_RESERVED' })
      return
    }
    const clash = findUserByRoleAndName(name, 'user')
    if (clash && clash.id !== target.id) {
      ack({ ok: false, error: 'NAME_TAKEN' })
      return
    }
    const oldName = target.name
    db.run('UPDATE users SET name = ? WHERE id = ?', [name, target.id])
    audit('rename', `"${oldName}" -> "${name}"`)
    pushConversationsTo(target.id)
    pushConversationsTo(ADMIN_ID)
    ack({ ok: true, name })
    console.log(`[user-control] rename "${oldName}" -> "${name}"`)
  }))

  // Tombstone SEMUA pesan hidup milik user (semua percakapan, semua jenis)
  // via pipeline hapus resmi; file disk media ikut dibebaskan (dedup aware).
  socket.on('admin:bulk_delete_user', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const rows = db
      .query('SELECT * FROM messages WHERE sender_id = ? AND deleted_at IS NULL')
      .all(target.id) as MessageRow[]
    const ts = now()
    let freed = 0
    const convIds = new Set<string>()
    for (const row of rows) {
      const conv = getConversation(row.conversation_id)
      if (!conv) continue
      const type = row.type ?? 'text'
      if (type === 'image' || type === 'voice' || type === 'file') {
        freed += mediaTombstoneRow(row, conv, ts)
      } else {
        tombstoneMessage(row, conv, ts)
      }
      convIds.add(conv.id)
    }
    for (const cid of convIds) {
      const conv = getConversation(cid)
      if (!conv) continue
      pushConversationsTo(conv.user_a_id)
      pushConversationsTo(conv.user_b_id)
    }
    audit('bulk_delete_user', `${target.name}: ${rows.length} pesan (${freed} B media)`)
    console.log(`[user-control] bulk delete ${target.name}: ${rows.length} pesan, ${freed} B`)
    ack({ ok: true, deleted: rows.length, freedBytes: freed })
  }))

  // Bot balasan otomatis per-user: on/off + teks (1–300) + jeda (0–120 dtk).
  socket.on('admin:user_bot', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const on = data?.on === true
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    const delaySec = Math.round(Number(data?.delaySec ?? 3))
    if (on && (text.length < 1 || text.length > 300)) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    if (!Number.isInteger(delaySec) || delaySec < 0 || delaySec > 120) {
      ack({ ok: false, error: 'INVALID_SCHEDULE' })
      return
    }
    db.run(
      'UPDATE users SET bot_reply_on = ?, bot_reply_text = ?, bot_reply_delay_ms = ? WHERE id = ?',
      [on ? 1 : 0, on ? text : null, delaySec * 1000, target.id]
    )
    clearBotTimer(target.id) // konfigurasi berubah → batalkan balasan pending
    audit(
      'bot_reply',
      `${target.name}: ${on ? `ON "${text.slice(0, 40)}" (${delaySec} dtk)` : 'OFF'}`
    )
    ack({ ok: true, bot: { on, text: on ? text : null, delaySec } })
    console.log(`[user-control] bot ${target.name}: ${on ? `on (${delaySec}s)` : 'off'}`)
  }))

  // Web push custom ke semua langganan push milik user (judul + isi bebas).
  socket.on('admin:user_push', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const title = typeof data?.title === 'string' ? data.title.trim() : ''
    const body = typeof data?.body === 'string' ? data.body.trim() : ''
    if (title.length < 1 || title.length > 60 || body.length < 1 || body.length > 200) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const subs = db
      .query('SELECT COUNT(*) AS v FROM push_subscriptions WHERE user_id = ?')
      .get(target.id) as { v: number | null }
    void pushSend(target.id, { title, body, url: '/' })
    audit('push_prank', `${target.name}: "${title}" — "${body.slice(0, 40)}"`)
    ack({ ok: true, subscriptions: Number(subs.v ?? 0) })
    console.log(`[user-control] push ke ${target.name}: ${subs.v ?? 0} langganan`)
  }))

  // Kuota media khusus per-user (MiB); 0 = kembali ke default global 250 MiB.
  socket.on('admin:user_quota', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const mb = Math.round(Number(data?.mb))
    if (!Number.isInteger(mb) || mb < 0 || mb > 102_400) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    db.run('UPDATE users SET media_quota_mb = ? WHERE id = ?', [mb, target.id])
    audit('quota', `${target.name}: ${mb === 0 ? 'default 250 MiB' : `${mb} MiB`}`)
    const fresh = findUserById(target.id) as UserRow // hindari ack dari row lama
    ack({
      ok: true,
      quotaMb: mb,
      quotaBytes: effectiveQuotaBytes(fresh),
      usedBytes: storedMediaBytes(target.id),
    })
    console.log(`[user-control] kuota ${target.name}: ${mb} MiB`)
  }))

  socket.on('admin:quick_replies:get', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    ack({ ok: true, items: getSettingList('quick_replies') })
  }))

  socket.on('admin:quick_replies:set', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const raw = Array.isArray(data?.items) ? data.items : null
    if (!raw || raw.length > 20) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const items: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string') {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const v = item.trim()
      if (v.length < 1 || v.length > 200) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      items.push(v)
    }
    setSetting('quick_replies', JSON.stringify(items))
    audit('quick_replies', `${items.length} template`)
    ack({ ok: true, items })
  }))

  /* ------------------- v40 — pusat kendali per-user ------------------- */

  // v40 — filter kata per-user: blokir total atau sensor otomatis.
  socket.on('admin:word_filter', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const words = typeof data?.words === 'string' ? data.words.trim().slice(0, 2000) : ''
    const action = data?.action === 'censor' ? 'censor' : 'block'
    db.run('UPDATE users SET word_filter = ?, word_filter_action = ? WHERE id = ?', [
      words || null,
      action,
      target.id,
    ])
    const count = wordFilterWords({ word_filter: words }).length
    audit('word_filter', `${target.name}: ${action} (${count} kata)`)
    ack({ ok: true, words, action })
  }))

  // v40 — mode persetujuan pra-kirim: semua pesan user masuk antrean admin.
  socket.on('admin:approval_mode', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const on = data?.on !== false
    db.run('UPDATE users SET approval_mode = ? WHERE id = ?', [on ? 1 : 0, target.id])
    audit('approval_mode', `${target.name}: ${on ? 'ON' : 'OFF'}`)
    ack({ ok: true, on })
  }))

  // v40 — blokir media per jenis (foto/voice/file) per-user.
  socket.on('admin:media_types', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const ALLOWED = ['image', 'voice', 'file']
    const raw = Array.isArray(data?.blocked) ? data.blocked : []
    const blocked = raw.filter((t: unknown) => typeof t === 'string' && ALLOWED.includes(t as string))
    db.run('UPDATE users SET blocked_media_types = ? WHERE id = ?', [blocked.join(','), target.id])
    audit('media_types', `${target.name}: ${blocked.join(',') || '-'}`)
    ack({ ok: true, blocked })
  }))

  // v40 — paksa logout: hapus semua perangkat + akhiri semua sesi socket.
  socket.on('admin:user_force_logout', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const dev = db.query('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?').get(target.id) as { c: number }
    db.run('DELETE FROM devices WHERE user_id = ?', [target.id])
    const sockets = onlineSockets.get(target.id)?.size ?? 0
    io.in(`user:${target.id}`).emit('session:revoked', { by: 'admin' })
    io.in(`user:${target.id}`).disconnectSockets(true)
    audit('force_logout', `${target.name} (${dev.c} perangkat, ${sockets} socket)`)
    console.log(`[force-logout] ${target.name}: ${dev.c} perangkat dilepas, ${sockets} socket diputus`)
    ack({ ok: true, devices: dev.c, sockets })
  }))

  // v40 — catatan & tag admin per user (khusus admin, tak terlihat user).
  socket.on('admin:user_note', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const note = typeof data?.note === 'string' ? data.note.trim().slice(0, 2000) : ''
    const tagRaw = typeof data?.tag === 'string' ? data.tag : ''
    const tag = ['vip', 'attention', 'problem'].includes(tagRaw) ? tagRaw : ''
    db.run('UPDATE users SET admin_note = ?, tag = ? WHERE id = ?', [note || null, tag, target.id])
    audit('user_note', `${target.name}: tag=${tag || '-'} catatan=${note.length} kar`)
    ack({ ok: true, note, tag })
  }))

  // v40 — leaderboard: peringkat pesan/media/aktif/balas-tercepat.
  socket.on('admin:leaderboard', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const users = db
      .query("SELECT id, name, last_seen_at FROM users WHERE role = 'user'")
      .all() as Array<{ id: string; name: string; last_seen_at: number }>
    const rows = users.map((u) => {
      const counts = db
        .query(
          `SELECT COUNT(*) AS c,
                  COALESCE(SUM(CASE WHEN type IN ('image','voice','file') THEN 1 ELSE 0 END), 0) AS media,
                  COALESCE(SUM(CASE WHEN file_size IS NOT NULL AND deleted_at IS NULL THEN file_size ELSE 0 END), 0) AS bytes
           FROM messages WHERE sender_id = ? AND deleted_at IS NULL`
        )
        .get(u.id) as { c: number; media: number; bytes: number }
      const conv = db
        .query(
          "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
        )
        .get(u.id, u.id) as { id: string } | undefined
      let avgReplySec: number | null = null
      if (conv) {
        const mrows = db
          .query(
            'SELECT sender_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND (pending IS NULL OR pending = 0) ORDER BY created_at ASC, id ASC'
          )
          .all(conv.id) as Array<{ sender_id: string; created_at: number }>
        let sum = 0
        let n = 0
        let lastAdminAt: number | null = null
        for (const r of mrows) {
          if (r.sender_id === ADMIN_ID) lastAdminAt = r.created_at
          else if (lastAdminAt != null) {
            const d = r.created_at - lastAdminAt
            if (d >= 0 && d <= 12 * 3_600_000) {
              sum += d
              n += 1
            }
            lastAdminAt = null
          }
        }
        if (n > 0) avgReplySec = Math.round(sum / n / 1000)
      }
      return {
        userId: u.id,
        name: u.name,
        msgs: Number(counts.c ?? 0),
        media: Number(counts.media ?? 0),
        bytes: Number(counts.bytes ?? 0),
        lastSeenAt: new Date(u.last_seen_at).toISOString(),
        avgReplySec,
      }
    })
    const top = (arr: typeof rows, cmp: (a: (typeof rows)[number], b: (typeof rows)[number]) => number) =>
      [...arr].sort(cmp).slice(0, 5).map((r) => r.userId)
    ack({
      ok: true,
      rows,
      rankings: {
        msgs: top(rows, (a, b) => b.msgs - a.msgs),
        media: top(rows, (a, b) => b.media - a.media),
        active: top(rows, (a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1)),
        reply: top(
          rows.filter((r) => r.avgReplySec != null),
          (a, b) => (a.avgReplySec ?? 0) - (b.avgReplySec ?? 0)
        ),
      },
    })
  }))

  // v40 — bandingkan dua user berdampingan (insight A vs B).
  socket.on('admin:user_compare', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const a = buildUserInsight(typeof data?.userIdA === 'string' ? data.userIdA : '')
    const b = buildUserInsight(typeof data?.userIdB === 'string' ? data.userIdB : '')
    if (!a || !b) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    ack({ ok: true, a, b })
  }))

  // v40 — riwayat login historis (50 terakhir).
  socket.on('admin:user_logins', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const rows = db
      .query(
        'SELECT at, ip, user_agent, kind FROM login_events WHERE user_id = ? ORDER BY at DESC LIMIT 50'
      )
      .all(target.id) as Array<{ at: number; ip: string | null; user_agent: string | null; kind: string }>
    ack({
      ok: true,
      events: rows.map((r) => ({
        at: new Date(r.at).toISOString(),
        ip: r.ip,
        userAgent: r.user_agent,
        kind: r.kind,
      })),
    })
  }))

  // v40 — pesan terjadwal admin ke user (reuse kolom scheduled_at v22 —
  // deliverDueScheduled yang sudah ada yang mengirimkannya tepat waktu).
  socket.on('admin:schedule_message', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    const sendAtMs = Number(data?.sendAtMs)
    if (
      text.length < 1 ||
      text.length > 1000 ||
      !Number.isFinite(sendAtMs) ||
      sendAtMs < now() + 5_000 ||
      sendAtMs > now() + 30 * 86_400_000
    ) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const conv = adminConversationWith(target.id)
    const result = db.run(
      "INSERT INTO messages (conversation_id, sender_id, content, created_at, type, flagged, scheduled_at) VALUES (?, ?, ?, ?, 'text', 0, ?)",
      [conv.id, ADMIN_ID, text, now(), Math.round(sendAtMs)]
    )
    audit('schedule_message', `${target.name} @ ${new Date(Math.round(sendAtMs)).toISOString()}`)
    ack({ ok: true, id: Number(result.lastInsertRowid), sendAtMs: Math.round(sendAtMs) })
  }))

  // v40 — daftar pesan terjadwal yang belum terkirim untuk satu user.
  socket.on('admin:schedule_list', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const conv = adminConversationWith(target.id)
    const rows = db
      .query(
        'SELECT id, content, scheduled_at FROM messages WHERE conversation_id = ? AND scheduled_at IS NOT NULL AND delivered_at IS NULL AND deleted_at IS NULL ORDER BY scheduled_at ASC'
      )
      .all(conv.id) as Array<{ id: number; content: string; scheduled_at: number }>
    ack({
      ok: true,
      items: rows.map((r) => ({ id: r.id, text: r.content, sendAtMs: r.scheduled_at })),
    })
  }))

  // v40 — batalkan pesan terjadwal milik admin yang belum terkirim.
  socket.on('admin:schedule_cancel', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row || row.scheduled_at == null || row.delivered_at != null || row.sender_id !== ADMIN_ID) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    db.run('DELETE FROM messages WHERE id = ?', [row.id])
    audit('schedule_cancel', `#${row.id}`)
    ack({ ok: true })
  }))

  // v40 — balasan cepat per-user: daftar template + kirim instan.
  socket.on('admin:quick_reply_list', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    let items: string[] = []
    try {
      const arr = JSON.parse(target.quick_replies ?? '[]')
      if (Array.isArray(arr)) items = arr.filter((x) => typeof x === 'string').slice(0, 20)
    } catch {
      items = []
    }
    ack({ ok: true, items })
  }))

  socket.on('admin:quick_reply_set', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const raw = Array.isArray(data?.items) ? data.items : null
    if (!raw || raw.length > 20) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const items: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string') {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const v = item.trim()
      if (v.length < 1 || v.length > 500) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      items.push(v)
    }
    db.run('UPDATE users SET quick_replies = ? WHERE id = ?', [JSON.stringify(items), target.id])
    audit('quick_reply_set', `${target.name}: ${items.length} template`)
    ack({ ok: true, items })
  }))

  socket.on('admin:quick_send', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    if (text.length < 1 || text.length > 1000) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const message = sendAsAdminToUser(target.id, text)
    if (!message) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    audit('quick_send', `${target.name}: ${text.slice(0, 80)}`)
    ack({ ok: true, message })
  }))

  // v40 — pengingat otomatis: user diam X hari → bot admin mengirim pesan.
  socket.on('admin:user_nudge', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const days = Math.round(Number(data?.days))
    const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 500) : ''
    if (!Number.isInteger(days) || days < 0 || days > 30 || (days > 0 && !text)) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    db.run('UPDATE users SET nudge_days = ?, nudge_text = ?, nudge_last_at = 0 WHERE id = ?', [
      days,
      days > 0 ? text : null,
      target.id,
    ])
    audit('user_nudge', `${target.name}: ${days === 0 ? 'nonaktif' : `${days} hari`}`)
    ack({ ok: true, days, text: days > 0 ? text : null })
  }))

  // v40 — auto-bersih chat per-user: pesan > X hari di-tombstone otomatis.
  socket.on('admin:user_autoclean', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const days = Math.round(Number(data?.days))
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    db.run('UPDATE users SET auto_clean_days = ? WHERE id = ?', [days, target.id])
    audit('user_autoclean', `${target.name}: ${days === 0 ? 'nonaktif' : `${days} hari`}`)
    ack({ ok: true, days })
  }))

  // v40 — unduh semua media hidup user sebagai ZIP (fflate, level store).
  socket.on('admin:user_media_zip', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const { files, totalBytes, skipped } = collectUserMediaFiles(target.id)
    if (files.length === 0) {
      ack({ ok: false, error: 'NO_MEDIA' })
      return
    }
    if (totalBytes > 40 * 1_048_576) {
      ack({ ok: false, error: 'TOO_LARGE', bytes: totalBytes })
      return
    }
    const map: Record<string, Uint8Array> = {}
    for (const f of files) map[f.name] = f.bytes
    const zipped = zipSync(map, { level: 0 })
    const b64 = Buffer.from(zipped).toString('base64')
    audit('media_zip', `${target.name}: ${files.length} berkas (${totalBytes} B)`)
    console.log(`[zip] ${target.name}: ${files.length} berkas, ${totalBytes} B, lewat ${skipped}`)
    ack({ ok: true, b64, count: files.length, bytes: totalBytes, skipped, name: `media-${target.name}.zip` })
  }))

  // v40 — kunci percakapan user dengan PIN (admin wajib membuka per socket).
  socket.on('admin:user_pinlock', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const pin = typeof data?.pin === 'string' ? data.pin.trim() : ''
    if (pin === '') {
      db.run('UPDATE users SET pin_lock = NULL WHERE id = ?', [target.id])
      audit('user_pinlock', `${target.name}: kunci dilepas`)
      ack({ ok: true, locked: false })
      return
    }
    if (!/^\d{4,8}$/.test(pin)) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    db.run('UPDATE users SET pin_lock = ? WHERE id = ?', [pinHash(pin, `lock:${target.id}`), target.id])
    audit('user_pinlock', `${target.name}: kunci dipasang`)
    ack({ ok: true, locked: true })
  }))

  // v40 — buka kunci percakapan untuk socket admin ini (sekali per login).
  socket.on('admin:unlock', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const target = restrictionTarget(data, ack)
    if (!target) return
    const partner = findUserById(target.id)
    if (!partner?.pin_lock) {
      ack({ ok: false, error: 'NOT_LOCKED' })
      return
    }
    const pin = typeof data?.pin === 'string' ? data.pin.trim() : ''
    if (pinHash(pin, `lock:${target.id}`) !== partner.pin_lock) {
      ack({ ok: false, error: 'INVALID_PIN' })
      return
    }
    if (!socket.data.unlockedPin) socket.data.unlockedPin = new Set<string>()
    ;(socket.data.unlockedPin as Set<string>).add(target.id)
    audit('unlock', `${target.name}`)
    ack({ ok: true })
  }))

  // v40 — persetujuan moderasi: setujui (fan-out) atau tolak (tombstone).
  socket.on('admin:moderate', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const action = data?.action === 'reject' ? 'reject' : 'approve'
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row || (row.pending ?? 0) !== 1) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    if (action === 'approve') {
      db.run('UPDATE messages SET pending = 0 WHERE id = ?', [row.id])
      db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [now(), conversation.id])
      const fresh = db.query('SELECT * FROM messages WHERE id = ?').get(row.id) as MessageRow
      const message = toChatMessage(fresh)
      attachReplyPreviews([fresh], [message])
      io.to(`user:${conversation.user_a_id}`).emit('message:new', message)
      io.to(`user:${conversation.user_b_id}`).emit('message:new', message)
      // Admin menerima versi perbarui (bubble ⏳ berubah jadi pesan normal).
      io.to('admins').emit('message:updated', { ...message, pending: false })
      pushConversationsTo(conversation.user_a_id)
      pushConversationsTo(conversation.user_b_id)
      audit('moderation_approve', `#${row.id}`)
      ack({ ok: true, action: 'approve' })
    } else {
      tombstoneMessage(row, conversation, now())
      const partnerId =
        conversation.user_a_id === ADMIN_ID ? conversation.user_b_id : conversation.user_a_id
      io.to(`user:${partnerId}`).emit('moderation:rejected', { messageId: row.id })
      audit('moderation_reject', `#${row.id}`)
      ack({ ok: true, action: 'reject' })
    }
  }))

  socket.on('admin:mirror', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const on = data?.on !== false
    setSetting('mirror_mode', on ? '1' : '0')
    audit('mirror', on ? 'on' : 'off')
    ack({ ok: true, mirror: on })
  }))

  /* v11 — moderation & advanced forensics ---------- */

  socket.on('admin:delete_message', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    if (row.deleted_at) {
      ack({ ok: true }) // already a tombstone
      return
    }
    tombstoneMessage(row, conversation, now())
    const senderName = findUserById(row.sender_id)?.name ?? row.sender_id
    audit('delete_message', `${senderName}: ${snippetOf(row).slice(0, 120)}`)
    console.log(`Message ${id} deleted by ADMIN (owner: ${row.sender_id.slice(0, 8)})`)
    ack({ ok: true })
  }))

  socket.on('admin:reset_conversation', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    // v29 — pipeline bersama (tombstone batch + bebaskan media + lepas pin).
    const cleared = wipeConversationMessages(conversation)
    const ts = now()
    const payload = {
      conversationId: conversation.id,
      deletedAt: new Date(ts).toISOString(),
      deleted: cleared,
      by: 'admin' as const,
      byName: 'Admin',
    }
    io.to(`user:${conversation.user_a_id}`).emit('conversation:reset', payload)
    io.to(`user:${conversation.user_b_id}`).emit('conversation:reset', payload)
    io.to('admins').emit('conversation:reset', payload)
    pushConversationsTo(conversation.user_a_id)
    pushConversationsTo(conversation.user_b_id)
    audit('reset_conversation', `${conversation.id.slice(0, 8)}: ${cleared} pesan`)
    console.log(`Conversation ${conversation.id.slice(0, 8)} reset: ${cleared} messages`)
    ack({ ok: true, deleted: cleared })
  }))

  socket.on('admin:audit', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    let limit = Number(data?.limit)
    if (!Number.isInteger(limit) || limit < 1) limit = 100
    limit = Math.min(limit, 200)
    const rows = db
      .query('SELECT action, detail, at FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ action: string; detail: string; at: number }>
    ack({
      ok: true,
      items: rows.map((r) => ({ action: r.action, detail: r.detail, at: new Date(r.at).toISOString() })),
    })
  }))

  socket.on('admin:pin', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const id = Number(data?.messageId)
    const row =
      Number.isInteger(id) && id > 0
        ? (db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null)
        : null
    if (!row) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const conversation = getConversation(row.conversation_id)
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const result = applyConversationPin(conversation, row.id)
    if (result === 'not_found') {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    const fresh = getConversation(conversation.id)
    const pid = fresh?.pinned_message_id ?? null
    const pinnedRow = pid
      ? (db.query('SELECT * FROM messages WHERE id = ?').get(pid) as MessageRow | null)
      : null
    ack({
      ok: true,
      conversationId: conversation.id,
      pinnedMessageId: pid,
      pinnedMessage: pinnedRow
        ? {
            messageId: pinnedRow.id,
            senderId: pinnedRow.sender_id,
            senderName: findUserById(pinnedRow.sender_id)?.name ?? '',
            snippet: snippetOf(pinnedRow),
            type: pinnedRow.type ?? 'text',
          }
        : null,
    })
  }))

  socket.on('admin:unpin', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const conversation =
      typeof data?.conversationId === 'string' ? getConversation(data.conversationId) : null
    if (!conversation) {
      ack({ ok: false, error: 'NOT_FOUND' })
      return
    }
    applyConversationPin(conversation, null)
    ack({ ok: true, conversationId: conversation.id, pinnedMessageId: null, pinnedMessage: null })
  }))

  socket.on('admin:keywords:get', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    ack({ ok: true, items: getSettingList('keywords') })
  }))

  socket.on('admin:keywords:set', handler(socket, (data, ack) => {
    if (!adminGuard(ack)) return
    const raw = Array.isArray(data?.items) ? data.items : null
    if (!raw || raw.length > 50) {
      ack({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    const items: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string') {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      const v = item.trim()
      if (v.length < 1 || v.length > 60) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      items.push(v)
    }
    setSetting('keywords', JSON.stringify(items))
    audit('keywords', `${items.length} kata kunci`)
    ack({ ok: true, items })
  }))

  socket.on('admin:flagged_list', handler(socket, (_data, ack) => {
    if (!adminGuard(ack)) return
    const rows = db
      .query(
        `SELECT m.*, u.name AS sender_name FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.flagged = 1 ORDER BY m.id DESC LIMIT 100`
      )
      .all() as Array<MessageRow & { sender_name: string | null }>
    ack({
      ok: true,
      items: rows.map((r) => ({
        messageId: r.id,
        conversationId: r.conversation_id,
        senderName: r.sender_name ?? '',
        type: r.type ?? 'text',
        snippet: snippetOf(r),
        keyword: matchedKeyword(r.deleted_content ?? r.content) ?? '',
        createdAt: new Date(r.created_at).toISOString(),
        ...(r.deleted_at ? { deletedAt: new Date(r.deleted_at).toISOString() } : {}),
      })),
    })
  }))


  /* ---------------------------- account PIN ---------------------------- */

  socket.on(
    'user:setpin',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me === ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const pin = data?.pin
      if (pin === null || pin === '') {
        db.run('UPDATE users SET pin_hash = NULL WHERE id = ?', [me])
        console.log(`PIN cleared for ${me.slice(0, 8)}`)
        ack({ ok: true, hasPin: false })
        return
      }
      if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
        ack({ ok: false, error: 'INVALID_PIN' })
        return
      }
      db.run('UPDATE users SET pin_hash = ? WHERE id = ?', [pinHash(pin, me), me])
      console.log(`PIN set for ${me.slice(0, 8)}`)
      ack({ ok: true, hasPin: true })
    })
  )

  /* ------------------- v27 — pasang password pertama ------------------- */

  /** Dipanggil dari modal wajib di klien untuk AKUN LAMA yang belum punya
   *  password. Setelah terpasang, login baru selalu butuh password. */
  socket.on(
    'user:set_password',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me === ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const target = findUserById(me)
      if (!target) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      if (target.password_hash) {
        ack({ ok: false, error: 'ALREADY_SET' })
        return
      }
      const password = typeof data?.password === 'string' ? data.password : ''
      if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        ack({ ok: false, error: 'WEAK_PASSWORD' })
        return
      }
      db.run('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?', [
        hashUserPassword(password),
        now(),
        me,
      ])
      userPwClear(target.name.toLowerCase())
      console.log(`Password set for ${me.slice(0, 8)}`)
      ack({ ok: true })
    })
  )

  /* ---------------------------- lifecycle ---------------------------- */

  socket.on('disconnect', (reason) => {
    const userId = socket.data?.userId
    console.log(`Socket disconnected: ${socket.id} (${reason})`)
    if (typeof userId !== 'string') return
    // v11 — connection metadata for admin:xray is memory-only and cleaned here.
    dropConnMeta(userId, socket.id)
    // v11 — always_online fake signal: the admin never goes offline / never
    // gets a fresh last_seen while the setting is on (socket bookkeeping in
    // onlineSockets still happens so counts stay accurate).
    const alwaysOn = userId === ADMIN_ID && getBoolSetting('always_online')
    const wentOffline = !alwaysOn && removeOnlineSocket(userId, socket.id)
    if (wentOffline) {
      const ts = now()
      db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [ts, userId])
      const realIso = new Date(ts).toISOString()
      if (userId === ADMIN_ID) {
        // Admin presence is public: everyone may know. v11 — users receive a
        // fake lastSeenAt when fake_last_seen is configured.
        const fake = getSetting('fake_last_seen')
        if (typeof fake === 'string' && fake.length > 0) {
          io.to('admins').emit('presence:update', {
            userId,
            online: false,
            lastSeenAt: realIso,
          })
          for (const u of db
            .query("SELECT id FROM users WHERE role = 'user'")
            .all() as Array<{ id: string }>) {
            io.to(`user:${u.id}`).emit('presence:update', {
              userId,
              online: false,
              lastSeenAt: fake,
            })
          }
        } else {
          io.emit('presence:update', { userId, online: false, lastSeenAt: realIso })
        }
      } else {
        // User presence is private: only the admins room.
        io.to('admins').emit('presence:update', {
          userId,
          online: false,
          lastSeenAt: realIso,
        })
      }
      console.log(`User ${userId} went offline`)
    }
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** Seed the fixed admin account (id 'admin') if it is not present. */
const ensureAdmin = () => {
  if (findUserById(ADMIN_ID)) return
  const ts = now()
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at) VALUES (?, ?, 'admin', ?, ?)",
    [ADMIN_ID, ADMIN_NAME, ts, ts]
  )
  console.log(`Admin account seeded (${ADMIN_ID})`)
}
ensureAdmin()

/* v27 — notifikasi perubahan: sekali saja setelah upgrade, sisipkan pesan
 * sistem ke percakapan setiap akun lama yang belum punya password. Klien
 * juga menampilkan modal wajib pemasangan password saat login. */
const ensureV27Notice = () => {
  if (getSetting('notice_v27_sent') === '1') return
  const legacy = db
    .query("SELECT * FROM users WHERE role = 'user' AND password_hash IS NULL")
    .all() as UserRow[]
  for (const u of legacy) {
    const conv = ensureConversationWithAdmin(u.id)
    insertAndFanOut(
      conv,
      ADMIN_ID,
      '🔐 Pembaruan keamanan: mulai sekarang 1 orang hanya bisa memiliki 1 akun. Akun kamu perlu dilindungi password — kamu akan diminta memasangnya saat login berikutnya (minimal 4 karakter). Akun baru mendaftar dengan password + kode undangan dari admin.',
      'system'
    )
  }
  setSetting('notice_v27_sent', '1')
  if (legacy.length > 0) console.log(`v27 notice: ${legacy.length} akun lama diberi notifikasi`)
}
ensureV27Notice()

// v8 — periodic server-lightening: expire old media (frees disk) + WAL
// checkpoint/VACUUM (keeps the DB lean). First pass shortly after boot,
// then every 6 hours.
const maintenanceCycle = () => {
  try {
    sweepExpiredMedia()
  } catch (err) {
    console.error('[retensi] error:', (err as Error)?.message ?? err)
  }
  dbMaintenance()
}
setTimeout(maintenanceCycle, 5_000)
setInterval(maintenanceCycle, 6 * 60 * 60_000)

/* v22 — pengirim pesan terjadwal: sweep tiap 10 detik, pesan jatuh tempo
 * dipancarkan ke semua pihak persis seperti pesan biasa (push + transkripsi). */
const deliverDueScheduled = () => {
  try {
    const due = db
      .query(
        'SELECT * FROM messages WHERE scheduled_at IS NOT NULL AND delivered_at IS NULL AND scheduled_at <= ?'
      )
      .all(now()) as MessageRow[]
    for (const row of due) {
      const conversation = getConversation(row.conversation_id)
      db.run('UPDATE messages SET delivered_at = ? WHERE id = ?', [now(), row.id])
      if (!conversation) continue
      db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [now(), conversation.id])
      const fresh = db.query('SELECT * FROM messages WHERE id = ?').get(row.id) as MessageRow
      const message = toChatMessage(fresh)
      attachReplyPreviews([fresh], [message])
      io.to(`user:${conversation.user_a_id}`).emit('message:new', message)
      io.to(`user:${conversation.user_b_id}`).emit('message:new', message)
      io.to('admins').emit('message:new', message)
      pushConversationsTo(conversation.user_a_id)
      pushConversationsTo(conversation.user_b_id)
      const senderName = findUserById(row.sender_id)?.name ?? 'ChatKita'
      for (const rid of [conversation.user_a_id, conversation.user_b_id]) {
        if (rid === row.sender_id) continue
        pushNewMessageIfOffline(rid, senderName, snippetOf(fresh))
      }
      if ((row.type ?? 'text') === 'voice')
        void transcribeVoice(row.id, conversation.id, row.content)
    }
    if (due.length > 0) console.log(`[terjadwal] ${due.length} pesan terkirim otomatis`)
  } catch (err) {
    console.error('[terjadwal] error:', (err as Error)?.message ?? err)
  }
}
setTimeout(deliverDueScheduled, 3_000)
setInterval(deliverDueScheduled, 10_000)

/* v40 — pengingat otomatis (nudge): user diam >= X hari dan belum diingatkan
 * pada periode diam ini → bot admin mengirim pesan pengingat. Cek tiap 30 menit. */
const sweepNudges = () => {
  try {
    const users = db
      .query(
        "SELECT * FROM users WHERE role = 'user' AND nudge_days > 0 AND nudge_text IS NOT NULL"
      )
      .all() as UserRow[]
    for (const u of users) {
      const idleMs = now() - u.last_seen_at
      if (idleMs < (u.nudge_days ?? 0) * 86_400_000) continue
      if ((u.nudge_last_at ?? 0) >= u.last_seen_at) continue // sudah diingatkan periode ini
      const text = (u.nudge_text ?? '').trim()
      if (!text) continue
      if (sendAsAdminToUser(u.id, text)) {
        db.run('UPDATE users SET nudge_last_at = ? WHERE id = ?', [now(), u.id])
        console.log(
          `[nudge] pengingat terkirim ke ${u.name} (diam ${Math.floor(idleMs / 86_400_000)} hari)`
        )
      }
    }
  } catch (err) {
    console.error('[nudge] error:', (err as Error)?.message ?? err)
  }
}
setTimeout(sweepNudges, 25_000)
setInterval(sweepNudges, 30 * 60_000)

/* v40 — auto-bersih chat per-user: pesan lebih tua dari X hari di
 * percakapan user tsb di-tombstone via pipeline resmi (isi asli tersimpan
 * untuk forensik, file media dibebaskan bila tak lagi direferensikan). */
const sweepAutoClean = () => {
  try {
    const users = db
      .query(
        "SELECT id, name, auto_clean_days FROM users WHERE role = 'user' AND auto_clean_days > 0"
      )
      .all() as Array<Pick<UserRow, 'id' | 'name' | 'auto_clean_days'>>
    for (const u of users) {
      const cutoff = now() - (u.auto_clean_days ?? 0) * 86_400_000
      const conv = db
        .query(
          "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
        )
        .get(u.id, u.id) as { id: string } | undefined
      if (!conv) continue
      const stale = db
        .query(
          "SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND created_at < ? AND scheduled_at IS NULL AND (pending IS NULL OR pending = 0)"
        )
        .all(conv.id, cutoff) as MessageRow[]
      if (stale.length === 0) continue
      const conversation = getConversation(conv.id)
      if (!conversation) continue
      const ts = now()
      for (const row of stale) tombstoneMessage(row, conversation, ts)
      pushConversationsTo(u.id)
      pushConversationsTo(ADMIN_ID)
      console.log(
        `[auto-bersih] ${u.name}: ${stale.length} pesan > ${u.auto_clean_days} hari dibersihkan`
      )
    }
  } catch (err) {
    console.error('[auto-bersih] error:', (err as Error)?.message ?? err)
  }
}
setTimeout(sweepAutoClean, 40_000)
setInterval(sweepAutoClean, 6 * 60 * 60_000)

httpServer.listen(PORT, () => {
  console.log(
    `ChatKita chat-service ${SERVICE_VERSION} listening on port ${PORT} (path: '/', push: ${VAPID_PUBLIC ? 'on' : 'off'}, retensi: ${RETENTION_MS === 0 ? 'tidak pernah (media permanen)' : `${RETENTION_DAYS} hari`})`
  )
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down server...')
  httpServer.close(() => {
    db.close()
    console.log('chat-service closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down server...')
  httpServer.close(() => {
    db.close()
    console.log('chat-service closed')
    process.exit(0)
  })
})
