/** v43 — uji admin penuh: login, admin:user_role promosi/demosi. */
const { io } = await import('socket.io-client')
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db', { readonly: true })
const mod = db.query("SELECT id FROM users WHERE name='ModUji60c'").get() as { id: string }
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('admin:auth', { password: 'admin123' }, (a: any) => {
    console.log('1) LOGIN ADMIN →', a.ok ? `OK actorRole=${a.actorRole}` : `GAGAL ${a.error}`)
    if (!a.ok) process.exit(1)
    // demosi moderator → user
    socket.emit('admin:user_role', { userId: mod.id, role: 'user' }, (r: any) => {
      console.log('2) DEMOSI mod→user →', JSON.stringify(r))
      // promosi lagi
      socket.emit('admin:user_role', { userId: mod.id, role: 'moderator' }, (r2: any) => {
        console.log('3) PROMOSI user→mod →', JSON.stringify(r2))
        // coba sentuh ADMIN_ID
        socket.emit('admin:user_role', { userId: 'admin', role: 'moderator' }, (r3: any) => {
          console.log('4) UBAH ADMIN_ID →', JSON.stringify(r3), '(harus FORBIDDEN)')
          // invalid role
          socket.emit('admin:user_role', { userId: mod.id, role: 'admin' }, (r4: any) => {
            console.log('5) ROLE=INVALID →', JSON.stringify(r4), '(harus ditolak)')
            socket.disconnect(); process.exit(0)
          })
        })
      })
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 20000)
