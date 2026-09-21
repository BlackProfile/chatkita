/** E2E v44 (Task 60-d) — signaling call WebRTC via socket.io chat-service.
 * Alur: ring → incoming → answer accept → answered → offer → answer_sdp →
 * ice dua arah → end → ended; + BUSY (call kedua saat aktif, dua arah) +
 * reject path. Server harus "chat-service v44 listening". */
const { io } = await import('socket.io-client')

const URL = 'http://127.0.0.1:3003'
const out = (s: string) => process.stdout.write(s + '\n')
let failures = 0
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failures += 1
  out(`${label}: ${ok ? '✓' : '✗'}${extra ? ' — ' + extra : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function once<T = any>(sock: any, ev: string, timeoutMs = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout menunggu ' + ev)), timeoutMs)
    sock.once(ev, (p: T) => {
      clearTimeout(t)
      resolve(p)
    })
  })
}
function emitAck(sock: any, ev: string, payload: any, timeoutMs = 6000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ack ' + ev)), timeoutMs)
    sock.emit(ev, payload, (res: any) => {
      clearTimeout(t)
      resolve(res)
    })
  })
}

const admin: any = io(URL, { transports: ['websocket'] })
const user: any = io(URL, { transports: ['websocket'] })

const run = async () => {
  // ===== AUTH =====
  await once(admin, 'connect')
  await once(user, 'connect')
  const aAuth = await emitAck(admin, 'admin:auth', { password: 'admin123' })
  check('1a. admin:auth ok', aAuth.ok === true)
  const uAuth = await emitAck(user, 'user:auth', {
    name: 'UjiBrowser59',
    password: 'uji60',
    deviceId: 't60-device-uji',
  })
  check('1b. user:auth UjiBrowser59 ok', uAuth.ok === true)

  // ===== 2. ring → incoming =====
  const incomingP = once<any>(admin, 'call:incoming')
  const ring = await emitAck(user, 'call:ring', { toUserId: 'admin', media: 'audio' })
  check('2a. user call:ring ok', ring.ok === true && typeof ring.callId === 'string')
  const inc = await incomingP
  check(
    '2b. admin terima call:incoming',
    inc.callId === ring.callId && inc.from?.name === 'UjiBrowser59' && inc.media === 'audio',
    `from=${inc.from?.name} media=${inc.media}`
  )
  const callId = ring.callId

  // ===== 3. answer accept → answered ke penelepon =====
  const answeredP = once<any>(user, 'call:answered')
  const ans = await emitAck(admin, 'call:answer', { callId, accept: true })
  check('3a. admin call:answer accept ok', ans.ok === true)
  const answered = await answeredP
  check('3b. user terima call:answered', answered.callId === callId)

  // ===== 4. offer → relay ke admin =====
  const offerP = once<any>(admin, 'call:offer')
  const offerSdp = 'v=0\r\no=- dummy-offer 0 IN IP4 127.0.0.1\r\ns=-\r\n'
  const offer = await emitAck(user, 'call:offer', { callId, sdp: offerSdp })
  check('4a. user call:offer ok', offer.ok === true)
  const offerGot = await offerP
  check('4b. admin terima call:offer (sdp sama)', offerGot.sdp === offerSdp)

  // ===== 5. answer_sdp → relay ke user =====
  const answerP = once<any>(user, 'call:answer_sdp')
  const answerSdp = 'v=0\r\no=- dummy-answer 0 IN IP4 127.0.0.1\r\ns=-\r\n'
  const ansSdp = await emitAck(admin, 'call:answer_sdp', { callId, sdp: answerSdp })
  check('5a. admin call:answer_sdp ok', ansSdp.ok === true)
  const answerGot = await answerP
  check('5b. user terima call:answer_sdp (sdp sama)', answerGot.sdp === answerSdp)

  // ===== 6. ICE dua arah =====
  const iceAdminP = once<any>(admin, 'call:ice')
  const iceUserP = once<any>(user, 'call:ice')
  const iceU = await emitAck(user, 'call:ice', {
    callId,
    candidate: JSON.stringify({ candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host' }),
  })
  const iceA = await emitAck(admin, 'call:ice', {
    callId,
    candidate: JSON.stringify({ candidate: 'candidate:2 1 UDP 1 127.0.0.1 5001 typ host' }),
  })
  const gotA = await iceAdminP
  const gotU = await iceUserP
  check(
    '6a. ice user→admin relay',
    iceU.ok && gotA.candidate.includes('candidate:1'),
    iceU.ok ? '' : 'ack gagal'
  )
  check(
    '6b. ice admin→user relay',
    iceA.ok && gotU.candidate.includes('candidate:2'),
    iceA.ok ? '' : 'ack gagal'
  )

  // ===== 7. BUSY: call kedua saat aktif (dua arah) =====
  const busyU = await emitAck(user, 'call:ring', { toUserId: 'admin', media: 'video' })
  check('7a. ring kedua user saat aktif → BUSY', busyU.ok === false && busyU.error === 'BUSY')
  const busyA = await emitAck(admin, 'call:ring', {
    toUserId: uAuth.user?.id ?? '',
    media: 'audio',
  })
  check('7b. ring balik admin saat aktif → BUSY', busyA.ok === false && busyA.error === 'BUSY')

  // ===== 8. end → ended ke lawan =====
  const endedP = once<any>(admin, 'call:ended')
  const end = await emitAck(user, 'call:end', { callId })
  check('8a. user call:end ok', end.ok === true)
  const ended = await endedP
  check(
    '8b. admin terima call:ended (by=user)',
    ended.callId === callId && typeof ended.by === 'string' && ended.by !== 'admin'
  )

  // ===== 9. setelah end: ring baru boleh + path reject =====
  const rejectedP = once<any>(user, 'call:rejected')
  const ring2 = await emitAck(user, 'call:ring', { toUserId: 'admin', media: 'video' })
  check('9a. ring baru setelah end ok (state bersih)', ring2.ok === true)
  const rej = await emitAck(admin, 'call:answer', { callId: ring2.callId, accept: false })
  const rejected = await rejectedP
  check('9b. tolak → user terima call:rejected', rej.ok === true && rejected.callId === ring2.callId)

  out(failures === 0 ? '\nSEMUA LANGKAH SIGNALING LULUS ✅' : `\nGAGAL: ${failures} langkah ✗`)
  admin.disconnect()
  user.disconnect()
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 200)
}

run().catch((err) => {
  out(`E2E GAGAL: ${err?.message ?? err}`)
  admin.disconnect()
  user.disconnect()
  process.exit(1)
})
