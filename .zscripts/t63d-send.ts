/** Task 63d — user kirim 1 pesan (memicu unread admin utk uji badge). */
import { io } from "socket.io-client";

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  socket.emit(
    "user:auth",
    { name: "UjiBrowser63Ganti", password: "uji63", deviceId: "t63d-device" },
    (res: { ok: boolean; conversationId?: string }) => {
      if (!res.ok || !res.conversationId) process.exit(1);
      socket.emit(
        "messages:send",
        { conversationId: res.conversationId, content: "badge uji notif ikon", type: "text" },
        (ack: { ok: boolean }) => {
          console.log(`send ok=${ack.ok}`);
          setTimeout(() => process.exit(0), 500);
        }
      );
    }
  );
});
