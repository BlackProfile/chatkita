/**
 * Shared contract between the Next.js frontend and the chat-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 *
 * Model (v6 — pure private messenger, like WhatsApp/Telegram):
 *   Every person who opens the app logs in with a name and gets a
 *   private 1-on-1 chat with the Admin account (the app owner), just
 *   like messaging any contact.
 *   - A user NEVER sees other users, their presence, or their messages
 *     (enforced server-side via participant checks).
 *   - The Admin (owner) sees ALL conversations in one list, like
 *     WhatsApp Web.
 *   - Messages: text | image | voice | file | system (+ replies, edit,
 *     delete-for-everyone, emoji reactions, live ✓✓ read receipts, pinned
 *     messages, archive, voice-note transcription, on-demand translate,
 *     Web Push notifications, document/video/audio file sharing).
 *   - v8 (server-lightening): ALL media (photos & voice notes included)
 *     lives on disk under db/media/ and travels as /api/media/<name> URLs
 *     (legacy in-band data URLs still render but are no longer produced).
 *     Photos/videos get tiny client-side thumbnails (`thumbUrl`); history is
 *     paginated (50/page, `messages:older` loads more); media ages out after
 *     MEDIA_RETENTION_DAYS (server sweeps → `mediaExpiredAt` tombstone);
 *     per-account rate limits + storage quota guard the socket.
 *   - Files are uploaded out-of-band via the Next.js route POST /api/upload
 *     (stored under db/media/, SHA-256 deduplicated) and the message carries
 *     the public URL /api/media/<name> plus fileName/fileSize/mimeType.
 *     GET /api/media/<name> streams bytes with immutable caching, ETag/304
 *     and HTTP Range support (video seeking without full re-download).
 *
 * NO customer-service tooling lives here anymore: no operating hours,
 * no quick-reply templates, no AI auto-reply/summary/suggestions, no
 * SLA alerts, no chatbot menu, no pre-chat form, no star ratings, no
 * broadcast, no CRM labels/notes, no stats, no CSV/PDF export.
 */

/** Fixed id of the admin account (seeded by the server on boot). */
export const ADMIN_ID = "admin";
export const ADMIN_NAME = "Admin";

/** Persisted user login ({ userId, name }) — Telegram-style, no password. */
export const CHAT_SESSION_KEY = "chatkita:user";

/**
 * Last account name that logged in from this browser. Unlike the session
 * key it SURVIVES logout, so the login card can prefill it and offer a
 * one-tap "continue previous conversation" entry.
 */
export const CHAT_LAST_NAME_KEY = "chatkita:last-name";

/** Persisted per-browser mute for the new-message blip. */
export const CHAT_SOUND_KEY = "chatkita:sound";

/** Persisted per-browser chat font size ("sm" | "md" | "lg"). */
export const CHAT_FONT_KEY = "chatkita:font-size";

/**
 * Persisted per-browser data-saver toggle. When on, heavy media (photos,
 * videos, audio attachments) is NOT fetched automatically — a tap-to-load
 * placeholder is shown instead. Thumbnails (<30 KB) still render.
 */
export const CHAT_DATA_SAVER_KEY = "chatkita:data-saver";

/** Draft of an unsent message (per role/conversation), survives reloads. */
export const draftKey = (scope: string, id: string) => `chatkita:draft:${scope}:${id}`;

/** Demo hint rendered on the admin login form (server default password). */
export const ADMIN_PASSWORD_HINT = "admin123";

/** Which mini service port — always reach it through the gateway query param. */
export const CHAT_SERVICE_PORT = 3003;

export const SOCKET_URL = `/?XTransformPort=${CHAT_SERVICE_PORT}`;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 40;

/** Messages per history page (auth/history/older). Older pages load on demand. */
export const HISTORY_PAGE_SIZE = 50;

/** Per-account media retention (server-side sweep; env MEDIA_RETENTION_DAYS).
 *  v36 — 0 = media disimpan PERMANEN (sweeper nonaktif — tidak ada penghapusan
 *  otomatis); server mengirim retentionDays: 0 dan UI menampilkan "permanen". */
export const MEDIA_RETENTION_DAYS = 0;

/** Per-account storage quota for disk media (sum of fileSize). */
export const MEDIA_QUOTA_BYTES = 250 * 1024 * 1024; // 250 MiB

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export interface ChatUser {
  id: string;
  name: string;
  /** Present on user auth: whether this account is PIN-protected. */
  hasPin?: boolean;
}

export type MessageContentType = "text" | "image" | "voice" | "file" | "system";

/** Grouped emoji reactions on one message. */
export interface MessageReaction {
  emoji: string;
  /** User ids who reacted with this emoji. */
  userIds: string[];
}

/** Snapshot of the original message a reply points at. */
export interface ReplyPreview {
  id: number;
  senderId: string;
  snippet: string;
  type: string;
}

/**
 * v11 — rich pinned-message snapshot (overview + conversation:pinned event).
 * Unlike the older `pinned` snapshot it also carries the sender display name.
 */
export interface PinnedMessageInfo {
  messageId: number;
  senderId: string;
  senderName: string;
  snippet: string;
  type: string;
}

/**
 * v42 — kartu polling dalam chat (meta_json {poll:{q,options}} pada pesan
 * type 'text'). counts/total/myVote diisi server saat memuat riwayat dan
 * diperbarui live lewat event poll:update.
 */
export interface ChatPoll {
  /** Pertanyaan polling (1–200 char). */
  q: string;
  /** Opsi pilihan (2–6 × ≤60 char). */
  options: string[];
  /** Jumlah suara per opsi (indeks sama dengan options). */
  counts?: number[];
  /** Total seluruh suara masuk. */
  total?: number;
  /** Indeks opsi pilihan viewer (null = belum memilih). */
  myVote?: number | null;
}

/** A chat message. Media content = data URL or /api/media URL; deleted → content "". */
export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  content: string;
  /** ISO 8601 timestamp string */
  createdAt: string;
  type: MessageContentType;
  replyToId?: number;
  replyTo?: ReplyPreview;
  /** Voice notes: recording length in ms. */
  durationMs?: number;
  /** Voice notes: AI transcription (may arrive later via message:updated). */
  transcript?: string;
  /** Soft delete marker (content is redacted server-side). */
  deletedAt?: string;
  /** Set when the sender edited their text message. */
  editedAt?: string;
  /** Indonesian translation fetched on demand. */
  translation?: string;
  /** Emoji reactions (may arrive later via message:updated). */
  reactions?: MessageReaction[];
  /** file messages: original file name (display only). */
  fileName?: string;
  /** v20 — caption teks opsional yang ikut dikirim bersama media. */
  caption?: string;
  /** file messages: size in bytes. */
  fileSize?: number;
  /** file messages: MIME type (e.g. application/pdf, video/mp4). */
  mimeType?: string;
  /**
   * v8 — tiny preview image (<30 KB) for photos & videos. The bubble renders
   * this instead of the full media; the viewer loads the full version.
   */
  thumbUrl?: string;
  /**
   * v8 — set when the retention sweeper removed this message's media
   * (content/file metadata are redacted; a tombstone placeholder renders).
   */
  mediaExpiredAt?: string;
  /** v22 — userId yang membintangi pesan ini (bintang per-pengguna). */
  starredBy?: string[];
  /** v22 — pesan terjadwal: ISO waktu kirim otomatis (belum terkirim). */
  scheduledAt?: string;
  /** v22 — label "Diteruskan dari <nama>" untuk pesan hasil forward. */
  forwardedFrom?: string;
  /** v40 — true saat pesan menunggu persetujuan admin (moderasi pra-kirim). */
  pending?: boolean;
  /** v42 — kartu polling bila pesan ini adalah polling. */
  poll?: ChatPoll;
}

/** A chat partner including live presence info. */
export type PartnerInfo = ChatUser & {
  online: boolean;
  /** ISO timestamp of the last time this user was online (null if unknown). */
  lastSeenAt: string | null;
  /** v42 — status custom partner (emoji + teks; null = kosong). */
  statusText?: string | null;
};

/**
 * One conversation as seen by the requesting side.
 * For the admin: `partner` is the human user. For a user: `partner` is Admin.
 */
export interface ConversationOverview {
  id: string;
  partner: PartnerInfo;
  lastMessage: {
    id: number;
    senderId: string;
    content: string;
    createdAt: string;
    type: string;
    deleted: boolean;
    /** file messages: original file name (for "📎 <nama>" previews). */
    fileName?: string;
    /** v8 — last message's media was swept by retention. */
    mediaExpired?: boolean;
    /** v20 — caption teks yang menyertai pesan media terakhir. */
    caption?: string;
  } | null;
  lastMessageAt: string;
  /** Unread messages sent by the partner. */
  unread: number;
  /** How far the PARTNER has read → ✓✓ on my own bubbles. */
  partnerLastReadId: number;
  /** Archived conversations live in their own tab (WhatsApp-style). */
  archived?: boolean;
  /** v42 — arsip sisi PEMANGGIL (per user+percakapan; admin tak terpengaruh). */
  archivedSelf?: boolean;
  /** Pinned message banner (both sides). */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
  /**
   * v11 — rich pinned snapshot incl. the sender display name
   * (admin can pin any message; both sides see this in the overview).
   */
  pinnedMessage?: PinnedMessageInfo | null;
}

/* ------------------------------------------------------------------ */
/* Ack payloads                                                        */
/* ------------------------------------------------------------------ */

/** Ack payload returned by `public:settings` (pre-login push config). */
export interface PublicSettingsAck {
  ok: true;
  pushPublicKey: string;
}

/** Ack payload returned by `user:auth`. */
export interface UserAuthAck {
  ok: true;
  user: ChatUser;
  /** The user's single conversation (with Admin). */
  conversationId: string;
  /** Always the Admin in this model. */
  partner: PartnerInfo;
  /** Full history of the conversation (already marked as read). */
  messages: ChatMessage[];
  /** v8 — true when older pages exist (messages:older loads them). */
  hasMore: boolean;
  /** How far the admin has read → ✓✓ on my sent messages. */
  partnerLastReadId: number;
  /** VAPID public key for Web Push ("" when push is unavailable). */
  pushPublicKey: string;
  /** Pinned banner state. */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
  /** v27 — akun lama tanpa password → klien wajib buka modal pemasangan. */
  mustSetPassword?: boolean;
}

/** Ack payload returned by `admin:auth`. */
export interface AdminAuthAck {
  ok: true;
  conversations: ConversationOverview[];
  /** v23 — true bila masih memakai password bawaan admin123 (belum di-custom). */
  usingDefault?: boolean;
  /** v43 — role aktor sesi; 'moderator' = akses baca (event destruktif ditolak). */
  actorRole?: 'admin' | 'moderator';
}

/** v43 — ack `admin:user_role` (ubah role user↔moderator; admin penuh saja). */
export interface AdminUserRoleAck {
  ok: true;
  role: 'user' | 'moderator';
}

