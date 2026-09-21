/** Uji user:mystats + conversation:archive_self + user:status sebagai UjiBrowser59. */
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const u = db.query("SELECT id FROM users WHERE name='UjiBrowser59'").get() as { id: string }
const conv = db.query("SELECT id FROM conversations WHERE user_a_id='admin' AND user_b_id=?").get(u.id) as { id: string }
const { io } = await import('socket.io-client')
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('user:auth', { name: 'UjiBrowser59', password: 'uji60', deviceId: 't60-device-uji' }, (a: any) => {
    if (!a.ok) { console.log('AUTH GAGAL', a.error); process.exit(1) }
    socket.emit('user:mystats', {}, (s: any) => {
      console.log('MYSTATS ok=', s.ok, '| pesan=', s.insight?.totals?.userMessages, '| streak=', s.insight?.activity?.streakDays, '| jamPuncak=', (s.insight?.activity?.hours ?? []).indexOf(Math.max(...(s.insight?.activity?.hours ?? [1]))))
      socket.emit('user:status', { text: '🐳 sibuk uji v42' }, (st: any) => {
        console.log('STATUS ok=', st.ok)
        socket.emit('conversation:archive_self', { conversationId: conv.id, archived: true }, (ar: any) => {
          console.log('ARSIP ok=', ar.ok)
          setTimeout(() => process.exit(0), 300)
        })
      })
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 25000)
