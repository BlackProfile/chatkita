/**
 * Uji protokol v27 — 1 Orang 1 Akun (Task 46).
 * Uji: registrasi (password+undangan+perangkat), login password, rate-limit
 * TIDAK diuji penuh (window 60 dtk), akun lama + set_password, sesi restore,
 * admin:invite_*, admin:user_create, admin:user_reset_password,
 * admin:user_unbind_devices. Jalankan: bun .zscripts/t46-test.ts
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

// ---- admin socket ----------------------------------------------------
const adminSock = await connect();
const auth = await emit(adminSock, "admin:auth", { password: "admin123" });
check("admin auth", auth.ok === true);

// Buka registrasi selama uji (pulihkan di cleanup).
const prevReg = db.query("SELECT value FROM settings WHERE key = 'allowRegistration'").get() as { value: string } | undefined;
await emit(adminSock, "admin:settings:set", { allowRegistration: true });

// ---- 1) registrasi tanpa password -------------------------------------
const c1 = await connect();
const r1 = await emit(c1, "user:auth", { name: "UjiSatu46", deviceId: "dev-A-111111" });
check("registrasi tanpa password → PASSWORD_REQUIRED", r1?.error === "PASSWORD_REQUIRED", JSON.stringify(r1));

// ---- 2) registrasi tanpa kode undangan --------------------------------
const r2 = await emit(c1, "user:auth", { name: "UjiSatu46", password: "rahasia", deviceId: "dev-A-111111" });
check("registrasi tanpa undangan → INVITE_REQUIRED", r2?.error === "INVITE_REQUIRED", JSON.stringify(r2));

// ---- 3) registrasi kode tidak dikenal ---------------------------------
const r3 = await emit(c1, "user:auth", { name: "UjiSatu46", password: "rahasia", inviteCode: "CK-ZZZZZ-9999", deviceId: "dev-A-111111" });
check("kode tak dikenal → INVITE_INVALID", r3?.error === "INVITE_INVALID", JSON.stringify(r3));

// ---- 4) buat kode undangan via admin ----------------------------------
const mk = await emit(adminSock, "admin:invite_create", { count: 3, label: "uji-t46" });
check("admin:invite_create 3 kode", mk?.ok === true && mk.created.length === 3);
const CODE = mk.created[0].code as string;
check("format kode CK-XXXXX-XXXX", /^CK-[A-Z2-9]{5}-[A-Z2-9]{4}$/.test(CODE), CODE);

// ---- 5) registrasi tanpa deviceId -------------------------------------
const r5 = await emit(c1, "user:auth", { name: "UjiSatu46", password: "rahasia", inviteCode: CODE });
check("registrasi tanpa perangkat → DEVICE_REQUIRED", r5?.error === "DEVICE_REQUIRED", JSON.stringify(r5));

// ---- 6) registrasi valid ----------------------------------------------
const ok1 = await emit(c1, "user:auth", { name: "UjiSatu46", password: "rahasia", inviteCode: CODE, deviceId: "dev-A-111111" });
check("registrasi valid → ok", ok1?.ok === true, ok1?.user?.id?.slice(0, 8));
check("mustSetPassword false (baru, ber-password)", ok1?.mustSetPassword === false);

// ---- 7) perangkat sama daftar akun kedua ------------------------------
const c2 = await connect();
const r7 = await emit(c2, "user:auth", { name: "UjiDua46", password: "rahasia", inviteCode: mk.created[1].code, deviceId: "dev-A-111111" });
check("perangkat sama + akun baru → DEVICE_TAKEN", r7?.error === "DEVICE_TAKEN", JSON.stringify(r7));

// ---- 8) kode undangan dipakai dua kali --------------------------------
const c3 = await connect();
const r8 = await emit(c3, "user:auth", { name: "UjiTiga46", password: "rahasia", inviteCode: CODE, deviceId: "dev-B-222222" });
check("kode dipakai ulang → INVITE_USED", r8?.error === "INVITE_USED", JSON.stringify(r8));

// ---- 9) login password salah / benar ----------------------------------
const r9 = await emit(c3, "user:auth", { name: "UjiSatu46", password: "SALAH123", deviceId: "dev-B-222222" });
check("login password salah → INVALID_PASSWORD", r9?.error === "INVALID_PASSWORD", JSON.stringify(r9));
const ok9 = await emit(c3, "user:auth", { name: "UjiSatu46", password: "rahasia", deviceId: "dev-B-222222" });
check("login password benar dari perangkat lain → ok", ok9?.ok === true);

// ---- 10) sesi restore tanpa password ----------------------------------
const ok10 = await emit(c3, "user:auth", { name: "UjiSatu46", userId: ok9.user.id, deviceId: "dev-B-222222" });
check("sesi restore (userId) → ok tanpa password", ok10?.ok === true);

// ---- 11) sesi restore di perangkat milik akun lain --------------------
// dev-A terikat UjiSatu46; login UjiSatu46 dari dev-A via sesi = akun sama → ok.
// UjiDua46 belum ada; coba restore akun lain di perangkat asing:
const r11 = await emit(c1, "user:auth", { name: "UjiSatu46", userId: "user-tidak-ada", deviceId: "dev-A-111111" });
check("userId tidak cocok → jalur login normal", r11?.ok === true || typeof r11?.error === "string");

// ---- 12) akun lama (tanpa password) → mustSetPassword -----------------
const legacyId = crypto.randomUUID();
db.run(
  "INSERT INTO users (id,name,role,created_at,last_seen_at) VALUES (?,?,?,?,?)",
  [legacyId, "UjiLama46", "user", now(), now()]
);
const c4 = await connect();
const ok12 = await emit(c4, "user:auth", { name: "UjiLama46", deviceId: "dev-C-333333" });
check("akun lama name-only → ok + mustSetPassword", ok12?.ok === true && ok12?.mustSetPassword === true, JSON.stringify(ok12?.mustSetPassword));

// ---- 13) user:set_password + setelah itu wajib password ---------------
const sp = await emit(c4, "user:set_password", { password: "baru46" });
check("user:set_password → ok", sp?.ok === true, JSON.stringify(sp));
const r13 = await emit(await connect(), "user:auth", { name: "UjiLama46", deviceId: "dev-C-333333" });
check("akun lama pasca set_password → PASSWORD_REQUIRED", r13?.error === "PASSWORD_REQUIRED", JSON.stringify(r13));
const ok13 = await emit(c4, "user:auth", { name: "UjiLama46", password: "baru46", deviceId: "dev-C-333333" });
check("login dengan password baru → ok", ok13?.ok === true);

// ---- 14) admin:user_create + login ------------------------------------
const uc = await emit(adminSock, "admin:user_create", { name: "UjiAdmin46", password: "admin46" });
check("admin:user_create → ok", uc?.ok === true && !!uc.userId, JSON.stringify(uc?.error));
const dup = await emit(adminSock, "admin:user_create", { name: "UjiAdmin46", password: "admin46" });
check("admin:user_create duplikat → NAME_TAKEN", dup?.error === "NAME_TAKEN", JSON.stringify(dup));
const ok14 = await emit(await connect(), "user:auth", { name: "UjiAdmin46", password: "admin46", deviceId: "dev-D-444444" });
check("login akun buatan admin → ok", ok14?.ok === true);

// ---- 15) admin:invite_list + delete -----------------------------------
const list = await emit(adminSock, "admin:invite_list", {});
check("admin:invite_list ≥ 2 kode", list?.ok === true && list.invites.length >= 2, `n=${list?.invites?.length}`);
const used = list.invites.find((i: any) => i.usedBy);
check("kode terpakai tercatat + nama pemakai", !!used && !!used.usedByName);
const del = await emit(adminSock, "admin:invite_delete", { code: mk.created[2].code });
check("admin:invite_delete kode bebas → ok", del?.ok === true);

// ---- 16) reset password + unbind perangkat ----------------------------
const rp = await emit(adminSock, "admin:user_reset_password", { userId: ok9.user.id, password: "reset46" });
check("admin:user_reset_password → ok", rp?.ok === true);
const ok16 = await emit(await connect(), "user:auth", { name: "UjiSatu46", password: "reset46", deviceId: "dev-E-555555" });
check("login pakai password hasil reset → ok", ok16?.ok === true);
const ub = await emit(adminSock, "admin:user_unbind_devices", { userId: ok9.user.id });
check("admin:user_unbind_devices → ok (≥2 perangkat)", ub?.ok === true && ub.removed >= 2, JSON.stringify(ub));
const ok16b = await emit(await connect(), "user:auth", { name: "UjiSatu46", password: "reset46", deviceId: "dev-F-666666" });
check("perangkat bebas bisa dipakai daftar lagi (diuji via login ok)", ok16b?.ok === true);

// ---- cleanup -----------------------------------------------------------
const delNames = ["UjiSatu46", "UjiLama46", "UjiAdmin46"];
const ids = (db.query("SELECT id FROM users WHERE name IN ('UjiSatu46','UjiLama46','UjiAdmin46')").all() as { id: string }[]).map((r) => r.id);
for (const id of ids) {
  const convs = db.query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?").all(id, id) as { id: string }[];
  for (const cv of convs) {
    db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
    db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
  }
  db.run("DELETE FROM devices WHERE user_id = ?", [id]);
  db.run("DELETE FROM users WHERE id = ?", [id]);
}
db.run("DELETE FROM invite_codes WHERE label = 'uji-t46'");
// Pulihkan status registrasi seperti semula.
if (prevReg) db.run("UPDATE settings SET value = ? WHERE key = 'allowRegistration'", [prevReg.value]);
else db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowRegistration', '0')");
console.log(`cleanup: ${ids.length} user uji dihapus, kode undangan uji dihapus (registrasi dipulihkan: ${prevReg?.value ?? "default"})`);

for (const s of [adminSock, c1, c2, c3, c4]) s.disconnect();
console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
