/**
 * Temporary protocol verification script for ChatKita chat-service.
 *
 * Run while the service is up:   bun test-protocol.ts
 * (from /home/z/my-project/mini-services/chat-service)
 *
 * NOTE: connects DIRECTLY to 127.0.0.1:3003 for testing only.
 * The real frontend must go through the Caddy gateway as
 * io('/?XTransformPort=3003').
 */

import { io, Socket } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
const OPTS = {
  transports: ['websocket', 'polling'],
  forceNew: true,
  reconnection: false,
  timeout: 10000,
} as const

let failed = 0
const assert = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`PASS: ${name}`)
  else {
    failed++
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** emit + wait for ack (supports events with and without payload) */
const emitAck = <T>(socket: Socket, event: string, payload?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ack of "${event}"`)),
      5000
    )
    const cb = (res: T) => {
      clearTimeout(timer)
      resolve(res)
    }
    if (payload === undefined) socket.emit(event, cb)
    else socket.emit(event, payload, cb)
  })

/** wait for a server->client event */
const waitFor = <T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event)
      reject(new Error(`timeout waiting for event "${event}"`))
    }, timeoutMs)
    socket.once(event, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })

const connect = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', (err: Error) => reject(err))
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  /* a) user joins a fresh session */
  const user = io(URL, OPTS)
  await connect(user)
  console.log('— user socket connected:', user.id)

  const joinRes = await emitAck<any>(user, 'user:join', { name: 'Budi Santoso' })
  assert('a1 user:join returns ok', joinRes?.ok === true, JSON.stringify(joinRes))
  const sessionId: string | undefined = joinRes?.session?.id
  assert('a2 sessionId returned', typeof sessionId === 'string' && sessionId.length > 0)
  assert('a3 session name echoed', joinRes?.session?.name === 'Budi Santoso')
  assert(
    'a4 fresh history is empty',
    Array.isArray(joinRes?.messages) && joinRes.messages.length === 0,
    JSON.stringify(joinRes?.messages)
  )

  /* b) user sends a message */
  const msgRes = await emitAck<any>(user, 'user:message', {
    sessionId,
    content: 'Halo, saya butuh bantuan',
  })
  assert('b1 user:message ok', msgRes?.ok === true, JSON.stringify(msgRes))
  assert('b2 message.sender === "user"', msgRes?.message?.sender === 'user')
  assert('b3 message.sessionId matches', msgRes?.message?.sessionId === sessionId)
  assert(
    'b4 createdAt is ISO string',
    typeof msgRes?.message?.createdAt === 'string' &&
      !Number.isNaN(Date.parse(msgRes.message.createdAt))
  )

  /* c) admin auth with wrong password */
  const admin = io(URL, OPTS)
  await connect(admin)
  console.log('— admin socket connected:', admin.id)

  const badAuth = await emitAck<any>(admin, 'admin:auth', { password: 'salah-banget' })
  assert(
    'c1 wrong password rejected with UNAUTHORIZED',
    badAuth?.ok === false && badAuth?.error === 'UNAUTHORIZED',
    JSON.stringify(badAuth)
  )

  /* d) admin auth with correct password */
  const authRes = await emitAck<any>(admin, 'admin:auth', { password: 'admin123' })
  assert('d1 admin:auth ok', authRes?.ok === true, JSON.stringify(authRes))
  const budi = (authRes?.sessions ?? []).find((s: any) => s.id === sessionId)
  assert('d2 sessions include Budi Santoso', !!budi && budi.name === 'Budi Santoso')
  assert('d3 Budi unread === 1', budi?.unread === 1, `unread=${budi?.unread}`)
  assert(
    'd4 Budi lastMessage is the user message',
    budi?.lastMessage?.content === 'Halo, saya butuh bantuan' && budi?.lastMessage?.sender === 'user',
    JSON.stringify(budi?.lastMessage)
  )

  /* e) admin history + admin reply -> user receives chat:message */
  const historyRes = await emitAck<any>(admin, 'admin:history', { sessionId })
  assert(
    'e1 admin:history returns exactly 1 message',
    historyRes?.ok === true && Array.isArray(historyRes?.messages) && historyRes.messages.length === 1,
    JSON.stringify(historyRes)
  )

  const chatMessagePromise = waitFor<any>(user, 'chat:message')
  const adminMsgRes = await emitAck<any>(admin, 'admin:message', {
    sessionId,
    content: 'Halo Budi, ada yang bisa dibantu?',
  })
  assert(
    'e2 admin:message ok, sender admin',
    adminMsgRes?.ok === true && adminMsgRes?.message?.sender === 'admin',
    JSON.stringify(adminMsgRes)
  )
  const received = await chatMessagePromise
  assert(
    'e3 user socket received chat:message from admin',
    received?.sender === 'admin' &&
      received?.content === 'Halo Budi, ada yang bisa dibantu?' &&
      received?.sessionId === sessionId,
    JSON.stringify(received)
  )

  /* f) admin:read -> unread becomes 0 */
  admin.emit('admin:read', { sessionId })
  await sleep(300) // no ack per contract; give the server a moment
  const sessionsRes = await emitAck<any>(admin, 'admin:sessions')
  assert('f1 admin:sessions ok', sessionsRes?.ok === true, JSON.stringify(sessionsRes))
  const budi2 = (sessionsRes?.sessions ?? []).find((s: any) => s.id === sessionId)
  assert('f2 Budi unread === 0 after read', budi2?.unread === 0, `unread=${budi2?.unread}`)

  /* g) user typing indicator reaches admin */
  const typingPromise = waitFor<any>(admin, 'user:typing')
  user.emit('user:typing', { sessionId, isTyping: true })
  const typing = await typingPromise
  assert(
    'g1 admin received user:typing {sessionId, isTyping:true}',
    typing?.sessionId === sessionId && typing?.isTyping === true,
    JSON.stringify(typing)
  )

  /* bonus: sessions sorted by last_message_at DESC (our session should be first) */
  const budi3 = (sessionsRes?.sessions ?? [])[0]
  assert('h1 sessions sorted, ours is most recent', budi3?.id === sessionId, `first=${budi3?.id}`)

  user.close()
  admin.close()
  console.log(
    failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} TEST(S) FAILED`
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