/** v43 — server → admins: role sebuah akun berubah. */
export interface AdminUserRoleUpdatePayload {
  userId: string;
  role: 'user' | 'moderator';
}

/** Ack payload returned by `admin:password_change` (v23 — custom login admin). */
export interface AdminPasswordChangeAck {
  ok: true;
}

/** Ack payload returned by `admin:peek` (v24 — cek password autologin, tanpa sesi). */
export interface AdminPeekAck {
  ok: true;
}

/**
 * Ack payload returned by `public:check_name` (v28 — cek nama pre-login).
 * Dipakai kartu login utk menyembunyikan kolom kode undangan ketika nama
 * yang diketik sudah dipakai akun yang ada (atau reserved "Admin").
 */
export interface PublicCheckNameAck {
  ok: true;
  /** true = nama sudah terdaftar (akun user ada / reserved) → bukan pendaftaran baru. */
  exists: boolean;
}

/* ------------------------------------------------------------------ */
/* v29 — Reset & hapus menyeluruh                                     */
/* ------------------------------------------------------------------ */

/** Ack payload returned by `messages:unstar_all` (lepas semua bintang milik saya). */
export interface UnstarAllAck {
  ok: true;
  /** Jumlah pesan yang bintangnya dilepas. */
  cleared: number;
}

/** Ack payload returned by `messages:schedule_cancel_all`. */
export interface ScheduleCancelAllAck {
  ok: true;
  /** Jumlah pesan terjadwal yang dibatalkan. */
  cancelled: number;
}

/** Ack payload returned by `admin:user_delete` (hapus akun permanen). */
export interface AdminUserDeleteAck {
  ok: true;
  deletedMessages: number;
  conversations: number;
}

/** Ack payload returned by `admin:invites_clear_unused`. */
export interface AdminInvitesClearAck {
  ok: true;
  /** Jumlah kode belum terpakai yang terhapus. */
  removed: number;
}

/** Ack payload returned by `admin:audit_clear`. */
export interface AdminAuditClearAck {
  ok: true;
  /** Jumlah entri log yang terhapus sebelum entri audit_clear ditulis. */
  removed: number;
}

/** Ack payload returned by `admin:settings:reset` (kembalikan default). */
export interface AdminSettingsResetAck {
  ok: true;
  /** Nilai default terbaru (hasil getAppSettings setelah penghapusan). */
  settings: AppSettings;
}

/** Ack payload returned by `messages:history` (both roles, participant-only). */
export interface HistoryAck {
  ok: true;
  messages: ChatMessage[];
  /** v8 — true when older pages exist (messages:older loads them). */
  hasMore: boolean;
  partner: PartnerInfo;
  partnerLastReadId: number;
  /** My read cursor BEFORE this call → "new messages" divider. */
  lastReadBefore: number;
  /** Pinned banner state. */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
}

/** Ack payload returned by `messages:send`. */
export interface MessageAck {
  ok: true;
  message: ChatMessage;
  /** v40 — true saat pesan masuk antrean moderasi (approval mode). */
  pending?: boolean;
}

