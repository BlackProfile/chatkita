/** v49 — fixture akun uji: UjiV49 (pw uji49) + percakapan dengan admin. */
import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db");
const NAME = "UjiV49";
const now = Date.now();
let u = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
if (!u) {
  const id = crypto.randomUUID();
  const hash = Bun.password.hashSync("uji49", { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
    [id, NAME, now, now, hash, now]
  );
  u = { id };
}
let conv = db.query("SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = 'admin'").get(u.id) as { id: string } | undefined;
if (!conv) {
  const cid = crypto.randomUUID();
  db.run("INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, ?, 'admin', ?, ?)", [cid, u.id, now, now]);
  conv = { id: cid };
}
// beberapa pesan pembuka
const cnt = (db.query("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(conv.id) as { c: number }).c;
if (cnt === 0) {
  db.run("INSERT INTO messages (conversation_id, sender_id, content, created_at, type) VALUES (?, 'admin', ?, ?, 'text')", [conv.id, "Selamat datang di v49! Coba stiker & panel media.", now - 60000]);
  db.run("INSERT INTO messages (conversation_id, sender_id, content, created_at, type) VALUES (?, 'admin', ?, ?, 'text')", [conv.id, "Info: https://bit.ly/contoh-jebakan", now - 30000]);
}
process.stdout.write(`OK user=${u.id} conv=${conv.id}\n`);
