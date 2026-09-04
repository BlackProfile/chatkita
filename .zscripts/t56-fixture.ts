/**
 * Util Task 56 — buat/hapus UjiBrowser56 + pesan uji BERPOLA utk insight:
 * - 5 teks user @13:00-13:30 UTC (20:00-20:30 WIB) di 5 hari berbeda lalu
 * - 2 foto user hari ini (file_size 1200+1800) → peak jam 20 WIB, streak 6 hari
 * - 3 pasangan balasan (user balas +35 dtk; admin balas +90 dtk)
 * - reads 100% + 2 reaksi dari user
 * Pemakaian: bun .zscripts/t56-fixture.ts create | cleanup
 */
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const NAME = "UjiBrowser56";
const out = (s: string) => process.stdout.write(s + "\n");
const DAY = 86_400_000;

const texts = [
  "Halo admin, ini pola pesan uji pertama jam sembilan malam",
  "Pesan uji kedua supaya jam dua puluh jadi puncak WIB",
  "Pola ketiga untuk histogram jam aktif dua puluh nol nol",
  "Keempat nih, tetap di jam dua puluh biar konsisten ya",
  "Kelima, terakhir untuk lima hari berbeda streak aktif",
];

if (process.argv[2] === "create") {
  const db = new Database(DB_PATH);
  const nowMs = Date.now();
  let user = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
  if (user) {
    out("exists: " + user.id);
    process.exit(0);
  }
  const id = crypto.randomUUID();
  const hash = Bun.password.hashSync("uji56", { algorithm: "bcrypt", cost: 10 });
  db.run(
    "INSERT INTO users (id, name, role, created_at, last_seen_at, password_hash, password_set_at, created_via) VALUES (?, ?, 'user', ?, ?, ?, ?, 'self')",
    [id, NAME, nowMs - 9 * DAY, nowMs, hash, nowMs - 9 * DAY]
  );
  const convId = crypto.randomUUID();
  db.run(
    "INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_message_at) VALUES (?, 'admin', ?, ?, ?)",
    [convId, id, nowMs, nowMs]
  );

  // Jam 13:05 UTC "k hari lalu" = 20:05 WIB hari yang sama (WIB = UTC+7).
  const at = (daysAgo: number, hUTC: number, minUTC: number) => {
    const base = new Date(nowMs - daysAgo * DAY);
    return Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hUTC, minUTC, 0);
  };

  const ins = db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, content, created_at, type, file_name, file_size, mime_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const run = <T,>(...a: unknown[]) => ins.run(...a) as unknown as T;

  // 5 teks user @20:05 WIB, hari lalu ke-5..1 (urut waktu naik).
  for (let k = 5; k >= 1; k -= 1) run(convId, id, texts[5 - k], at(k, 13, 5), "text", null, null, null);

  // Hari ini: 2 "foto" user @ 09:50 & 10:05 UTC (16:50/17:05 WIB).
  run(convId, id, "/api/media/t56dummy1.jpg", nowMs - 55 * 60_000, "image", "pola1.jpg", 1200, "image/jpeg");
  run(convId, id, "/api/media/t56dummy2.jpg", nowMs - 40 * 60_000, "image", "pola2.jpg", 1800, "image/jpeg");

  // 3 pasangan balasan pada 3 hari lalu (21:00 WIB): admin → user balas +35 dtk;
  // user → admin balas +90 dtk. Hanya hari lampau agar tidak ada timestamp masa depan.
  for (let k = 3; k >= 1; k -= 1) {
    const t0 = at(k, 14, 0);
    run(convId, "admin", `Pesan admin uji ${3 - k}: gimana kabarnya hari ini?`, t0, "text", null, null, null);
    run(convId, id, `Balasan uji ${3 - k}: alhamdulillah baik banget, lagi sibuk`, t0 + 35_000, "text", null, null, null);
    run(convId, id, `Follow up uji ${3 - k}: jangan lupa cek lampiran ya`, t0 + 120_000, "text", null, null, null);
    run(convId, "admin", `Balasan admin uji ${3 - k}: siap, langsung saya cek sekarang`, t0 + 210_000, "text", null, null, null);
  }

  const maxId = (db.query("SELECT MAX(id) m FROM messages").get() as { m: number }).m;
  db.run(
    "INSERT INTO reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?) ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id",
    [convId, id, maxId]
  );
  // 2 reaksi dari user pada 2 pesan admin terakhir.
  const adminIds = db
    .query("SELECT id FROM messages WHERE conversation_id = ? AND sender_id = 'admin' ORDER BY id DESC LIMIT 2")
    .all(convId) as Array<{ id: number }>;
  const rx = db.prepare("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)");
  rx.run(adminIds[0]?.id ?? maxId, id, "👍");
  rx.run(adminIds[1]?.id ?? maxId, id, "❤️");

  const c = db
    .query("SELECT COUNT(*) n FROM messages WHERE conversation_id = ?")
    .get(convId) as { n: number };
  out(`created user=${id} conv=${convId} messages=${c.n}`);
} else if (process.argv[2] === "cleanup") {
  const db = new Database(DB_PATH);
  const row = db.query("SELECT id FROM users WHERE name = ?").get(NAME) as { id: string } | undefined;
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
  out(`cleaned user=${row ? 1 : 0} convs=${convs}`);
} else {
  out("usage: bun .zscripts/t56-fixture.ts create|cleanup");
}
