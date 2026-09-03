/**
 * Uji protokol v29 — Reset & hapus menyeluruh (Task 48).
 * Uji: conversation:clear (user), messages:unstar_all (per-user),
 * messages:schedule_cancel_all, admin:user_delete (kaskade penuh),
 * admin:invites_clear_unused, admin:audit_clear, admin:settings:reset,
 * plus semua guard UNAUTHORIZED. Jalankan: bun .zscripts/t48-test.ts
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

const mk = await emit(adminSock, "admin:invite_create", { count: 4, label: "uji-t48" });
check("buat 4 kode uji", mk?.ok === true && mk.created.length === 4);

const uSock = await connect();
const reg = await emit(uSock, "user:auth", {
  name: "UjiReset48",
  password: "uji48",
  inviteCode: mk.created[0].code,
  deviceId: "dev-T48-000001",
});
check("registrasi UjiReset48 → ok", reg?.ok === true, JSON.stringify(reg?.error));
const uid = reg.user.id as string;
const convId = reg.conversationId as string;

// ---- 1) guard UNAUTHORIZED ----------------------------------------------
const anon = await connect();
const g1 = await emit(anon, "conversation:clear", {});
check("conversation:clear tanpa auth → UNAUTHORIZED", g1?.error === "UNAUTHORIZED");
const g2 = await emit(anon, "messages:unstar_all", {});
check("messages:unstar_all tanpa auth → UNAUTHORIZED", g2?.error === "UNAUTHORIZED");
const g3 = await emit(anon, "messages:schedule_cancel_all", {});
check("messages:schedule_cancel_all tanpa auth → UNAUTHORIZED", g3?.error === "UNAUTHORIZED");
const g4 = await emit(anon, "admin:user_delete", { userId: uid });
check("admin:user_delete tanpa auth → UNAUTHORIZED", g4?.error === "UNAUTHORIZED");
const g5 = await emit(anon, "admin:audit_clear", {});
check("admin:audit_clear tanpa auth → UNAUTHORIZED", g5?.error === "UNAUTHORIZED");
const g6 = await emit(anon, "admin:settings:reset", {});
check("admin:settings:reset tanpa auth → UNAUTHORIZED", g6?.error === "UNAUTHORIZED");
const g7 = await emit(anon, "admin:invites_clear_unused", {});
check("admin:invites_clear_unused tanpa auth → UNAUTHORIZED", g7?.error === "UNAUTHORIZED");

// ---- 2) isi data: 4 pesan teks + bintang + 2 terjadwal + pin -------------
const m1 = await emit(uSock, "messages:send", { conversationId: convId, content: "pesan user 1" });
const m2 = await emit(adminSock, "messages:send", { conversationId: convId, content: "pesan admin 1" });
const m3 = await emit(uSock, "messages:send", { conversationId: convId, content: "pesan user 2" });
const m4 = await emit(adminSock, "messages:send", { conversationId: convId, content: "pesan admin 2" });
check("4 pesan teks terkirim", [m1, m2, m3, m4].every((r) => r?.ok === true));

await emit(uSock, "messages:star", { messageId: m1.message.id });
await emit(uSock, "messages:star", { messageId: m2.message.id });
await emit(adminSock, "messages:star", { messageId: m2.message.id });
const starredList = await emit(uSock, "messages:starred", { conversationId: convId });
check("user punya 2 bintang", starredList?.ok === true && starredList.messages.length === 2);

const sched1 = now() + 60 * 60_000;
const sched2 = now() + 2 * 60 * 60_000;
const s1 = await emit(uSock, "messages:send", { conversationId: convId, content: "jadwal A", scheduledAt: sched1 });
const s2 = await emit(uSock, "messages:send", { conversationId: convId, content: "jadwal B", scheduledAt: sched2 });
check("2 pesan terjadwal dibuat", s1?.ok === true && s2?.ok === true);

const pin = await emit(adminSock, "admin:pin", { messageId: m4.message.id });
check("admin pin pesan", pin?.ok === true);

// ---- 3) messages:unstar_all (bintang admin tidak tersentuh) --------------
const resetEvtPromise = waitEvent(adminSock, "message:updated");
const ua = await emit(uSock, "messages:unstar_all", {});
check("messages:unstar_all → cleared=2", ua?.ok === true && ua.cleared === 2, JSON.stringify(ua));
const starredAfter = await emit(uSock, "messages:starred", { conversationId: convId });
check("bintang user habis", starredAfter?.messages.length === 0);
const adminStarKept = db
  .query("SELECT starred_by FROM messages WHERE id = ?")
  .get(m2.message.id) as { starred_by: string | null };
check("bintang admin di pesan yang sama tetap ada", (adminStarKept?.starred_by ?? "").includes("admin"));
const updEvt = await resetEvtPromise;
check("broadcast message:updated starredBy terkirim", !!updEvt && Array.isArray(updEvt.starredBy));

// ---- 4) conversation:clear (user membersihkan chat sendiri) --------------
const resetPromise = waitEvent(adminSock, "conversation:reset");
const cc = await emit(uSock, "conversation:clear", {});
check("conversation:clear → cleared=6 (4 teks + 2 terjadwal)", cc?.ok === true && cc.cleared === 6, JSON.stringify(cc));
const resetEvt = await resetPromise;
check(
  "broadcast conversation:reset by=user byName=UjiReset48",
  resetEvt?.by === "user" && resetEvt?.byName === "UjiReset48" && resetEvt?.deleted === 6,
  JSON.stringify({ by: resetEvt?.by, deleted: resetEvt?.deleted })
);
const pinRow = db.query("SELECT pinned_message_id FROM conversations WHERE id = ?").get(convId) as {
  pinned_message_id: number | null;
};
check("pin lepas setelah clear", pinRow?.pinned_message_id === null);
const delCount = db.query("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND deleted_at IS NOT NULL").get(convId) as { c: number };
check("semua pesan jadi tombstone (forensik aman)", delCount.c === 6);

// ---- 5) messages:schedule_cancel_all --------------------------------------
const sc = await emit(uSock, "messages:schedule_cancel_all", {});
check("schedule_cancel_all → cancelled=2", sc?.ok === true && sc.cancelled === 2, JSON.stringify(sc));
const schedLeft = db
  .query("SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? AND scheduled_at IS NOT NULL AND delivered_at IS NULL")
  .get(uid) as { c: number };
check("tidak ada terjadwal tersisa", schedLeft.c === 0);
const sc2 = await emit(uSock, "messages:schedule_cancel_all", {});
check("schedule_cancel_all kedua → cancelled=0", sc2?.cancelled === 0);

// ---- 6) admin:invites_clear_unused ----------------------------------------
const ic = await emit(adminSock, "admin:invites_clear_unused", {});
const usedLeft = db.query("SELECT COUNT(*) AS c FROM invite_codes WHERE used_by IS NOT NULL").get() as { c: number };
const freeLeft = db.query("SELECT COUNT(*) AS c FROM invite_codes WHERE used_by IS NULL").get() as { c: number };
check(
  "invites_clear_unused: kode terpakai utuh, bebas habis",
  ic?.ok === true && usedLeft.c === 1 && freeLeft.c === 0,
  `used=${usedLeft.c} free=${freeLeft.c}`
);

// ---- 7) admin:settings:reset ----------------------------------------------
await emit(adminSock, "admin:settings:set", { appName: "UjiApp48", maxMessageLength: 555 });
const sr = await emit(adminSock, "admin:settings:reset", {});
check(
  "settings:reset → appName default + maxLen default",
  sr?.ok === true && sr.settings.appName === "ChatKita" && sr.settings.maxMessageLength === 1000,
  JSON.stringify({ appName: sr?.settings?.appName })
);
const pwKey = db
  .query("SELECT key FROM settings WHERE key LIKE '%password%' OR key LIKE 'vapid%'")
  .all() as { key: string }[];
check("kunci password/vapid tidak ikut terhapus", pwKey.length >= 1, JSON.stringify(pwKey.map((k) => k.key)));
const auth2 = await emit(await connect(), "admin:auth", { password: "admin123" });
check("login admin masih bekerja pasca reset settings", auth2?.ok === true);

// ---- 8) admin:audit_clear ---------------------------------------------------
const ac = await emit(adminSock, "admin:audit_clear", {});
check("audit_clear → removed ≥ 5", ac?.ok === true && ac.removed >= 5, JSON.stringify(ac?.removed));
const auditAfter = await emit(adminSock, "admin:audit", { limit: 50 });
check(
  "audit tersisa hanya entri audit_clear",
  auditAfter?.ok === true && auditAfter.items.length === 1 && auditAfter.items[0].action === "audit_clear",
  JSON.stringify(auditAfter?.items)
);

// ---- 9) admin:user_delete (kaskade penuh) -----------------------------------
const delAdmin = await emit(adminSock, "admin:user_delete", { userId: "admin" });
check("hapus akun admin → ditolak NOT_FOUND", delAdmin?.error === "NOT_FOUND");

const uDisconnect = new Promise<string>((res) => uSock.once("disconnect", (r) => res(String(r))));
const ud = await emit(adminSock, "admin:user_delete", { userId: uid });
check(
  "admin:user_delete → ok (4 pesan tersisa, 1 percakapan)",
  ud?.ok === true && ud.deletedMessages === 4 && ud.conversations === 1,
  JSON.stringify(ud)
);
const goneUser = (db.query("SELECT COUNT(*) AS c FROM users WHERE id = ?").get(uid) as { c: number }).c;
const goneConv = (db.query("SELECT COUNT(*) AS c FROM conversations WHERE id = ?").get(convId) as { c: number }).c;
const goneMsg = (db.query("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(convId) as { c: number }).c;
const goneDev = (db.query("SELECT COUNT(*) AS c FROM devices WHERE user_id = ?").get(uid) as { c: number }).c;
const gonePush = (db.query("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?").get(uid) as { c: number }).c;
check("users/conversations/messages/devices/push semuanya terhapus", !goneUser && !goneConv && !goneMsg && !goneDev && !gonePush, `u=${goneUser} c=${goneConv} m=${goneMsg} d=${goneDev} p=${gonePush}`);
const discReason = await Promise.race([uDisconnect, new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
check("socket user langsung diputus server", discReason !== "timeout", String(discReason));
const auditFinal = await emit(adminSock, "admin:audit", { limit: 10 });
check(
  "audit mencatat user_delete",
  auditFinal?.items?.some((i: any) => i.action === "user_delete" && i.detail.includes("UjiReset48"))
);

// ---- cleanup ----------------------------------------------------------------
db.run("DELETE FROM invite_codes WHERE label = 'uji-t48'");
if (prevReg) db.run("UPDATE settings SET value = ? WHERE key = 'allowRegistration'", [prevReg.value]);
else db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowRegistration', '0')");
console.log("cleanup: kode uji dihapus, registrasi dipulihkan (audit dibiarkan berisi entri uji — admin bisa bersihkan dari UI)");

for (const s of [adminSock, uSock, anon]) s.disconnect();
console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
