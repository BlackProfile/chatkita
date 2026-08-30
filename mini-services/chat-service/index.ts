/**
 * ChatKita chat-service — socket.io mini service (port 3003)
 *
 * Model (v4 — 1-on-1 with Admin, full-featured):
 *   users(role, pin_hash, label, note) ──< conversations ──< messages
 *     messages: type text|image|voice|system, reply_to_id, duration_ms,
 *               transcript (AI speech-to-text), deleted_at (soft delete)
 *   + per-user read state (reads) → ✓✓ receipts broadcast live
 *   + settings table (operating hours, AI assistant, quick replies)
 *
 * New in v4:
 *   - Media messages: image (data URL) & voice notes (data URL + duration)
 *   - Reply/quote (reply_to_id, snapshot delivered as `replyTo`)
 *   - Delete for everyone (soft delete + content redaction)
 *   - Live read receipts (`read:update` broadcast)
 *   - Optional account PIN (SHA-256) protecting name-only logins
 *   - Admin CRM: per-user label (new|priority|vip) + internal note
 *   - Admin config: operating hours, AI assistant on/off, knowledge base,
 *     quick replies (`admin:settings`)
 *   - AI: auto-reply while admin is offline, reply suggestions,
 *     conversation summary, voice-note transcription (z-ai-web-dev-sdk)
 *
 * Users are isolated from each other: every event is participant-gated
 * and user presence is visible to the `admins` room ONLY (privacy).
 *
 * Persistence: bun:sqlite (WAL mode) at ./chat.db
 * Connection path MUST stay '/' — the Caddy gateway forwards
 * /?XTransformPort=3003 to this port.
 */

import { createServer } from 'http'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { Database } from 'bun:sqlite'
import { Server, type Socket as IoSocket } from 'socket.io'
import ZAI from 'z-ai-web-dev-sdk'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = 3003 // hardcoded — gateway routes XTransformPort=3003 here
const ADMIN_ID = 'admin'
const ADMIN_NAME = 'Admin'
const MAX_NAME_LENGTH = 40
const MAX_MESSAGE_LENGTH = 1000
const HISTORY_LIMIT = 500
/** Max data-URL payload for image/voice messages (base64 chars). */
const MAX_MEDIA_LENGTH = 2_500_000
/** Fixed UTC offset of the operating-hours timezone (Asia/Bangkok). */
const TZ_OFFSET_MS = 7 * 3600_000
const USER_LABELS = ['new', 'priority', 'vip'] as const

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
addColumn('users', 'label', 'TEXT')
addColumn('users', 'note', 'TEXT')

/* ------------------------------ row types ------------------------------ */

interface UserRow {
  id: string
  name: string
  role: string
  created_at: number
  last_seen_at: number
  pin_hash?: string | null
  label?: string | null
  note?: string | null
}

interface ConversationRow {
  id: string
  user_a_id: string
  user_b_id: string
  created_at: number
  last_message_at: number
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
}

/* ------------------------------ API types ------------------------------ */

interface ChatMessageApi {
  id: number
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  type: 'text' | 'image' | 'voice' | 'system'
  replyToId?: number
  replyTo?: { id: number; senderId: string; snippet: string; type: string }
  durationMs?: number
  transcript?: string
  deletedAt?: string
}

interface PartnerInfoApi {
  id: string
  name: string
  online: boolean
  lastSeenAt: string | null
  label?: string | null
}

interface ConversationOverviewApi {
  id: string
  partner: PartnerInfoApi
  lastMessage:
    | { id: number; senderId: string; content: string; createdAt: string; type: string; deleted: boolean }
    | null
  lastMessageAt: string
  unread: number
  /** How far the PARTNER has read → powers ✓✓ on own bubbles. */
  partnerLastReadId: number
}

interface ServiceSettings {
  hours: { enabled: boolean; start: string; end: string; days: number[] }
  aiEnabled: boolean
  aiKb: string
  outsideMsg: string
  quickReplies: { label: string; text: string }[]
}