/** Ack payload returned by `messages:older` (v8 pagination). */
export interface OlderMessagesAck {
  ok: true;
  /** Up to HISTORY_PAGE_SIZE messages OLDER than beforeId, ascending. */
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface SetPinAck {
  ok: true;
  hasPin: boolean;
}

export interface TranslateAck {
  ok: true;
  translation: string | null;
}

export interface PinUpdatePayload {
  conversationId: string;
  pinnedMessageId: number | null;
  pinned: { id: number; senderId: string; snippet: string; type: string } | null;
}

export interface ArchiveUpdatePayload {
  conversationId: string;
  archived: boolean;
}

/** Shape of the message:updated merge payload (superset of all versions). */
export interface MessageUpdatePayload {
  id: number;
  conversationId: string;
  deletedAt?: string;
  transcript?: string;
  content?: string;
  editedAt?: string;
  translation?: string;
  reactions?: MessageReaction[];
  /** v22 — state bintang per-user (array userId pemberi bintang). */
  starredBy?: string[];
  /** v25 — Pusat Cheat: waktu pesan diubah admin (backdate/forward-date). */
  createdAt?: string;
  /** v40 — moderasi: false saat pesan pending disetujui admin. */
  pending?: boolean;
}

/** Generic error ack: `{ ok: false, error: ErrorCode }` */
export type ChatErrorCode =
  | "INVALID_NAME"
  | "NAME_RESERVED"
  | "INVALID_MESSAGE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "PIN_REQUIRED"
  | "INVALID_PIN"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "SERVER_ERROR"
  // v11 — admin session control (enforced inside messages:send):
  | "FROZEN"
  | "MUTED"
  // v40 — pusat kendali per-user:
  | "WORD_BLOCKED"
  | "MEDIA_TYPE_BLOCKED"
  | "PIN_LOCKED"
  | "NO_MEDIA"
  | "TOO_LARGE"
  | "NOT_LOCKED"
  | "SLOW_MODE"
  | "MEDIA_BLOCKED"
  // v23 — custom login admin (admin:password_change):
  | "WEAK_PASSWORD"
  // v27 — 1 orang 1 akun (login/pendaftaran + kelola akun admin):
  | "PASSWORD_REQUIRED"
  | "INVALID_PASSWORD"
  | "TOO_MANY_ATTEMPTS"
  | "INVITE_REQUIRED"
  | "INVITE_INVALID"
  | "INVITE_USED"
  | "DEVICE_REQUIRED"
  | "DEVICE_TAKEN"
  | "ALREADY_SET"
  | "NAME_TAKEN"
  // v13 — pendaftaran ditutup admin (di-kirim server sejak v13, resmi
  // terdaftar di union sekarang):
  | "REGISTRATION_CLOSED";

export interface ChatErrorAck {
  ok: false;
  error: ChatErrorCode;
  hasPin?: boolean;
  /** v11 — MUTED / SLOW_MODE: seconds until the restriction expires. */
  remainingSeconds?: number;
}

export type AckOf<T> = T | ChatErrorAck;

/* ------------------------------------------------------------------ */
/* v10 — admin dashboard / app settings / broadcast                    */
/* ------------------------------------------------------------------ */

/** App-wide settings (editable by admin, broadcast to everyone). */
export interface AppSettings {
  appName: string;
  welcomeMessage: string;
  maintenanceMode: boolean;
  maintenanceNote: string;
  /* v13 — behaviour controls; optional so older servers stay compatible. */
  allowRegistration?: boolean;
  maxMessageLength?: number;
  maxUploadMb?: number;
  allowImages?: boolean;
  allowVoice?: boolean;
  allowFiles?: boolean;
  allowLinks?: boolean;
  linkPreview?: boolean;
  allowReactions?: boolean;
  readReceipts?: boolean;
  slowmodeSeconds?: number;
  /* v43 — branding kustom. */
  /** URL logo kustom (/api/media/... atau http(s)); kosong = ikon bawaan. */
  appLogo?: string;
  /** Warna aksen global (hex #rrggbb); kosong = tema bawaan. */
  accentColor?: string;
}

/** `public:settings` now also carries the public app settings (v10). */
export interface PublicSettingsAck {
  ok: true;
  pushPublicKey: string;
  /** v10 — present on newer servers; optional for older clients. */
  app?: AppSettings;
}

/** One UTC day of message counts (dashboard daily series). */
export interface DashboardDayPoint {
  date: string;
  count: number;
}

/** A user row inside the dashboard (top users / all users tables). */
export interface DashboardUserRow {
  id: string;
  name: string;
  messages: number;
  lastSeenAt: string;
  online: boolean;
  /** v43 — hanya untuk baris daftar semua user ('moderator' = lihat semua). */ 
  role?: "user" | "moderator";
  /** Only on the all-users list. */
  joinedAt?: string;
  /* v13 — richer per-user analytics. */
  mediaCount?: number;
  lastMessageAt?: string;
  /* v27 — 1 orang 1 akun. */
  hasPassword?: boolean;
  devices?: number;
}

/** Full stats payload returned by `admin:dashboard`. */
export interface DashboardStats {
  generatedAt: string;
  version: string;
  uptimeMs: number;
  totals: {
    users: number;
    conversations: number;
    messages: number;
    deletedMessages: number;
    last24h: number;
    last7d: number;
    byType: Record<string, number>;
    onlineUsers: number;
    mediaCount: number;
    mediaBytes: number;
    /* v13 — engagement extras. */
    newUsers7d?: number;
    reactionsTotal?: number;
    repliesTotal?: number;
    editsTotal?: number;
    pushSubs?: number;
  };
  daily: DashboardDayPoint[];
  /* v13 — deeper analytics (optional for older servers). */
  daily30?: DashboardDayPoint[];
  newUsersDaily?: DashboardDayPoint[];
  /** 24 buckets, hour-of-day (UTC) over the last 7 days. */
  hourly: number[];
  /** 7 buckets Sun..Sat over the last 28 days. */
  weekday?: number[];
  bySender?: { user: number; admin: number };
  avgResponseMs?: number | null;
  firstMessageAt?: string | null;
  topUsers: DashboardUserRow[];
  users: DashboardUserRow[];
  storage: {
    dbBytes: number;
    walBytes: number;
    mediaBytes: number;
    mediaFiles: number;
    quotaBytes: number;
    retentionDays: number;
  };
}

export interface DashboardStatsAck {
  ok: true;
  stats: DashboardStats;
}

export interface AppSettingsAck {
  ok: true;
  settings: AppSettings;
}

export interface BroadcastAck {
  ok: true;
  count: number;
  kind: "siaran" | "pengumuman";
}

/* v25 — Pusat Cheat: semua fitur cheat admin dalam satu tab dashboard. */

/** Ack `admin:cheat_peek` — pesan percakapan target + keadaan saklar cheat. */
export interface AdminCheatPeekAck {
  ok: true;
  conversationId: string;
  messages: ChatMessage[];
  hasMore: boolean;
  cheatState: {
    alwaysOnline: boolean;
    mirror: boolean;
    ghost: boolean;
    fakeLastSeen: string;
    /** v45 — cheat lanjutan per-user. */
    shadowban: boolean;
    shadowCount: number;
    throttleSec: number;
    autoreply: { on: boolean; text: string; delaySec: number };
  };
}

/* v45 — cheat lanjutan per-user (Kategori C3). */

/** Ack `admin:cheat_shadowban` — ilusi "pesan terkirim tapi tak sampai". */
export interface AdminCheatShadowAck {
  ok: true;
  on: boolean;
  /** Jumlah pesan bayangan yang terungkap saat dimatikan. */
  revealed: number;
}

/** Ack `admin:cheat_voice` — pesan suara (TTS) atas nama user terkirim. */
export interface AdminCheatVoiceAck {
  ok: true;
  message: ChatMessage;
}

/** Ack `admin:cheat_image_ai` — pesan foto AI atas nama user terkirim. */
export interface AdminCheatImageAiAck {
  ok: true;
  message: ChatMessage;
}

/** Ack `admin:cheat_flood` — injector dijadwalkan. */
export interface AdminCheatFloodAck {
  ok: true;
  count: number;
}

/** Ack `admin:cheat_flood_stop` — sisa pesan dibatalkan. */
export interface AdminCheatFloodStopAck {
  ok: true;
  stopped: number;
}

/** Ack `admin:cheat_timewarp` — waktu semua pesan user digeser massal. */
export interface AdminCheatTimewarpAck {
  ok: true;
  changed: number;
  deltaHours: number;
}

/** Ack `admin:cheat_autoreply` / `admin:cheat_throttle` — konfigurasi disimpan. */
export interface AdminCheatConfigAck {
  ok: true;
  seconds?: number;
}

/** Ack `admin:clone_conversation` — salin/pindah isi percakapan. */
export interface AdminCloneConversationAck {
  ok: true;
  copied: number;
  deleted: number;
}

/** Ack `admin:cheat_send` — pesan spoof/backdate berhasil dikirim. */
export interface AdminCheatSendAck {
  ok: true;
  message: ChatMessage;
}

/** Ack `admin:cheat_edit` — isi pesan siapa saja diganti. */
export interface AdminCheatEditAck {
  ok: true;
}

/** Ack `admin:cheat_react` — reaksi atas nama user lain di-toggle. */
export interface AdminCheatReactAck {
  ok: true;
}

/** Ack `admin:cheat_time` — waktu pesan diganti. */
export interface AdminCheatTimeAck {
  ok: true;
}

/* v38 — Kontrol user lengkap: cheat center per-user + kontrol media per-user
   langsung dari toolbar percakapan admin. */

/** Satu item media hidup milik percakapan user↔admin (admin:user_media). */
export interface AdminUserMediaItem {
  messageId: number;
  senderId: string;
  /** true bila pengirim adalah user target (bukan Admin). */
  fromUser: boolean;
  type: "image" | "voice" | "file";
  /** URL media (/api/media/<nama> atau data: untuk voice lama). */
  url: string;
  thumbUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  caption?: string;
  durationMs?: number;
  createdAt: string;
  /** v26 — dimensi/durasi/halaman dari meta_json (bila ada). */
  width?: number;
  height?: number;
  pages?: number;
}

/** Ack `admin:user_media` — daftar media percakapan + total pemakaian. */
export interface AdminUserMediaAck {
  ok: true;
  conversationId: string;
  items: AdminUserMediaItem[];
  totals: {
    count: number;
    bytes: number;
    fromUserCount: number;
    fromUserBytes: number;
  };
}

/** Ack `admin:media_delete` — satu media di-tombstone + file dibebaskan. */
export interface AdminMediaDeleteAck {
  ok: true;
  messageId: number;
  freedBytes: number;
}

/** Ack `admin:media_delete_all` — semua media user dibersihkan. */
export interface AdminMediaDeleteAllAck {
  ok: true;
  deleted: number;
  freedBytes: number;
}

/* v26 — Peta Penyimpanan: metadata media file user dibaca dari header file. */

/** v35 — bagian EXIF foto (dibaca server via exifr, khusus admin). */
export interface ExifMetaInfo {
  gps?: { lat: number; lon: number };
  takenAt?: string;
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  orientation?: number;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
}

/** Metadata yang bisa dibaca server dari header file media. */
export interface MediaMetaInfo {
  width?: number;
  height?: number;
  durationMs?: number;
  pages?: number;
  /** v35 — waktu pembuatan video (mvhd, MP4/MOV). */
  videoCreated?: string;
  /** v35 — EXIF foto (GPS/kamera/pencahayaan). */
  exif?: ExifMetaInfo;
}

/** Satu baris media pada daftar "file terbesar". */
export interface StorageLargestItem {
  id: number;
  type: string;
  fileName: string;
  mime: string;
  size: number;
  senderId: string;
  senderName: string;
  conversationId: string;
  createdAt: string;
  meta: MediaMetaInfo | null;
}

/** Ack `admin:storage_map` — peta lengkap pemakaian penyimpanan. */
export interface AdminStorageMapAck {
  ok: true;
  map: {
    generatedAt: string;
    storage: {
      dbBytes: number;
      walBytes: number;
      mediaBytes: number;
      mediaFiles: number;
      quotaBytes: number;
    };
    /** Total byte media menurut catatan DB (logical). */
    logicalBytes: number;
    byType: Record<string, { count: number; bytes: number }>;
    byUser: { id: string; name: string; count: number; bytes: number }[];
    largest: StorageLargestItem[];
    coverage: { withMeta: number; withoutMeta: number };
  };
}

/** Ack `admin:media_scan` — hasil pemindaian metadata file yang belum terisi. */
export interface AdminMediaScanAck {
  ok: true;
  scanned: number;
  filled: number;
  remaining: number;
}

/** v35 — info file pesan media pada ack `admin:message_meta`. */
export interface AdminMessageMetaFileInfo {
  messageId: number;
  mediaName: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  senderId: string;
  senderName: string | null;
  conversationId: string;
  createdAt: string;
  deleted: boolean;
  expired: boolean;
}

/** Ack `admin:message_meta` — metadata lengkap 1 pesan media (khusus admin). */
export interface AdminMessageMetaAck {
  ok: true;
  meta: MediaMetaInfo;
  file: AdminMessageMetaFileInfo;
}

/* ------------------------------------------------------------------ */
/* v27 — 1 orang 1 akun                                                */
/* ------------------------------------------------------------------ */

/** v27 — satu kode undangan sekali pakai (1 kode = 1 akun). */
export interface InviteCodeInfo {
  code: string;
  label: string | null;
  createdAt: string;
  usedBy: string | null;
  /** Nama akun pemakai kode (bila sudah dipakai). */
  usedByName?: string | null;
  usedAt: string | null;
}

/** Ack `admin:invite_list`. */
export interface AdminInviteListAck {
  ok: true;
  invites: InviteCodeInfo[];
}

/** Ack `admin:invite_create`. */
export interface AdminInviteCreateAck {
  ok: true;
  created: InviteCodeInfo[];
}

/** Ack `admin:invite_delete`. */
export interface AdminInviteDeleteAck {
  ok: true;
}

/** Ack `admin:user_create` — akun dibuat admin dari dashboard. */
export interface AdminUserCreateAck {
  ok: true;
  userId: string;
  name: string;
}

/** Ack `admin:user_reset_password`. */
export interface AdminResetPasswordAck {
  ok: true;
}

/** Ack `admin:user_unbind_devices` — lepas semua kunci perangkat user. */
export interface AdminUnbindDevicesAck {
  ok: true;
  removed: number;
}

/** Ack `user:set_password` — pemasangan password pertama (akun lama). */
export interface UserSetPasswordAck {
  ok: true;
}

export interface BackupAck {
  ok: true;
  exportedAt: string;
  version: string;
  users: unknown[];
  conversations: unknown[];
  messages: unknown[];
  settings: { key: string; value: string }[];
}

/** v20 — Pusat: ack reset aplikasi (hapus seluruh data chat + file media). */
export interface AdminResetAllAck {
  ok: true;
  deleted: { messages: number; conversations: number; users: number; settings: number };
  mediaFiles: number;
  freedBytes: number;
}

/** v20 — Pusat: ack pemulihan backup JSON. */
export interface AdminRestoreAck {
  ok: true;
  restored: {
    users: number;
    conversations: number;
    messages: number;
    settings: number;
  };
  /** Jumlah baris backup yang gagal validasi dan dilewati. */
  skipped: number;
}

export interface VacuumAck {
  ok: true;
  before: { dbBytes: number; walBytes: number };
  after: { dbBytes: number; walBytes: number };
}

/* v13 — dashboard: runtime info, audit tail, manual cleanup. */

/** Runtime snapshot returned by `admin:system` (Sistem tab). */
export interface SystemInfo {
  generatedAt: string;
  runtime: string;
  platform: string;
  pid: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  socketClients: number;
  onlineUsers: number;
  auditCount: number;
  pushSubs: number;
  flaggedCount: number;
  keywords: number;
  audit: { action: string; detail: string; at: string }[];
}

export interface SystemInfoAck {
  ok: true;
  system: SystemInfo;
}

export interface CleanupAck {
  ok: true;
  before: { bytes: number; files: number };
  after: { bytes: number; files: number };
}

export interface GhostAck {
  ok: true;
  ghost: boolean;
}

/** Server → everyone: app settings changed (v10). */
export type AppSettingsUpdatePayload = AppSettings;

/* ------------------------------------------------------------------ */
/* v11 — admin power features (intel / session control / fake signals) */
/* ------------------------------------------------------------------ */

/**
 * v11 — live restriction state pushed to a user via `user:restricted`
 * (on every restriction change, and on user:auth when anything is active).
 */
export interface UserRestrictionState {
  /** Frozen account — messages:send is rejected with FROZEN. */
  frozen: boolean;
  /** Active mute deadline (ISO), or null when not muted. */
  mutedUntil: string | null;
  /** Personal text rate limit per minute (0 = off / server default). */
  slowMode: number;
  /** When true all non-text sends are rejected with MEDIA_BLOCKED. */
  mediaBlocked: boolean;
}

/** Server → restricted user: restriction state changed (or on login). */
export type UserRestrictedPayload = UserRestrictionState;

/** Per-user connection metadata captured at auth time (admin:xray). */
export interface XrayProfile {
  id: string;
  name: string;
  createdAt: string;
  lastSeen: string;
  online: boolean;
  socketCount: number;
  messageCount: number;
  mediaCount: number;
  mediaBytes: number;
  lastMessageAt: string | null;
  /** First x-forwarded-for entry of the last connection (null when unknown). */
  ip: string | null;
  userAgent: string | null;
  /** Coarse platform guess derived from the user-agent. */
  platform: string;
  /** v39 — special per-user media quota (MiB); 0 = global default 250 MiB. */
  mediaQuotaMb?: number;
  /** v39 — auto-reply bot ON for this user. */
  botReplyOn?: boolean;
  /** v39 — bot reply text (null when unset/off). */
  botReplyText?: string | null;
  /** v39 — bot reply delay in seconds (0–120). */
  botReplyDelaySec?: number;
  /* v40 — pusat kendali per-user. */
  /** v40 — catatan pribadi admin tentang user ini (null = kosong). */
  adminNote?: string | null;
  /** v40 — label: '' | 'vip' | 'attention' | 'problem'. */
  tag?: string;
  /** v40 — daftar kata terlarang (null = kosong). */
  wordFilter?: string | null;
  /** v40 — 'block' (tolak pesan) | 'censor' (sensor ***). */
  wordFilterAction?: 'block' | 'censor';
  /** v40 — semua pesan user menunggu persetujuan admin. */
  approvalMode?: boolean;
  /** v40 — jenis media yang diblokir (subset image/voice/file). */
  blockedMediaTypes?: string[];
  /** v40 — template balasan cepat milik user ini. */
  quickReplies?: string[];
  /** v40 — pengingat otomatis saat user diam ≥ X hari (0 = nonaktif). */
  nudgeDays?: number;
  /** v40 — teks pengingat otomatis. */
  nudgeText?: string | null;
  /** v40 — auto-bersih chat: pesan > X hari di-tombstone (0 = nonaktif). */
  autoCleanDays?: number;
  /** v40 — percakapan dikunci PIN oleh admin. */
  pinLockSet?: boolean;
  /** v42 — status custom user (emoji + teks; null = kosong). */
  statusText?: string | null;
}

export interface XrayAck {
  ok: true;
  profile: XrayProfile;
}

/** v39 — ack `admin:user_rename` — display/login name changed. */
export interface AdminRenameAck {
  ok: true;
  name: string;
}

/** v39 — ack `admin:bulk_delete_user` — tombstoned ALL live messages of the
 * user across every conversation (official delete pipeline + disk cleanup). */
export interface AdminBulkDeleteUserAck {
  ok: true;
  deleted: number;
  freedBytes: number;
}

/** v39 — per-user auto-reply bot configuration (admin:user_bot). */
export interface AdminBotState {
  on: boolean;
  text: string | null;
  delaySec: number;
}

export interface AdminBotAck {
  ok: true;
  bot: AdminBotState;
}

/** v39 — ack `admin:user_push` — custom web push sent to user's devices. */
export interface AdminPushAck {
  ok: true;
  subscriptions: number;
}

/** v39 — ack `admin:user_quota` — special media quota saved (0 = default). */
export interface AdminQuotaAck {
  ok: true;
  quotaMb: number;
  quotaBytes: number;
  usedBytes: number;
}

/* ------------------------------------------------------------------ */
/* v40 — pusat kendali per-user (moderasi / insight / otomasi / aman)   */
/* ------------------------------------------------------------------ */

/** v40 — ack `admin:word_filter` — daftar kata terlarang tersimpan. */
export interface AdminWordFilterAck {
  ok: true;
  words: string;
  action: 'block' | 'censor';
}

/** v40 — ack `admin:approval_mode` — mode persetujuan pra-kirim. */
export interface AdminApprovalModeAck {
  ok: true;
  on: boolean;
}

/** v40 — ack `admin:media_types` — blokir media per jenis. */
export interface AdminMediaTypesAck {
  ok: true;
  blocked: string[];
}

/** v40 — ack `admin:user_force_logout` — semua perangkat dilepas. */
export interface AdminForceLogoutAck {
  ok: true;
  devices: number;
  sockets: number;
}

/** v40 — ack `admin:user_note` — catatan + tag admin tersimpan. */
export interface AdminNoteAck {
  ok: true;
  note: string;
  tag: string;
}

/** v40 — satu baris leaderboard (admin:leaderboard). */
export interface AdminLeaderRow {
  userId: string;
  name: string;
  msgs: number;
  media: number;
  bytes: number;
  lastSeenAt: string;
  avgReplySec: number | null;
}

export interface AdminLeaderboardAck {
  ok: true;
  rows: AdminLeaderRow[];
  rankings: { msgs: string[]; media: string[]; active: string[]; reply: string[] };
}

/** v40 — ack `admin:user_compare` — insight dua user berdampingan. */
export interface AdminCompareAck {
  ok: true;
  a: AdminUserInsightAck['insight'];
  b: AdminUserInsightAck['insight'];
}

/** v40 — satu entri riwayat login (admin:user_logins). */
export interface AdminLoginEvent {
  at: string;
  ip: string | null;
  userAgent: string | null;
  kind: string;
}

export interface AdminLoginsAck {
  ok: true;
  events: AdminLoginEvent[];
}

/** v40 — ack `admin:schedule_message` — pesan terjadwal tersimpan. */
export interface AdminScheduleAck {
  ok: true;
  id: number;
  sendAtMs: number;
}

/** v40 — ack `admin:schedule_list` — antrean pesan terjadwal user. */
export interface AdminScheduleListAck {
  ok: true;
  items: {
    id: number;
    text: string;
    sendAtMs: number;
    /** v42 — pengulangan: 'daily' | 'weekly' | null (sekali kirim). */
    repeat?: "daily" | "weekly" | null;
  }[];
}

/** v40 — ack `admin:schedule_cancel` — pesan terjadwal dibatalkan. */
export interface AdminScheduleCancelAck {
  ok: true;
}

/** v40 — ack `admin:quick_reply_list/set` — template balasan cepat user. */
export interface AdminQuickReplyAck {
  ok: true;
  items: string[];
}

/** v40 — ack `admin:quick_send` — template terkirim sebagai Admin. */
export interface AdminQuickSendAck {
  ok: true;
  message: ChatMessageApi;
}

/** v40 — ack `admin:user_nudge` — pengingat otomatis dikonfigurasi. */
export interface AdminNudgeAck {
  ok: true;
  days: number;
  text: string | null;
}

/** v40 — ack `admin:user_autoclean` — auto-bersih dikonfigurasi. */
export interface AdminAutocleanAck {
  ok: true;
  days: number;
}

/** v40 — ack `admin:user_media_zip` — ZIP media siap diunduh (base64). */
export interface AdminMediaZipAck {
  ok: true;
  b64: string;
  count: number;
  bytes: number;
  skipped: number;
  name: string;
}

/** v40 — ack `admin:user_pinlock` — kunci PIN dipasang/dilepas. */
export interface AdminPinLockAck {
  ok: true;
  locked: boolean;
}

/** v40 — ack `admin:unlock` — kunci PIN dibuka untuk socket ini. */
export interface AdminUnlockAck {
  ok: true;
}

/** v40 — ack `admin:moderate` — pesan pending disetujui/ditolak. */
export interface AdminModerateAck {
  ok: true;
  action: 'approve' | 'reject';
}

/** v40 — server → admin: pemakaian kuota media user menyentuh ambang. */
export interface AdminQuotaWarnPayload {
  userId: string;
  userName: string;
  pct: number;
  usedBytes: number;
  quotaBytes: number;
}

/** v40 — server → admin: aktivitas user live (feed). */
export interface AdminActivityPayload {
  userId: string;
  kind: 'login' | 'message' | 'read';
  detail: string;
  at: string;
}

/** v40 — server → user: sesi diakhiri admin (paksa logout). */
export interface SessionRevokedPayload {
  by: string;
}

/** v43 — server → admins: perangkat baru terikat ke akun (login/daftar). */
export interface AdminNewLoginPayload {
  userId: string;
  userName: string;
  /** 6 karakter pertama deviceId (penuh tidak diekspos). */
  deviceId: string;
  ip: string | null;
  userAgent: string | null;
  at: number;
}

/** v43 — server → admins: hasil backup otomatis terjadwal. */
export interface AdminAutoBackupPayload {
  ok: boolean;
  at: string;
  detail?: string;
}

/** v43 — ack `admin:auto_backup_get` — status backup otomatis (Pusat). */
export interface AdminAutoBackupGetAck {
  ok: true;
  /** Jam:menit WIB target (format HH:MM). */
  at: string;
  /** Tanggal WIB (YYYY-MM-DD) backup otomatis terakhir, null bila belum pernah. */
  lastAutoBackup: string | null;
  lastRun: { at: string; ok: boolean; detail: string } | null;
}

/** v43 — ack `admin:auto_backup_now` — mulai backup sekarang (hasil menyusul via broadcast). */
export interface AdminAutoBackupNowAck {
  ok: boolean;
  started: boolean;
  detail: string;
}

/** v40 — server → user: pesan yang menunggu moderasi ditolak admin. */
export interface ModerationRejectedPayload {
  messageId: number;
}

/** One deleted (tombstoned) message as returned by `admin:forensics`. */
export interface ForensicsItem {
  messageId: number;
  conversationId: string;
  senderName: string;
  type: string;
  /** Original text preserved server-side before redaction (may be ""). */
  content: string;
  createdAt: string;
  deletedAt: string;
}

export interface ForensicsAck {
  ok: true;
  items: ForensicsItem[];
}

/** One historical revision of an edited message (oldest first). */
export interface EditHistoryItem {
  text: string;
  at: string;
}

export interface EditHistoryAck {
  ok: true;
  items: EditHistoryItem[];
}

/** `admin:peek` — side-effect-free read of the latest history page. */
export interface PeekAck {
  ok: true;
  conversationId: string;
  messages: ChatMessage[];
  hasMore: boolean;
}

/** One hit of `admin:search` (content match across ALL conversations). */
export interface SearchItem {
  messageId: number;
  conversationId: string;
  senderName: string;
  type: string;
  /** Excerpt of the content around the match (…-trimmed, ≤ ~140 chars). */
  snippet: string;
  createdAt: string;
  conversationName: string;
}

export interface SearchAck {
  ok: true;
  items: SearchItem[];
}

export interface UserStatsAck {
  ok: true;
  /** Last 14 UTC days, zero-filled ({ day: 'YYYY-MM-DD', count }). */
  perDay: { day: string; count: number }[];
  /** 24 hour-of-day buckets (UTC) over the last 7 days. */
  topHours: { hour: number; count: number }[];
  /** Live (non-deleted) messages sent by the user. */
  total: number;
  /** Live media messages (image/voice/file) sent by the user. */
  media: number;
}

/** v37 — hasil insight per-pengguna (admin:user_insight, khusus admin). */
export interface UserInsight {
  user: {
    id: string;
    name: string;
    role: string;
    createdAt: string;
    lastSeenAt: string;
  };
  conversationId: string;
  totals: {
    userMessages: number;
    adminMessages: number;
    mediaCount: number;
    mediaBytes: number;
    textChars: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    byType: Record<string, number>;
  };
  /** Histogram jam (24) & hari (0=Minggu) zona WIB + hari aktif/streak. */
  activity: {
    hours: number[];
    weekdays: number[];
    activeDays: number;
    streakDays: number;
    longestSilenceMs: number;
  };
  /** Kecepatan membalas berpasangan (null bila sampel < 1, cap 12 jam). */
  responses: {
    userAvgMs: number | null;
    adminAvgMs: number | null;
    userSamples: number;
    adminSamples: number;
  };
  reads: { adminMessages: number; readCount: number; readPct: number };
  reactions: { given: number; received: number };
  /** Pesan user: 7 hari terakhir vs 7 hari sebelumnya. */
  trend: { last7: number; prev7: number; pct: number };
  /** Ide/observasi otomatis Bahasa Indonesia (maks 8 butir). */
  insights: string[];
}

export interface AdminUserInsightAck {
  ok: true;
  insight: UserInsight;
}

/** Shared ack of `admin:export_conversation` / `admin:export_user`.
 *  The UI turns `content` into a Blob download named `fileName`. */
export interface ExportAck {
  ok: true;
  format: "txt" | "json";
  fileName: string;
  content: string;
  count: number;
}

export interface KickAck {
  ok: true;
  sockets: number;
}

export interface FreezeAck {
  ok: true;
  frozen: boolean;
  restricted: UserRestrictionState;
}

export interface MuteAck {
  ok: true;
  /** ISO deadline or null when the mute was cleared (minutes: 0). */
  mutedUntil: string | null;
  restricted: UserRestrictionState;
}

export interface SlowModeAck {
  ok: true;
  perMinute: number;
  restricted: UserRestrictionState;
}

export interface MediaBlockAck {
  ok: true;
  mediaBlocked: boolean;
  restricted: UserRestrictionState;
}

export interface FakeTypingAck {
  ok: true;
}

export interface AlwaysOnlineAck {
  ok: true;
  alwaysOnline: boolean;
}

export interface FakeLastSeenAck {
  ok: true;
  /** The stored fake string ('' = disabled). */
  fakeLastSeen: string;
}

export interface FakeReceiptsAck {
  ok: true;
  /** Number of messages the fake receipt covered. */
  count: number;
  lastReadMessageId: number;
}

export interface QuickRepliesAck {
  ok: true;
  items: string[];
}

export interface MirrorAck {
  ok: true;
  mirror: boolean;
}

export interface AuditItem {
  action: string;
  detail: string;
  at: string;
}

export interface AuditAck {
  ok: true;
  items: AuditItem[];
}

export interface ResetConversationAck {
  ok: true;
  deleted: number;
}

/** One flagged message as returned by `admin:flagged_list`. */
export interface FlaggedItem {
  messageId: number;
  conversationId: string;
  senderName: string;
  type: string;
  snippet: string;
  /** First matching keyword (recomputed from the content). */
  keyword: string;
  createdAt: string;
  deletedAt?: string;
}

export interface FlaggedListAck {
  ok: true;
  items: FlaggedItem[];
}

/** `admin:pin` / `admin:unpin` — same ack shape as conversation:pin. */
export interface AdminPinAck {
  ok: true;
  conversationId: string;
  pinnedMessageId: number | null;
  pinnedMessage: PinnedMessageInfo | null;
}

/** Server → both sides: the conversation's pinned message changed (v11). */
export interface ConversationPinnedPayload {
  conversationId: string;
  pinnedMessageId: number | null;
  pinnedMessage: PinnedMessageInfo | null;
}

/** Server → admins room: a text message matched a keyword (silent flag). */
export interface AdminFlaggedPayload {
  messageId: number;
  conversationId: string;
  senderName: string;
  snippet: string;
  keyword: string;
  createdAt: string;
}

/** Server → everyone in the conversation: bulk soft delete (v11 reset). */
export interface ConversationResetPayload {
  conversationId: string;
  deletedAt: string;
  deleted: number;
  /** v29 — siapa yang membersihkan (toast klien tidak selalu menyalahkan admin). */
  by?: "admin" | "user";
  byName?: string;
}

/* ------------------------------------------------------------------ */
/* Client → Server events (ack via callback where listed)              */
/* ------------------------------------------------------------------ */
//
// public:settings    {} → PublicSettingsAck | ChatErrorAck
//                      Pre-login fetch of the Web Push VAPID public key.
//
// public:check_name  { name: string } → PublicCheckNameAck | ChatErrorAck  (v28)
//                      Pre-login probe (tanpa sesi): apakah nama (case-
//                      insensitive) sudah dipakai akun user / reserved
//                      "Admin". Hanya boolean `exists` — dipakai kartu login
//                      utk menyembunyikan kolom kode undangan pada user lama.
//
// user:auth         { name: string; userId?: string; pin?: string }
//                     → UserAuthAck | ChatErrorAck
//                     Login (session userId) or find-or-create by
//                     (case-insensitive) name. PIN-protected accounts must
//                     present `pin` on fresh logins (PIN_REQUIRED /
//                     INVALID_PIN). Ensures the 1-on-1 conversation with
//                     Admin, marks it read (broadcasts read:update),
//                     returns the full history + admin read cursor.
//
// admin:auth        { password: string }
//                     → AdminAuthAck | ChatErrorAck
//                     Password login (hash settings v23, fallback
//                     ADMIN_PASSWORD env atau "admin123"). Rate-limited.
//                     Joins the `admins` room; returns ALL conversations.
//
// admin:password_change { currentPassword, newPassword }   [v23, admin-only]
//                     → AdminPasswordChangeAck | ChatErrorAck
//                     Ganti password admin (bcrypt ≥6 karakter, tersimpan
//                     di settings). Sesi yang sudah ter-auth tetap berlaku.
//
// messages:history  { conversationId: string; beforeId?: number }
//                     → HistoryAck | ChatErrorAck
//                     Both roles; participant-gated; marks read.
//                     Returns the newest HISTORY_PAGE_SIZE (50) messages
//                     ascending; with `beforeId` (v8) the page ENDING just
//                     before that id. `hasMore` signals older pages.
//
// messages:older    { conversationId: string; beforeId: number }
//                     → OlderMessagesAck | ChatErrorAck            (v8)
//                     Participant-gated page of up to 50 messages with
//                     id < beforeId (ascending) + `hasMore`. Read state
//                     is NOT touched. Powers the "Muat pesan lama" button.
//
// messages:send     { conversationId: string; content: string;
//                     type?: 'text'|'image'|'voice'|'file';
//                     replyToId?: number; durationMs?: number;
//                     fileName?: string; fileSize?: number; mimeType?: string;
//                     thumbUrl?: string;
//                     caption?: string }  // v20 — teks yang ikut media (foto/file)
//                     → MessageAck | ChatErrorAck
//                     Both roles; participant-gated. Sender auto-reads.
//                     v8 — image/voice content is PREFERRED as the
//                     /api/media/<name> URL produced by POST /api/upload
//                     (then fileName/fileSize/mimeType are REQUIRED and
//                     validated; legacy in-band data URLs still accepted,
//                     size-capped). `thumbUrl` is an optional /api/media
//                     URL pointing at a tiny preview image.
//                     Voice notes are transcribed asynchronously (server
//                     reads the bytes from db/media; transcript arrives
//                     via message:updated).
//                     file content = /api/media/<name> URL obtained from
//                     POST /api/upload; fileName (1–255 chars), mimeType
//                     (type/subtype) and fileSize (≤ 25 MiB) are required
//                     metadata validated server-side.
//                     v8 guards: per-account rate limits (30 text/min,
//                     12 media/min → RATE_LIMITED) and a storage quota
//                     (sum of fileSize ≤ 250 MiB → QUOTA_EXCEEDED).
//                     The retention sweeper may later redact any media
//                     message (→ mediaExpiredAt tombstone via
//                     message:updated) after MEDIA_RETENTION_DAYS.
//
// messages:delete   { messageId: number }
//                     → { ok: true } | ChatErrorAck
//                     Sender-only soft delete; content redacted for
//                     everyone; broadcast as message:updated.
//
// messages:edit     { messageId: number; content: string }
//                     → { ok: true } | ChatErrorAck
//                     Sender-only, text messages, 15-minute window;
//                     broadcast as message:updated.
//
// message:react     { messageId: number; emoji: string }
//                     → { ok: true } | ChatErrorAck
//                     Toggle the caller's reaction on a message.
//                     Empty emoji removes the caller's reaction.
//
// message:translate { messageId: number } → TranslateAck | ChatErrorAck
//                     On-demand Indonesian translation (AI, best effort).
//
// messages:read     { conversationId: string }                 (no ack)
//
// typing            { conversationId: string; isTyping: boolean } (no ack)
//
// user:setpin       { pin: string | null }        → SetPinAck | ChatErrorAck
//                     4–8 digits, or null/"" to remove. User role only.
//
// conversation:pin     { conversationId, messageId|null } (admin)
// conversation:archive { conversationId, archived }  (admin)
//                     Plain archive/unarchive — no rating side effects.
// push:subscribe       { subscription }              (no ack, user/admin)
//
// ---- v10 (admin dashboard) — all admin-only, ack via callback ----
//
// admin:dashboard     {} → DashboardStatsAck | ChatErrorAck
// admin:settings:get  {} → AppSettingsAck | ChatErrorAck
// admin:settings:set  { appName?, welcomeMessage?, maintenanceMode?,
//                       maintenanceNote?,
//                       v13: allowRegistration?, maxMessageLength?,
//                       maxUploadMb?, allowImages?, allowVoice?, allowFiles?,
//                       allowLinks?, linkPreview?, allowReactions?,
//                       readReceipts?, slowmodeSeconds? }
//                       → AppSettingsAck | ChatErrorAck
//                       Also broadcasts `app:settings:update` to everyone.
// admin:broadcast     { text, kind: 'siaran'|'pengumuman' }
//                       → BroadcastAck | ChatErrorAck
//                       Inserts one system message into EVERY conversation.
// admin:backup        {} → BackupAck | ChatErrorAck (full JSON dump)
// admin:vacuum        {} → VacuumAck | ChatErrorAck (WAL checkpoint + VACUUM)
// admin:ghost         { on: boolean } → GhostAck | ChatErrorAck
//                       Ghost reading: admin reads without read receipts.
// admin:system        {} → SystemInfoAck | ChatErrorAck   (v13)
//                       Runtime snapshot + audit tail (Sistem tab).
// admin:cleanup       {} → CleanupAck | ChatErrorAck      (v13)
//                       Manual retention sweep: expire old media, VACUUM.
//
// ---- v10 server → client ----
//
// app:settings:update  AppSettingsUpdatePayload (broadcast to ALL clients)
//
// ---- v11 (admin power features) — all admin-only, ack via callback ----
//
// Kategori A — intel / x-ray:
// admin:xray              { userId } → XrayAck | ChatErrorAck
//                           Live profile: id, name, createdAt, lastSeen,
//                           online, socketCount, messageCount, mediaCount,
//                           mediaBytes, lastMessageAt, ip, userAgent, platform.
//                           Connection metadata (ip/user-agent) is captured at
//                           auth time and lives in memory only.
// admin:forensics         { conversationId? } → ForensicsAck | ChatErrorAck
//                           Latest 100 tombstoned messages (newest first) with
//                           the ORIGINAL text preserved in deleted_content.
//                           Note: messages deleted BEFORE v11 are unrecoverable
//                           (their content was redacted by the old pipeline).
// admin:edit_history      { messageId } → EditHistoryAck | ChatErrorAck
//                           Previous revisions of an edited message (oldest
//                           first, [{text, at}]). Recorded from v11 on.
// admin:peek              { conversationId } → PeekAck | ChatErrorAck
//                           Latest 50 messages, NO read marks, NO receipts,
//                           no side effects at all.
// admin:search            { query } → SearchAck | ChatErrorAck
//                           Case-insensitive substring search across ALL
//                           conversations (2–100 chars, excludes deleted,
//                           newest first, limit 100).
// admin:user_stats        { userId } → UserStatsAck | ChatErrorAck
// admin:user_insight (v37) { userId } → AdminUserInsightAck | ChatErrorAck
//                          — agregat + ide otomatis per user (khusus admin,
//                            ter-audit); dialog "Insight pengguna" dashboard.
//                           perDay (14 UTC days, zero-filled), topHours (24
//                           buckets over last 7 days), total, media — live
//                           messages only.
// admin:export_conversation { conversationId, format: 'txt'|'json' }
//                           → ExportAck | ChatErrorAck
//                           Full transcript (latest 5000 messages); the UI
//                           downloads `content` as a Blob named `fileName`.
// admin:export_user       { userId } → ExportAck | ChatErrorAck
//                           JSON dump { profile (= xray), messages (≤5000),
//                           stats (= user_stats), exportedAt }.
//
// Kategori B — session control (enforcement inside messages:send,
// ordered: frozen → muted → mediaBlocked → slowmode/rate → quota):
// admin:kick              { userId } → KickAck | ChatErrorAck
//                           Force-disconnects ALL sockets of the user. The
//                           client auto-reconnects (acceptable, documented).
// admin:freeze            { userId, on: boolean } → FreezeAck | ChatErrorAck
//                           Frozen users may connect but sending acks FROZEN.
// admin:mute              { userId, minutes } → MuteAck | ChatErrorAck
//                           minutes 1–1440 (0 = clear early). Sending acks
//                           MUTED with remainingSeconds while active.
// admin:slowmode          { userId, perMinute } → SlowModeAck | ChatErrorAck
//                           perMinute 0|1|2|3|5|10 (0 = off). Personal text
//                           limit; hitting it acks SLOW_MODE + remainingSeconds.
// admin:mediablock        { userId, on: boolean } → MediaBlockAck | ChatErrorAck
//                           Non-text sends ack MEDIA_BLOCKED while on.
//                           Every restriction change emits `user:restricted`
//                           to that user's sockets; users also receive it on
//                           login when any restriction is active.
//
// Kategori B2 — kendali per-user tambahan (v39, panel X-Ray):
// admin:user_rename       { userId, name } → AdminRenameAck | ChatErrorAck
//                           Display/login name change; same validation as
//                           account creation (unique, not admin's name).
// admin:bulk_delete_user  { userId } → AdminBulkDeleteUserAck | ChatErrorAck
//                           Tombstones EVERY live message of the user in all
//                           conversations (official pipeline: deleted_content
//                           preserved) + releases disk media (dedup aware).
// admin:user_bot          { userId, on, text, delaySec } → AdminBotAck
//                           Per-user auto-reply bot answering AS ADMIN in the
//                           user↔admin conversation after delaySec (0–120).
//                           Stored in DB; one pending timer per user.
// admin:user_push         { userId, title, body } → AdminPushAck
//                           Custom web push to ALL push subscriptions of the
//                           user (title ≤60, body ≤200).
// admin:user_quota        { userId, mb } → AdminQuotaAck
//                           Special per-user media quota in MiB (0 = global
//                           default 250 MiB); enforced in messages:send via
//                           effectiveQuotaBytes().
//
// Kategori B3 — pusat kendali per-user (v40):
// admin:word_filter        { userId, words, action } → AdminWordFilterAck
//                           Daftar kata terlarang (baris/koma); action
//                           'block' = tolak pesan (WORD_BLOCKED), 'censor'
//                           = kata diganti '***' otomatis di messages:send.
// admin:approval_mode      { userId, on } → AdminApprovalModeAck
//                           Semua pesan user disimpan pending=1 dan HANYA
//                           dikirim ke room admin sampai disetujui.
// admin:moderate           { messageId, action 'approve'|'reject' }
//                          → AdminModerateAck
//                           approve: pending=0 + fan-out message:new ke user
//                           + message:updated ke admin; reject: tombstone
//                           via pipeline resmi + moderation:rejected ke user.
// admin:media_types        { userId, blocked: string[] } → AdminMediaTypesAck
//                           Blokir jenis media tertentu (image/voice/file)
//                           → error MEDIA_TYPE_BLOCKED di messages:send.
// admin:user_force_logout  { userId } → AdminForceLogoutAck
//                           Hapus semua devices + emit session:revoked ke
//                           seluruh socket user + putuskan socket-nya.
// admin:user_note          { userId, note, tag } → AdminNoteAck
//                           Catatan pribadi admin + tag vip/attention/problem.
// admin:leaderboard        {} → AdminLeaderboardAck
//                           Peringkat: pesan terbanyak, media terbanyak,
//                           paling aktif (last_seen), balas tercepat (rtp).
// admin:user_compare       { userIdA, userIdB } → AdminCompareAck
//                           buildUserInsight untuk dua user berdampingan.
// admin:user_logins        { userId } → AdminLoginsAck
//                           50 login terakhir dari tabel login_events.
// admin:schedule_message   { userId, text, sendAtMs } → AdminScheduleAck
//                           Pesan admin terjadwal (reuse kolom scheduled_at
//                           v22; deliverDueScheduled mengirimkan otomatis).
// admin:schedule_list      { userId } → AdminScheduleListAck
// admin:schedule_cancel    { messageId } → AdminScheduleCancelAck
// admin:quick_reply_list   { userId } → AdminQuickReplyAck
// admin:quick_reply_set    { userId, items } → AdminQuickReplyAck
// admin:quick_send         { userId, text } → AdminQuickSendAck
//                           Kirim template ATAS NAMA ADMIN ke user (instan).
// admin:user_nudge         { userId, days, text } → AdminNudgeAck
//                           Pengingat otomatis saat user diam ≥ days hari
//                           (sweeper 30 menit; sekali per periode diam).
// admin:user_autoclean     { userId, days } → AdminAutocleanAck
//                           Auto-bersih: tombstone pesan > days hari di
//                           percakapan user (sweeper 6 jam, pipeline resmi).
// admin:user_media_zip     { userId } → AdminMediaZipAck
//                           ZIP semua media hidup user (base64, maks 40 MiB).
// admin:user_pinlock       { userId, pin|null } → AdminPinLockAck
//                           Kunci percakapan dengan PIN 4–8 digit.
// admin:unlock             { userId, pin } → AdminUnlockAck
//                           Buka kunci untuk socket admin ini (per login).
// messages:history/older   → ack error PIN_LOCKED { userId } saat terkunci.
// server → admin: admin:quota_warn (AdminQuotaWarnPayload, ambang 80/95%),
//           admin:activity (AdminActivityPayload, feed live).
// server → user: session:revoked (SessionRevokedPayload, paksa logout),
//           moderation:rejected (ModerationRejectedPayload).
//
// Kategori C2 — paket AI khusus admin (v41, dialog "🤖 AI" + saran chip):
// admin:ai_summary         { conversationId } → AdminAISummaryAck
//                           Ringkasan percakapan oleh LLM (Bahasa Indonesia).
// admin:ai_suggest         { conversationId } → AdminAISuggestAck
//                           3 saran balasan pendek untuk admin.
// admin:ai_assistant       { history: {role,content}[] } → AdminAIAssistantAck
//                           Chat bebas dgn "ChatKita AI" (maks 20 giliran).
// admin:ai_tts             { messageId } → AdminAITtsAck
//                           Bacakan pesan teks → WAV base64 (diputar klien).
// admin:ai_transcribe      { messageId } → AdminAITranscribeAck
//                           Transkrip ulang pesan suara (ASR) → transcript
//                           disimpan + broadcast message:updated.
// admin:ai_media_search    { query } → AdminAIMediaSearchAck
//                           Cari foto dgn bahasa: VLM caption (cache) +
//                           LLM ranking → hits urut kecocokan.
// admin:ai_image_generate  { prompt, size } → AdminAIImageGenerateAck
//                           Text-to-image (pratinjau base64, cache 15 mnt).
// admin:ai_image_send      { conversationId, prompt, size } → AdminAIImageSendAck
//                           Kirim hasil cache sebagai pesan foto sungguhan.
// admin:ai_moderation      {} get | { enabled?, mode? } set → AdminAIModerationAck
//                           Moderasi otomatis pesan teks user (pasca-kirim):
//                           mode 'censor' (ganti ***) atau 'block' (tombstone
//                           + moderation:rejected). Fail-open bila AI down.
// Kategori C4 — cheat lanjutan per-user (v45, dialog "🎭 Cheat"):
// admin:cheat_shadowban     { userId, on } → AdminCheatShadowAck
//                           Shadowban: pesan user sukses di sisinya tapi tak
//                           sampai admin; matikan → pesan bayangan terungkap.
// admin:cheat_voice         { userId, text } → AdminCheatVoiceAck
//                           Spoof pesan suara (TTS Indonesia) atas nama user.
// admin:cheat_image_ai      { userId, prompt, size? } → AdminCheatImageAiAck
//                           Gambar AI dikirim atas nama user (tanpa label AI).
// admin:cheat_flood         { userId, text, count 1-30, intervalMs 250-5000 }
//                           → AdminCheatFloodAck — spam injector berjadwal.
// admin:cheat_flood_stop    { userId } → AdminCheatFloodStopAck
// admin:cheat_timewarp      { userId, deltaHours ±2160 } → AdminCheatTimewarpAck
//                           Geser waktu SEMUA pesan hidup user (massal).
// admin:cheat_autoreply     { userId, on, text?, delaySec? } → AdminCheatConfigAck
//                           Bot balasan atas nama user saat Admin kirim pesan.
// admin:cheat_throttle      { userId, seconds 0-300 } → AdminCheatConfigAck
//                           Pesan user tiba di admin setelah jeda X detik.
// admin:clone_conversation  { fromUserId, toUserId, move? } → AdminCloneConversationAck
//                           Salin (atau pindah) maks 500 pesan antar percakapan.
// server → admins: admin:ai_flag (AdminAIFlagPayload) — intel pesan tersensor/
//           diblokir AI.
//
// Kategori C3 — Admin & Sistem (v43, Task 60-c):
// server → admins: admin:new_login (AdminNewLoginPayload) — perangkat baru
//           terikat ke akun (pendaftaran / login perangkat lain).
// server → admins: admin:auto_backup (AdminAutoBackupPayload) — backup
//           otomatis terjadwal selesai (ok/at/detail).
// admin:auto_backup_get    {} → AdminAutoBackupGetAck — status jadwal + hasil
//           terakhir (Pusat).
// admin:auto_backup_now    {} → AdminAutoBackupNowAck — jalankan backup
//           berlapis sekarang (audit auto_backup, admin penuh).
//
// Kategori C — fake signals (stored as settings rows):
// admin:fake_typing       { conversationId, on: boolean } → FakeTypingAck
//                           Emits the SAME partner:typing shape the user side
//                           already understands (as if Admin were typing).
//                           No DB writes.
// admin:always_online     { on: boolean } → AlwaysOnlineAck | ChatErrorAck
//                           Admin presence stays online even with 0 sockets;
//                           disconnect no longer marks admin offline/lastSeen.
// admin:fake_last_seen    { value: string } → FakeLastSeenAck | ChatErrorAck
//                           ≤ 40 chars or '' to disable. Substituted for the
//                           admin's lastSeen in every payload sent to USERS
//                           (the admin always sees the real value).
// admin:fake_receipts     { conversationId } → FakeReceiptsAck | ChatErrorAck
//                           Broadcasts a read:update as if Admin read ALL
//                           messages, WITHOUT touching reads in the DB.
// admin:quick_replies:get {} → QuickRepliesAck | ChatErrorAck
// admin:quick_replies:set { items: string[] } → QuickRepliesAck | ChatErrorAck
//                           ≤ 20 items, each 1–200 chars; UI sends them as
//                           normal messages (no other server behavior).
// admin:mirror            { on: boolean } → MirrorAck | ChatErrorAck
//                           While on, a user typing in a conversation WITH the
//                           admin also receives a mirrored partner:typing
//                           ("Admin is typing") for the user side only.
//
// Kategori E — Pusat Cheat (v25, semua cheat admin jadi satu tempat):
// admin:cheat_peek        { userId } → AdminCheatPeekAck | ChatErrorAck
//                           Resolves the user↔admin conversation, returns the
//                           latest page + current cheat toggles (no side effect).
// admin:cheat_send        { userId, text, createdAt? } → AdminCheatSendAck | ChatErrorAck
//                           Spoof: inserts a TEXT message AS the target user
//                           through the normal fan-out (indistinguishable);
//                           createdAt (epoch ms, ≤90d past / ≤1d future)
//                           backdates it. Audited as cheat_send.
// admin:cheat_edit        { messageId, text } → AdminCheatEditAck | ChatErrorAck
//                           Edit ANY text message (no sender/window checks);
//                           old text still recorded in edit_history (forensics).
// admin:cheat_react       { messageId, userId, emoji } → AdminCheatReactAck | ChatErrorAck
//                           Toggle a reaction AS the target user (same store as
//                           message:react).
// admin:cheat_time        { messageId, createdAt } → AdminCheatTimeAck | ChatErrorAck
//                           Rewrites created_at; clients update the time chip
//                           + day separator via message:updated.createdAt.
//
// Kategori I — Kontrol user lengkap (v38, dari toolbar percakapan admin):
// admin:user_media         { userId } → AdminUserMediaAck | ChatErrorAck
//                           Lists LIVE media (image/voice/file, not deleted,
//                           not expired) of the user↔admin conversation,
//                           newest first, with per-side totals. Read-only.
// admin:media_delete       { messageId } → AdminMediaDeleteAck | ChatErrorAck
//                           Tombstones ONE media message through the shared
//                           delete pipeline (forensics-safe), releases the
//                           disk file when no live message references it
//                           (SHA-256 dedup aware) and frees quota (quota is
//                           computed live from file_size). Broadcasts the
//                           usual message:updated tombstone to both sides.
// admin:media_delete_all   { userId, scope: "user" | "all" } →
//                           AdminMediaDeleteAllAck | ChatErrorAck
//                           scope "user" = only media SENT BY the user;
//                           "all" = every media in the conversation. Same
//                           pipeline as admin:media_delete, then a single
//                           conversations push. Audited as media_delete_all.
//
// Kategori F — Peta Penyimpanan (v26):
// admin:storage_map       {} → AdminStorageMapAck | ChatErrorAck
//                           Storage breakdown: disk (db/wal/media + file count),
//                           logical media bytes per type bucket (image/audio/
//                           video/pdf/file), per-user usage vs quota, top-12
//                           largest files (with parsed header metadata), and
//                           metadata coverage (withMeta/withoutMeta).
// admin:media_scan        {} → AdminMediaScanAck | ChatErrorAck
//                           Scans up to 500 media rows lacking meta_json, reads
//                           file headers (PNG/GIF/WebP/JPEG dims, MP4 dims+
//                           duration, PDF page count) and fills meta_json.
//                           New image/file sends extract metadata at send time.
//
// admin:message_meta       { messageId } → AdminMessageMetaAck | ChatErrorAck (v35)
//                           ADMIN-ONLY. Full media metadata for one message:
//                           meta_json (dims/duration/pages/videoCreated/EXIF)
//                           + file info (name/mime/size/sender/created).
//                           Live-enriches missing EXIF from the disk file and
//                           persists it; images only; failures are silent.
//
// Kategori G — 1 orang 1 akun (v27):
// user:auth                { name, pin?, password?, inviteCode?, deviceId?, userId? }
//                           → UserAuthAck (mustSetPassword) | error:
//                           REGISTRATION_CLOSED / PASSWORD_REQUIRED / WEAK_PASSWORD /
//                           INVITE_REQUIRED / INVITE_INVALID / INVITE_USED /
//                           DEVICE_REQUIRED / DEVICE_TAKEN / INVALID_PASSWORD /
//                           TOO_MANY_ATTEMPTS / PIN_REQUIRED / INVALID_PIN
//                           Registration = password (4–72) + single-use invite code
//                           + unbound device (1 device = 1 account, append-only).
//                           Login with a password account requires the password
//                           (session restore exempt); legacy accounts keep the
//                           PIN gate and receive mustSetPassword → client shows
//                           the mandatory password-setup modal.
// user:set_password        { password } → { ok: true } | ChatErrorAck (ALREADY_SET/WEAK)
//                           First-time password setup for legacy accounts.
//
// Kategori H — reset & hapus menyeluruh (v29):
//                          v30 — conversation:clear (user) DIHAPUS dari protokol;
//                          membersihkan chat untuk KEDUA SISI hanya dapat
//                          dilakukan ADMIN via admin:reset_conversation
//                          (Kategori D) — audit + broadcast conversation:reset.
// messages:unstar_all      {} → UnstarAllAck | ChatErrorAck
//                           Lepas semua bintang MILIK pemanggil (starred_by
//                           per-user); tiap pesan berubah di-broadcast
//                           message:updated {starredBy}.
// messages:schedule_cancel_all {} → ScheduleCancelAllAck | ChatErrorAck
//                           Batalkan semua pesan terjadwal milik pemanggil
//                           yang belum terkirim (hard delete + broadcast
//                           message:scheduled_cancelled per id).
// admin:user_delete        { userId } → AdminUserDeleteAck | ChatErrorAck
//                           Hapus PERMANEN akun user: socket diputus, pesan /
//                           reaksi / reads / percakapan / perangkat / langganan
//                           push dihapus, media dibebaskan. Broadcast
//                           users:changed { userId, removed } ke admins.
// admin:invites_clear_unused {} → AdminInvitesClearAck | ChatErrorAck
//                           Hapus semua kode undangan yang belum terpakai.
// admin:audit_clear        {} → AdminAuditClearAck | ChatErrorAck
//                           Bersihkan audit_log; satu entri audit_clear tetap
//                           ditulis sebagai jejak pembersihan.
// admin:settings:reset     {} → AdminSettingsResetAck | ChatErrorAck
//                           Kembalikan seluruh pengaturan aplikasi ke default
//                           (hanya kunci APP_SETTING_RESET_KEYS; password
//                           admin/vapid/notice tidak tersentuh) + broadcast
//                           app:settings:update.
// users:changed            (server → admins) { userId, removed: true } — sinyal
//                           refresh daftar pengguna/overview setelah hapus akun.
// admin:invite_list        {} → AdminInviteListAck | ChatErrorAck
// admin:invite_create      { count?, label? } → AdminInviteCreateAck (1–20 codes,
//                           format CK-XXXXX-XXXX, single-use) | ChatErrorAck
// admin:invite_delete      { code } → { ok: true } | ChatErrorAck (NOT_FOUND)
// admin:user_create        { name, password } → AdminUserCreateAck | ChatErrorAck
//                           Admin creates an account directly (no invite/device).
// admin:user_reset_password { userId, password } → { ok: true } | ChatErrorAck
// admin:user_unbind_devices { userId } → AdminUnbindDevicesAck — releases ALL
//                           device bindings of a user (e.g. they changed phone).
//
// Kategori D — moderation & advanced forensics:
// admin:delete_message    { messageId } → { ok: true } | ChatErrorAck
//                           ANY sender's message via the SAME delete pipeline
//                           (tombstone + message:updated broadcast).
// admin:reset_conversation { conversationId } → ResetConversationAck | ChatErrorAck
//                           Soft-deletes ALL messages (same pipeline, batched
//                           into one `conversation:reset` event), clears the
//                           pin, keeps the conversation row.
// admin:audit             { limit? } → AuditAck | ChatErrorAck
//                           Newest-first audit trail (limit ≤ 200, default 100).
// admin:pin               { messageId } → AdminPinAck | ChatErrorAck
// admin:unpin             { conversationId } → AdminPinAck | ChatErrorAck
//                           Pin/unpin ANY message in ANY conversation using the
//                           same internals as conversation:pin.
// admin:keywords:get      {} → QuickRepliesAck | ChatErrorAck  (string[])
// admin:keywords:set      { items: string[] } → QuickRepliesAck | ChatErrorAck
//                           ≤ 50 items, each 1–60 chars, case-insensitive.
// admin:flagged_list      {} → FlaggedListAck | ChatErrorAck
//                           Latest 100 flagged=1 messages.
//
// ---- v11 server → client ----
//
// user:restricted      UserRestrictedPayload — to the affected user's room on
//                      every restriction change + on login when active.
// conversation:pinned  ConversationPinnedPayload — both user rooms + admins
//                      room, on every pin change (also emitted as the older
//                      conversation:update for backward compatibility).
// admin:flagged        AdminFlaggedPayload — admins room only, right after a
//                      text message matching a keyword is stored (silent: the
//                      sender's message is NOT blocked or altered).
// conversation:reset   ConversationResetPayload — both sides, bulk delete.

/* ------------------------------------------------------------------ */
/* Server → Client events                                              */
/* ------------------------------------------------------------------ */
//
// message:new          ChatMessage
//                        Fan-out to the two participants: the human
//                        user's `user:<id>` room AND the `admins` room.
//                        (Clients append ONLY from this event; ignore
//                        message payloads inside success acks.)
//
// message:updated      MessageUpdatePayload
//                        Merge-by-id: delete tombstones, edits, late
//                        voice transcripts, translations, reactions,
//                        v8 retention tombstones (mediaExpiredAt).
//
// read:update          { conversationId, userId, lastReadMessageId }
//                        `userId` = who read. Own sent messages with
//                        id <= lastReadMessageId become ✓✓.
//
// conversations:update ConversationOverview[]
//                        Personalized: full list to the `admins` room;
//                        the caller's own list to a `user:<id>` room.
//
// partner:typing       { conversationId: string; isTyping: boolean }
//                        Relayed to the OTHER participant (admins room
//                        when the typer is a user, user room when the
//                        typer is admin).
//
// presence:update      { userId: string; online: boolean;
//                        lastSeenAt: string | null }
//                        User online/offline → `admins` room ONLY
//                        (users must never learn about other users).
//                        Admin online/offline → all `user:<id>` rooms.
//
// conversation:update  PinUpdatePayload — pinned banner changed (both).
// conversation:archive:update ArchiveUpdatePayload (admins room only).
//
// user:restricted      UserRestrictedPayload (v11) — restriction state of the
//                      receiving user (frozen/mutedUntil/slowMode/mediaBlocked).
// conversation:pinned  ConversationPinnedPayload (v11) — pinnedMessage incl.
//                      senderName or null; supersedes conversation:update for
//                      pin changes (both are still emitted).
// admin:flagged        AdminFlaggedPayload (v11) — keyword hit, admins only.
// conversation:reset   ConversationResetPayload (v11) — bulk tombstone after
//                      admin:reset_conversation; clients clear the message
//                      list for that conversation.

/* ------------------------------------------------------------------ */
/* v41 — Paket AI khusus admin (Kategori C2)                          */
/* ------------------------------------------------------------------ */

/** ChatKita AI: satu giliran percakapan (asisten admin). */
export interface AdminAIChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AdminAISummaryAck {
  ok: boolean;
  summary?: string;
  error?: string;
}

export interface AdminAISuggestAck {
  ok: boolean;
  suggestions?: string[];
  error?: string;
}

export interface AdminAIAssistantAck {
  ok: boolean;
  reply?: string;
  error?: string;
}

export interface AdminAITtsAck {
  ok: boolean;
  /** WAV lengkap dalam base64 (diputar via data URL). */
  audioBase64?: string;
  error?: string;
}

export interface AdminAITranscribeAck {
  ok: boolean;
  transcript?: string;
  error?: string;
}

/** Satu hasil pencarian media AI (foto hidup, terbaru dulu). */
export interface AdminAIMediaHit {
  messageId: number;
  conversationId: string;
  /** URL publik media ("/api/media/<nama>"). */
  mediaUrl: string;
  fileName: string;
  senderName: string;
  createdAt: string;
  /** Keterangan hasil VLM (bisa kosong bila caption user ada). */
  caption: string;
}

export interface AdminAIMediaSearchAck {
  ok: boolean;
  hits?: AdminAIMediaHit[];
  /** Jumlah foto yang diperiksa (dipakai label "N foto diperiksa"). */
  scanned?: number;
  error?: string;
}

export interface AdminAIImageGenerateAck {
  ok: boolean;
  /** PNG base64 tanpa prefiks data URL (pratinjau klien). */
  imageBase64?: string;
  error?: string;
}

export interface AdminAIImageSendAck {
  ok: boolean;
  error?: string;
}

/** Status moderasi otomatis AI (setting global, bukan per-user). */
export interface AdminAIModerationState {
  enabled: boolean;
  mode: "block" | "censor";
}

export interface AdminAIModerationAck {
  ok: boolean;
  state?: AdminAIModerationState;
  error?: string;
}

/** Intel ke room admin: pesan user yang disensor/diblokir AI. */
export interface AdminAIFlagPayload {
  messageId: number;
  conversationId: string;
  senderName: string;
  action: "censor" | "block";
  reason: string;
  snippet: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Kategori D2 — paket v42 (Task 60-b): 10 fitur chat baru             */
/* ------------------------------------------------------------------ */

/** v42 — ack `user:mystats` — statistik personal user (payload sama
 *  dengan admin:user_insight; buildUserInsight v37 dipakai ulang). */
export interface UserMyStatsAck {
  ok: true;
  insight: UserInsight;
}

/** v42 — ack `messages:poll_create` — pesan polling dibuat. */
export interface PollCreateAck {
  ok: true;
  message: ChatMessage;
}

/** v42 — ack `messages:poll_vote` — suara tersimpan (ganti pilihan = replace). */
export interface PollVoteAck {
  ok: true;
  /** Jumlah suara per opsi (keadaan terbaru). */
  counts: number[];
  /** Total seluruh suara. */
  total: number;
  /** Indeks opsi yang baru dipilih pemilih. */
  myVote: number;
}

/** v42 — broadcast `poll:update` ke kedua room user + admins setiap ada
 *  suara baru (tanpa myVote — tiap viewer memegang pilihannya sendiri). */
export interface PollUpdatePayload {
  messageId: number;
  conversationId: string;
  counts: number[];
  total: number;
}

/** v42 — ack `conversation:ttl` (admin set) — jam TTL aktif (0 = mati). */
export interface TtlSetAck {
  ok: true;
  hours: number;
}

/** v42 — ack `conversation:ttl_get` — baca TTL percakapan. */
export interface TtlGetAck {
  ok: true;
  hours: number;
}

/** v42 — broadcast `conversation:ttl:update` ke kedua user room + admins. */
export interface TtlUpdatePayload {
  conversationId: string;
  hours: number;
}

/** v42 — ack `messages:remind` — pengingat pesan tersimpan. */
export interface RemindAck {
  ok: true;
}

/** v42 — ack `messages:remind_cancel` — pengingat pesan dibatalkan. */
export interface RemindCancelAck {
  ok: true;
}

/** v42 — broadcast `reminder:due` ke room pembuat saat pengingat jatuh tempo. */
export interface ReminderDuePayload {
  messageId: number;
  conversationId: string;
}

/** v42 — ack `conversation:archive_self` — arsip sisi user berubah. */
export interface ArchiveSelfAck {
  ok: true;
  archived: boolean;
}

/** v42 — ack `user:status` — status custom tersimpan ('' = dihapus). */
export interface UserStatusAck {
  ok: true;
  statusText: string;
}

/** v42 — broadcast `user:status:update` ke room admins. */
export interface UserStatusUpdatePayload {
  userId: string;
  statusText: string;
}

/* ------------------------------------------------------------------ */
/* v43 — 2FA TOTP admin (Kategori C4)                                 */
/* ------------------------------------------------------------------ */

export interface AdminTotpStateAck {
  ok: boolean;
  enabled?: boolean;
  error?: string;
}

export interface AdminTotpSetupAck {
  ok: boolean;
  /** Secret base32 untuk dimasukkan ke aplikasi autentikator. */
  secret?: string;
  /** URI otpauth:// (bisa dirender sebagai QR atau disalin). */
  otpauth?: string;
  error?: string;
}

export interface AdminTotpEnableAck {
  ok: boolean;
  error?: "TOTP_INVALID" | string;
}

export interface AdminTotpDisableAck {
  ok: boolean;
  error?: "TOTP_INVALID" | string;
}

// Kategori C4 — 2FA TOTP admin (v43, seksi Keamanan di tab Pusat):
// admin:totp_state    {} → AdminTotpStateAck
// admin:totp_setup    {} → AdminTotpSetupAck — secret pending + otpauth URI
// admin:totp_enable   {code} → AdminTotpEnableAck — verifikasi kode lalu aktif
// admin:totp_disable  {code} → AdminTotpDisableAck
// admin:auth gate: totpEnabled tanpa {totp} → {ok:false,error:'TOTP_REQUIRED'};
//                  kode salah → {ok:false,error:'TOTP_INVALID'}.
// server → admins: admin:new_login (v43 — perangkat baru terikat ke akun),
//           admin:auto_backup {ok, at} (v43 — hasil backup terjadwal).

/* ------------------------------------------------------------------ */
/* Kategori D — call suara/video WebRTC (v44, Task 60-d)               */
/* ------------------------------------------------------------------ */
/* Signaling via socket.io chat-service; MEDIA P2P langsung antar browser
 * (RTCPeerConnection + STUN publik, host candidate satu mesin langsung
 * berhasil) — TIDAK lewat gateway. Server hanya me-relay sinyal dengan
 * validasi peserta; maks 1 call aktif per pasangan (BUSY).              */

/** Jenis media call: 'audio' = telepon suara, 'video' = video call. */
export type CallMedia = "audio" | "video";

/** Fase UI satu call dari awal sampai selesai. */
export type CallPhase =
  | "ringing" // callee: call masuk berbunyi
  | "outgoing" // caller: memanggil, menunggu dijawab
  | "connecting" // SDP/ICE dipertukarkan setelah diterima
  | "active" // media mengalir (timer durasi berjalan)
  | "ended"; // call berakhir (overlay singkat sebelum ditutup)

/** Peran lokal dalam call. */
export type CallRole = "caller" | "callee";

/** Identitas lawan dalam call. */
export interface CallPeer {
  id: string;
  name: string;
}

/** call:ring {toUserId, media} → ack. BUSY bila pasangan sedang call. */
export interface CallRingAck {
  ok: boolean;
  callId?: string;
  error?: "BUSY" | "INVALID_TARGET" | "NO_CONVERSATION" | "UNAUTHORIZED" | string;
}

/** server → penerima: call masuk (room user:<id> / admins). */
export interface CallIncomingPayload {
  callId: string;
  from: CallPeer;
  media: CallMedia;
}

/** call:answer {callId, accept} (hanya penerima) → ack. */
export interface CallAnswerAck {
  ok: boolean;
  error?: "INVALID_CALL" | "NOT_CALLEE" | string;
}

/** server → penelepon: call diterima → mulai createOffer. */
export interface CallAnsweredPayload {
  callId: string;
  media: CallMedia;
}

/** server → penelepon: call ditolak penerima. */
export interface CallRejectedPayload {
  callId: string;
}

/** server → penelepon: call tak terjawab (timeout 45 dtk server). */
export interface CallMissedPayload {
  callId: string;
  to: string;
  media: CallMedia;
}

/** Ack umum event relay (call:offer / call:answer_sdp / call:ice / call:end). */
export interface CallRelayAck {
  ok: boolean;
  error?: "INVALID_CALL" | string;
}

/** server → lawan: call diakhiri oleh `by` (userId). */
export interface CallEndedPayload {
  callId: string;
  by: string;
}

// Protokol Kategori D — call (v44), semua handler di chat-service index.ts:
// client → server (ack):
//   call:ring       {toUserId, media}  → CallRingAck ('BUSY' bila sibuk)
//   call:answer     {callId, accept}   → CallAnswerAck (penerima saja)
//   call:offer      {callId, sdp}      → CallRelayAck (penelepon → penerima)
//   call:answer_sdp {callId, sdp}      → CallRelayAck (penerima → penelepon)
//   call:ice        {callId, candidate} → CallRelayAck (dua arah, JSON string)
//   call:end        {callId}           → CallRelayAck (siapa pun peserta)
// server → client:
//   call:incoming   {callId, from:{id,name}, media} — ke room penerima
//   call:answered   {callId, media}  — ke penelepon (mulai createOffer)
//   call:rejected   {callId}         — ke penelepon
//   call:missed     {callId, to, media} — ke penelepon (timeout 45 dtk)
//   call:ended      {callId, by}     — ke lawan (juga saat peserta disconnect)
