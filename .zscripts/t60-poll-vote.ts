/** Vote polling terbaru sebagai UjiBrowser59. Pemakaian: bun .zscripts/t60-poll-vote.ts <optionIdx> */
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const u = db.query("SELECT id FROM users WHERE name='UjiBrowser59'").get() as { id: string }
const conv = db.query("SELECT id FROM conversations WHERE user_a_id='admin' AND user_b_id=?").get(u.id) as { id: string }
const poll = db.query("SELECT id FROM messages WHERE conversation_id=? AND deleted_at IS NULL ORDER BY id DESC").all(conv.id) as { id: number }[]
// cari pesan poll terbaru
let pollId = 0
for (const r of poll) {
  const row = db.query('SELECT meta_json FROM messages WHERE id=?').get(r.id) as { meta_json: string | null }
  if (row.meta_json && row.meta_json.includes('poll')) { pollId = r.id; break }
}
const { io } = await import('socket.io-client')
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('user:auth', { name: 'UjiBrowser59', password: 'uji60', deviceId: 't60-device-uji' }, (a: any) => {
    if (!a.ok) { console.log('AUTH GAGAL', a.error); process.exit(1) }
    socket.emit('messages:poll_vote', { messageId: pollId, optionIdx: Number(process.argv[2] ?? 1) }, (res: any) => {
      console.log(`VOTE poll#${pollId} idx=${process.argv[2]} →`, JSON.stringify(res))
      socket.disconnect(); process.exit(0)
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 20000)
