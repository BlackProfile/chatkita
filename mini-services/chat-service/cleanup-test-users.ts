/**
 * One-off surgical cleanup: remove protocol-test users (Budi Test, Siti
 * Test) + their conversations/messages/reads/reactions/push subscriptions.
 * Real users (Admin, Budi Uji, rvg, ...) are untouched (exact-name match).
 */
import { Database } from 'bun:sqlite'

const db = new Database('/home/z/my-project/mini-services/chat-service/chat.db')
const targets = db
  .query("SELECT id, name FROM users WHERE name IN ('Budi Test','Siti Test') AND role='user'")
  .all() as Array<{ id: string; name: string }>

for (const u of targets) {
  const convs = db
    .query('SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?')
    .all(u.id, u.id) as Array<{ id: string }>
  for (const c of convs) {
    db.run(
      'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)',
      [c.id]
    )
    db.run('DELETE FROM messages WHERE conversation_id = ?', [c.id])
    db.run('DELETE FROM reads WHERE conversation_id = ?', [c.id])
    db.run('DELETE FROM conversations WHERE id = ?', [c.id])
    console.log(`removed conversation ${c.id}`)
  }
  db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [u.id])
  db.run('DELETE FROM users WHERE id = ?', [u.id])
  console.log(`removed test user "${u.name}" (${u.id})`)
}

const check = db.query(`PRAGMA integrity_check`).get()
console.log('integrity:', check)
console.log('remaining users:', JSON.stringify(db.query('SELECT name FROM users').all()))
db.run('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
