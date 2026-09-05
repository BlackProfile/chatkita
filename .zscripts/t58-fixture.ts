/**
 * Util Task 58 — buat/hapus UjiBrowser58 + 1 media nyata utk kendali per-user:
 * - 2 teks user + 1 foto user (JPEG valid di db/media) + 1 teks admin
 * - Pemakaian: bun .zscripts/t58-fixture.ts create | cleanup | verify
 * Cleanup cocokkan nama LIKE 'UjiBrowser58%' (rename uji tidak bocor).
 */
import { writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const MEDIA_DIR = "/home/z/my-project/db/media";
const NAME = "UjiBrowser58";
const out = (s: string) => process.stdout.write(s + "\n");

const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAAAv/aAAwDAQACEQMRAD8AmgA//9k=";
const jpegBytes = Buffer.from(JPEG_1X1, "base64");

const mediaFilesFor = (): string[] => {
  try {
    return readdirSync(MEDIA_DIR).filter((f) => f.includes("t58"));
  } catch {
    return [];
  }
};

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const nowMs = Date.now();
  const existing = db.query("SELECT id FROM users WHERE name LIKE ?").get(NAME + "%") as
    | { id: string }
    | undefined;
  if (existing) {
    out("exists: " + existing.id);
    process.exit(0);
  }
  const id = crypto.randomUUID();
  const hash = Bun.password.hashSync("uji58", { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
    [id, NAME, nowMs - 2 * 86_400_000, nowMs, hash, nowMs - 2 * 86_400_000]
  );
  const convId = crypto.randomUUID();
  // Urutan kolom WAJIB sama dengan pairKey server (leksikografis) agar
  // ensureConversationWithAdmin tidak membuat percakapan duplikat saat login.
  const [a, b] = id < "admin" ? [id, "admin"] : ["admin", id];
  db.run(
    "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)",
    [convId, a, b, nowMs, nowMs]
  );

  const fileName = `${crypto.randomUUID().replace(/-/g, "")}t58.jpg`;
  writeFileSync(join(MEDIA_DIR, fileName), jpegBytes);

  const ins = db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, content, created_at, type, file_name, file_size, mime_type, thumb_url, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const t0 = nowMs - 25 * 60_000;
  ins.run(convId, id, "Halo admin, pesan teks pertama uji 58", t0, "text", null, null, null, null, null);
  ins.run(
    convId,
    id,
    `/api/media/${fileName}`,
    t0 + 60_000,
    "image",
    "foto-uji-t58.jpg",
    jpegBytes.length,
    "image/jpeg",
    `/api/media/${fileName}`,
    "Foto uji kendali per-user"
  );
  ins.run(convId, "admin", "Pesan admin uji 58", t0 + 120_000, "text", null, null, null, null, null);
  ins.run(convId, id, "Pesan teks kedua uji 58", t0 + 180_000, "text", null, null, null, null, null);

  const maxId = (db.query("SELECT MAX(id) m FROM messages").get() as { m: number }).m;
  db.run(
    "INSERT INTO reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?) ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id",
    [convId, id, maxId]
  );

  const c = db
    .query("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND deleted_at IS NULL")
    .get(convId) as { n: number };
  out(`created user=${id} conv=${convId} messages=${c.n} file=${fileName}`);
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const rows = db.query("SELECT id FROM users WHERE name LIKE ?").all(NAME + "%") as Array<{ id: string }>;
  let convs = 0;
  for (const row of rows) {
    const cs = db
      .query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?")
      .all(row.id, row.id) as Array<{ id: string }>;
    for (const cv of cs) {
      db.run("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)", [cv.id]);
      db.run("DELETE FROM reads WHERE conversation_id = ?", [cv.id]);
      db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
      db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
      convs += 1;
    }
    db.run("DELETE FROM devices WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM push_subscriptions WHERE user_id = ?", [row.id]);
    db.run("DELETE FROM users WHERE id = ?", [row.id]);
  }
  let removed = 0;
  for (const f of mediaFilesFor()) {
    try {
      unlinkSync(join(MEDIA_DIR, f));
      removed += 1;
    } catch {
      /* abaikan */
    }
  }
  const users = (db.query("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
  const reg = (db.query("SELECT value FROM settings WHERE key = 'allowRegistration'").get() as { value: string } | undefined)?.value;
  out(`cleaned users=${rows.length} convs=${convs} mediaFilesRemoved=${removed} users=${users} allowRegistration=${reg}`);
} else if (process.argv[2] === "verify") {
  const db = new Database(DB_PATH, { readonly: true });
  const u = db.query("SELECT COUNT(*) n FROM users").get() as { n: number };
  const m = db
    .query("SELECT COUNT(*) n FROM messages WHERE content LIKE '%uji 58%' OR caption LIKE '%uji%' AND caption LIKE '%t58%'")
    .get() as { n: number };
  out(`users=${u.n} leftoverT58Messages=${m.n} leftoverT58Files=${mediaFilesFor().length}`);
} else {
  out("usage: bun .zscripts/t58-fixture.ts create|cleanup|verify");
}
