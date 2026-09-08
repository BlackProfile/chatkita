/**
 * Util Task 61 — fixture E2E v45 (Kendali Akun Penuh + Cheat Lab).
 * create : UjiBrowser61 (pw uji61, 3 pesan, 1 memuat "rahasia")
 *          + UjiBrowser61B (pw uji61, khusus uji hapus akun)
 * cleanup: hapus total kedua user + pesan + reaksi + reads + devices
 * Pemakaian: bun .zscripts/t61-fixture.ts create | cleanup
 */
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const out = (s: string) => process.stdout.write(s + "\n");

const ensureUser = (db: Database, name: string, password: string) => {
  const existing = db.query("SELECT id FROM users WHERE name = ?").get(name) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = Date.now();
  const hash = Bun.password.hashSync(password, { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
    [id, name, now, now, hash, now]
  );
  return id;
};

const ensureConv = (db: Database, userId: string) => {
  const conv = db
    .query(
      "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
    )
    .get(userId, userId) as { id: string } | undefined;
  if (conv) return conv.id;
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, 'admin', ?, ?, ?)",
    [id, userId, now, now]
  );
  return id;
};

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const now = Date.now();
  const idA = ensureUser(db, "UjiBrowser61", "uji61");
  const idB = ensureUser(db, "UjiBrowser61B", "uji61");
  const convA = ensureConv(db, idA);
  ensureConv(db, idB);
  const count = (db.query("SELECT COUNT(*) AS v FROM messages WHERE sender_id = ? AND conversation_id = ?").get(idA, convA) as { v: number }).v;
  if (count === 0) {
    const texts = ["Halo admin, ini pesan uji t61 nomor satu", "rahasia: kode warna merah", "Oke sip, terima kasih admin"];
    for (let i = 0; i < texts.length; i++) {
      db.run(
        "INSERT INTO messages (conversation_id, sender_id, content, created_at, type) VALUES (?, ?, ?, ?, 'text')",
        [convA, idA, texts[i], now - (texts.length - i) * 60_000]
      );
    }
  }
  const total = (db.query("SELECT COUNT(*) AS v FROM messages WHERE conversation_id = ?").get(convA) as { v: number }).v;
  out(`create OK — UjiBrowser61=${idA} convA=${convA} pesan=${total}; UjiBrowser61B=${idB}`);
  db.close();
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  for (const name of ["UjiBrowser61", "UjiBrowser61B"]) {
    const row = db.query("SELECT id FROM users WHERE name = ?").get(name) as { id: string } | undefined;
    if (!row) {
      out(`cleanup: ${name} tidak ada`);
      continue;
    }
    const convs = db.query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?").all(row.id, row.id) as Array<{ id: string }>;
    for (const c of convs) {
      db.run("DELETE FROM messages WHERE conversation_id = ?", [c.id]);
      db.run("DELETE FROM reads WHERE conversation_id = ?", [c.id]);
      db.run("DELETE FROM conversations WHERE id = ?", [c.id]);
    }
    db.run("DELETE FROM message_reactions WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM devices WHERE user_id = ?", [row.id]);
    try { db.run("DELETE FROM push_subscriptions WHERE user_id = ?", [row.id]); } catch {}
    try { db.run("DELETE FROM login_events WHERE user_id = ?", [row.id]); } catch {}
    db.run("DELETE FROM users WHERE id = ?", [row.id]);
    out(`cleanup: ${name} dihapus (conv=${convs.length})`);
  }
  const sisa = (db.query("SELECT COUNT(*) AS v FROM users WHERE name LIKE 'UjiBrowser61%'").get() as { v: number }).v;
  out(`sisa fixture t61 = ${sisa}`);
  db.close();
} else {
  out("pemakaian: bun .zscripts/t61-fixture.ts create | cleanup");
}
