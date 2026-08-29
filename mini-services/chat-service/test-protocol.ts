/**
 * Protocol test-suite for the ChatKita chat-service
 * (v3 model: every human user chats 1-on-1 with the Admin).
 *
 * TEST-ONLY: connects DIRECTLY to 127.0.0.1:3003 (bypassing the gateway).
 * The service must be running with a FRESH chat.db ( wiped before start).
 *
 * Run: bun test-protocol.ts   → prints PASS/FAIL summary, exit 0 iff all pass.
 */
import { io, type Socket } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

/* ------------------------------------------------------------------ */
/* Minimal mirrors of the shared contract types                        */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  id: number
  conversationId: string
  senderId: string
  content: string
  createdAt: string
}

interface PartnerInfo {
  id: string
  name: string
  online: boolean
  lastSeenAt: string | null
}

interface ConvOverview {
  id: string
  partner: PartnerInfo
  lastMessage: { id: number; senderId: string; content: string; createdAt: string } | null
  lastMessageAt: string
  unread: number
}

interface PresencePayload {
  userId: string
  online: boolean
  lastSeenAt: string | null
}

interface TypingPayload {
  conversationId: string
  isTyping: boolean
}

interface Ack {
  ok: boolean
  error?: string
  user?: { id: string; name: string }
  conversationId?: string
  partner?: PartnerInfo
  messages?: ChatMessage[]
  conversations?: ConvOverview[]
  message?: ChatMessage
}

/* ------------------------------------------------------------------ */
/* Tiny test helpers                                                   */
/* ------------------------------------------------------------------ */

let passCount = 0
let failCount = 0
const failures: string[] = []

const check = (label: string, condition: boolean, extra?: unknown) => {
  if (condition) {
    passCount++
    console.log(`  PASS  ${label}`)
  } else {
    failCount++
    failures.push(label)
    console.log(`  FAIL  ${label}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`)
  }
}

const connect = (): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = io(URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (err) => reject(new Error(`connect_error: ${err.message}`)))
  })

const emitAck = <T extends Ack = Ack>(socket: Socket, event: string, payload?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000)
    const cb = (res: T) => {
      clearTimeout(timer)
      resolve(res)
    }
    if (payload === undefined) socket.emit(event, cb)
    else socket.emit(event, payload, cb)
  })

/** One-shot listener: resolves with the first matching event payload. */
const waitFor = <T>(
  socket: Socket,
  event: string,
  predicate: (data: T) => boolean = () => true,
  timeoutMs = 5000
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener)
      reject(new Error(`wait timeout: ${event}`))
    }, timeoutMs)
    const listener = (data: T) => {
      if (!predicate(data)) return
      clearTimeout(timer)
      socket.off(event, listener)
      resolve(data)
    }
    socket.on(event, listener)
  })

/** Resolves true when NOTHING arrives on the given events within `ms`. */
const expectSilence = (socket: Socket, events: string[], ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    let noisy = false
    const cleanup: Array<[string, () => void]> = []
    for (const ev of events) {
      const l = () => {
        noisy = true
      }
      socket.on(ev, l)
      cleanup.push([ev, l])
    }
    setTimeout(() => {
      for (const [ev, l] of cleanup) socket.off(ev, l)
      resolve(!noisy)
    }, ms)
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const findConv = (list: unknown, partnerId: string): ConvOverview | undefined =>
  Array.isArray(list)
    ? (list as ConvOverview[]).find((c) => c.partner && c.partner.id === partnerId)
    : undefined

const isIsoOrNull = (v: unknown) => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)))

