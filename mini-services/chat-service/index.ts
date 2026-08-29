/**
 * ChatKita chat-service — socket.io mini service (port 3003)
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
import { Server } from 'socket.io'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = 3003 // hardcoded — gateway routes XTransformPort=3003 here
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const MAX_NAME_LENGTH = 40
const MAX_MESSAGE_LENGTH = 1000

/* ------------------------------------------------------------------ */
/* Storage (bun:sqlite, WAL)                                           */
/* ------------------------------------------------------------------ */

const db = new Database(join(import.meta.dir, 'chat.db'))
db.run('PRAGMA journal_mode = WAL')

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)')

db.run(`
  CREATE TABLE IF NOT EXISTS admin_reads (
    session_id TEXT PRIMARY KEY,
    last_read_message_id INTEGER NOT NULL DEFAULT 0
  )
`)

interface SessionRow {
  id: string
  name: string
  created_at: number
  last_message_at: number
}

interface MessageRow {
  id: number
  session_id: string
  sender: string
  content: string
  created_at: number
}

/** DB row -> ChatMessage (contract in src/lib/chat-types.ts) */
const toChatMessage = (row: MessageRow) => ({
  id: row.id,
  sessionId: row.session_id,
  sender: row.sender as 'user' | 'admin',
  content: row.content,
  createdAt: new Date(row.created_at).toISOString(),
})

