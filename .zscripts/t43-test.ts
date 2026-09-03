/**
 * Uji protokol v25 — Pusat Cheat (Task 43).
 * Setup data uji via bun:sqlite → uji socket admin:cheat_* → cleanup.
 * Jalankan: bun /home/z/.cache/t43/t43-test.ts
 */
import { Database } from "bun:sqlite";
import { io } from "socket.io-client";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const URL = "http://localhost:3003";
const now = () => Date.now();
const db = new Database(DB_PATH);

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

const emit = (sock: any, ev: string, data: unknown) =>
  new Promise<any>((res) => sock.emit(ev, data, (r: unknown) => res(r)));

// ---- setup data uji -------------------------------------------------
const uid = crypto.randomUUID();
const convId = crypto.randomUUID();
const NAME = "UjiCheat43";
db.run(
  "INSERT INTO users (id,name,role,created_at,last_seen_at) VALUES (?,?,?,?,?)",
  [uid, NAME, "user", now(), now()]
);
db.run(
  "INSERT INTO conversations (id,user_a_id,user_b_id,created_at,last_message_at) VALUES (?,?,?,?,?)",
  [convId, uid, "admin", now(), now()]
);
db.run(
  "INSERT INTO messages (conversation_id,sender_id,content,created_at,type) VALUES (?,?,?,?,?)",
  [convId, uid, "halo admin, ini pesan asli", now() - 60_000, "text"]
);
db.run(
  "INSERT INTO messages (conversation_id,sender_id,content,created_at,type) VALUES (?,?,?,?,?)",
  [convId, "admin", "hai, balasan asli admin", now() - 30_000, "text"]
);
console.log(`setup: user=${uid.slice(0, 8)} conv=${convId.slice(0, 8)}`);

// ---- uji socket ------------------------------------------------------
const sock = io(URL, { transports: ["websocket"], reconnection: false });
await new Promise((r) => sock.on("connect", r));
console.log("socket connected");

// 1. cheat_peek tanpa auth → ditolak
const noAuth = await emit(sock, "admin:cheat_peek", { userId: uid });
check("peek tanpa auth ditolak", noAuth?.ok === false, JSON.stringify(noAuth));

// 2. admin:auth
const auth = await emit(sock, "admin:auth", { password: "admin123" });
check("admin:auth ok", auth?.ok === true);

// 3. peek target admin sendiri → NOT_FOUND
const peekAdmin = await emit(sock, "admin:cheat_peek", { userId: "admin" });
check("peek target=admin ditolak", peekAdmin?.ok === false && peekAdmin?.error === "NOT_FOUND");

// 4. peek user uji → ok + cheatState
const peek = await emit(sock, "admin:cheat_peek", { userId: uid });
check(
  "peek user uji ok",
  peek?.ok === true && peek?.conversationId === convId && Array.isArray(peek?.messages),
  `messages=${peek?.messages?.length}`
);
check(
  "cheatState lengkap",
  typeof peek?.cheatState?.alwaysOnline === "boolean" &&
    typeof peek?.cheatState?.mirror === "boolean" &&
    typeof peek?.cheatState?.ghost === "boolean" &&
    typeof peek?.cheatState?.fakeLastSeen === "string"
);

// 5. spoof kirim sebagai user
const spoof = await emit(sock, "admin:cheat_send", {
  userId: uid,
  text: "pesan spoof dari pusat cheat",
});
check("cheat_send spoof ok", spoof?.ok === true && spoof?.message?.senderId === uid);

// 6. spoof backdate 5 hari
const back = await emit(sock, "admin:cheat_send", {
  userId: uid,
  text: "pesan backdate",
  createdAt: now() - 5 * 86_400_000,
});
check("cheat_send backdate ok", back?.ok === true);

// 7. spoof invalid (teks kosong) → INVALID_MESSAGE
const bad = await emit(sock, "admin:cheat_send", { userId: uid, text: "  " });
check("cheat_send kosong ditolak", bad?.ok === false && bad?.error === "INVALID_MESSAGE");

// 8. edit pesan milik user
const msgId = spoof?.message?.id as number;
const edit = await emit(sock, "admin:cheat_edit", {
  messageId: msgId,
  text: "pesan spoof SUDAH DIEDIT",
});
check("cheat_edit ok", edit?.ok === true);
const editedRow = db
  .query("SELECT content, edited_at, edit_history FROM messages WHERE id=?")
  .get(msgId) as any;
check(
  "DB berubah + edit_history",
  editedRow?.content === "pesan spoof SUDAH DIEDIT" && !!editedRow?.edit_history
);

// 9. reaksi sebagai user
const react = await emit(sock, "admin:cheat_react", {
  messageId: msgId,
  userId: uid,
  emoji: "👍",
});
check("cheat_react ok", react?.ok === true);
const reactRow = db
  .query("SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?")
  .get(msgId, uid) as any;
check("DB reaksi tersimpan", reactRow?.emoji === "👍");

// 10. ubah waktu pesan
const newTs = now() - 3 * 86_400_000;
const time = await emit(sock, "admin:cheat_time", { messageId: msgId, createdAt: newTs });
check("cheat_time ok", time?.ok === true);
const timeRow = db.query("SELECT created_at FROM messages WHERE id=?").get(msgId) as any;
check("DB created_at berganti", Math.abs(Number(timeRow?.created_at) - newTs) < 1500);

// 11. pesan muncul di peek terbaru
const peek2 = await emit(sock, "admin:cheat_peek", { userId: uid });
const found = (peek2?.messages ?? []).find((m: any) => m.id === msgId);
check(
  "peek memuat pesan spoof teredit",
  !!found &&
    found.content === "pesan spoof SUDAH DIEDIT" &&
    (found.reactions?.length ?? 0) > 0
);

sock.close();

// ---- cleanup ---------------------------------------------------------
db.run(
  "DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?)",
  [convId]
);
db.run("DELETE FROM messages WHERE conversation_id=?", [convId]);
db.run("DELETE FROM conversations WHERE id=?", [convId]);
db.run("DELETE FROM users WHERE id=?", [uid]);
const left = db.query("SELECT COUNT(*) c FROM users WHERE name=?").get(NAME) as any;
check("cleanup bersih", Number(left?.c) === 0);

console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
