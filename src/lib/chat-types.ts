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
}

/** A chat partner including live presence info. */
export type PartnerInfo = ChatUser & {
  online: boolean;
  /** ISO timestamp of the last time this user was online (null if unknown). */
  lastSeenAt: string | null;
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
  };
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
}

export interface XrayAck {
  ok: true;
  profile: XrayProfile;
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
