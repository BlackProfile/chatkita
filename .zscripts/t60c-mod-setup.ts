/** v43 — buat akun moderator uji (password t60c-mod) + verifikasi FORBIDDEN utk moderator. */
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db')
const NAME = 'ModUji60c'
const hash = Bun.password.hashSync('t60c-mod', 'bcrypt')
const existing = db.query('SELECT id, role FROM users WHERE name = ?').get(NAME) as { id: string; role: string } | null
if (existing) {
  db.run('UPDATE users SET role = ?, password_hash = ? WHERE id = ?', ['moderator', hash, existing.id])
  console.log('MOD UPDATED', existing.id)
} else {
  const id = crypto.randomUUID()
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'moderator', ?, ?, ?, ?, 'fixture')",
    [id, NAME, Date.now(), Date.now(), hash, Date.now()]
  )
  console.log('MOD CREATED', id)
}
process.exit(0)
