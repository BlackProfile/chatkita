/**
 * Uji protokol v28 — sembunyikan kode undangan utk akun lama (Task 47).
 * Uji: public:check_name (ada/tidak, case-insensitive, reserved Admin,
 * trim, panjang, tipe salah) + alur nyata registrasi → nama terdeteksi ada.
 * Jalankan: bun .zscripts/t47-test.ts
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

const sock = await connect();

// ---- 1) nama akun lama (sudah ada di DB) -------------------------------
const r1 = await emit(sock, "public:check_name", { name: "KIANI" });
check("nama akun lama → exists:true", r1?.ok === true && r1.exists === true, JSON.stringify(r1));

// ---- 2) case-insensitive -----------------------------------------------
const r2 = await emit(sock, "public:check_name", { name: "kiani" });
check("case-insensitive (kiani) → exists:true", r2?.exists === true);

// ---- 3) spasi di trim dulu ----------------------------------------------
const r3 = await emit(sock, "public:check_name", { name: "  KIANI  " });
check("spasi di-trim → exists:true", r3?.exists === true);

// ---- 4) reserved "Admin" → exists --------------------------------------
const r4 = await emit(sock, "public:check_name", { name: "admin" });
check("reserved admin → exists:true", r4?.exists === true);

// ---- 5) nama belum terdaftar --------------------------------------------
const r5 = await emit(sock, "public:check_name", { name: "BelumAdaAkun47" });
check("nama baru → exists:false", r5?.ok === true && r5.exists === false, JSON.stringify(r5));

// ---- 6) nama kosong ------------------------------------------------------
const r6 = await emit(sock, "public:check_name", { name: "" });
check("nama kosong → exists:false", r6?.exists === false);

// ---- 7) bukan string ------------------------------------------------------
const r7 = await emit(sock, "public:check_name", { name: 123 });
check("bukan string → exists:false", r7?.exists === false);

// ---- 8) lebih panjang dari MAX_NAME_LENGTH ------------------------------
const r8 = await emit(sock, "public:check_name", { name: "x".repeat(41) });
check("nama >40 karakter → exists:false", r8?.exists === false);

// ---- 9) alur nyata: registrasi → nama jadi exists -----------------------
const adminSock = await connect();
const auth = await emit(adminSock, "admin:auth", { password: "admin123" });
check("admin auth", auth?.ok === true);

const prevReg = db.query("SELECT value FROM settings WHERE key = 'allowRegistration'").get() as { value: string } | undefined;
await emit(adminSock, "admin:settings:set", { allowRegistration: true });

const mk = await emit(adminSock, "admin:invite_create", { count: 1, label: "uji-t47" });
const CODE = mk.created[0].code as string;
const reg = await emit(await connect(), "user:auth", {
  name: "UjiCek47",
  password: "uji47",
  inviteCode: CODE,
  deviceId: "dev-T47-000001",
});
check("registrasi UjiCek47 → ok", reg?.ok === true, JSON.stringify(reg?.error));

const r9 = await emit(sock, "public:check_name", { name: "ujicek47" });
check("pasca-registrasi (ujicek47) → exists:true", r9?.exists === true);

// ---- cleanup --------------------------------------------------------------
const ids = (db.query("SELECT id FROM users WHERE name = 'UjiCek47'").all() as { id: string }[]).map((r) => r.id);
for (const id of ids) {
  const convs = db.query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?").all(id, id) as { id: string }[];
  for (const cv of convs) {
    db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
    db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
  }
  db.run("DELETE FROM devices WHERE user_id = ?", [id]);
  db.run("DELETE FROM users WHERE id = ?", [id]);
}
db.run("DELETE FROM invite_codes WHERE label = 'uji-t47'");
if (prevReg) db.run("UPDATE settings SET value = ? WHERE key = 'allowRegistration'", [prevReg.value]);
else db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowRegistration', '0')");
console.log(`cleanup: ${ids.length} user uji dihapus, kode uji dihapus (registrasi dipulihkan: ${prevReg?.value ?? "default"})`);

for (const s of [sock, adminSock]) s.disconnect();
console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
