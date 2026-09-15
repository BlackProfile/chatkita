/** v56 — kirim pesan image TANPA thumbUrl (reproduksi pesan lama: bubble melebar
 *  mengikuti ukuran intrinsik gambar, img di-cap 320px → ruang kosong). */
import { io } from "socket.io-client";
import crypto from "node:crypto";

function totpNow(secret: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret) bits += A.indexOf(c.toUpperCase()).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 30000);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  b.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(b).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  return (((hmac[off] & 0x7f) << 24 | hmac[off + 1] << 16 | hmac[off + 2] << 8 | hmac[off + 3]) % 1000000)
    .toString()
    .padStart(6, "0");
}

import { Database } from "bun:sqlite";
const db = new Database("mini-services/chat-service/chat.db", { readonly: true });
const secret = db.query("SELECT value FROM settings WHERE key='totp_secret'").get()?.value as string;

const socket = io("ws://127.0.0.1:3003/", { transports: ["websocket"] });
socket.on("connect", () => {
  socket.emit("admin:auth", { password: "admin123", totp: totpNow(secret) }, (res: { ok: boolean; error?: string }) => {
    if (!res.ok) {
      console.log("auth gagal:", res.error);
      process.exit(1);
    }
    socket.emit(
      "messages:send",
      {
        conversationId: "cbaa10d2-5061-4832-a157-a800eebdc219",
        content: "/api/media/a84eedfd740881f098e7e2e956ff262c.jpg",
        type: "image",
        fileName: "uji-tanpa-thumb.jpg",
        mimeType: "image/jpeg",
        fileSize: 22995,
      },
      (ack: { ok: boolean; error?: string; message?: { id: number } }) => {
        console.log("send ack:", JSON.stringify(ack).slice(0, 140));
        socket.close();
        process.exit(ack.ok ? 0 : 1);
      }
    );
  });
});
socket.on("connect_error", (e: Error) => {
  console.log("connect_error:", e.message);
  process.exit(1);
});
