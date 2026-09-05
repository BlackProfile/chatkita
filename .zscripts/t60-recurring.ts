/** Uji admin:schedule_message berulang (daily) — kirim +15 dtk, cek kembaran. */
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const u = db.query("SELECT id FROM users WHERE name='UjiBrowser59'").get() as { id: string }
const conv = db.query("SELECT id FROM conversations WHERE user_a_id='admin' AND user_b_id=?").get(u.id) as { id: string }
const { io } = await import('socket.io-client')
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('admin:auth', { password: 'admin123' }, (a: any) => {
    if (!a.ok) { console.log('AUTH GAGAL'); process.exit(1) }
    socket.emit('admin:schedule_message', { userId: u.id, text: '[berulang] halo harian v42', sendAtMs: Date.now() + 15000, repeat: 'daily' }, (r: any) => {
      console.log('SCHEDULE ok=', r.ok, 'id=', r.messageId ?? r.id ?? JSON.stringify(r).slice(0,80))
      const w = new Database('/home/z/my-project/mini-services/chat-service/chat.db')
      const row = w.query("SELECT id, repeat_rule, scheduled_at, delivered_at FROM messages WHERE repeat_rule='daily' ORDER BY id DESC LIMIT 1").get() as any
      console.log('DB:', JSON.stringify(row))
      socket.disconnect(); process.exit(0)
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 20000)
