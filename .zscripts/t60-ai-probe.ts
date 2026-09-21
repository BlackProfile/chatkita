import { io } from 'socket.io-client'
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('admin:auth', { password: 'admin123' }, (res: any) => {
    console.log('AUTH:', JSON.stringify(res).slice(0, 80))
    const convId = process.argv[2]
    socket.emit('admin:ai_summary', { conversationId: convId }, (res2: any) => {
      console.log('SUMMARY RAW ACK:', JSON.stringify(res2).slice(0, 600))
      socket.disconnect()
      process.exit(0)
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 45000)
