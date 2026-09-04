/**
 * Util Task 57 — buat/hapus UjiBrowser57 + media uji NYATA utk kontrol media:
 * - 3 "foto" dari user (JPEG valid di db/media, sha-prefixed nama file,
 *   file_size 1547 B masing-masing) + thumb_url kecil
 * - 1 file dari ADMIN (teks kecil .txt di db/media, 96 B)
 * - 2 teks user + 1 teks admin
 * - media_delete nanti membebaskan file disk sungguhan → bisa diverifikasi
 * Pemakaian: bun .zscripts/t57-fixture.ts create | cleanup
 */
import { writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const MEDIA_DIR = "/home/z/my-project/db/media";
const NAME = "UjiBrowser57";
const out = (s: string) => process.stdout.write(s + "\n");

// 1x1 JPEG valid (base64).
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAAAv/aAAwDAQACEQMRAD8AmgA//9k=";
const jpegBytes = Buffer.from(JPEG_1X1, "base64");
// Minimal PNG 1x1 (base64) untuk variasi foto ke-3.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(PNG_1X1, "base64");
const txtBytes = Buffer.from("File uji Task 57 - kontrol media per-user.\n", "utf8");

const SUFFIXES = ["t57a", "t57b", "t57c", "t57d"];

const mediaFilesFor = (): string[] => {
  try {
    return readdirSync(MEDIA_DIR).filter((f) => f.includes("t57"));
  } catch {
    return [];
  }
};

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const nowMs = Date.now();
  const existing = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as
    | { id: string }
    | undefined;
  if (existing) {
    out("exists: " + existing.id);
    process.exit(0);
  }
  const id = crypto.randomUUID();
  const hash = Bun.password.hashSync("uji57", { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
    [id, NAME, nowMs - 6 * 86_400_000, nowMs, hash, nowMs - 6 * 86_400_000]
  );
  const convId = crypto.randomUUID();
  db.run(
    "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, 'admin', ?, ?, ?)",
    [convId, id, nowMs, nowMs]
  );

  // Tulis 4 file media sungguhan ke db/media (nama mengandung t57 → mudah dibersihkan).
  const files: Array<{ name: string; bytes: Buffer; mime: string }> = [
    { name: `${crypto.randomUUID().replace(/-/g, "")}t57a.jpg`, bytes: jpegBytes, mime: "image/jpeg" },
    { name: `${crypto.randomUUID().replace(/-/g, "")}t57b.jpg`, bytes: jpegBytes, mime: "image/jpeg" },
    { name: `${crypto.randomUUID().replace(/-/g, "")}t57c.png`, bytes: pngBytes, mime: "image/png" },
    { name: `${crypto.randomUUID().replace(/-/g, "")}t57d.txt`, bytes: txtBytes, mime: "text/plain" },
  ];
  for (const f of files) writeFileSync(join(MEDIA_DIR, f.name), f.bytes);

  const ins = db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, content, created_at, type, file_name, file_size, mime_type, thumb_url, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Urutan waktu naik: teks user → 3 foto user → file admin → teks admin → teks user.
  const t0 = nowMs - 30 * 60_000;
  ins.run(convId, id, "Halo admin, ini pesan teks uji 57", t0, "text", null, null, null, null, null);
  ins.run(convId, id, `/api/media/${files[0].name}`, t0 + 60_000, "image", "foto-uji-a.jpg", files[0].bytes.length, files[0].mime, `/api/media/${files[0].name}`, "Foto pertama uji media");
  ins.run(convId, id, `/api/media/${files[1].name}`, t0 + 120_000, "image", "foto-uji-b.jpg", files[1].bytes.length, files[1].mime, `/api/media/${files[1].name}`, null);
  ins.run(convId, id, `/api/media/${files[2].name}`, t0 + 180_000, "image", "foto-uji-c.png", files[2].bytes.length, files[2].mime, `/api/media/${files[2].name}`, null);
  ins.run(convId, "admin", `/api/media/${files[3].name}`, t0 + 240_000, "file", "catatan-uji.txt", files[3].bytes.length, files[3].mime, null, "Catatan dari admin");
  ins.run(convId, "admin", "Ini balasan admin uji 57", t0 + 300_000, "text", null, null, null, null, null);
  ins.run(convId, id, "Terima kasih, sudah saya terima", t0 + 360_000, "text", null, null, null, null, null);

  const maxId = (db.query("SELECT MAX(id) m FROM messages").get() as { m: number }).m;
  db.run(
    "INSERT INTO reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?) ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id",
    [convId, id, maxId]
  );

  const c = db
    .query("SELECT COUNT(*) n, COALESCE(SUM(file_size),0) b FROM messages WHERE conversation_id = ? AND deleted_at IS NULL")
    .get(convId) as { n: number; b: number };
  out(`created user=${id} conv=${convId} messages=${c.n} mediaBytes=${c.b}`);
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const row = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as
    | { id: string }
    | undefined;
  let convs = 0;
  if (row) {
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
  // Hapus file media uji dari disk (apa pun yang tersisa, message rows sudah tiada).
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
  out(`cleaned user=${row ? 1 : 0} convs=${convs} mediaFilesRemoved=${removed} users=${users} allowRegistration=${reg}`);
} else if (process.argv[2] === "verify") {
  // Pemeriksaan pasca-uji (readonly).
  const db = new Database(DB_PATH, { readonly: true });
  const u = db.query("SELECT COUNT(*) n FROM users").get() as { n: number };
  const m = db
    .query("SELECT COUNT(*) n FROM messages WHERE content LIKE '%t57%'")
    .get() as { n: number };
  out(`users=${u.n} leftoverT57Messages=${m.n} leftoverT57Files=${mediaFilesFor().length} filesOnDisk=${readdirSync(MEDIA_DIR).length}`);
} else {
  out("usage: bun .zscripts/t57-fixture.ts create|cleanup|verify");
}
