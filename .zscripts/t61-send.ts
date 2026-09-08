/**
 * Task 61b — user kirim 1 pesan "reaksi otomatis t61", lalu menunggu:
 * message:updated (auto-react ❤️ Admin) + user:toast (toast palsu).
 * Jalankan: bun .zscripts/t61-send.ts  (maks 12 dtk)
 */
import { io } from "socket.io-client";

const out = (s: string) => process.stdout.write(s + "\n");
const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  socket.emit(
    "user:auth",
    { name: "UjiBrowser61", password: "uji61x", deviceId: "t61-device-uji" },
    (res: { ok: boolean; conversationId?: string }) => {
      if (!res.ok || !res.conversationId) {
        out(`auth gagal: ${JSON.stringify(res)}`);
        process.exit(1);
      }
      socket.emit(
        "messages:send",
        { conversationId: res.conversationId, content: "reaksi otomatis t61", type: "text" },
        (ack: { ok: boolean; id?: number }) => out(`kirim ok=${ack.ok} id=${ack.id ?? "-"}`)
      );
    }
  );
});

socket.on("message:updated", (m: { id: number; reactions?: unknown }) => {
  out(`message:updated #${m.id} reactions=${JSON.stringify(m.reactions)}`);
});
socket.on("user:toast", (p: { title: string; body: string }) => {
  out(`user:toast "${p.title}" — "${p.body}"`);
});

setTimeout(() => process.exit(0), 12_000);
