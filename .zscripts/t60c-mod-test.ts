/** v43 — uji: login moderator via admin:auth, baca OK, destruktif FORBIDDEN, admin:user_role. */
const { io } = await import('socket.io-client')
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
socket.on('connect', () => {
  // 1) login moderator via form admin
  socket.emit('admin:auth', { password: 't60c-mod' }, (a: any) => {
    console.log('1) LOGIN MODERATOR →', a.ok ? `OK actorRole=${a.actorRole}, convs=${a.conversations.length}` : `GAGAL ${a.error}`)
    if (!a.ok) process.exit(1)
    // 2) event baca boleh
    socket.emit('admin:dashboard', {}, (r: any) => {
      console.log('2) READ admin:dashboard →', r.ok ? `OK users=${r.stats.totals.users}` : r.error)
      // 3) event destruktif ditolak
      socket.emit('admin:reset_all', {}, (r2: any) => {
        console.log('3) DESTRUKTIF admin:reset_all →', JSON.stringify(r2))
        // 4) settings ditolak
        socket.emit('admin:settings:set', { appName: 'Hack' }, (r3: any) => {
          console.log('4) DESTRUKTIF admin:settings:set →', JSON.stringify(r3))
          // 5) admin:user_role ditolak untuk moderator
          socket.emit('admin:user_role', { userId: 'x', role: 'user' }, (r4: any) => {
            console.log('5) admin:user_role oleh moderator →', JSON.stringify(r4))
            socket.disconnect(); process.exit(0)
          })
        })
      })
    })
  })
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 20000)
