/**
 * Task 63 — listener USER UjiBrowser63 (socket.io) utk E2E v47 sisi user:
 *  t+6s : kirim "uji delay t63" → expect ack instan, echo ×2 (multiplier),
 *         teks HURUF BESAR (mutator), read:update instan (fakeReads)
 *  t+12s: hapus pesan sendiri → expect DELETE_LOCKED (lockDelete)
 *  t+17s: edit pesan sendiri  → expect EDIT_LOCKED (lockEdit)
 *  t+24s: messages:read       → admin TIDAK boleh menerima read:update (freezeChecks)
 *  t+40s: messages:history    → cek ghosted (isi asli pesan dihapus)
 * Listener: message:ghost (isi asli), message:updated (self-destruct),
 *           message:new (echo), read:update.
 * Jalankan: bun .zscripts/t63-user.ts  (log → stdout, 55 dtk)
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
let firstEchoId = 0;
let sendAt = 0;

const socket = io("http://localhost:81/?XTransformPort=3003", {
  path: "/",
  transports: ["websocket"],
  reconnection: false,
});

socket.on("connect", () => {
  out("connected");
  socket.emit(
    "user:auth",
    { name: "UjiBrowser63", password: "uji63", deviceId: "t63-device-uji" },
    (res: { ok: boolean; error?: string; conversationId?: string }) => {
      convId = res.conversationId ?? "";
      out(`auth ok=${res.ok} err=${res.error ?? "-"} conv=${convId}`);
    }
  );
});

socket.on("message:new", (m: { id: number; senderId: string; content: string }) => {
  const dt = sendAt ? `${Date.now() - sendAt}ms sejak kirim` : "-";
  out(
    `message:new #${m.id} dari=${m.senderId === "admin" ? "ADMIN" : "USER"} ${dt} "${m.content.slice(0, 45)}"`
  );
  if (m.senderId !== "admin" && !firstEchoId) firstEchoId = m.id;
});

// v47 — isi asli pesan yang dihapus (cheat antiDelete).
socket.on(
  "message:ghost",
  (g: { id: number; content: string; deletedAt: string }) => {
    out(`message:ghost #${g.id} (dihapus ${g.deletedAt}) ISI ASLI: "${g.content}"`);
  }
);

socket.on("message:updated", (m: { id: number; deletedAt?: string | null }) => {
  out(`message:updated #${m.id} deletedAt=${m.deletedAt ?? "(isi)"}`);
});

// v47 — fakeReads: ✓✓ instan.
socket.on("read:update", (r: { userId: string; lastReadMessageId: number }) => {
  out(`read:update (pembaca=${r.userId === "admin" ? "ADMIN" : r.userId}) upTo=${r.lastReadMessageId}`);
});

// t+6s — kirim (delay 3 dtk berlaku di sisi penerima).
setTimeout(() => {
  if (!convId) {
    out("kirim GAGAL: conv belum ada");
    return;
  }
  sendAt = Date.now();
  socket.emit(
    "messages:send",
    { conversationId: convId, content: "uji delay t63", type: "text" },
    (ack: { ok: boolean; error?: string }) => {
      out(`kirim ack ok=${ack.ok} err=${ack.error ?? "-"} (ack ${Date.now() - sendAt}ms)`);
    }
  );
}, 6000);

// t+12s — hapus sendiri harus DITOLAK.
setTimeout(() => {
  socket.emit("messages:delete", { messageId: firstEchoId }, (ack: { ok: boolean; error?: string }) => {
    out(`hapus-sendiri ack ok=${ack.ok} err=${ack.error ?? "-"} (expect DELETE_LOCKED)`);
  });
}, 12_000);

// t+17s — edit sendiri harus DITOLAK.
setTimeout(() => {
  socket.emit(
    "message:edit",
    { messageId: firstEchoId, content: "editan ilegal" },
    (ack: { ok: boolean; error?: string }) => {
      out(`edit-sendiri ack ok=${ack.ok} err=${ack.error ?? "-"} (expect EDIT_LOCKED)`);
    }
  );
}, 17_000);

// t+24s — user membaca (freezeChecks: admin tidak boleh tahu).
setTimeout(() => {
  socket.emit("messages:read", { conversationId: convId });
  out("messages:read dikirim (bacaan harus tak terkabarkan)");
}, 24_000);

// t+40s — muat riwayat: ghosted harus tampil.
setTimeout(() => {
  socket.emit(
    "messages:history",
    { conversationId: convId },
    (res: { ok: boolean; messages?: Array<{ id: number; content: string; deletedAt?: string; ghosted?: boolean; senderId: string }> }) => {
      if (!res.ok) {
        out("history GAGAL");
        return;
      }
      const ghosts = (res.messages ?? []).filter((m) => m.ghosted);
      out(
        `history ok — total=${(res.messages ?? []).length} ghosted=${ghosts.length}: ${ghosts
          .map((g) => `#${g.id} dari=${g.senderId === "admin" ? "ADMIN" : "USER"} "${g.content.slice(0, 40)}"`)
          .join(" | ")}`
      );
    }
  );
}, 40_000);

setTimeout(() => {
  out("selesai — 55s");
  process.exit(0);
}, 55_000);
