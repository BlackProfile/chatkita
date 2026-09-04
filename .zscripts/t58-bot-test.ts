/**
 * Uji bot balasan otomatis v39 — login sebagai UjiBrowser58 via socket.io,
 * kirim pesan, tunggu balasan Admin otomatis (bot), ukur jeda.
 * Jalankan SETELAH bot diaktifkan dari UI admin (teks memuat "balasan otomatis uji t58").
 * Pemakaian: bun .zscripts/t58-bot-test.ts
 */
import { io } from "socket.io-client";
import { Database } from "bun:sqlite";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const out = (s: string) => process.stdout.write(s + "\n");

const db = new Database(DB_PATH, { readonly: true });
const user = db.query("SELECT id, name FROM users WHERE name LIKE 'UjiBrowser58%'").get() as
  | { id: string; name: string }
  | undefined;
if (!user) {
  out("FAIL: user UjiBrowser58 tidak ditemukan");
  process.exit(1);
}
const conv = db
  .query("SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?")
  .get(user.id, user.id) as { id: string } | undefined;
if (!conv) {
  out("FAIL: percakapan tidak ditemukan");
  process.exit(1);
}

const socket = io("http://localhost:3003", { path: "/", transports: ["websocket"] });
const timeout = setTimeout(() => {
  out("FAIL: timeout — bot tidak membalas dalam 15 dtk");
  process.exit(1);
}, 15_000);

socket.on("connect", () => {
  out(`connected as socket ${socket.id}`);
  socket.emit(
    "user:auth",
    { name: user.name, password: "uji58", deviceId: "t58botdevice01" },
    (res: { ok: boolean; error?: string; user?: { id: string } }) => {
      if (!res.ok) {
        out(`FAIL: auth gagal (${res.error})`);
        process.exit(1);
      }
      out(`auth ok user=${res.user?.id ?? user.id}`);
      const t0 = Date.now();
      socket.on("message:new", (m: { senderId?: string; content?: string }) => {
        if (m?.senderId === "admin" && (m.content ?? "").includes("balasan otomatis uji t58")) {
          const elapsed = Date.now() - t0;
          out(
            `PASS: bot membalas dalam ${elapsed} ms — "${m.content}" (senderId=${m.senderId})`
          );
          clearTimeout(timeout);
          process.exit(0);
        }
      });
      socket.emit(
        "messages:send",
        { conversationId: conv!.id, content: "Halo bot, balas pesan ini (uji t58)", type: "text" },
        (res2: { ok: boolean; error?: string }) => {
          if (!res2.ok) {
            out(`FAIL: kirim pesan gagal (${res2.error})`);
            process.exit(1);
          }
          out("pesan user terkirim, menunggu bot…");
        }
      );
    }
  );
});

socket.on("connect_error", (err: Error) => {
  out(`FAIL: connect_error ${err.message}`);
  process.exit(1);
});
