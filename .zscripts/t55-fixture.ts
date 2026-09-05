/**
 * Util Task 55 — buat/hapus bukti media LAMA (40 hari) milik UjiBrowser55
 * untuk membuktikan retensi nonaktif: media berumur 40 hari TIDAK dihapus
 * sweeper maupun tombol "Bersihkan media lama".
 * Pemakaian: bun .zscripts/t55-fixture.ts create | cleanup
 */
import { Database } from "bun:sqlite";
import { existsSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const MEDIA_DIR = "/home/z/my-project/db/media";
const NAME = "UjiBrowser55";
const AGE_DAYS = 40;
const out = (s: string) => process.stdout.write(s + "\n");

// 1x1 JPEG standar (SOI+APP0+DHT+SOF0+scan) — sama dengan generator t54.
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAAAv/aAAwDAQACEQMRAD8AmgA//9k=";

const mediaFiles = () =>
  readdirSync(MEDIA_DIR).filter((f) => f.startsWith("t55-old-"));

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const now = Date.now();
  const ts = now - AGE_DAYS * 86_400_000;

  let user = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as
    | { id: string }
    | undefined;
  if (!user) {
    const id = crypto.randomUUID();
    const hash = Bun.password.hashSync("uji55", { algorithm: "bcrypt", cost: 10 });
    db.run(
      "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
      [id, NAME, now, now, hash, now]
    );
    user = { id };
  }

  const conv = db
    .query(
      "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
    )
    .get(user.id, user.id) as { id: string } | undefined;
  if (!conv) {
    db.run(
      "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, 'admin', ?, ?, ?)",
      [crypto.randomUUID(), user.id, ts, ts]
    );
  }
  const convId = (
    db
      .query(
        "SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = 'admin') OR (user_b_id = ? AND user_a_id = 'admin')"
      )
      .get(user.id, user.id) as { id: string }
  ).id;

  // File media uji + pesan 'file' berumur 40 hari (created_at dipalu mundur).
  const stored = `t55-old-${now}.jpg`;
  const bytes = Buffer.from(JPEG_1X1, "base64");
  writeFileSync(join(MEDIA_DIR, stored), bytes);
  db.run(
    `INSERT INTO messages (conversation_id, sender_id, content, created_at, type, file_name, file_size, mime_type)
     VALUES (?, ?, ?, ?, 'file', ?, ?, 'image/jpeg')`,
    [convId, user.id, `/api/media/${stored}`, ts, "bukti-lama-t55.jpg", bytes.length]
  );
  const msg = db
    .query("SELECT id, created_at, media_expired_at FROM messages WHERE content = ?")
    .get(`/api/media/${stored}`) as { id: number; created_at: number; media_expired_at: number | null };
  out(
    `created msg#${msg.id} age=${Math.round((now - msg.created_at) / 86_400_000)}h expired=${msg.media_expired_at} file=${stored}`
  );
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const row = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as
    | { id: string }
    | undefined;
  let convs = 0;
  if (row) {
    const cs = db
      .query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?")
      .all(row.id, row.id) as { id: string }[];
    for (const cv of cs) {
      db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
      db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
      convs++;
    }
    db.run("DELETE FROM devices WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM push_subscriptions WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM users WHERE id = ?", [row.id]);
  }
  let files = 0;
  for (const f of mediaFiles()) {
    const p = join(MEDIA_DIR, f);
    if (existsSync(p)) {
      unlinkSync(p);
      files++;
    }
  }
  out(`cleaned user=${row ? 1 : 0} convs=${convs} files=${files}`);
} else {
  out("usage: bun .zscripts/t55-fixture.ts create|cleanup");
}
