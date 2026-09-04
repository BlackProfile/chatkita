/**
 * Util Task 59 — buat/hapus UjiBrowser59 + data uji kendali per-user v40:
 * - password uji59; percakapan dgn Admin
 * - 3 teks LAMA (5 hari lalu) → uji auto-bersih (auto_clean_days=1)
 * - 2 teks HARI INI + 1 file media NYATA (db/media/t59-uji.jpg) → uji ZIP/leaderboard
 * - nudge_days=2 + nudge_text + last_seen 3 hari lalu → uji sweep pengingat
 * Pemakaian: bun .zscripts/t59-fixture.ts create | cleanup | age  (age = set last_seen tua lagi)
 */
import { Database } from "bun:sqlite";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const MEDIA = "/home/z/my-project/db/media/t59-uji.jpg";
const NAME = "UjiBrowser59";
const DAY = 86_400_000;
const out = (s: string) => process.stdout.write(s + "\n");

// JPEG 1x1 valid (polos) + padding agar > 10 KB supaya ZIP realistis.
const JPEG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const jpeg = Buffer.concat([JPEG, Buffer.alloc(12_000, 7)]);

const userIdOf = (db: Database): string | null =>
  ((db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined)?.id ?? null);

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  if (userIdOf(db)) {
    out("exists");
    process.exit(0);
  }
  const nowMs = Date.now();
  const id = crypto.randomUUID();
  const hash = Bun.password.hashSync("uji59", { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via, nudge_days, nudge_text, auto_clean_days) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self', 2, 'Halo! Lama tidak kabar — semoga sehat selalu 😊 (uji t59)', 1)",
    [id, NAME, nowMs - 9 * DAY, nowMs - 3 * DAY, hash, nowMs - 9 * DAY]
  );
  const convId = crypto.randomUUID();
  // Orientasi KANONIK sesuai pairKey() server: user_a_id < user_b_id (sorted).
  const [convA, convB] = [id, "admin"].sort();
  db.run(
    "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)",
    [convId, convA, convB, nowMs, nowMs]
  );
  const ins = db.prepare(
    "INSERT INTO messages (conversation_id, sender_id, content, created_at, type) VALUES (?, ?, ?, ?, 'text')"
  );
  // 3 teks lama (5 hari lalu) — target auto-bersih.
  for (let k = 0; k < 3; k += 1) ins.run(convId, id, `Pesan LAMA uji t59 nomor ${k + 1}`, nowMs - 5 * DAY + k * 60_000);
  // 1 teks lama dari admin.
  ins.run(convId, "admin", "Pesan admin lama uji t59 — tidak ikut auto-bersih milik user? (kolom memang per percakapan)", nowMs - 5 * DAY + 300_000);
  // 2 teks hari ini.
  ins.run(convId, id, "Pesan BARU uji t59 pertama hari ini", nowMs - 30 * 60_000);
  ins.run(convId, "admin", "Pesan admin hari ini uji t59", nowMs - 20 * 60_000);
  // File media NYATA di disk.
  writeFileSync(MEDIA, jpeg);
  db.run(
    "INSERT INTO messages (conversation_id, sender_id, content, created_at, type, file_name, file_size, mime_type) VALUES (?, 'admin', '/api/media/t59-uji.jpg', ?, 'file', 't59-uji.jpg', ?, 'image/jpeg')",
    [convId, nowMs - 10 * 60_000, jpeg.byteLength]
  );
  out(`created user=${id} conv=${convId} media=${jpeg.byteLength}B`);
} else if (process.argv[2] === "age") {
  const db = new Database(DB_PATH);
  const id = userIdOf(db);
  if (!id) { out("missing"); process.exit(1); }
  db.run("UPDATE users SET last_seen_at = ? WHERE id = ?", [Date.now() - 3 * DAY, id]);
  out("last_seen diset tua (3 hari)");
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const id = userIdOf(db);
  if (!id) { out("sudah bersih"); if (existsSync(MEDIA)) unlinkSync(MEDIA); process.exit(0); }
  const convs = db.query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?").all(id, id) as { id: string }[];
  for (const c of convs) {
    db.run("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)", [c.id]);
    db.run("DELETE FROM messages WHERE conversation_id = ?", [c.id]);
    db.run("DELETE FROM reads WHERE conversation_id = ?", [c.id]);
    db.run("DELETE FROM conversations WHERE id = ?", [c.id]);
  }
  db.run("DELETE FROM devices WHERE user_id = ?", [id]);
  db.run("DELETE FROM push_subscriptions WHERE user_id = ?", [id]);
  db.run("DELETE FROM login_events WHERE user_id = ?", [id]);
  db.run("DELETE FROM users WHERE id = ?", [id]);
  if (existsSync(MEDIA)) unlinkSync(MEDIA);
  const uc = (db.query("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
  out(`cleaned; users sisa=${uc}`);
} else {
  out("pemakaian: bun .zscripts/t59-fixture.ts create|cleanup|age");
}
