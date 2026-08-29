/**
 * Protocol smoke test for the messenger-service (Telegram-style 1-on-1).
 * Run: bun test-messenger.ts   (connects directly to 127.0.0.1:3003)
 * Uses unique usernames per run so it is re-runnable against a warm DB.
 */
import { io, type Socket } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
let pass = 0
let fail = 0

const ok = (cond: boolean, label: string) => {
  if (cond) {
    pass++
    console.log(`  PASS ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}`)
  }
}

const connect = (): Socket => io(URL, { transports: ['websocket'] })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const emitAck = <T>(socket: Socket, ev: string, payload: unknown) =>
  new Promise<T>((resolve) => socket.emit(ev, payload, (res: T) => resolve(res)))

const waitEvent = <T>(socket: Socket, ev: string, timeoutMs = 4000) =>
  new Promise<T | null>((resolve) => {
    const t = setTimeout(() => {
      socket.off(ev, h)
      resolve(null)
    }, timeoutMs)
    const h = (data: T) => {
      clearTimeout(t)
      socket.off(ev, h)
      resolve(data)
    }
    socket.once(ev, h)
  })

async function main() {
  const sfx = Date.now().toString(36)
  const SITI = `Siti-${sfx}`
  const BUDI = `Budi-${sfx}`
  const CANDRA = `Candra-${sfx}`
  const OUTSIDER = `Obs-${sfx}`

  const siti = connect()
  const budi = connect()

  /* a. auth */
  console.log('a. user:auth')
  const badName = await emitAck<{ ok: boolean; error?: string }>(siti, 'user:auth', {
    name: '   ',
  })
  ok(badName.ok === false && badName.error === 'INVALID_NAME', 'a1 empty name rejected')

  const sitiAuth = await emitAck<{
    ok: boolean
    user?: { id: string; name: string }
    conversations?: unknown[]
  }>(siti, 'user:auth', { name: SITI })
  ok(sitiAuth.ok === true && !!sitiAuth.user?.id, 'a2 Siti registered')
  ok((sitiAuth.conversations ?? []).length === 0, 'a3 Siti starts with 0 conversations')

  const sitiReauth = await emitAck<{ ok: boolean; user?: { id: string } }>(siti, 'user:auth', {
    name: SITI,
    userId: sitiAuth.user!.id,
  })
  ok(
    sitiReauth.ok === true && sitiReauth.user?.id === sitiAuth.user!.id,
    'a4 re-auth with userId keeps identity'
  )

  /* b. search */
  console.log('b. users:search')
  const budiAuth = await emitAck<{ ok: boolean; user?: { id: string } }>(budi, 'user:auth', {
    name: BUDI,
  })
  ok(budiAuth.ok === true, 'b1 Budi registered')

  const found = await emitAck<{ ok: boolean; users?: Array<{ id: string; online: boolean }> }>(
    budi,
    'users:search',
    { query: SITI }
  )
  ok(
    found.ok === true && found.users?.length === 1 && found.users[0].id === sitiAuth.user!.id,
    'b2 Budi finds Siti by name'
  )
  ok(found.users?.[0]?.online === true, 'b3 Siti shown as online')

  const selfSearch = await emitAck<{ ok: boolean; users?: unknown[] }>(budi, 'users:search', {
    query: BUDI,
  })
  ok((selfSearch.users ?? []).length === 0, 'b4 search excludes self')

  const emptySearch = await emitAck<{ ok: boolean; users?: unknown[] }>(budi, 'users:search', {
    query: '',
  })
  ok((emptySearch.users ?? []).length >= 1, 'b5 empty query lists recent users')

  /* c. conversation start */
  console.log('c. conversations:start')
  // register listener BEFORE the ack to avoid missing the push
  const convoUpdateBudiPromise = waitEvent<Array<{ id: string }>>(budi, 'conversations:update')
  const startSiti = await emitAck<{
    ok: boolean
    conversation?: { id: string; partner: { id: string; online: boolean } }
  }>(siti, 'conversations:start', { userId: budiAuth.user!.id })
  ok(
    startSiti.ok === true && startSiti.conversation!.partner.id === budiAuth.user!.id,
    'c1 Siti starts chat with Budi'
  )
  const convoUpdateBudi = await convoUpdateBudiPromise
  ok(convoUpdateBudi?.[0]?.id === startSiti.conversation!.id, 'c2 Budi sees conversation appear')

  const startAgain = await emitAck<{ ok: boolean; conversation?: { id: string } }>(
    siti,
    'conversations:start',
    { userId: budiAuth.user!.id }
  )
  ok(startAgain.conversation?.id === startSiti.conversation!.id, 'c3 start is idempotent')

  const startSelf = await emitAck<{ ok: boolean; error?: string }>(siti, 'conversations:start', {
    userId: sitiAuth.user!.id,
  })
  ok(startSelf.ok === false && startSelf.error === 'FORBIDDEN', 'c4 cannot chat with self')

  /* d. messaging */
  console.log('d. messages:send / message:new')
  const convId = startSiti.conversation!.id

  const msg1Promise = waitEvent<{ id: number; senderId: string; content: string }>(
    budi,
    'message:new'
  )
  const send1 = await emitAck<{ ok: boolean; message?: { id: number } }>(siti, 'messages:send', {
    conversationId: convId,
    content: 'Halo Budi!',
  })
  ok(send1.ok === true && !!send1.message?.id, 'd1 Siti sends message')
  const msg1 = await msg1Promise
  ok(msg1?.content === 'Halo Budi!' && msg1.senderId === sitiAuth.user!.id, 'd2 Budi receives live')

  const histSiti = await emitAck<{
    ok: boolean
    messages?: Array<{ id: number; content: string }>
    partner?: { id: string; online: boolean }
  }>(siti, 'messages:history', { conversationId: convId })
  ok(
    histSiti.ok === true &&
      histSiti.messages?.length === 1 &&
      histSiti.messages[0].content === 'Halo Budi!',
    'd3 history works for Siti'
  )
  ok(histSiti.partner?.id === budiAuth.user!.id, 'd4 history includes partner info')

  const emptyMsg = await emitAck<{ ok: boolean; error?: string }>(siti, 'messages:send', {
    conversationId: convId,
    content: '   ',
  })
  ok(emptyMsg.ok === false && emptyMsg.error === 'INVALID_MESSAGE', 'd5 empty message rejected')

  /* e. unread + read state (check unread BEFORE Budi opens history) */
  console.log('e. unread / read')
  const unreadForBudi = await emitAck<{
    ok: boolean
    conversations?: Array<{ id: string; unread: number }>
  }>(budi, 'user:auth', { name: BUDI, userId: budiAuth.user!.id })
  ok(
    unreadForBudi.conversations?.find((c) => c.id === convId)?.unread === 1,
    'e1 Budi has 1 unread'
  )

  const histBudi = await emitAck<{ ok: boolean; messages?: Array<{ id: number }> }>(
    budi,
    'messages:history',
    { conversationId: convId }
  )
  ok(histBudi.messages?.length === 1, 'e2 history works for Budi')

  budi.emit('messages:read', { conversationId: convId }) // no ack by design
  await wait(200)
  const readForBudi = await emitAck<{
    ok: boolean
    conversations?: Array<{ id: string; unread: number }>
  }>(budi, 'user:auth', { name: BUDI, userId: budiAuth.user!.id })
  ok(readForBudi.conversations?.find((c) => c.id === convId)?.unread === 0, 'e3 read resets unread')

  /* f. typing */
  console.log('f. typing relay')
  const typingPromise = waitEvent<{ conversationId: string; isTyping: boolean }>(
    budi,
    'partner:typing'
  )
  siti.emit('typing', { conversationId: convId, isTyping: true })
  const typing = await typingPromise
  ok(typing?.conversationId === convId && typing.isTyping === true, 'f1 typing relayed to partner')

  /* g. presence */
  console.log('g. presence')
  const candra = connect()
  const presencePromise = waitEvent<{ userId: string; online: boolean }>(siti, 'presence:update')
  await emitAck<{ ok: boolean; user?: { id: string } }>(candra, 'user:auth', { name: CANDRA })
  const presence = await presencePromise
  ok(presence?.online === true, 'g1 online broadcast on auth')
  const offlinePromise = waitEvent<{ userId: string; online: boolean }>(siti, 'presence:update')
  candra.disconnect()
  const offline = await offlinePromise
  ok(offline?.online === false, 'g2 offline broadcast on disconnect')

  /* h. security: outsider cannot access conversation */
  console.log('h. isolation')
  const outsider = connect()
  const outsiderAuth = await emitAck<{ ok: boolean; user?: { id: string } }>(
    outsider,
    'user:auth',
    { name: OUTSIDER }
  )
  const forbidden = await emitAck<{ ok: boolean; error?: string }>(
    outsider,
    'messages:history',
    { conversationId: convId }
  )
  ok(forbidden.ok === false && forbidden.error === 'FORBIDDEN', 'h1 outsider denied history')
  const forbiddenSend = await emitAck<{ ok: boolean; error?: string }>(
    outsider,
    'messages:send',
    { conversationId: convId, content: 'inject' }
  )
  ok(forbiddenSend.ok === false, 'h2 outsider denied send')

  siti.disconnect()
  budi.disconnect()
  outsider.disconnect()
  await wait(300)

  console.log(`\nResult: ${pass} PASS, ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
