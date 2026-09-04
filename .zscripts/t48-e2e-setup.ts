/**
 * Setup E2E Task 48 — buat akun uji + pesan + kode undangan,
 * dan BACKUP tabel yang terdampak tombol destruktif (audit_log,
 * invite_codes, settings kunci aplikasi) ke /tmp/t48-backup.json.
 * Pemakaian: bun .zscripts/t48-e2e-setup.ts
 */
import { Database } from "bun:sqlite";
import { io, Socket } from "socket.io-client";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const URL = "http://localhost:3003";
const db = new Database(DB_PATH);
const out = (s: string) => process.stdout.write(s + "\n");

const emit = (sock: Socket, ev: string, data: unknown) =>
  new Promise<any>((res) => sock.emit(ev, data, (r: unknown) => res(r)));
const connect = (): Promise<Socket> =>
  new Promise((res) => {
    const s = io(URL, { transports: ["websocket"] });
    s.on("connect", () => res(s));
  });

// ---- 1) backup tabel sensitif --------------------------------------------
const backup = {
  audit: db.query("SELECT id, action, detail, at FROM audit_log ORDER BY id").all(),
  invites: db.query("SELECT * FROM invite_codes ORDER BY code").all(),
  settings: db.query("SELECT key, value FROM settings ORDER BY key").all(),
  seqAudit: db.query("SELECT seq FROM sqlite_sequence WHERE name='audit_log'").get(),
};
await Bun.write("/tmp/t48-backup.json", JSON.stringify(backup));
out(`backup: audit=${backup.audit.length} invites=${backup.invites.length} settings=${backup.settings.length}`);

// ---- 2) akun uji + pesan + kode -------------------------------------------
const admin = await connect();
const auth = await emit(admin, "admin:auth", { password: "admin123" });
if (!auth?.ok) {
  out("FATAL: admin auth gagal");
  process.exit(1);
}
const prevReg = db.query("SELECT value FROM settings WHERE key = 'allowRegistration'").get() as
  | { value: string }
  | undefined;
await emit(admin, "admin:settings:set", { allowRegistration: true });

// hapus sisa akun uji sebelumnya bila ada
const old = db.query("SELECT id FROM users WHERE name = 'UjiHapus48'").get() as { id: string } | undefined;
if (old) {
  for (const cv of db.query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?").all(old.id, old.id) as { id: string }[]) {
    db.run("DELETE FROM messages WHERE conversation_id = ?", [cv.id]);
    db.run("DELETE FROM conversations WHERE id = ?", [cv.id]);
  }
  db.run("DELETE FROM devices WHERE user_id = ?", [old.id]);
  db.run("DELETE FROM users WHERE id = ?", [old.id]);
}

const mk = await emit(admin, "admin:invite_create", { count: 4, label: "uji-t48e" });
const reg = await emit(await connect(), "user:auth", {
  name: "UjiHapus48",
  password: "uji48",
  inviteCode: mk.created[0].code,
  deviceId: "dev-T48E-00001",
});
if (!reg?.ok) {
  out("FATAL: registrasi gagal " + JSON.stringify(reg));
  process.exit(1);
}
// 3 pesan admin agar riwayat terlihat di browser
for (const text of ["Halo! Ini pesan uji 1 🌿", "Pesan uji 2 — silakan dibintangi ⭐", "Pesan uji 3"]) {
  await emit(admin, "messages:send", { conversationId: reg.conversationId, content: text });
}
// pulihkan registrasi tertutup (default app nyata)
if (prevReg) db.run("UPDATE settings SET value = ? WHERE key = 'allowRegistration'", [prevReg.value]);
else db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowRegistration', '0')");

const inv = db.query("SELECT COUNT(*) AS c FROM invite_codes WHERE label = 'uji-t48e'").get() as { c: number };
out(`setup OK: UjiHapus48=${reg.user.id.slice(0, 8)} conv=${String(reg.conversationId).slice(0, 8)} kode_uji=${inv.c} (1 terpakai, 3 bebas)`);
process.exit(0);
