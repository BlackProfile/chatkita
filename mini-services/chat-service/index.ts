/**
 * ChatKita chat-service — socket.io mini service (port 3003)
 *
 * Model (v3 — every human user chats 1-on-1 with the Admin):
 *   users(role) ──< conversations(user ↔ admin) ──< messages
 *   + per-user read state (reads) + presence (last_seen_at / online map)
 *
 * - Users are isolated from each other: every event is participant-gated
 *   and user presence is visible to the `admins` room ONLY (privacy).
 * - The admin sees ALL users' conversations in one list (`admins` room).
 * - Admin presence is public by design (broadcast to everyone).
 *
 * Implements the shared protocol contract defined in
 * /home/z/my-project/src/lib/chat-types.ts (DO NOT change event names
 * or payload shapes without updating both sides).
 *
 * Persistence: bun:sqlite (WAL mode) at ./chat.db
 * Connection path MUST stay '/' — the Caddy gateway forwards
 * /?XTransformPort=3003 to this port.
 */

import { createServer } from 'http'
import { join } from 'path'
import { Database } from 'bun:sqlite'
import { Server, type Socket as IoSocket } from 'socket.io'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = 3003 // hardcoded — gateway routes XTransformPort=3003 here
const ADMIN_ID = 'admin'
const ADMIN_NAME = 'Admin'
const MAX_NAME_LENGTH = 40
const MAX_MESSAGE_LENGTH = 1000
const HISTORY_LIMIT = 500

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

/* ------------------------------ row types ------------------------------ */

interface UserRow {
  id: string
  name: string
  role: string
  created_at: number
  last_seen_at: number
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
}

/** API-side mirrors of the shared contract types (kept in sync manually). */
interface ChatMessageApi {
  id: number
  conversationId: string
  senderId: string
  content: string
  createdAt: string
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
  lastMessage: { id: number; senderId: string; content: string; createdAt: string } | null
  lastMessageAt: string
  unread: number
}

/* ------------------------------ helpers ------------------------------ */

const now = () => Date.now()

const toChatMessage = (row: MessageRow): ChatMessageApi => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  content: row.content,
  createdAt: new Date(row.created_at).toISOString(),
})

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
  return rows.map(toChatMessage)
}

/** Upsert reads.last_read_message_id = GREATEST(existing, upTo) */
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
        lm.id AS last_id,
        lm.sender_id AS last_sender,
        lm.content AS last_content,
        lm.created_at AS last_at,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id != $me
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
    last_id: number | null
    last_sender: string | null
    last_content: string | null
    last_at: number | null
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
            content: r.last_content as string,
            createdAt: new Date(r.last_at as number).toISOString(),
          }
        : null,
    lastMessageAt: new Date(r.last_message_at).toISOString(),
    unread: r.unread,
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
        const ts = now()
        db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [ts, user.id])
        user.last_seen_at = ts
      }

      // A user's single conversation is the one with the admin.
      const conversation = ensureConversationWithAdmin(user.id)
      // The user is looking at the chat right now → mark everything read.
      markRead(conversation.id, user.id)

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
        user: { id: user.id, name: user.name },
        conversationId: conversation.id,
        partner: admin
          ? toPartnerInfo(admin)
          : { id: ADMIN_ID, name: ADMIN_NAME, online: false, lastSeenAt: null },
        messages: getMessages(conversation.id),
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
      markRead(conversation.id, me)
      const partner = getPartnerUser(conversation, me)
      ack({
        ok: true,
        messages: getMessages(conversation.id),
        partner: toPartnerInfo(partner),
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
      const content = typeof data?.content === 'string' ? data.content.trim() : ''
      if (content.length < 1 || content.length > MAX_MESSAGE_LENGTH) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
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

      const ts = now()
      const result = db.run(
        'INSERT INTO messages (conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?)',
        [conversation.id, me, content, ts]
      )
      db.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [ts, conversation.id])
      markRead(conversation.id, me, Number(result.lastInsertRowid)) // sender has read up to own message

      const message: ChatMessageApi = {
        id: Number(result.lastInsertRowid),
        conversationId: conversation.id,
        senderId: me,
        content,
        createdAt: new Date(ts).toISOString(),
      }

      ack({ ok: true, message })
      // Fan out to BOTH participants' personal rooms AND the admins room.
      // (`user:admin` is empty — the admins room carries admin-side delivery
      // and keeps every admin socket in sync.)
      io.to(`user:${conversation.user_a_id}`).emit('message:new', message)
      io.to(`user:${conversation.user_b_id}`).emit('message:new', message)
      io.to('admins').emit('message:new', message)
      pushConversationsTo(conversation.user_a_id)
      pushConversationsTo(conversation.user_b_id)
      console.log(`[${me.slice(0, 8)}] -> ${conversation.id.slice(0, 8)}: ${content.slice(0, 60)}`)
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
      markRead(conversation.id, me)
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
  console.log(`ChatKita chat-service listening on port ${PORT} (path: '/')`)
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
