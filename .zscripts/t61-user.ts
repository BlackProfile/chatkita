/**
 * Task 61 — klien user UjiBrowser61 (socket.io-client) utk E2E sisi user v45:
 * auth → dengarkan user:toast (toast palsu admin) → message:updated
 * (retro-edit massal) → message:new (broadcast 📢 + pesan blackhole sendiri)
 * → kirim pesan saat lubang hitam AKTIF (tetap ok di sisi user).
 * Jalankan: bun .zscripts/t61-user.ts  (log → /tmp/t61-user.log, 45 dtk)
 */
import { io } from "socket.io-client";

const log: string[] = [];
const t0 = Date.now();
const out = (s: string) => {
  const line = `[${String(Math.round((Date.now() - t0) / 1000)).padStart(3, "0")}s] ${s}`;
  log.push(line);
  process.stdout.write(line + "\n");
};

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  out("connected");
  socket.emit(
    "user:auth",
    { name: "UjiBrowser61", password: "uji61x", deviceId: "t61-device-uji" },
    (res: { ok: boolean; error?: string; conversationId?: string }) => {
      out(`auth ok=${res.ok} err=${res.error ?? "-"} conv=${res.conversationId ?? "-"}`);
      (globalThis as Record<string, unknown>).__conv = res.conversationId;
    }
  );
});

// v45 — toast palsu dari admin.
socket.on("user:toast", (p: { title: string; body: string }) => {
  out(`user:toast "${p.title}" — "${p.body}"`);
});

// Retro-edit massal + tombstone.
socket.on("message:updated", (m: { id: number; content?: string; deletedAt?: string }) => {
  out(`message:updated #${m.id} content="${(m.content ?? "(tombstone)").slice(0, 50)}"`);
});

socket.on("message:new", (m: { id: number; senderId: string; content: string; type: string }) => {
  out(
    `message:new #${m.id} from=${m.senderId === "admin" ? "ADMIN" : "USER"} type=${m.type} "${m.content.slice(0, 50)}"`
  );
});

// +24 dtk — kirim pesan saat lubang hitam diperkirakan SUDAH aktif.
setTimeout(() => {
  const conv = (globalThis as Record<string, unknown>).__conv as string | undefined;
  if (!conv) {
    out("kirim-blackhole GAGAL: conv belum ada");
    return;
  }
  socket.emit(
    "messages:send",
    { conversationId: conv, content: "uji lubang hitam t61", type: "text" },
    (ack: { ok: boolean; error?: string }) => {
      out(`kirim-blackhole ack ok=${ack.ok} err=${ack.error ?? "-"}`);
    }
  );
}, 24_000);

setTimeout(() => {
  out("selesai — 45s");
  process.exit(0);
}, 45_000);
