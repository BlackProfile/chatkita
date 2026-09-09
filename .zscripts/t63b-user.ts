/**
 * Task 63b — listener USER UjiBrowser63 (lanjutan terarah):
 *  t+4s : kirim "editlock uji" → simpan id echo (masih hidup)
 *  t+9s : edit echo → expect EDIT_LOCKED (pesan masih hidup kali ini)
 *  t+14s: menunggu ghost dari pesan ADMIN yang dihapus admin
 * Jalankan: bun .zscripts/t63b-user.ts (30 dtk)
 */
import { io } from "socket.io-client";

const log: string[] = [];
const t0 = Date.now();
const out = (s: string) => {
  const line = `[${String(Math.round((Date.now() - t0) / 1000)).padStart(3, "0")}s] ${s}`;
  log.push(line);
  process.stdout.write(line + "\n");
};

let convId = "";
let echoId = 0;
let sendAt = 0;

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  out("connected (online — mode hantu aktif, admin tidak boleh melihat)");
  socket.emit(
    "user:auth",
    { name: "UjiBrowser63", password: "uji63", deviceId: "t63b-device-uji" },
    (res: { ok: boolean; error?: string; conversationId?: string }) => {
      convId = res.conversationId ?? "";
      out(`auth ok=${res.ok} conv=${convId}`);
    }
  );
});

socket.on("message:new", (m: { id: number; senderId: string; content: string }) => {
  const dt = sendAt ? `${Date.now() - sendAt}ms sejak kirim` : "-";
  out(
    `message:new #${m.id} dari=${m.senderId === "admin" ? "ADMIN" : "USER"} ${dt} "${m.content.slice(0, 45)}"`
  );
  if (m.senderId !== "admin" && !echoId) echoId = m.id;
});

socket.on("message:ghost", (g: { id: number; content: string }) => {
  out(`message:ghost #${g.id} ISI ASLI: "${g.content}" (dari pesan ADMIN yang dihapus)`);
});

socket.on("message:updated", (m: { id: number; deletedAt?: string | null }) => {
  out(`message:updated #${m.id} deletedAt=${m.deletedAt ?? "(isi)"}`);
});

setTimeout(() => {
  sendAt = Date.now();
  socket.emit(
    "messages:send",
    { conversationId: convId, content: "editlock uji", type: "text" },
    (ack: { ok: boolean }) => out(`kirim ack ok=${ack.ok}`)
  );
}, 4000);

setTimeout(() => {
  socket.emit(
    "message:edit",
    { messageId: echoId, content: "coba edit" },
    (ack: { ok: boolean; error?: string }) => {
      out(`edit-sendiri ack ok=${ack.ok} err=${ack.error ?? "-"} (expect EDIT_LOCKED)`);
    }
  );
}, 9000);

setTimeout(() => {
  out("selesai — 30s");
  process.exit(0);
}, 30_000);
