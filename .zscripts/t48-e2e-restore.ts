/**
 * Cleanup E2E Task 48 — pulihkan data nyata setelah uji tombol destruktif:
 * 1) audit_log dari /tmp/t48-backup.json (tombol "Bersihkan log" menghapusnya)
 * 2) settings kunci aplikasi (tombol "Kembalikan default" membuka registrasi)
 * 3) kode undangan uji (label uji-t48e)
 * Pemakaian: bun .zscripts/t48-e2e-restore.ts
 */
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db");
const out = (s: string) => process.stdout.write(s + "\n");

const bak = await Bun.file("/tmp/t48-backup.json").json();

// 1) audit_log — pulihkan snapshot asli
db.run("DELETE FROM audit_log");
for (const r of bak.audit) {
  db.run("INSERT INTO audit_log (id, action, detail, at) VALUES (?, ?, ?, ?)", [
    r.id,
    r.action,
    r.detail,
    r.at,
  ]);
}
if (bak.seqAudit) {
  const seq = db.query("SELECT seq FROM sqlite_sequence WHERE name='audit_log'").get();
  if (seq) db.run("UPDATE sqlite_sequence SET seq = ? WHERE name = 'audit_log'", [bak.seqAudit.seq]);
  else db.run("INSERT INTO sqlite_sequence (name, seq) VALUES ('audit_log', ?)", [bak.seqAudit.seq]);
}

// 2) settings — pulihkan nilai asli (mis. allowRegistration='0')
for (const s of bak.settings) {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [s.key, s.value]);
}

// 3) kode undangan uji
db.run("DELETE FROM invite_codes WHERE label = 'uji-t48e'");

// verifikasi
const audit = (db.query("SELECT COUNT(*) AS c FROM audit_log").get()).c;
const reg = (db.query("SELECT value FROM settings WHERE key='allowRegistration'").get());
const inv = (db.query("SELECT COUNT(*) AS c FROM invite_codes").get()).c;
const users = (db.query("SELECT COUNT(*) AS c FROM users").get()).c;
const left = db.query("SELECT name FROM users WHERE name LIKE 'Uji%'").all();
out(`restore: audit=${audit} (target ${bak.audit.length}) · allowRegistration=${reg?.value} · invites=${inv} · users=${users} · sisa_uji=${JSON.stringify(left)}`);
