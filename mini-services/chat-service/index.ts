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
import { readFileSync, unlinkSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { Server, type Socket as IoSocket } from 'socket.io'
import ZAI from 'z-ai-web-dev-sdk'
import webpush from 'web-push'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = 3003 // hardcoded — gateway routes XTransformPort=3003 here
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
 *  (payload redacted → "media kedaluwarsa" tombstone). Days, env-overridable. */
const RETENTION_MS =
  Math.min(365, Math.max(1, Number(process.env.MEDIA_RETENTION_DAYS) || 30)) * 86_400_000
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

const db = new Database(join(import.meta.dir, 'chat.db'))
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
  row: Pick<MessageRow, 'type' | 'content' | 'deleted_at' | 'file_name' | 'media_expired_at'>
): string => {
  if (row.deleted_at) return 'Pesan ini dihapus'
  if (row.media_expired_at) return '⏳ Media kedaluwarsa'
  const type = row.type ?? 'text'
  if (type === 'image') return '📷 Foto'
  if (type === 'voice') return '🎤 Pesan suara'
  if (type === 'file') return `📎 ${row.file_name ?? 'File'}`
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

const toPartnerInfo = (user: UserRow): PartnerInfoApi => ({
  id: user.id,
  name: user.name,
  online: isOnline(user.id),
  lastSeenAt: new Date(user.last_seen_at).toISOString(),
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
  limit = HISTORY_PAGE_SIZE
): { messages: ChatMessageApi[]; hasMore: boolean } => {
  const fetched = (
    beforeId
      ? (db
          .query(
            `SELECT * FROM (
               SELECT * FROM messages WHERE conversation_id = ? AND id < ?
               ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`
          )
          .all(conversationId, beforeId, limit + 1) as MessageRow[])
      : (db
          .query(
            `SELECT * FROM (
               SELECT * FROM messages WHERE conversation_id = ?
               ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`
          )
          .all(conversationId, limit + 1) as MessageRow[])
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
        pm.id AS pin_id,
        pm.sender_id AS pin_sender,
        pm.content AS pin_content,
        pm.type AS pin_type,
        pm.deleted_at AS pin_deleted,
        pm.file_name AS pin_file_name,
        (SELECT r.last_read_message_id FROM reads r
          WHERE r.conversation_id = c.id
            AND r.user_id = (CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END)
        ) AS partner_read,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id != $me
            AND m.deleted_at IS NULL
            AND m.id > COALESCE(
              (SELECT r.last_read_message_id FROM reads r
               WHERE r.conversation_id = c.id AND r.user_id = $me), 0)
        ) AS unread
      FROM conversations c
      JOIN users p
        ON p.id = (CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END)
      LEFT JOIN messages lm
        ON lm.id = (SELECT m2.id FROM messages m2
                    WHERE m2.conversation_id = c.id ORDER BY m2.id DESC LIMIT 1)
      LEFT JOIN messages pm
        ON pm.id = c.pinned_message_id
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
    pin_id: number | null
    pin_sender: string | null
    pin_content: string | null
    pin_type: string | null
    pin_deleted: number | null
    pin_file_name: string | null
    partner_read: number | null
    unread: number
  }>

  return rows.map((r) => ({
    id: r.id,
    partner: {
      id: r.partner_id,
      name: r.partner_name,
      online: isOnline(r.partner_id),
      lastSeenAt: new Date(r.partner_last_seen).toISOString(),
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
  }))
}

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

const onlineSockets = new Map<string, Set<string>>() // userId -> socket ids

const isOnline = (userId: string) => (onlineSockets.get(userId)?.size ?? 0) > 0

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
  } = {}
): ChatMessageApi => {
  const ts = now()
  const hasMediaMeta = type === 'file' || type === 'image' || type === 'voice'
  const result = db.run(
    'INSERT INTO messages (conversation_id, sender_id, content, created_at, type, reply_to_id, duration_ms, file_name, file_size, mime_type, thumb_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
/* Connection                                                          */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)

  /* ---------------------- public config (pre-login) ---------------------- */

  socket.on('public:settings', handler(socket, (_data, ack) => {
    // Pre-login Web Push config: just the VAPID public key ("" when push
    // is unavailable).
    ack({ ok: true, pushPublicKey: VAPID_PUBLIC })
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

      if (!user) {
        const id = crypto.randomUUID()
        const ts = now()
        db.run(
          "INSERT INTO users (id, name, role, created_at, last_seen_at) VALUES (?, ?, 'user', ?, ?)",
          [id, name, ts, ts]
        )
        user = { id, name, role: 'user', created_at: ts, last_seen_at: ts }
        console.log(`New user registered: "${name}" (${id})`)
      } else {
        // PIN gate: fresh (name-only) logins must present the PIN.
        if (user.pin_hash) {
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
        const ts = now()
        db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [ts, user.id])
        user.last_seen_at = ts
      }

      // A user's single conversation is the one with the admin.
      const conversation = ensureConversationWithAdmin(user.id)
      // The user is looking at the chat right now → mark everything read.
      const readUpTo = markRead(conversation.id, user.id)
      broadcastRead(conversation, user.id, readUpTo)

      socket.data.userId = user.id
      socket.join(`user:${user.id}`)
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
      const admin = findUserById(ADMIN_ID) // seeded on boot — always exists
      const page = getMessagesPage(conversation.id)
      ack({
        ok: true,
        user: { id: user.id, name: user.name, hasPin: !!user.pin_hash },
        conversationId: conversation.id,
        partner: admin
          ? toPartnerInfo(admin)
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
    })
  )

  socket.on(
    'admin:auth',
    handler(socket, (data, ack) => {
      const password = typeof data?.password === 'string' ? data.password : ''
      const expected = process.env.ADMIN_PASSWORD || 'admin123'
      if (password !== expected) {
        console.log(`Rejected admin login (wrong password, socket ${socket.id})`)
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }

      socket.data.userId = ADMIN_ID
      socket.join('admins')
      const becameOnline = addOnlineSocket(ADMIN_ID, socket.id)
      if (becameOnline) {
        // Admin presence is public by design.
        io.emit('presence:update', { userId: ADMIN_ID, online: true, lastSeenAt: null })
      }

      console.log(`Admin authenticated (socket ${socket.id})`)
      ack({ ok: true, conversations: getConversationsFor(ADMIN_ID) })
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
      const lastReadBefore = getReadUpTo(conversation.id, me)
      const readUpTo = markRead(conversation.id, me)
      broadcastRead(conversation, me, readUpTo)
      const partner = getPartnerUser(conversation, me)
      const page = getMessagesPage(conversation.id)
      ack({
        ok: true,
        messages: page.messages,
        // v8 — older pages load on demand via `messages:older`.
        hasMore: page.hasMore,
        partner: toPartnerInfo(partner),
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
      const beforeId = Number(data?.beforeId)
      if (!Number.isInteger(beforeId) || beforeId <= 0) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      // Read state is intentionally NOT touched by paging through history.
      ack({ ok: true, ...getMessagesPage(conversation.id, beforeId) })
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
      let trimmed: string
      let fileMeta: { fileName: string; fileSize: number; mimeType: string } | null = null
      let thumbUrlRef: string | undefined

      if (type === 'text') {
        trimmed = content.trim()
        if (trimmed.length < 1 || trimmed.length > MAX_MESSAGE_LENGTH) {
          ack({ ok: false, error: 'INVALID_MESSAGE' })
          return
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
          if (
            typeof fileSize !== 'number' ||
            !Number.isInteger(fileSize) ||
            fileSize < 0 ||
            fileSize > MAX_FILE_BYTES
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
      if (type === 'text') {
        if (!rateAllowed(me, 'text', RATE_TEXT_PER_MIN)) {
          ack({ ok: false, error: 'RATE_LIMITED' })
          return
        }
      } else if (!rateAllowed(me, 'media', RATE_MEDIA_PER_MIN)) {
        ack({ ok: false, error: 'RATE_LIMITED' })
        return
      } else if (fileMeta && storedMediaBytes(me) + fileMeta.fileSize > QUOTA_BYTES) {
        ack({ ok: false, error: 'QUOTA_EXCEEDED' })
        return
      }

      const message = insertAndFanOut(conversation, me, trimmed, type, {
        replyToId,
        durationMs,
        ...(fileMeta ?? {}),
        ...(thumbUrlRef ? { thumbUrl: thumbUrlRef } : {}),
      })
      ack({ ok: true, message })

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
      // Redact content (and v7 file metadata) so deleted messages leave no
      // trace in any future payload.
      db.run(
        `UPDATE messages SET content = '', transcript = NULL, file_name = NULL, file_size = NULL, mime_type = NULL, deleted_at = ? WHERE id = ?`,
        [ts, id]
      )
      const payload = {
        id,
        conversationId: conversation.id,
        deletedAt: new Date(ts).toISOString(),
        content: '',
        type: row.type ?? 'text',
      }
      ack({ ok: true })
      io.to(`user:${conversation.user_a_id}`).emit('message:updated', payload)
      io.to(`user:${conversation.user_b_id}`).emit('message:updated', payload)
      io.to('admins').emit('message:updated', payload)
      pushConversationsTo(conversation.user_a_id)
      pushConversationsTo(conversation.user_b_id)
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
      const readUpTo = markRead(conversation.id, me)
      broadcastRead(conversation, me, readUpTo)
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
      db.run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', [content, ts, id])
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
      let pinned: { id: number; senderId: string; snippet: string; type: string } | null = null
      if (data?.messageId != null) {
        const id = Number(data.messageId)
        const row =
          Number.isInteger(id) && id > 0
            ? (db
                .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
                .get(id, conversation.id) as MessageRow | null)
            : null
        if (!row) {
          ack({ ok: false, error: 'NOT_FOUND' })
          return
        }
        db.run('UPDATE conversations SET pinned_message_id = ? WHERE id = ?', [id, conversation.id])
        pinned = { id: row.id, senderId: row.sender_id, snippet: snippetOf(row), type: row.type ?? 'text' }
      } else {
        db.run('UPDATE conversations SET pinned_message_id = NULL WHERE id = ?', [conversation.id])
      }
      const payload = {
        conversationId: conversation.id,
        pinnedMessageId: pinned?.id ?? null,
        pinned,
      }
      ack({ ok: true, ...payload })
      io.to(`user:${conversation.user_a_id}`).emit('conversation:update', payload)
      io.to(`user:${conversation.user_b_id}`).emit('conversation:update', payload)
      io.to('admins').emit('conversation:update', payload)
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

  /* ---------------------------- lifecycle ---------------------------- */

  socket.on('disconnect', (reason) => {
    const userId = socket.data?.userId
    console.log(`Socket disconnected: ${socket.id} (${reason})`)
    if (typeof userId !== 'string') return
    const wentOffline = removeOnlineSocket(userId, socket.id)
    if (wentOffline) {
      const ts = now()
      db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [ts, userId])
      const payload = { userId, online: false, lastSeenAt: new Date(ts).toISOString() }
      if (userId === ADMIN_ID) {
        // Admin presence is public: everyone may know.
        io.emit('presence:update', payload)
      } else {
        // User presence is private: only the admins room.
        io.to('admins').emit('presence:update', payload)
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

httpServer.listen(PORT, () => {
  console.log(
    `ChatKita chat-service v8 listening on port ${PORT} (path: '/', push: ${VAPID_PUBLIC ? 'on' : 'off'}, retensi: ${RETENTION_MS / 86_400_000} hari)`
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
