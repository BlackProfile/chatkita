/** Cleanup uji v45 — hapus pesan uji + user kloning + file media uji. */
import { Database } from 'bun:sqlite'
import { unlinkSync, existsSync, readdirSync } from 'node:fs'

const DB_PATH = '/home/z/my-project/mini-services/chat-service/chat.db'
const MEDIA_DIR = '/home/z/my-project/db/media'
const out = (s: string) => process.stdout.write(s + '\n')

const db = new Database(DB_PATH)

// 1. Hapus user KlonTarget60e + seluruh pesannya (percakapan ikut).
const klon = db.query("SELECT id FROM users WHERE name = 'KlonTarget60e'").get() as { id: string } | null
if (klon) {
  const klconv = db
    .query('SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?')
    .all(klon.id, klon.id) as { id: string }[]
  for (const c of klconv) {
    db.run('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', [c.id])
    db.run('DELETE FROM poll_votes WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', [c.id])
    db.run('DELETE FROM messages WHERE conversation_id = ?', [c.id])
    db.run('DELETE FROM reads WHERE conversation_id = ?', [c.id])
    db.run('DELETE FROM conversation_prefs WHERE conversation_id = ?', [c.id])
    db.run('DELETE FROM conversations WHERE id = ?', [c.id])
  }
  db.run('DELETE FROM devices WHERE user_id = ?', [klon.id])
  db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [klon.id])
  db.run('DELETE FROM login_events WHERE user_id = ?', [klon.id])
  db.run('DELETE FROM users WHERE id = ?', [klon.id])
  out(`user KlonTarget60e dihapus (${klconv.length} percakapan dibersihkan)`)
} else {
  out('user KlonTarget60e tidak ada — lewati')
}

// 2. Hapus pesan uji v45 di percakapan UjiBrowser59 (id >= 243).
const uji = db.query("SELECT id FROM users WHERE name = 'UjiBrowser59'").get() as { id: string } | null
if (uji) {
  const conv = db
    .query('SELECT id FROM conversations WHERE (user_a_id = ? OR user_b_id = ?) AND (user_a_id = ? OR user_b_id = ?)')
    .all(uji.id, uji.id, 'admin', 'admin') as { id: string }[]
  let removed = 0
  for (const c of conv) {
    const r = db.run('DELETE FROM messages WHERE conversation_id = ? AND id >= 243', [c.id])
    removed += r.changes
    db.run('DELETE FROM message_reactions WHERE message_id NOT IN (SELECT id FROM messages)')
    db.run(
      'UPDATE reads SET last_read_message_id = (SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id = ?) WHERE conversation_id = ?',
      [c.id, c.id]
    )
  }
  out(`pesan uji v45 dihapus: ${removed} (percakapan UjiBrowser59)`)
  // 3. Reset saklar cheat user (throttle/autoreply/shadowban sudah off via uji — pastikan).
  db.run('UPDATE users SET shadowban = 0, throttle_sec = 0, autoreply_on = 0, autoreply_text = NULL WHERE id = ?', [uji.id])
}

// 3. Bersihkan reaksi/atak yatim.
db.run('DELETE FROM message_reactions WHERE message_id NOT IN (SELECT id FROM messages)')
db.run('DELETE FROM poll_votes WHERE message_id NOT IN (SELECT id FROM messages)')

// 4. Hapus file media uji (wav/png tanpa referensi pesan).
const referenced = new Set(
  (db.query("SELECT content FROM messages WHERE type IN ('image','voice','file')").all() as { content: string }[])
    .map((r) => r.content.split('/').pop() ?? '')
    .filter(Boolean)
)
let freed = 0
for (const f of readdirSync(MEDIA_DIR)) {
  if (!referenced.has(f) && (f.endsWith('.wav') || f.endsWith('.png'))) {
    try {
      unlinkSync(`${MEDIA_DIR}/${f}`)
      freed++
    } catch {}
  }
}
out(`file media yatim dihapus: ${freed}`)

db.run("UPDATE conversations SET last_message_at = COALESCE((SELECT MAX(created_at) FROM messages WHERE messages.conversation_id = conversations.id), last_message_at)")
db.run('INSERT INTO audit_log (action, detail, at) VALUES (?, ?, ?)', ['cleanup', 't60e-cleanup: data uji v45 dibersihkan', Date.now()])
out('SELESAI')