const allSockets: Socket[] = []
const disconnectAll = () => {
  for (const s of allSockets) {
    try {
      s.disconnect()
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

const main = async () => {
  console.log(`\n=== ChatKita chat-service protocol test (${URL}) ===\n`)

  /* ---------------- A. user:auth ---------------- */

  console.log('A. user:auth (fresh / invalid / reserved / returning / case-insensitive)')

  const u1 = await connect()
  allSockets.push(u1)
  const a1 = await emitAck(u1, 'user:auth', { name: 'Alice Test' })
  check('a1 fresh auth ok', a1.ok === true, a1)
  const ALICE = a1.user?.id ?? ''
  const ALICE_CONV = a1.conversationId ?? ''
  check('a1 user.id is a non-admin id', typeof ALICE === 'string' && ALICE.length > 0 && ALICE !== 'admin', ALICE)
  check('a1 user.name echoed', a1.user?.name === 'Alice Test', a1.user)
  check('a1 conversationId returned', typeof ALICE_CONV === 'string' && ALICE_CONV.length > 0, ALICE_CONV)
  check('a1 partner is the admin', a1.partner?.id === 'admin' && a1.partner?.name === 'Admin', a1.partner)
  check('a1 partner.online=false (no admin connected yet)', a1.partner?.online === false, a1.partner)
  check('a1 partner.lastSeenAt present', isIsoOrNull(a1.partner?.lastSeenAt), a1.partner?.lastSeenAt)
  check('a1 initial history empty', Array.isArray(a1.messages) && a1.messages.length === 0, a1.messages)

  const t1 = await connect()
  allSockets.push(t1)
  const a2 = await emitAck(t1, 'user:auth', { name: '   ' })
  check('a2 empty name → INVALID_NAME', a2.ok === false && a2.error === 'INVALID_NAME', a2)

  const t2 = await connect()
  allSockets.push(t2)
  const a3 = await emitAck(t2, 'user:auth', { name: 'AdMiN' })
  check('a3 reserved name → NAME_RESERVED', a3.ok === false && a3.error === 'NAME_RESERVED', a3)
  t1.disconnect()
  t2.disconnect()

  const t3 = await connect()
  allSockets.push(t3)
  const a4 = await emitAck(t3, 'user:auth', { name: 'Alice Test', userId: ALICE })
  check('a4 returning via userId → same account', a4.ok === true && a4.user?.id === ALICE, a4.user)
  check('a4 same conversation', a4.conversationId === ALICE_CONV, { got: a4.conversationId, want: ALICE_CONV })
  t3.disconnect()

  const t4 = await connect()
  allSockets.push(t4)
  const a5 = await emitAck(t4, 'user:auth', { name: 'alice test' })
  check('a5 case-insensitive name → same account', a5.ok === true && a5.user?.id === ALICE, a5.user)
  check('a5 stored name keeps original casing', a5.user?.name === 'Alice Test', a5.user)
  t4.disconnect()

  /* ---------------- B. zero-message user ---------------- */

  console.log('B. zero-message user registration')
  const uSilent = await connect()
  allSockets.push(uSilent)
  const b1 = await emitAck(uSilent, 'user:auth', { name: 'Silent Sam' })
  check('b1 silent user auth ok', b1.ok === true && !!b1.conversationId, b1)
  const SILENT = b1.user?.id ?? ''

  /* ---------------- C. user message fan-out (no admin online yet) ---------------- */

  console.log('C. messages:send — echo to own room (admins room empty but must not fail)')
  const echoPromise = waitFor<ChatMessage>(u1, 'message:new', (m) => m.content === 'Hello admin')
  const c1 = await emitAck(u1, 'messages:send', { conversationId: ALICE_CONV, content: 'Hello admin' })
  check('c1 send ack ok', c1.ok === true && !!c1.message, c1)
  check('c1 message.senderId = user', c1.message?.senderId === ALICE, c1.message)
  check('c1 message.conversationId matches', c1.message?.conversationId === ALICE_CONV, c1.message)
  const echo = await echoPromise
  check('c3 own-room echo received with same id', echo.id === c1.message?.id, echo)

  /* ---------------- D. admin:auth ---------------- */

  console.log('D. admin:auth (wrong password / correct → full conversation list)')

  const aBad = await connect()
  allSockets.push(aBad)
  const d1 = await emitAck(aBad, 'admin:auth', { password: 'definitely-wrong' })
  check('d1 wrong password → UNAUTHORIZED', d1.ok === false && d1.error === 'UNAUTHORIZED', d1)
  aBad.disconnect()

  const a0 = await connect()
  allSockets.push(a0)
  const d2 = await emitAck(a0, 'admin:auth', { password: ADMIN_PASSWORD })
  check('d2 admin auth ok', d2.ok === true, d2)
  const list = d2.conversations ?? []
  check('d2 list includes BOTH users (2 conversations)', list.length === 2, list)
  const aliceConv = findConv(list, ALICE)
  const silentConv = findConv(list, SILENT)
  check('d2 alice conv present', !!aliceConv, list)
  check('d2 alice unread = 1', aliceConv?.unread === 1, aliceConv)
  check('d2 alice lastMessage.content', aliceConv?.lastMessage?.content === 'Hello admin', aliceConv?.lastMessage)
  check('d2 alice partner.online = true (u1 connected)', aliceConv?.partner?.online === true, aliceConv?.partner)
  check('d2 alice partner.lastSeenAt present', isIsoOrNull(aliceConv?.partner?.lastSeenAt), aliceConv?.partner)
  check('d2 silent conv present (zero messages)', !!silentConv, list)
  check('d2 silent conv lastMessage = null', silentConv?.lastMessage === null || silentConv?.lastMessage === undefined, silentConv)
  check('d2 silent conv unread = 0', silentConv?.unread === 0, silentConv)

  /* ---------------- E. history / mark-read / admin reply / user send w/ admin online ---------------- */

  console.log('E. messages:history (participant), mark-read, reply fan-out')

  const e1 = await emitAck(a0, 'messages:history', { conversationId: ALICE_CONV })
  check('e1 admin history ok, 1 message', e1.ok === true && e1.messages?.length === 1, e1.messages)
  check('e1 history content', e1.messages?.[0]?.content === 'Hello admin', e1.messages)
  check('e1 history partner = alice', e1.partner?.id === ALICE, e1.partner)
  check('e1 history partner.online = true', e1.partner?.online === true, e1.partner)
  check('e1 history partner.lastSeenAt present', isIsoOrNull(e1.partner?.lastSeenAt), e1.partner?.lastSeenAt)

  const e2 = await waitFor<ConvOverview[]>(a0, 'conversations:update', (l) => findConv(l, ALICE)?.unread === 0)
  check('e2 refreshed admin list shows unread 0 after history', findConv(e2, ALICE)?.unread === 0, findConv(e2, ALICE))

  const u1UpdateAfterReply = waitFor<ConvOverview[]>(u1, 'conversations:update', (l) => findConv(l, 'admin')?.unread === 1)
  const u1ReplyPromise = waitFor<ChatMessage>(u1, 'message:new', (m) => m.content === 'Hi Alice!')
  const e3 = await emitAck(a0, 'messages:send', { conversationId: ALICE_CONV, content: 'Hi Alice!' })
  check('e3 admin reply ack ok, senderId admin', e3.ok === true && e3.message?.senderId === 'admin', e3.message)
  const reply = await u1ReplyPromise
  check('e4 user room received admin reply via message:new', reply.senderId === 'admin' && reply.conversationId === ALICE_CONV, reply)
  const u1Upd = await u1UpdateAfterReply
  check('e5 user list shows admin conv unread 1', findConv(u1Upd, 'admin')?.unread === 1, findConv(u1Upd, 'admin'))

  // user sends while admin is online → must arrive in the admins room
  const adminMsgPromise = waitFor<ChatMessage>(a0, 'message:new', (m) => m.content === 'Thanks admin!')
  const e6 = await emitAck(u1, 'messages:send', { conversationId: ALICE_CONV, content: 'Thanks admin!' })
  check('e6 user send ack ok (admin online)', e6.ok === true && e6.message?.senderId === ALICE, e6.message)
  const adminMsg = await adminMsgPromise
  check('e7 admins room received user message', adminMsg.senderId === ALICE && adminMsg.id === e6.message?.id, adminMsg)

  /* ---------------- F. typing relay both directions ---------------- */

  console.log('F. typing relay (user→admins room, admin→user room)')
  const adminTypingPromise = waitFor<TypingPayload>(a0, 'partner:typing', (p) => p.isTyping === true)
  u1.emit('typing', { conversationId: ALICE_CONV, isTyping: true })
  const tUser = await adminTypingPromise
  check('f1 user typing relayed to admins room', tUser.conversationId === ALICE_CONV && tUser.isTyping === true, tUser)

  const userTypingPromise = waitFor<TypingPayload>(u1, 'partner:typing', (p) => p.isTyping === true)
  a0.emit('typing', { conversationId: ALICE_CONV, isTyping: true })
  const tAdmin = await userTypingPromise
  check('f2 admin typing relayed to user room', tAdmin.conversationId === ALICE_CONV && tAdmin.isTyping === true, tAdmin)
  u1.emit('typing', { conversationId: ALICE_CONV, isTyping: false })
  a0.emit('typing', { conversationId: ALICE_CONV, isTyping: false })

  /* ---------------- G. late user: presence → admins room ONLY + sidebar push ---------------- */

  console.log('G. late user appears in admin sidebar; user presence stays private')
  const adminPresencePromise = waitFor<PresencePayload>(
    a0,
    'presence:update',
    (p) => p.userId !== 'admin' && p.online === true
  )
  const uLarry = await connect()
  allSockets.push(uLarry)
  const g1 = await emitAck(uLarry, 'user:auth', { name: 'Late Larry' })
  check('g1 late user auth ok', g1.ok === true && !!g1.conversationId, g1)
  const LARRY = g1.user?.id ?? ''
  const larryPresence = await adminPresencePromise
  check(
    'g2 admins room sees user online (lastSeenAt null)',
    larryPresence.userId === LARRY && larryPresence.online === true && larryPresence.lastSeenAt === null,
    larryPresence
  )
  const aliceSeesLarry = await expectSilence(u1, ['presence:update'], 400)
  check('g3 other user does NOT see larry online (privacy)', aliceSeesLarry)
  const larryPush = await waitFor<ConvOverview[]>(a0, 'conversations:update', (l) => !!findConv(l, LARRY))
  const larryConv = findConv(larryPush, LARRY)
  check('g4 larry appears in admin list with zero messages', larryConv?.lastMessage === null && larryConv?.unread === 0, larryConv)

  /* ---------------- H. disconnect presence + auth marks read ---------------- */

  console.log('H. user offline presence + re-auth returns history and marks read')
  const offlinePromise = waitFor<PresencePayload>(
    a0,
    'presence:update',
    (p) => p.userId === ALICE && p.online === false
  )
  u1.disconnect()
  const offline = await offlinePromise
  check('h1 admins room sees user offline with lastSeenAt', offline.userId === ALICE && typeof offline.lastSeenAt === 'string' && !Number.isNaN(Date.parse(offline.lastSeenAt)), offline)

  const h2a = await emitAck(a0, 'messages:send', { conversationId: ALICE_CONV, content: 'msg one' })
  const h2b = await emitAck(a0, 'messages:send', { conversationId: ALICE_CONV, content: 'msg two' })
  check('h2 admin can message offline user (acks ok)', h2a.ok === true && h2b.ok === true, { h2a, h2b })

  const adminRefresh = waitFor<ConvOverview[]>(a0, 'conversations:update', (l) => Array.isArray(l) && !!findConv(l, ALICE))
  const u2 = await connect()
  allSockets.push(u2)
  const h3 = await emitAck(u2, 'user:auth', { name: 'Alice Test', userId: ALICE })
  check('h3 re-auth ok (returning user)', h3.ok === true && h3.user?.id === ALICE, h3.user)
  check('h3 auth ack contains full history incl. offline messages', h3.messages?.some((m) => m.content === 'msg one') === true && h3.messages?.some((m) => m.content === 'msg two') === true, h3.messages?.map((m) => m.content))
  check('h3 last message is newest', h3.messages?.[h3.messages.length - 1]?.content === 'msg two', h3.messages?.slice(-1))
  check('h3 partner (admin) online in auth ack', h3.partner?.id === 'admin' && h3.partner?.online === true, h3.partner)
  const refreshed = await adminRefresh
  check('h4 admin list pushed after user re-auth (contains alice conv)', findConv(refreshed, ALICE) !== undefined, findConv(refreshed, ALICE))

  // Discriminator for "auth marks read": next admin message must leave unread = 1
  // (if auth had NOT marked read, the two offline messages would make it 3).
  const u2Update = waitFor<ConvOverview[]>(u2, 'conversations:update', (l) => !!findConv(l, 'admin'))
  const h5 = await emitAck(a0, 'messages:send', { conversationId: ALICE_CONV, content: 'msg three' })
  check('h5 admin message ack ok', h5.ok === true, h5)
  const u2List = await u2Update
  check('h6 auth marked read → user unread counts only the new message (1, not 3)', findConv(u2List, 'admin')?.unread === 1, findConv(u2List, 'admin'))

  /* ---------------- I. isolation between users ---------------- */

  console.log('I. isolation — user B cannot touch or observe user A')

  const uBob = await connect()
  allSockets.push(uBob)
  const i1 = await emitAck(uBob, 'user:auth', { name: 'Bob Test' })
  check('i1 bob auth ok', i1.ok === true, i1)
  const BOB_CONV = i1.conversationId ?? ''
  check('i2 bob has his OWN conversation with admin', !!BOB_CONV && BOB_CONV !== ALICE_CONV, { bob: BOB_CONV, alice: ALICE_CONV })
  check('i3 bob partner is admin', i1.partner?.id === 'admin', i1.partner)

  const i4 = await emitAck(uBob, 'messages:history', { conversationId: ALICE_CONV })
  check('i4 bob history on alice conv → FORBIDDEN', i4.ok === false && i4.error === 'FORBIDDEN', i4)
  const i5 = await emitAck(uBob, 'messages:send', { conversationId: ALICE_CONV, content: 'injected' })
  check('i5 bob send on alice conv → FORBIDDEN', i5.ok === false && i5.error === 'FORBIDDEN', i5)

  const bobSilence = expectSilence(uBob, ['message:new', 'conversations:update', 'partner:typing'], 700)
  const adminSeesSecret = waitFor<ChatMessage>(a0, 'message:new', (m) => m.content === 'secret from alice')
  const adminSeesTyping = waitFor<TypingPayload>(a0, 'partner:typing', (p) => p.isTyping === true)
  const i6 = await emitAck(u2, 'messages:send', { conversationId: ALICE_CONV, content: 'secret from alice' })
  check('i6 alice message delivered (ack ok)', i6.ok === true, i6)
  const secret = await adminSeesSecret
  check('i7 admin received alice message in admins room', secret.senderId === ALICE, secret)
  u2.emit('typing', { conversationId: ALICE_CONV, isTyping: true })
  const aliceTyping = await adminSeesTyping
  check('i8 admin received alice typing in admins room', aliceTyping.conversationId === ALICE_CONV && aliceTyping.isTyping === true, aliceTyping)
  check('i9 bob received NOTHING from alice activity (silence)', await bobSilence)
  u2.emit('typing', { conversationId: ALICE_CONV, isTyping: false })

  const i10 = await emitAck(uBob, 'messages:history', { conversationId: BOB_CONV })
  check('i10 server healthy: bob own history ok and empty (no leak)', i10.ok === true && i10.messages?.length === 0, i10.messages)

  /* ---------------- J. admin presence cycle seen from a user room ---------------- */

  console.log('J. admin offline/online presence is public (users see it)')
  const adminOffline = waitFor<PresencePayload>(u2, 'presence:update', (p) => p.userId === 'admin' && p.online === false)
  a0.disconnect()
  const aOff = await adminOffline
  check('j1 user room sees admin offline (lastSeenAt set)', typeof aOff.lastSeenAt === 'string' && !Number.isNaN(Date.parse(aOff.lastSeenAt)), aOff)

  const adminOnline = waitFor<PresencePayload>(u2, 'presence:update', (p) => p.userId === 'admin' && p.online === true)
  const a2 = await connect()
  allSockets.push(a2)
  const j2 = await emitAck(a2, 'admin:auth', { password: ADMIN_PASSWORD })
  check('j2 second admin auth ok', j2.ok === true, j2)
  const aOn = await adminOnline
  check('j3 user room sees admin online (lastSeenAt null)', aOn.online === true && aOn.lastSeenAt === null, aOn)

  /* ---------------- K. user offline → admins room only ---------------- */

  console.log('K. user offline event reaches admins room only')
  const admin2SeesOffline = waitFor<PresencePayload>(a2, 'presence:update', (p) => p.userId === ALICE && p.online === false)
  const bobSeesNothing = expectSilence(uBob, ['presence:update'], 500)
  u2.disconnect()
  const k1 = await admin2SeesOffline
  check('k1 admin room sees alice offline', k1.userId === ALICE && k1.online === false && typeof k1.lastSeenAt === 'string', k1)
  check('k2 other user does NOT see alice offline (privacy)', await bobSeesNothing)

  /* ---------------- done ---------------- */

  uBob.disconnect()
  uSilent.disconnect()
  uLarry.disconnect()
}

main()
  .then(() => {
    console.log('\n================ SUMMARY ================')
    console.log(`PASS: ${passCount}   FAIL: ${failCount}`)
    if (failCount > 0) {
      console.log('Failed assertions:')
      for (const f of failures) console.log(`  - ${f}`)
    }
    console.log('=========================================\n')
    disconnectAll()
    process.exit(failCount > 0 ? 1 : 0)
  })
  .catch((err) => {
    console.error('\nSUITE ERROR:', err)
    console.log(`\nPASS: ${passCount}   FAIL: ${failCount + 1}`)
    failures.push(`suite error: ${String(err)}`)
    disconnectAll()
    process.exit(1)
  })
