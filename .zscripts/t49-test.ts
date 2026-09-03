/**
 * Uji protokol v30 — Bersihkan chat kedua sisi KHUSUS ADMIN (Task 49).
 * Uji: conversation:clear (user) DIHAPUS dari protokol (tanpa ack),
 * admin:reset_conversation satu-satunya jalur (guard user UNAUTHORIZED,
 * reset berjalan + broadcast by:'admin' + pin lepas + audit), NOT_FOUND id
 * palsu, regresi messages:unstar_all masih hidup.
 * Jalankan: bun .zscripts/t49-test.ts
 */
import { Database } from "bun:sqlite";
import { io, Socket } from "socket.io-client";

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

const emit = (sock: Socket, ev: string, data: unknown) =>
  new Promise<any>((res) => sock.emit(ev, data, (r: unknown) => res(r)));

/** Emit dengan timeout — mengembalikan TIMEOUT bila ack tidak pernah dipanggil
 * (tanda handler event sudah DIHAPUS dari server). */
const TIMEOUT = Symbol("timeout");
const emitTimeout = (sock: Socket, ev: string, data: unknown, ms = 900) =>
  new Promise<any>((res) => {
    const t = setTimeout(() => res(TIMEOUT), ms);
    sock.emit(ev, data, (r: unknown) => {
      clearTimeout(t);
      res(r);
    });
  });

const connect = (): Promise<Socket> =>
  new Promise((res) => {
    const s = io(URL, { transports: ["websocket"] });
    s.on("connect", () => res(s));
  });

const waitEvent = (sock: Socket, ev: string, ms = 4000): Promise<any> =>
  new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    sock.once(ev, (p: unknown) => {
      clearTimeout(t);
      res(p);
    });
  });

// ---- setup --------------------------------------------------------------
const adminSock = await connect();
const auth = await emit(adminSock, "admin:auth", { password: "admin123" });
check("admin auth", auth?.ok === true);

const prevReg = db.query("SELECT value FROM settings WHERE key = 'allowRegistration'").get() as
  | { value: string }
  | undefined;
await emit(adminSock, "admin:settings:set", { allowRegistration: true });

const mk = await emit(adminSock, "admin:invite_create", { count: 1, label: "uji-t49" });
check("buat kode uji", mk?.ok === true && mk.created.length === 1);

const uSock = await connect();
const reg = await emit(uSock, "user:auth", {
  name: "UjiAdmin49",
  password: "uji49",
  inviteCode: mk.created[0].code,
  deviceId: "dev-T49-000001",
});
check("registrasi UjiAdmin49 → ok", reg?.ok === true, JSON.stringify(reg?.error));
const convId = reg.conversationId as string;

// ---- 1) conversation:clear DIHAPUS dari protokol -------------------------
const r1 = await emitTimeout(uSock, "conversation:clear", {});
check("conversation:clear user → TIDAK ada ack (handler dihapus)", r1 === TIMEOUT);
const r2 = await emitTimeout(adminSock, "conversation:clear", {});
check("conversation:clear dari socket admin → juga TIDAK ada ack", r2 === TIMEOUT);

// ---- 2) guard: reset percakapan ditolak untuk user ------------------------
const g1 = await emit(uSock, "admin:reset_conversation", { conversationId: convId });
check("admin:reset_conversation oleh user → UNAUTHORIZED", g1?.error === "UNAUTHORIZED");
const anon = await connect();
const g2 = await emit(anon, "admin:reset_conversation", { conversationId: convId });
check("admin:reset_conversation anonim → UNAUTHORIZED", g2?.error === "UNAUTHORIZED");

// ---- 3) isi 3 pesan + pin -------------------------------------------------
const m1 = await emit(uSock, "messages:send", { conversationId: convId, content: "t49 pesan A" });
const m2 = await emit(adminSock, "messages:send", { conversationId: convId, content: "t49 pesan B" });
const m3 = await emit(uSock, "messages:send", { conversationId: convId, content: "t49 pesan C" });
check("3 pesan terkirim", [m1, m2, m3].every((r) => r?.ok === true));

const pin = await emit(adminSock, "admin:pin", { messageId: m2.message.id });
check("admin pin pesan", pin?.ok === true);

// ---- 4) admin:reset_conversation = satu-satunya jalur pembersihan ---------
const resetEvtPromise = waitEvent(uSock, "conversation:reset");
const rst = await emit(adminSock, "admin:reset_conversation", { conversationId: convId });
check("admin reset percakapan → deleted=3", rst?.ok === true && rst.deleted === 3, JSON.stringify(rst));

const evt = await resetEvtPromise;
check(
  "broadcast conversation:reset ke user (by=admin)",
  !!evt && evt.by === "admin" && evt.byName === "Admin" && evt.conversationId === convId,
  JSON.stringify(evt ? { by: evt.by, byName: evt.byName } : null)
);

const tomb = db
  .query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND deleted_at IS NOT NULL")
  .get(convId) as { n: number };
check("3 pesan jadi tombstone (forensik utuh)", tomb.n === 3);

const conv = db.query("SELECT pinned_message_id FROM conversations WHERE id = ?").get(convId) as
  | { pinned_message_id: number | null }
  | undefined;
check("pin dilepas setelah reset", conv?.pinned_message_id == null);

const aud = db
  .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'reset_conversation' AND detail LIKE ?")
  .get(`${convId.slice(0, 8)}%`) as { n: number };
check("audit reset_conversation tercatat", aud.n >= 1);

// ---- 5) id palsu → NOT_FOUND ----------------------------------------------
const nf = await emit(adminSock, "admin:reset_conversation", { conversationId: "tidak-ada" });
check("reset percakapan id palsu → NOT_FOUND", nf?.error === "NOT_FOUND");

// ---- 6) regresi: event v29 lain tetap hidup --------------------------------
const ua = await emit(uSock, "messages:unstar_all", {});
check("regresi messages:unstar_all tetap hidup", ua?.ok === true && ua.cleared === 0, JSON.stringify(ua));

// ---- cleanup ---------------------------------------------------------------
uSock.disconnect();
adminSock.disconnect();
anon.disconnect();

db.run("DELETE FROM messages WHERE conversation_id = ?", [convId]);
db.run(
  "DELETE FROM conversations WHERE user_a_id = (SELECT id FROM users WHERE name = 'UjiAdmin49') OR user_b_id = (SELECT id FROM users WHERE name = 'UjiAdmin49')"
);
db.run("DELETE FROM push_subscriptions WHERE user_id = (SELECT id FROM users WHERE name = 'UjiAdmin49')");
db.run("DELETE FROM devices WHERE user_id = (SELECT id FROM users WHERE name = 'UjiAdmin49')");
db.run("DELETE FROM users WHERE name = 'UjiAdmin49'");
db.run("DELETE FROM invite_codes WHERE label = 'uji-t49'");
db.run("DELETE FROM audit_log WHERE detail LIKE '%uji-t49%'");
db.run("DELETE FROM audit_log WHERE action = 'reset_conversation' AND detail LIKE ?", [`${convId.slice(0, 8)}%`]);
if (prevReg) {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowRegistration', ?)", [prevReg.value]);
} else {
  db.run("DELETE FROM settings WHERE key = 'allowRegistration'");
}
console.log("cleanup: data uji dihapus, allowRegistration dipulihkan");

console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.stdout.write("");
process.exit(fail === 0 ? 0 : 1);
