/** v51 — fixture E2E anti-dupe nama:
 *  1) KevinUji51 (pw kevin51) + chat dgn admin (pesa pemilik nama pertama)
 *  2) KevinWarisan51 — akun warisan TANPA password/PIN (test ACCOUNT_UNCLAIMED)
 *  3) kode undangan aktif CK-T67A-6751 utk pendaftaran "KevinUji51 (2)" */
import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db");
const now = Date.now();

function ensureUser(name: string, withPassword: boolean): { id: string } {
  let u = db.query("SELECT id FROM users WHERE name = ?").get(name) as { id: string } | undefined;
  if (!u) {
    const id = crypto.randomUUID();
    if (withPassword) {
      const hash = Bun.password.hashSync("kevin51", { algorithm: "bcrypt", cost: 10 });
      db.run(
        "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
        [id, name, now, now, hash, now]
      );
    } else {
      db.run(
        "INSERT INTO users (id, name, role, created_at, last_seen_at, created_via) VALUES (?, ?, 'user', ?, ?, 'legacy')",
        [id, name, now, now]
      );
    }
    u = { id };
  }
  let conv = db.query("SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = 'admin'").get(u.id) as { id: string } | undefined;
  if (!conv) {
    const cid = crypto.randomUUID();
    db.run("INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, ?, 'admin', ?, ?)", [cid, u.id, now, now]);
    conv = { id: cid };
  }
  const cnt = (db.query("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(conv.id) as { c: number }).c;
  if (cnt === 0) {
    db.run("INSERT INTO messages (conversation_id, sender_id, content, created_at, type) VALUES (?, 'admin', ?, ?, 'text')", [conv.id, `Pesan rahasia milik ${name} yang PERTAMA — tidak boleh terlihat oleh orang lain!`, now - 60000]);
  }
  return u;
}

const k1 = ensureUser("KevinUji51", true);
const k2 = ensureUser("KevinWarisan51", false);

let inv = db.query("SELECT code FROM invite_codes WHERE code = ?").get("CK-T67A-6751") as { code: string } | undefined;
if (!inv) {
  db.run("INSERT INTO invite_codes (code, created_by, created_at, label) VALUES ('CK-T67A-6751', 'admin', ?, 'fixture v51')", [now]);
  inv = { code: "CK-T67A-6751" };
}

process.stdout.write(`OK kevin1=${k1.id} kevin2=${k2.id} invite=${inv.code}\n`);
