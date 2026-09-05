/**
 * Util Task 60 — uji AI admin.
 * Pemakaian:
 *   bun .zscripts/t60-fixture.ts pass           → reset password UjiBrowser59 jadi 'uji60'
 *   bun .zscripts/t60-fixture.ts voice          → kirim pesan suara (data URL WAV TTS)
 *   bun .zscripts/t60-fixture.ts text <isi>     → kirim pesan teks sebagai UjiBrowser59
 */
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

const DB_PATH = '/home/z/my-project/mini-services/chat-service/chat.db'
const NAME = 'UjiBrowser59'
const out = (s: string) => process.stdout.write(s + '\n')

const mode = process.argv[2] ?? ''

if (mode === 'pass') {
  const db = new Database(DB_PATH)
  const hash = Bun.password.hashSync('uji60', { algorithm: 'bcrypt', cost: 10 })
  db.run('UPDATE users SET password_hash = ?, password_set_at = ? WHERE name = ?', [hash, Date.now(), NAME])
  const u = db.query('SELECT id FROM users WHERE name = ?').get(NAME) as { id: string }
  out(`password ${NAME} direset (id=${u.id})`)
  process.exit(0)
}

if (mode === 'voice' || mode === 'text') {
  const payload = mode === 'voice' ? null : (process.argv[3] ?? '')
  const run = async () => {
    const { io } = await import('socket.io-client')
    const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })
    socket.on('connect', () => {
      socket.emit(
        'user:auth',
        { name: NAME, password: 'uji60', deviceId: 't60-device-uji' },
        (auth: { ok: boolean; error?: string }) => {
          if (!auth.ok) {
            out(`AUTH GAGAL: ${auth.error}`)
            process.exit(1)
          }
          const db = new Database(DB_PATH, { readonly: true })
          const u = db.query('SELECT id FROM users WHERE name = ?').get(NAME) as { id: string }
          const conv = db
            .query(
              "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
            )
            .get(u.id, u.id) as { id: string }
          const send = (body: Record<string, unknown>, label: string) => {
            socket.emit('messages:send', body, (res: { ok: boolean; message?: { id: number }; error?: string }) => {
              out(`${label} → ok=${res.ok} id=${res.message?.id ?? '-'} err=${res.error ?? ''}`)
              socket.disconnect()
              process.exit(0)
            })
          }
          if (mode === 'text') {
            send({ conversationId: conv.id, type: 'text', content: payload }, `teks "${payload}"`)
          } else {
            const wav = readFileSync('/tmp/t60-voice.wav')
            const dataUrl = `data:audio/wav;base64,${wav.toString('base64')}`
            send({ conversationId: conv.id, type: 'voice', content: dataUrl, durationMs: 3000 }, 'suara WAV')
          }
        }
      )
    })
    setTimeout(() => {
      out('TIMEOUT')
      process.exit(1)
    }, 30000)
  }
  void run()
}
