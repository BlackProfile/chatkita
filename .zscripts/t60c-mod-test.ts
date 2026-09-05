/** Uji alur moderator v43: reset password ModUji60c → login → reset FORBIDDEN → leaderboard ok → user_role. */
import { Database } from 'bun:sqlite'
const { io } = await import('socket.io-client')
const out = (s: string) => process.stdout.write(s + '\n')

const w = new Database('/home/z/my-project/mini-services/chat-service/chat.db')
const hash = Bun.password.hashSync('mod123', { algorithm: 'bcrypt', cost: 10 })
w.run("UPDATE users SET password_hash = ? WHERE name = 'ModUji60c'", [hash])
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const mod = db.query("SELECT id FROM users WHERE name='ModUji60c'").get() as { id: string }

const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('admin:auth', { password: 'mod123' }, (m: any) => {
    out('2b. login moderator → ok=' + m.ok + ' actorRole=' + m.actorRole + (m.ok && m.actorRole === 'moderator' ? ' ✓' : ' ✗'))
    if (!m.ok) { process.exit(1) }
    socket.emit('admin:reset_conversation', { conversationId: 'x' }, (r: any) => {
      out('2c. reset_conversation → ok=' + r.ok + ' error=' + r.error + (r.error === 'FORBIDDEN' ? ' ✓ (ditolak)' : ' ✗'))
      socket.emit('admin:leaderboard', {}, (l: any) => {
        out('2d. leaderboard (baca) → ok=' + l.ok + (l.ok ? ' ✓' : ' ✗'))
        // login admin penuh → promosi user biasa jadi moderator lalu balik
        const s3 = io('http://127.0.0.1:3003', { transports: ['websocket'] })
        s3.on('connect', () => {
          s3.emit('admin:auth', { password: 'admin123' }, (a: any) => {
            if (!a.ok) { out('admin auth gagal'); process.exit(1) }
            const plain = db.query("SELECT id FROM users WHERE role='user' AND name NOT LIKE 'UjiBrowser%' AND name NOT LIKE 'Mod%' LIMIT 1").get() as { id: string } | undefined
            if (!plain) { out('2e. tidak ada user biasa utk uji role'); s3.disconnect(); socket.disconnect(); process.exit(0) }
            s3.emit('admin:user_role', { userId: plain.id, role: 'moderator' }, (r1: any) => {
              const now = dbRead2()
              const role1 = now.query('SELECT role FROM users WHERE id=?').get(plain.id) as any
              s3.emit('admin:user_role', { userId: plain.id, role: 'user' }, (r2: any) => {
                const role2 = now.query('SELECT role FROM users WHERE id=?').get(plain.id) as any
                out(`2e. admin:user_role user→moderator ok=${r1.ok} (role=${role1.role}) lalu →user ok=${r2.ok} (role=${role2.role})` + (r1.ok && role1.role === 'moderator' && r2.ok && role2.role === 'user' ? ' ✓' : ' ✗'))
                s3.disconnect(); socket.disconnect(); process.exit(0)
              })
            })
          })
        })
      })
    })
  })
})
const dbRead2 = () => new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
setTimeout(() => { out('TIMEOUT'); process.exit(1) }, 30000)
