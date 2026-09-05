/** E2E v45 (Task 60-e) — cheat lanjutan per-user via socket.io chat-service.
 * Uji: cheat_peek state baru, shadowban (on → pesan tak sampai admin → off
 * → terungkap), spoof suara TTS, gambar AI user, flood + stop, time warp,
 * auto-reply user, throttle, clone percakapan. */
const { io } = await import('socket.io-client')

const URL = 'http://127.0.0.1:3003'
const out = (s: string) => process.stdout.write(s + '\n')
let failures = 0
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failures += 1
  out(`${label}: ${ok ? '✓' : '✗'}${extra ? ' — ' + extra : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function once<T = any>(sock: any, ev: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout menunggu ' + ev)), timeoutMs)
    sock.once(ev, (p: T) => {
      clearTimeout(t)
      resolve(p)
    })
  })
}
function emitAck(sock: any, ev: string, payload: any, timeoutMs = 8000): Promise<any> {
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
  const userId = uAuth.user?.id ?? uAuth.userId
  check('1c. userId diperoleh', typeof userId === 'string' && userId.length > 0)

  // ===== 2. cheat_peek — state baru v45 =====
  const peek = await emitAck(admin, 'admin:cheat_peek', { userId })
  check('2a. cheat_peek ok', peek.ok === true)
  check(
    '2b. cheatState v45 lengkap',
    typeof peek.cheatState?.shadowban === 'boolean' &&
      typeof peek.cheatState?.shadowCount === 'number' &&
      typeof peek.cheatState?.throttleSec === 'number' &&
      typeof peek.cheatState?.autoreply?.on === 'boolean',
    `shadowban=${peek.cheatState?.shadowban} shadowCount=${peek.cheatState?.shadowCount} throttle=${peek.cheatState?.throttleSec}`
  )
  const convId = peek.conversationId

  // Buat user target CLONE (admin:user_create), nanti dihapus di akhir.
  let cloneTargetId: string = ''
  const created = await emitAck(admin, 'admin:user_create', {
    name: 'KlonTarget60e',
    password: 'klon60e',
  })
  if (created.ok === true) {
    cloneTargetId = created.userId ?? ''
  } else if (created.error === 'NAME_TAKEN') {
    // Sudah ada dari uji sebelumnya — login untuk mendapatkan id-nya.
    const klon: any = io(URL, { transports: ['websocket'] })
    await new Promise((r) => klon.once('connect', r))
    const kAuth = await emitAck(klon, 'user:auth', {
      name: 'KlonTarget60e',
      password: 'klon60e',
      deviceId: 't60e-klon-uji',
    })
    cloneTargetId = kAuth.user?.id ?? ''
    klon.disconnect()
  }
  check('2c. user target clone siap', cloneTargetId.length > 0, created.error ?? created.userId)

  // ===== 3. SHADOWBAN =====
  const sbOn = await emitAck(admin, 'admin:cheat_shadowban', { userId, on: true })
  check('3a. shadowban AKTIF', sbOn.ok === true && sbOn.on === true)

  const adminGotShadow = new Promise<string>((resolve) => {
    admin.once('message:new', (m: any) => resolve(m?.id ? 'DITERIMA-ADMIN' : 'kosong'))
  })
  const uSend = await emitAck(user, 'messages:send', {
    conversationId: convId,
    content: 'Pesan bayangan uji v45 — harusnya tak sampai ke admin',
    type: 'text',
  })
  const shadowId = uSend?.message?.id
  check('3b. pesan user ok (ilusi sukses)', uSend.ok === true, `id=${shadowId}`)
  const race = await Promise.race([adminGotShadow, wait(1500).then(() => 'TAK-DITERIMA')])
  check('3c. admin TIDAK menerima pesan bayangan', race === 'TAK-DITERIMA', String(race))

  const peek2 = await emitAck(admin, 'admin:cheat_peek', { userId })
  check('3d. shadowCount=1 di peek', peek2.cheatState?.shadowCount === 1, `n=${peek2.cheatState?.shadowCount}`)

  const adminReveal = once<any>(admin, 'message:new', 5000)
  const sbOff = await emitAck(admin, 'admin:cheat_shadowban', { userId, on: false })
  const revealedMsg = await adminReveal
  check(
    '3e. shadowban mati → pesan terungkap ke admin',
    sbOff.ok === true && sbOff.revealed === 1 && revealedMsg?.id === shadowId,
    `revealed=${sbOff.revealed} id=${revealedMsg?.id}`
  )

  // ===== 4. SPOOF SUARA (TTS) =====
  const voice = await emitAck(admin, 'admin:cheat_voice', {
    userId,
    text: 'Halo, ini suara palsu uji cheat v45.',
  }, 60000)
  check(
    '4. spoof suara TTS sebagai user',
    voice.ok === true && voice.message?.type === 'voice' && voice.message?.senderId === userId,
    voice.ok ? `id=${voice.message?.id} durasi=${voice.message?.durationMs}ms` : voice.error
  )

  // ===== 5. GAMBAR AI ATAS NAMA USER =====
  const img = await emitAck(admin, 'admin:cheat_image_ai', {
    userId,
    prompt: 'kucing oranye lucu memakai topi ulang tahun kartun',
  }, 90000)
  check(
    '5. gambar AI sebagai user',
    img.ok === true && img.message?.type === 'image' && img.message?.senderId === userId,
    img.ok ? `id=${img.message?.id}` : img.error
  )

  // ===== 6. FLOOD INJECTOR + STOP =====
  const adminFloodIds: number[] = []
  const collectFlood = (m: any) => {
    if (m?.senderId === userId && String(m?.content ?? '').includes('BanjirUji60e'))
      adminFloodIds.push(m.id)
  }
  admin.on('message:new', collectFlood)
  const flood = await emitAck(admin, 'admin:cheat_flood', {
    userId,
    text: 'BanjirUji60e',
    count: 5,
    intervalMs: 300,
  })
  check('6a. flood dijadwalkan (5 @300ms)', flood.ok === true && flood.count === 5)
  await wait(700)
  const stop = await emitAck(admin, 'admin:cheat_flood_stop', { userId })
  check('6b. stop flood — sisa dibatalkan', stop.ok === true && stop.stopped >= 1, `stopped=${stop.stopped}`)
  await wait(1500)
  admin.off('message:new', collectFlood)
  check(
    '6c. hanya sebagian pesan flood terkirim',
    adminFloodIds.length >= 1 && adminFloodIds.length < 5,
    `terkirim=${adminFloodIds.length}`
  )

  // ===== 7. TIME WARP MASSAL =====
  const before = await emitAck(admin, 'admin:cheat_peek', { userId })
  const userMsgs = before.messages.filter((m: any) => m.senderId === userId && !m.deletedAt)
  const warpIds = userMsgs.slice(0, 3).map((m: any) => m.id)
  const updatedTimes = new Map<number, string>()
  const updHandler = (p: any) => updatedTimes.set(p.id, p.createdAt)
  admin.on('message:updated', updHandler)
  const warp = await emitAck(admin, 'admin:cheat_timewarp', { userId, deltaHours: -48 })
  await wait(600)
  admin.off('message:updated', updHandler)
  const gotUpdates = warpIds.every((id) => updatedTimes.has(id))
  check(
    '7. timewarp -48 jam → message:updated per pesan',
    warp.ok === true && warp.changed >= 3 && gotUpdates,
    `changed=${warp.changed} updated=${warpIds.filter((id) => updatedTimes.has(id)).length}/3`
  )
  // Balikkan lagi +48 jam supaya data uji mudah dibersihkan.
  await emitAck(admin, 'admin:cheat_timewarp', { userId, deltaHours: 48 })
  await wait(400)

  // ===== 8. AUTO-REPLY ATAS NAMA USER =====
  const arOn = await emitAck(admin, 'admin:cheat_autoreply', {
    userId,
    on: true,
    text: 'Balasan otomatis uji v45 ✅',
    delaySec: 1,
  })
  check('8a. auto-reply AKTIF (jeda 1 dtk)', arOn.ok === true)
  const userAutoReply = new Promise<any>((resolve) => {
    const h = (m: any) => {
      if (m?.senderId === userId) {
        admin.off('message:new', h)
        resolve(m)
      }
    }
    admin.on('message:new', h)
    setTimeout(() => resolve(null), 10000)
  })
  await emitAck(admin, 'messages:send', {
    conversationId: convId,
    content: 'Trigger auto-reply v45',
    type: 'text',
  })
  const arMsg = await userAutoReply
  check(
    '8b. user membalas otomatis setelah admin kirim',
    arMsg?.senderId === userId && String(arMsg?.content).includes('Balasan otomatis uji v45'),
    `id=${arMsg?.id}`
  )
  const arOff = await emitAck(admin, 'admin:cheat_autoreply', { userId, on: false })
  check('8c. auto-reply dimatikan', arOff.ok === true)

  // ===== 9. THROTTLE PESAN =====
  const th = await emitAck(admin, 'admin:cheat_throttle', { userId, seconds: 5 })
  check('9a. throttle 5 dtk disimpan', th.ok === true && th.seconds === 5)
  const adminGotNormal = new Promise<number>((resolve) => {
    admin.once('message:new', (m: any) => (m?.senderId === userId ? resolve(m.id) : resolve(0)))
  })
  const t0 = Date.now()
  const thSend = await emitAck(user, 'messages:send', {
    conversationId: convId,
    content: 'Pesan throttle uji v45 — tiba di admin 5 dtk',
    type: 'text',
  })
  const throttledId = thSend?.message?.id
  const gotAt = Date.now() - t0
  const normalId = await Promise.race([adminGotNormal, wait(9000).then(() => -1)])
  const elapsed = Date.now() - t0
  check(
    '9b. pesan user tiba di admin setelah ~5 dtk',
    normalId === throttledId && elapsed >= 4000,
    `tiba setelah ${Math.round(elapsed / 1000)} dtk (user ack ${Math.round(gotAt / 1000)} dtk)`
  )
  const thOff = await emitAck(admin, 'admin:cheat_throttle', { userId, seconds: 0 })
  check('9c. throttle dimatikan', thOff.ok === true)

  // ===== 10. CLONE PERCAKAPAN =====
  const clone = await emitAck(admin, 'admin:clone_conversation', {
    fromUserId: userId,
    toUserId: cloneTargetId,
  }, 15000)
  check(
    '10a. clone (salin) — 500 maks, terkopi = jumlah hidup',
    clone.ok === true && clone.copied > 0,
    `copied=${clone.copied}`
  )
  const clonePeek = await emitAck(admin, 'admin:cheat_peek', { userId: cloneTargetId })
  check(
    '10b. isi terkloning terlihat di percakapan target',
    clonePeek.ok === true && clonePeek.messages.length >= clone.copied,
    `pesan target=${clonePeek.messages.length}`
  )

  // ===== SELESAI =====
  out(`\nSELESAI — failures=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  out('FATAL: ' + (e as Error).message)
  process.exit(1)
})
