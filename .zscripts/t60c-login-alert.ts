/** Admin mendengar admin:new_login; user login dgn perangkat BARU. */
const { io } = await import('socket.io-client')
const out = (s: string) => process.stdout.write(s + '\n')
const admin = io('http://127.0.0.1:3003', { transports: ['websocket'] })
admin.on('connect', () => {
  admin.emit('admin:auth', { password: 'admin123' }, (a: any) => {
    if (!a.ok) process.exit(1)
    admin.on('admin:new_login', (p: any) => {
      out('ADMIN MENERIMA admin:new_login → ' + JSON.stringify(p).slice(0, 140) + ' ✓')
      admin.disconnect(); user.disconnect(); process.exit(0)
    })
    const user = io('http://127.0.0.1:3003', { transports: ['websocket'] })
    user.on('connect', () => {
      user.emit('user:auth', { name: 'UjiBrowser59', password: 'uji60', deviceId: 't60c-perangkat-baru-' + Date.now().toString(36) }, (u: any) => {
        if (!u.ok) { out('user auth gagal: ' + u.error); process.exit(1) }
        out('user login dgn perangkat baru ok')
      })
    })
  })
})
setTimeout(() => { out('TIMEOUT — event tidak sampai'); process.exit(1) }, 20000)
