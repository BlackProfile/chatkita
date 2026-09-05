/** E2E v43 via socket: TOTP flow + moderator + new_login + auto_backup_now. */
import { Database } from 'bun:sqlite'
import { createHmac } from 'node:crypto'

const dbRead = () => new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const { io } = await import('socket.io-client')
const out = (s: string) => process.stdout.write(s + '\n')

/** TOTP RFC 6238 (sama seperti server). */
const b32decode = (s: string): Buffer => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.toUpperCase().replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
const totpNow = (secret: string, offset = 0): string => {
  const key = b32decode(secret)
  const counter = Math.floor(Date.now() / 30000) + offset
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', key).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(code % 1_000_000).padStart(6, '0')
}

const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', async () => {
  // ===== 1. TOTP: setup → enable → login gate → disable =====
  socket.emit('admin:auth', { password: 'admin123' }, (a: any) => {
    if (!a.ok) { out('AUTH GAGAL: ' + a.error); process.exit(1) }
    out('1a. auth tanpa totp: ok (2FA mati default) ✓ actorRole=' + (a.actorRole ?? 'admin'))
    socket.emit('admin:totp_state', {}, (s: any) => {
      out('1b. totp_state enabled=' + s.enabled)
      socket.emit('admin:totp_setup', {}, (u: any) => {
        if (!u.ok) { out('1c. SETUP GAGAL: ' + u.error); process.exit(1) }
        const code = totpNow(u.secret)
        out('1c. totp_setup ok (secret 16 char, otpauth ada=' + !!u.otpauth + ') kode=' + code)
        socket.emit('admin:totp_enable', { code }, (e: any) => {
          out('1d. totp_enable ok=' + e.ok)
          if (!e.ok) process.exit(1)
          socket.emit('admin:auth', { password: 'admin123' }, (g1: any) => {
            out('1e. login tanpa kode → ' + g1.ok + ' error=' + g1.error + (g1.error === 'TOTP_REQUIRED' ? ' ✓' : ' ✗'))
            socket.emit('admin:auth', { password: 'admin123', totp: '000000' }, (g2: any) => {
              out('1f. login kode salah → error=' + g2.error + (g2.error === 'TOTP_INVALID' ? ' ✓' : ' ✗'))
              const good = totpNow(u.secret)
              socket.emit('admin:auth', { password: 'admin123', totp: good }, (g3: any) => {
                out('1g. login kode benar → ok=' + g3.ok + (g3.ok ? ' ✓' : ' ✗'))
                // kode offset -1 (jendela toleransi)
                const prev = totpNow(u.secret, -1)
                socket.emit('admin:totp_disable', { code: prev }, (d: any) => {
                  out('1h. totp_disable (kode jendela -1) ok=' + d.ok + (d.ok ? ' ✓' : ' ✗'))
                  // ===== 2. Moderator =====
                  const w = new Database('/home/z/my-project/mini-services/chat-service/chat.db')
                  let mod = dbRead().query("SELECT id, name FROM users WHERE role='moderator'").get() as any
                  if (!mod) {
                    const id = crypto.randomUUID()
                    const hash = Bun.password.hashSync('mod123', { algorithm: 'bcrypt', cost: 10 })
                    w.run("INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, 'ModeratorUji', 'moderator', ?, ?, ?, ?, 'self')", [id, Date.now(), Date.now(), hash, Date.now()])
                    mod = { id, name: 'ModeratorUji' }
                    out('2a. akun moderator uji dibuat (ModeratorUji/mod123)')
                  }
                  const s2 = io('http://127.0.0.1:3003', { transports: ['websocket'] })
                  s2.on('connect', () => {
                    s2.emit('admin:auth', { password: 'mod123' }, (m: any) => {
                      out('2b. login moderator via form admin → ok=' + m.ok + ' actorRole=' + m.actorRole + (m.ok && m.actorRole === 'moderator' ? ' ✓' : ' ✗'))
                      s2.emit('admin:reset_conversation', { conversationId: 'x' }, (r: any) => {
                        out('2c. moderator coba reset → ok=' + r.ok + ' error=' + r.error + (r.error === 'FORBIDDEN' ? ' ✓' : ' ✗'))
                        s2.emit('admin:leaderboard', {}, (l: any) => {
                          out('2d. moderator baca leaderboard → ok=' + l.ok + (l.ok ? ' ✓' : ' ✗'))
                          s2.disconnect()
                          // ===== 3. auto_backup_now =====
                          socket.emit('admin:auto_backup_now', {}, (b: any) => {
                            out('3a. backup sekarang ok=' + b.ok + (b.ok ? ' ✓' : ' ✗'))
                            socket.disconnect()
                            process.exit(0)
                          })
                        })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })
    })
  })
})
setTimeout(() => { out('TIMEOUT GLOBAL'); process.exit(1) }, 60000)