const getSessionMessages = (sessionId: string) =>
  (db
    .query('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as MessageRow[]).map(toChatMessage)

const sessionExists = (sessionId: unknown): sessionId is string =>
  typeof sessionId === 'string' &&
  sessionId.length > 0 &&
  !!db.query('SELECT id FROM sessions WHERE id = ?').get(sessionId)

/** Upsert admin_reads.last_read_message_id = MAX(messages.id) for the session */
const markSessionRead = (sessionId: string) => {
  const row = db
    .query('SELECT MAX(id) AS max_id FROM messages WHERE session_id = ?')
    .get(sessionId) as { max_id: number | null }
  const maxId = row?.max_id ?? 0
  db.run(
    `INSERT INTO admin_reads (session_id, last_read_message_id) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`,
    [sessionId, maxId]
  )
}

/** Full inbox overview: all sessions, newest activity first */
const getSessionsOverview = () => {
  const sessions = db
    .query('SELECT * FROM sessions ORDER BY last_message_at DESC')
    .all() as SessionRow[]
  const lastMsgStmt = db.query(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1'
  )
  const unreadStmt = db.query(
    `SELECT COUNT(*) AS unread FROM messages
     WHERE session_id = ? AND sender = 'user'
       AND id > COALESCE((SELECT last_read_message_id FROM admin_reads WHERE session_id = ?), 0)`
  )
  return sessions.map((s) => {
    const last = lastMsgStmt.get(s.id) as MessageRow | null
    const unread = (unreadStmt.get(s.id, s.id) as { unread: number }).unread
    return {
      id: s.id,
      name: s.name,
      createdAt: new Date(s.created_at).toISOString(),
      lastMessageAt: new Date(s.last_message_at).toISOString(),
      lastMessage: last
        ? {
            content: last.content,
            sender: last.sender as 'user' | 'admin',
            createdAt: new Date(last.created_at).toISOString(),
          }
        : null,
      unread,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Socket.io server                                                    */
/* ------------------------------------------------------------------ */

const httpServer = createServer((req, res) => {
  // plain HTTP health probe (socket.io intercepts its own requests first)
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
 * Wraps a handler with flexible ack extraction (last function argument,
 * so both `emit(ev, ack)` and `emit(ev, payload, ack)` work) and a
 * try/catch that acks SERVER_ERROR on unexpected exceptions.
 */
const handler =
  (fn: (data: any, ack: AckFn) => void) =>
  (...args: unknown[]) => {
    const last = args[args.length - 1]
    const ack: AckFn =
      typeof last === 'function' ? (last as AckFn) : () => {}
    const data =
      args.length > 0 && typeof args[0] === 'object' && args[0] !== null
        ? args[0]
        : {}
    try {
      fn(data, ack)
    } catch (err) {
      console.error('Handler error:', err)
      ack({ ok: false, error: 'SERVER_ERROR' })
    }
  }

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)

  /* ------------------------------ user ------------------------------ */

  socket.on(
    'user:join',
    handler((data, ack) => {
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
        ack({ ok: false, error: 'INVALID_NAME' })
        return
      }

      let session: SessionRow | null = null
      if (sessionExists(data?.sessionId)) {
        session = db
          .query('SELECT * FROM sessions WHERE id = ?')
          .get(data.sessionId) as SessionRow
        if (session.name !== name) {
          db.run('UPDATE sessions SET name = ? WHERE id = ?', [
            name,
            session.id,
          ])
          session.name = name
        }
        console.log(`User "${name}" rejoined session ${session.id} (socket ${socket.id})`)
      } else {
        // no sessionId or stale/unknown sessionId -> create a fresh session
        const id = crypto.randomUUID()
        const now = Date.now()
        db.run(
          'INSERT INTO sessions (id, name, created_at, last_message_at) VALUES (?, ?, ?, ?)',
          [id, name, now, now]
        )
        session = { id, name, created_at: now, last_message_at: now }
        console.log(`User "${name}" created session ${id} (socket ${socket.id})`)
      }

      socket.join(`session:${session.id}`)
      ack({
        ok: true,
        session: { id: session.id, name: session.name },
        messages: getSessionMessages(session.id),
      })
      io.to('admins').emit('sessions:update', getSessionsOverview())
    })
  )

  socket.on(
    'user:message',
    handler((data, ack) => {
      const content =
        typeof data?.content === 'string' ? data.content.trim() : ''
      if (content.length < 1 || content.length > MAX_MESSAGE_LENGTH) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      if (!sessionExists(data?.sessionId)) {
        ack({ ok: false, error: 'SESSION_NOT_FOUND' })
        return
      }
      const sessionId = data.sessionId as string
      const now = Date.now()
      const result = db.run(
        "INSERT INTO messages (session_id, sender, content, created_at) VALUES (?, 'user', ?, ?)",
        [sessionId, content, now]
      )
      db.run('UPDATE sessions SET last_message_at = ? WHERE id = ?', [
        now,
        sessionId,
      ])
      const message = {
        id: Number(result.lastInsertRowid),
        sessionId,
        sender: 'user' as const,
        content,
        createdAt: new Date(now).toISOString(),
      }
      ack({ ok: true, message })
      io.to(`session:${sessionId}`).emit('chat:message', message)
      io.to('admins').emit('chat:message', message)
      io.to('admins').emit('sessions:update', getSessionsOverview())
      console.log(`[user] ${sessionId}: ${content.slice(0, 60)}`)
    })
  )

  socket.on(
    'user:typing',
    handler((data) => {
      io.to('admins').emit('user:typing', {
        sessionId: typeof data?.sessionId === 'string' ? data.sessionId : '',
        isTyping: data?.isTyping === true,
      })
    })
  )

  /* ------------------------------ admin ----------------------------- */

  socket.on(
    'admin:auth',
    handler((data, ack) => {
      const password = typeof data?.password === 'string' ? data.password : ''
      if (password !== ADMIN_PASSWORD) {
        console.log(`Failed admin auth attempt (socket ${socket.id})`)
        ack({ ok: false, error: 'UNAUTHORIZED' })
        return
      }
      socket.join('admins')
      console.log(`Admin authenticated (socket ${socket.id})`)
      ack({ ok: true, sessions: getSessionsOverview() })
    })
  )

  socket.on(
    'admin:sessions',
    handler((data, ack) => {
      ack({ ok: true, sessions: getSessionsOverview() })
    })
  )

  socket.on(
    'admin:history',
    handler((data, ack) => {
      if (!sessionExists(data?.sessionId)) {
        ack({ ok: false, error: 'SESSION_NOT_FOUND' })
        return
      }
      const sessionId = data.sessionId as string
      markSessionRead(sessionId)
      ack({ ok: true, messages: getSessionMessages(sessionId) })
      io.to('admins').emit('sessions:update', getSessionsOverview())
      console.log(`Admin opened history of session ${sessionId}`)
    })
  )

  socket.on(
    'admin:message',
    handler((data, ack) => {
      const content =
        typeof data?.content === 'string' ? data.content.trim() : ''
      if (content.length < 1 || content.length > MAX_MESSAGE_LENGTH) {
        ack({ ok: false, error: 'INVALID_MESSAGE' })
        return
      }
      if (!sessionExists(data?.sessionId)) {
        ack({ ok: false, error: 'SESSION_NOT_FOUND' })
        return
      }
      const sessionId = data.sessionId as string
      const now = Date.now()
      const result = db.run(
        "INSERT INTO messages (session_id, sender, content, created_at) VALUES (?, 'admin', ?, ?)",
        [sessionId, content, now]
      )
      db.run('UPDATE sessions SET last_message_at = ? WHERE id = ?', [
        now,
        sessionId,
      ])
      const message = {
        id: Number(result.lastInsertRowid),
        sessionId,
        sender: 'admin' as const,
        content,
        createdAt: new Date(now).toISOString(),
      }
      ack({ ok: true, message })
      io.to(`session:${sessionId}`).emit('chat:message', message)
      io.to('admins').emit('chat:message', message)
      io.to('admins').emit('sessions:update', getSessionsOverview())
      console.log(`[admin] ${sessionId}: ${content.slice(0, 60)}`)
    })
  )

  socket.on(
    'admin:read',
    handler((data) => {
      if (!sessionExists(data?.sessionId)) return
      const sessionId = data.sessionId as string
      markSessionRead(sessionId)
      io.to('admins').emit('sessions:update', getSessionsOverview())
      console.log(`Admin marked session ${sessionId} as read`)
    })
  )

  socket.on(
    'admin:typing',
    handler((data) => {
      if (typeof data?.sessionId !== 'string') return
      io.to(`session:${data.sessionId}`).emit('admin:typing', {
        isTyping: data?.isTyping === true,
      })
    })
  )

  /* ---------------------------- lifecycle ---------------------------- */

  socket.on('disconnect', (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

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
