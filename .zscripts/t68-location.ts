/** v52 — uji rich:send lokasi (kirim sebagai admin) → kartu lokasi muncul di chat. */
import { io } from "socket.io-client";

const socket = io("ws://127.0.0.1:3003/", { transports: ["websocket"] });
socket.on("connect", () => {
  socket.emit(
    "admin:auth",
    { password: "admin123" },
    (res: { ok: boolean; error?: string }) => {
      if (!res.ok) {
        console.log("auth gagal:", res.error);
        process.exit(1);
      }
      socket.emit(
        "rich:send",
        {
          conversationId: "f091fe9e-24ab-4a08-a7f2-d5abf972a66b",
          kind: "location",
          data: { lat: -6.2088, lng: 106.8456, label: "Lokasi admin" },
        },
        (ack: { ok: boolean; error?: string; message?: { id: number } }) => {
          console.log("rich:send ack:", JSON.stringify(ack).slice(0, 120));
          socket.close();
          process.exit(ack.ok ? 0 : 1);
        }
      );
    }
  );
});
socket.on("connect_error", (e: Error) => {
  console.log("connect_error:", e.message);
  process.exit(1);
});
