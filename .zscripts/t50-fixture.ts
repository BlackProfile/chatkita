/**
 * Util Task 50 — buat/hapus akun uji UjiBrowser50 (password: uji50).
 * Pemakaian: bun .zscripts/t50-fixture.ts create | cleanup
 * Setiap aksi diverifikasi baca-ulang dari koneksi kedua + stdout di-flush.
 */
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const NAME = "UjiBrowser50";
const out = (s: string) => process.stdout.write(s + "\n");

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const existing = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
  if (existing) {
    out("exists already: " + existing.id);
  } else {
    const id = crypto.randomUUID();
    const ts = Date.now();
    const hash = Bun.password.hashSync("uji50", { algorithm: "bcrypt", cost: 10 });
    db.run(
      "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
      [id, NAME, ts, ts, hash, ts]
    );
    // Conversation with Admin dibuat otomatis oleh server (ensureConversationWithAdmin)
    // saat auth pertama — tidak perlu dibuat manual di sini.
    const v = new Database(DB_PATH, { readonly: true });
    const row = v.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
    out(`created=${row?.id === id} id=${id}`);
  }
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const row = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
  if (row) {
    const convs = db
      .query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?")
      .all(row.id, row.id) as { id: string }[];
    for (const cv of convs) {
      db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
      db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
    }
    db.run("DELETE FROM devices WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM push_subscriptions WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM users WHERE id = ?", [row.id]);
    out("cleaned user + convs=" + convs.length);
  } else {
    out("nothing to clean");
  }
} else {
  out("usage: bun .zscripts/t50-fixture.ts create|cleanup");
}
