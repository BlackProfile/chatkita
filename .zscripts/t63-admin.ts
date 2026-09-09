/**
 * Task 63 — listener ADMIN (socket.io) utk E2E v47 sisi admin:
 *  t+1s  : admin:account_set — nyalakan SELURUH matriks cheat lab II
 *  t+26s : kirim pesan admin (untuk dihapus → uji ghost)
 *  t+31s : admin hapus pesannya sendiri (tombstone → message:ghost ke user)
 * Listener: message:new (timing delay), read:update (harus NOL dari user —
 * freezeChecks), user:toast (alarmAdmin), message:updated (tombstone).
 * Jalankan: bun .zscripts/t63-admin.ts  (log → stdout, 50 dtk)
 */
import { io } from "socket.io-client";
import { Database } from "bun:sqlite";

const log: string[] = [];
const t0 = Date.now();
const out = (s: string) => {
  const line = `[${String(Math.round((Date.now() - t0) / 1000)).padStart(3, "0")}s] ${s}`;
  log.push(line);
  process.stdout.write(line + "\n");
};

const db = new Database(
  "/home/z/my-project/mini-services/chat-service/chat.db",
  { readonly: true }
);
const target = db.query("SELECT id FROM users WHERE name LIKE 'UjiBrowser63%'").get() as
  | { id: string }
  | undefined;
db.close();
if (!target) {
  out("GAGAL: fixture UjiBrowser63 tidak ada — jalankan t63-fixture create");
  process.exit(1);
}
out(`target=${target.id}`);

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  out("connected");
  socket.emit("admin:auth", { password: "admin123" }, (res: { ok: boolean }) => {
    out(`auth ok=${res.ok}`);
  });
});

let readUpdateCount = 0;
socket.on("read:update", (p: { userId: string; lastReadMessageId: number }) => {
  readUpdateCount++;
  out(`read:update dari=${p.userId} upTo=${p.lastReadMessageId}`);
});

socket.on("user:toast", (p: { title: string; body: string }) => {
  out(`user:toast (ALARM) "${p.title}" — "${(p.body ?? "").slice(0, 60)}"`);
});

socket.on(
  "message:new",
  (m: { id: number; senderId: string; content: string }) => {
    out(
      `message:new #${m.id} dari=${m.senderId === "admin" ? "ADMIN" : "USER"} "${m.content.slice(0, 40)}"`
    );
  }
);

socket.on("message:updated", (m: { id: number; deletedAt?: string | null }) => {
  out(`message:updated #${m.id} deletedAt=${m.deletedAt ?? "(isi)"}`);
});

// t+1s — nyalakan seluruh matriks cheat.
setTimeout(() => {
  socket.emit(
    "admin:account_set",
    {
      userId: target.id,
      patch: {
        antiDelete: true,
        freezeChecks: true,
        fakeReads: true,
        lockDelete: true,
        lockEdit: true,
        alarmAdmin: true,
        alwaysOffline: true,
        delayMs: 3000,
        multiplier: 2,
        textMutator: "upper",
        selfDestructSec: 10,
      },
    },
    (res: { ok: boolean; touched?: string[]; flags?: Record<string, unknown> }) => {
      out(
        `account_set ok=${res.ok} touched=${(res.touched ?? []).join("+")} flags=${JSON.stringify(res.flags ?? {})}`
      );
    }
  );
}, 1000);

// t+26s — admin kirim pesan (akan dihapus → uji ghost).
let adminMsgId = 0;
setTimeout(() => {
  socket.emit(
    "messages:send",
    { conversationId: target.id, content: "Pesan admin untuk dihapus t63", type: "text" },
    (ack: { ok: boolean; message?: { id: number } }) => {
      adminMsgId = ack.message?.id ?? 0;
      out(`kirim-admin ack ok=${ack.ok} id=${adminMsgId}`);
    }
  );
}, 26_000);

// t+31s — admin hapus pesannya sendiri → ghost ke user (antiDelete).
setTimeout(() => {
  if (!adminMsgId) {
    out("hapus-admin GAGAL: id pesan admin tidak ada");
    return;
  }
  socket.emit("messages:delete", { messageId: adminMsgId }, (ack: { ok: boolean }) => {
    out(`hapus-admin ack ok=${ack.ok}`);
  });
}, 31_000);

setTimeout(() => {
  out(`SELESAI — read:update diterima total=${readUpdateCount} (harus 0 = freezeChecks bekerja)`);
  process.exit(0);
}, 50_000);
