/** Task 63f — set ulang matriks cheat fixture (user baru = flags kosong). */
import { io } from "socket.io-client";
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/mini-services/chat-service/chat.db", {
  readonly: true,
});
const target = db.query("SELECT id FROM users WHERE name LIKE 'UjiBrowser63%'").get() as
  | { id: string }
  | undefined;
db.close();
if (!target) {
  console.log("fixture tidak ada");
  process.exit(1);
}

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});
socket.on("connect", () => {
  socket.emit("admin:auth", { password: "admin123" }, () => {
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
      (res: { ok: boolean; flags?: unknown }) => {
        console.log(`flags ok=${res.ok} ${JSON.stringify(res.flags ?? {})}`);
        setTimeout(() => process.exit(0), 300);
      }
    );
  });
});