const DEFAULT_SETTINGS: ServiceSettings = {
  hours: { enabled: true, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  aiEnabled: true,
  aiKb:
    'ChatKita adalah aplikasi chat customer service. Admin membalas pada jam kerja ' +
    '09:00–17:00 Senin–Jumat (waktu Indonesia/Bangkok). Di luar jam kerja asisten AI ' +
    'membantu menjawab pertanyaan umum. Transaksi, pembayaran, dan pengiriman ' +
    'dikonfirmasi langsung oleh admin.',
  outsideMsg:
    '🌙 Admin sedang tidak online. Pesan Anda sudah masuk — admin akan membalas ' +
    'saat jam kerja. Asisten AI siap membantu dulu untuk pertanyaan umum.',
  quickReplies: [
    { label: 'Salam', text: 'Halo! Terima kasih sudah menghubungi kami 😊 Ada yang bisa dibantu?' },
    { label: 'Mohon tunggu', text: 'Mohon tunggu sebentar ya, kami cek dulu 🙏' },
    { label: 'Diterima', text: 'Baik, permintaan Anda sudah kami terima dan segera diproses ✅' },
    { label: 'Penutup', text: 'Senang bisa membantu! Kalau ada lagi, silakan chat kapan saja 🙏' },
  ],
}

let settings: ServiceSettings = loadSettings()

function loadSettings(): ServiceSettings {
  try {
    const row = db.query('SELECT value FROM settings WHERE key = ?').get('service') as
      | { value: string }
      | null
    if (!row) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(row.value) as Partial<ServiceSettings>
    return {
      hours: { ...DEFAULT_SETTINGS.hours, ...(parsed.hours ?? {}) },
      aiEnabled: parsed.aiEnabled ?? DEFAULT_SETTINGS.aiEnabled,
      aiKb: parsed.aiKb ?? DEFAULT_SETTINGS.aiKb,
      outsideMsg: parsed.outsideMsg ?? DEFAULT_SETTINGS.outsideMsg,
      quickReplies: parsed.quickReplies ?? DEFAULT_SETTINGS.quickReplies,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings() {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['service', JSON.stringify(settings)]
  )
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
})

/** Human-readable one-liner for previews and reply quotes. */
const snippetOf = (row: Pick<MessageRow, 'type' | 'content' | 'deleted_at'>): string => {
  if (row.deleted_at) return 'Pesan ini dihapus'
  const type = row.type ?? 'text'
  if (type === 'image') return '📷 Foto'
  if (type === 'voice') return '🎤 Pesan suara'
  if (type === 'system') return row.content
  return row.content
}

/** Fetch reply-quote snapshots for a batch of messages (single query). */
const attachReplyPreviews = (rows: MessageRow[], messages: ChatMessageApi[]) => {
  const ids = [...new Set(rows.filter((r) => r.reply_to_id).map((r) => r.reply_to_id as number))]
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const originals = db
    .query(`SELECT id, sender_id, content, type, deleted_at FROM messages WHERE id IN (${placeholders})`)
    .all(...ids) as Array<Pick<MessageRow, 'id' | 'sender_id' | 'content' | 'type' | 'deleted_at'>>
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
  ...(user.label ? { label: user.label } : {}),
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
  return { id, user_a_id: a, user_b_id: b, created_at: ts, last_message_at: ts }
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

const getMessages = (conversationId: string): ChatMessageApi[] => {
  const rows = db
    .query(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ?
         ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
       ) ORDER BY id ASC`
    )
    .all(conversationId) as MessageRow[]
  const messages = rows.map(toChatMessage)
  attachReplyPreviews(rows, messages)
  return messages
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
        CASE WHEN c.user_a_id = $me THEN c.user_b_id ELSE c.user_a_id END AS partner_id,
        p.name AS partner_name,
        p.last_seen_at AS partner_last_seen,
        p.label AS partner_label,
        lm.id AS last_id,
        lm.sender_id AS last_sender,
        lm.content AS last_content,
        lm.created_at AS last_at,
        lm.type AS last_type,
        lm.deleted_at AS last_deleted,
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
      WHERE c.user_a_id = $me OR c.user_b_id = $me
      ORDER BY c.last_message_at DESC`
    )
    .all({ $me: userId }) as Array<{
    id: string
    last_message_at: number
    partner_id: string
    partner_name: string
    partner_last_seen: number
    partner_label: string | null
    last_id: number | null
    last_sender: string | null
    last_content: string | null
    last_at: number | null
    last_type: string | null
    last_deleted: number | null
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
      ...(r.partner_label ? { label: r.partner_label } : {}),
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
          }
        : null,
    lastMessageAt: new Date(r.last_message_at).toISOString(),
    unread: r.unread,
    partnerLastReadId: r.partner_read ?? 0,
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
/* Operating hours (Asia/Bangkok)                                      */
/* ------------------------------------------------------------------ */

const bangkokNow = () => {
  const d = new Date(Date.now() + TZ_OFFSET_MS)
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

const parseHm = (s: string, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return fallback
  return Math.min(24 * 60, Math.max(0, Number(m[1]) * 60 + Number(m[2])))
}

const isWithinHours = () => {
  const h = settings.hours
  if (!h.enabled) return true
  const { day, minutes } = bangkokNow()
  if (Array.isArray(h.days) && h.days.length > 0 && !h.days.includes(day)) return false
  const start = parseHm(h.start, 9 * 60)
  const end = parseHm(h.end, 17 * 60)
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/** Epoch ms of the current Bangkok day start (for daily stats). */
const startOfBangkokDay = () => {
  const d = new Date(Date.now() + TZ_OFFSET_MS)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET_MS
}

/* ------------------------------------------------------------------ */
/* Message persistence + fan-out (shared by human send / AI / system)  */
/* ------------------------------------------------------------------ */

type MessageType = 'text' | 'image' | 'voice' | 'system'

const insertAndFanOut = (
  conversation: ConversationRow,
  senderId: string,
  content: string,
  type: MessageType,
  opts: { replyToId?: number; durationMs?: number } = {}
): ChatMessageApi => {
  const ts = now()
  const result = db.run(
    'INSERT INTO messages (conversation_id, sender_id, content, created_at, type, reply_to_id, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [conversation.id, senderId, content, ts, type, opts.replyToId ?? null, opts.durationMs ?? null]
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
  return message
}

/* ------------------------------------------------------------------ */
/* AI assistant (z-ai-web-dev-sdk) — best effort, never blocks chat    */
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

/** Best-effort voice-note transcription → `message:updated` broadcast. */
const transcribeAsync = async (messageId: number, conversationId: string, dataUrl: string) => {
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

/** Recent text conversation as a transcript for LLM context. */
const recentTranscript = (conversationId: string, limit = 14, maxChars = 4000): string => {
  const rows = db
    .query(
      `SELECT sender_id, content FROM (
         SELECT id, sender_id, content FROM messages
         WHERE conversation_id = ? AND type = 'text' AND deleted_at IS NULL
         ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(conversationId, limit) as Array<{ sender_id: string; content: string }>
  let transcript = rows
    .map((r) => `${r.sender_id === ADMIN_ID ? 'Admin' : 'User'}: ${r.content}`)
    .join('\n')
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars)
  return transcript
}

const buildAiSystem = (user: UserRow) => {
  const labelNote =
    user.label === 'vip'
      ? ' — pelanggan VIP, utamakan keluhannya'
      : user.label === 'priority'
        ? ' — pelanggan prioritas'
        : ''
  return [
    'Anda adalah "Asisten ChatKita", asisten customer service yang ramah, singkat, dan membantu.',
    'Aturan wajib: bahasa Indonesia santun; maksimal 3 kalimat; TANPA markdown/format tebal;',
    'jawab hanya berdasarkan INFO LAYANAN di bawah; jika tidak yakin atau butuh aksi admin,',
    'sarankan dengan sopan untuk menunggu balasan admin. Jangan mengaruh informasi.',
    '',
    '== INFO LAYANAN ==',
    settings.aiKb,
    '',
    `== PELANGGAN == Nama: ${user.name}${labelNote}`,
  ].join('\n')
}

const aiBusy = new Set<string>() // one AI reply at a time per conversation

/** Auto-reply as the admin while they are offline. */
const aiAutoReply = async (conversation: ConversationRow, user: UserRow) => {
  if (aiBusy.has(conversation.id)) return
  aiBusy.add(conversation.id)
  try {
    if (!settings.aiEnabled || isOnline(ADMIN_ID)) return
    const history = recentTranscript(conversation.id)
    if (!history) return
    io.to(`user:${user.id}`).emit('partner:typing', {
      conversationId: conversation.id,
      isTyping: true,
    })
    const reply = await llmComplete(
      buildAiSystem(user),
      `${history}\n\n(Balas pesan terakhir dari User.)`,
      700
    )
    io.to(`user:${user.id}`).emit('partner:typing', {
      conversationId: conversation.id,
      isTyping: false,
    })
    if (!reply || isOnline(ADMIN_ID)) return
    insertAndFanOut(conversation, ADMIN_ID, reply, 'text')
    console.log(`AI auto-replied in ${conversation.id.slice(0, 8)}`)
  } catch (err) {
    console.error('AI auto-reply error:', (err as Error)?.message ?? err)
  } finally {
    aiBusy.delete(conversation.id)
  }
}

/** Once per 6h per conversation outside operating hours. */
const maybeOutsideHoursNotice = (conversation: ConversationRow) => {
  if (isWithinHours()) return
  const last = db
    .query(
      `SELECT created_at FROM messages WHERE conversation_id = ? AND type = 'system' ORDER BY id DESC LIMIT 1`
    )
    .get(conversation.id) as { created_at: number } | null
  if (last && Date.now() - last.created_at < 6 * 3600_000) return
  insertAndFanOut(conversation, ADMIN_ID, settings.outsideMsg, 'system')
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
  // image/voice messages travel as base64 data URLs
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

/* ------------------------------ stats ------------------------------ */

const computeStats = () => {
  const startDay = startOfBangkokDay()
  const weekAgo = startDay - 6 * 86400_000
  const totalUsers =
    (db.query(`SELECT COUNT(*) AS c FROM users WHERE role = 'user'`).get() as { c: number }).c
  const totalMessages =
    (db.query(`SELECT COUNT(*) AS c FROM messages WHERE deleted_at IS NULL`).get() as { c: number }).c
  const messagesToday =
    (db
      .query(`SELECT COUNT(*) AS c FROM messages WHERE created_at >= ? AND deleted_at IS NULL`)
      .get(startDay) as { c: number }).c
  const activeToday =
    (db
      .query(`SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND last_seen_at >= ?`)
      .get(startDay) as { c: number }).c
  const avgRow = db
    .query(
      `SELECT AVG(resp) AS avg FROM (
         SELECT (
           SELECT MIN(m2.created_at) FROM messages m2
           WHERE m2.conversation_id = m.conversation_id
             AND m2.sender_id = 'admin'
             AND m2.created_at > m.created_at
             AND m2.deleted_at IS NULL
         ) - m.created_at AS resp
         FROM messages m
         WHERE m.sender_id != 'admin' AND m.created_at >= ? AND m.deleted_at IS NULL
       ) WHERE resp IS NOT NULL AND resp >= 0 AND resp < 86400000`
    )
    .get(weekAgo) as { avg: number | null }
  return {
    totalUsers,
    totalMessages,
    messagesToday,
    activeToday,
    avgResponseMin: avgRow.avg == null ? null : Math.round((avgRow.avg / 60000) * 10) / 10,
  }
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)

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
      ack({
        ok: true,
        user: { id: user.id, name: user.name, hasPin: !!user.pin_hash },
        conversationId: conversation.id,
        partner: admin
          ? toPartnerInfo(admin)
          : { id: ADMIN_ID, name: ADMIN_NAME, online: false, lastSeenAt: null },
        messages: getMessages(conversation.id),
        /** How far the admin has read → ✓✓ on my sent messages. */
        partnerLastReadId: getReadUpTo(conversation.id, ADMIN_ID),
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
      const readUpTo = markRead(conversation.id, me)
      broadcastRead(conversation, me, readUpTo)
      const partner = getPartnerUser(conversation, me)
      ack({
        ok: true,
        messages: getMessages(conversation.id),
        partner: toPartnerInfo(partner),
        partnerLastReadId: getReadUpTo(conversation.id, partner.id),
      })
      pushConversationsTo(me)
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

      if (type === 'text') {
        trimmed = content.trim()
        if (trimmed.length < 1 || trimmed.length > MAX_MESSAGE_LENGTH) {
          ack({ ok: false, error: 'INVALID_MESSAGE' })
          return
        }
      } else if (type === 'image' || type === 'voice') {
        trimmed = content
        const pattern =
          type === 'image'
            ? /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/
            : /^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,[A-Za-z0-9+/=]+$/
        if (!pattern.test(trimmed) || trimmed.length > MAX_MEDIA_LENGTH) {
          ack({ ok: false, error: 'INVALID_MESSAGE' })
          return
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

      const message = insertAndFanOut(conversation, me, trimmed, type, {
        replyToId,
        durationMs,
      })
      ack({ ok: true, message })

      // Voice notes: transcribe in the background.
      if (type === 'voice') void transcribeAsync(message.id, conversation.id, trimmed)

      // AI hooks only for human user messages (never for the admin).
      if (me !== ADMIN_ID && type !== 'system') {
        maybeOutsideHoursNotice(conversation)
        if (!isOnline(ADMIN_ID) && settings.aiEnabled) {
          const userRow = findUserById(me)
          if (userRow) void aiAutoReply(conversation, userRow)
        }
      }

      console.log(
        `[${me.slice(0, 8)}] -> ${conversation.id.slice(0, 8)} (${type}): ${type === 'text' ? trimmed.slice(0, 60) : `${trimmed.length}b`}`
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
      // Redact content so deleted media/text leaves every future payload.
      db.run(`UPDATE messages SET content = '', transcript = NULL, deleted_at = ? WHERE id = ?`, [
        ts,
        id,
      ])
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

  /* ------------------------- admin CRM & config ------------------------ */

  socket.on(
    'admin:updateuser',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const userId = typeof data?.userId === 'string' ? data.userId : ''
      const target = userId ? findUserByRoleAndId(userId, 'user') : null
      if (!target) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      let { label, note } = data ?? {}
      if (label !== null && label !== undefined) {
        if (typeof label !== 'string' || !(USER_LABELS as readonly string[]).includes(label)) {
          ack({ ok: false, error: 'INVALID_LABEL' })
          return
        }
      } else label = null
      if (note !== null && note !== undefined) {
        if (typeof note !== 'string') {
          ack({ ok: false, error: 'INVALID_NOTE' })
          return
        }
        note = note.trim().slice(0, 500)
      } else note = null
      db.run('UPDATE users SET label = ?, note = ? WHERE id = ?', [label, note, target.id])
      ack({ ok: true, userId: target.id, label, note })
      pushConversationsTo(ADMIN_ID)
    })
  )

  socket.on(
    'admin:getnote',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const userId = typeof data?.userId === 'string' ? data.userId : ''
      const target = userId ? findUserByRoleAndId(userId, 'user') : null
      if (!target) {
        ack({ ok: false, error: 'NOT_FOUND' })
        return
      }
      ack({ ok: true, userId: target.id, label: target.label ?? null, note: target.note ?? null })
    })
  )

  socket.on(
    'admin:settings',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      const s = data?.settings ?? {}
      if (s.hours && typeof s.hours === 'object') {
        const h = s.hours
        const next = { ...settings.hours }
        if (typeof h.enabled === 'boolean') next.enabled = h.enabled
        if (typeof h.start === 'string' && /^\d{1,2}:\d{2}$/.test(h.start)) next.start = h.start
        if (typeof h.end === 'string' && /^\d{1,2}:\d{2}$/.test(h.end)) next.end = h.end
        if (Array.isArray(h.days)) {
          const days = [...new Set(h.days.filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6))]
          if (days.length > 0) next.days = days.sort()
        }
        settings.hours = next
      }
      if (typeof s.aiEnabled === 'boolean') settings.aiEnabled = s.aiEnabled
      if (typeof s.aiKb === 'string') settings.aiKb = s.aiKb.trim().slice(0, 4000) || DEFAULT_SETTINGS.aiKb
      if (typeof s.outsideMsg === 'string')
        settings.outsideMsg = s.outsideMsg.trim().slice(0, 300) || DEFAULT_SETTINGS.outsideMsg
      if (Array.isArray(s.quickReplies)) {
        const valid = s.quickReplies
          .filter(
            (q: unknown) =>
              !!q &&
              typeof (q as { label?: unknown }).label === 'string' &&
              typeof (q as { text?: unknown }).text === 'string'
          )
          .map((q: { label: string; text: string }) => ({
            label: q.label.trim().slice(0, 40),
            text: q.text.trim().slice(0, 300),
          }))
          .filter((q) => q.label && q.text)
          .slice(0, 20)
        settings.quickReplies = valid
      }
      saveSettings()
      console.log('Settings updated by admin')
      ack({ ok: true, settings })
    })
  )

  socket.on(
    'admin:getsettings',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      ack({ ok: true, settings })
    })
  )

  socket.on(
    'admin:stats',
    handler(socket, (data, ack) => {
      const me = authedUserId(socket)
      if (!me || me !== ADMIN_ID) {
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      ack({ ok: true, stats: computeStats() })
    })
  )

  /* ------------------------------ AI admin ----------------------------- */

  socket.on(
    'ai:suggest',
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
      const history = recentTranscript(conversation.id, 12)
      if (!history) {
        ack({ ok: false, error: 'AI_UNAVAILABLE' })
        return
      }
      llmComplete(
        'Anda asisten admin customer service ChatKita. Buat TIGA opsi balasan singkat ' +
          '(masing-masing maksimal 120 karakter) untuk pesan user terakhir dalam riwayat. ' +
          'Gaya: ramah, natural, sesuai isi chat. Jawab HANYA tiga baris bernomor, ' +
          'tanpa teks pembuka/penutup, tanpa markdown, tanpa tanda kutip. Contoh bentuk:\n' +
          '1. Halo! Terima kasih, pesanan sedang kami proses ya.\n' +
          '2. Baik, mohon tunggu sebentar, admin cek dulu.\n' +
          '3. Siap, akan kami informasikan setelah diproses.',
        history,
        600
      ).then((text) => {
        if (!text) {
          ack({ ok: false, error: 'AI_UNAVAILABLE' })
          return
        }
        const suggestions = text
          .split('\n')
          .map((line) => /^\s*\d+[.)]\s*(.+)$/.exec(line)?.[1]?.trim())
          .filter((s): s is string => !!s && s.length > 0)
          .slice(0, 3)
        ack({ ok: true, suggestions })
      })
    })
  )

  socket.on(
    'ai:summary',
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
      const history = recentTranscript(conversation.id, 30)
      if (!history) {
        ack({ ok: false, error: 'AI_UNAVAILABLE' })
        return
      }
      llmComplete(
        'Anda asisten admin customer service. Ringkas percakapan berikut dalam 1–2 kalimat ' +
          'bahasa Indonesia: kebutuhan/keluhan user dan status terakhirnya. Tanpa markdown.',
        history,
        400
      ).then((summary) => {
        if (!summary) {
          ack({ ok: false, error: 'AI_UNAVAILABLE' })
          return
        }
        ack({ ok: true, summary })
      })
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

httpServer.listen(PORT, () => {
  console.log(
    `ChatKita chat-service v4 listening on port ${PORT} (path: '/', ai: ${settings.aiEnabled ? 'on' : 'off'})`
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
