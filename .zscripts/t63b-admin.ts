/**
 * Task 63b — listener ADMIN (lanjutan terarah): kirim pesan lalu hapus
 * pesannya sendiri → user (antiDelete) harus menerima message:ghost.
 * Jalankan: bun .zscripts/t63b-admin.ts (20 dtk)
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
const row = db
  .query(
    "SELECT c.id AS conv FROM conversations c JOIN users u ON u.id = CASE WHEN c.user_a_id = 'admin' THEN c.user_b_id ELSE c.user_a_id END WHERE u.name LIKE 'UjiBrowser63%'"
  )
  .get() as { conv: string } | undefined;
db.close();
if (!row) {
  out("GAGAL: conv fixture tidak ada");
  process.exit(1);
}
const convId = row.conv;
out(`conv=${convId}`);

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

let adminMsgId = 0;
socket.on("message:new", (m: { id: number; senderId: string; content: string }) => {
  out(`message:new #${m.id} dari=${m.senderId === "admin" ? "ADMIN" : "USER"} "${m.content.slice(0, 40)}"`);
});

// t+3s — admin kirim pesan.
setTimeout(() => {
  socket.emit(
    "messages:send",
    { conversationId: convId, content: "Rahasia admin akan lenyap t63b", type: "text" },
    (ack: { ok: boolean; message?: { id: number } }) => {
      adminMsgId = ack.message?.id ?? 0;
      out(`kirim-admin ack ok=${ack.ok} id=${adminMsgId}`);
    }
  );
}, 3000);

// t+8s — admin hapus pesannya sendiri → ghost ke user.
setTimeout(() => {
  if (!adminMsgId) {
    out("hapus-admin GAGAL: id tidak ada");
    return;
  }
  socket.emit("messages:delete", { messageId: adminMsgId }, (ack: { ok: boolean }) => {
    out(`hapus-admin ack ok=${ack.ok} → user (antiDelete) harus melihat isinya`);
  });
}, 8000);

setTimeout(() => {
  out("selesai — 20s");
  process.exit(0);
}, 20_000);
