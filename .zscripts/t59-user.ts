/**
 * Task 59 — klien user UjiBrowser59 (socket.io-client) utk E2E sisi user:
 * login → kirim normal → kirim kata terlarang (WORD_BLOCKED) → kirim saat
 * approval mode (pending:true) → kirim file saat jenis diblokir
 * (MEDIA_TYPE_BLOCKED) → menunggu approve/reject (message:new /
 * moderation:rejected) → session:revoked saat paksa logout.
 * Jalankan: bun .zscripts/t59-user.ts  (log → /tmp/t59-user.log)
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

let approvedSeen = false;
let rejectedSeen = false;

socket.on("connect", () => {
  out("connected");
  socket.emit(
    "user:auth",
    { name: "UjiBrowser59", password: "uji59", deviceId: "t59-device-uji" },
    (res: { ok: boolean; error?: string; conversationId?: string }) => {
      out(`auth ok=${res.ok} err=${res.error ?? "-"} conv=${res.conversationId ?? "-"}`);
      if (!res.ok || !res.conversationId) process.exit(1);
      const conv = res.conversationId;

      // +4s — pesan normal (harus ok, pending undefined).
      setTimeout(() => {
        socket.emit(
          "messages:send",
          { conversationId: conv, content: "pesan langsung uji t59", type: "text" },
          (ack: { ok: boolean; pending?: boolean; error?: string }) => {
            out(`kirim-normal: ok=${ack.ok} pending=${String(ack.pending)} err=${ack.error ?? "-"}`);
          }
        );
      }, 4000);

      // +9s — kata terlarang (filter block) → WORD_BLOCKED.
      setTimeout(() => {
        socket.emit(
          "messages:send",
          { conversationId: conv, content: "ini mengandung kata kasar uji t59", type: "text" },
          (ack: { ok: boolean; error?: string }) => {
            out(`kirim-terlarang: ok=${ack.ok} err=${ack.error ?? "-"}`);
          }
        );
      }, 9000);

      // +14s — approval mode aktif → ack pending:true.
      setTimeout(() => {
        socket.emit(
          "messages:send",
          { conversationId: conv, content: "pesan antre uji t59", type: "text" },
          (ack: { ok: boolean; pending?: boolean }) => {
            out(`kirim-antre: ok=${ack.ok} pending=${String(ack.pending)}`);
          }
        );
      }, 14000);

      // +26s — jenis file diblokir → MEDIA_TYPE_BLOCKED.
      setTimeout(() => {
        socket.emit(
          "messages:send",
          {
            conversationId: conv,
            content: "/api/media/t59-uji.jpg",
            type: "file",
            fileName: "t59-uji.jpg",
            fileSize: 12064,
            mimeType: "image/jpeg",
          },
          (ack: { ok: boolean; error?: string }) => {
            out(`kirim-file-diblokir: ok=${ack.ok} err=${ack.error ?? "-"}`);
          }
        );
      }, 26000);

      // +40s — sensor: admin ganti aksi censor → pesan jadi ***.
      setTimeout(() => {
        socket.emit(
          "messages:send",
          { conversationId: conv, content: "kata kasar versi sensor uji t59", type: "text" },
          (ack: { ok: boolean; pending?: boolean; message?: { content?: string } }) => {
            out(`kirim-sensor: ok=${ack.ok} pending=${String(ack.pending)} konten="${ack.message?.content ?? "-"}"`);
          }
        );
      }, 40000);

      // +50s — kirim kedua utk uji TOLAK (admin menolak strip ⏳ kedua).
      setTimeout(() => {
        socket.emit(
          "messages:send",
          { conversationId: conv, content: "pesan antre kedua uji t59", type: "text" },
          (ack: { ok: boolean; pending?: boolean }) => {
            out(`kirim-antre-2: ok=${ack.ok} pending=${String(ack.pending)}`);
          }
        );
      }, 50000);

      // +150s — hard stop (fallback; normalnya keluar via session:revoked).
      setTimeout(() => {
        out(`SELESAI: approved=${approvedSeen} rejected=${rejectedSeen} (timeout)`);
        process.exit(0);
      }, 150000);
    }
  );
});

socket.on("message:new", (m: { content?: string; pending?: boolean }) => {
  if (typeof m?.content === "string" && m.content.includes("uji t59")) {
    if (m.content.includes("antre uji")) {
      approvedSeen = true;
      out(`message:new ANTRE DISETUJUI → "${m.content}"`);
    } else {
      out(`message:new → "${m.content.slice(0, 60)}"`);
    }
  }
});

socket.on("moderation:rejected", (p: { messageId: number }) => {
  rejectedSeen = true;
  out(`moderation:rejected id=${p.messageId}`);
});

socket.on("session:revoked", () => {
  out("session:revoked diterima ✓");
  out(`SELESAI: approved=${approvedSeen} rejected=${rejectedSeen}`);
  setTimeout(() => process.exit(0), 500);
});

socket.on("connect_error", (e: Error) => out("connect_error: " + e.message));

setInterval(() => {
  if (log.length) {
    // noop keepalive — bun keluar via process.exit eksplisit
  }
}, 60_000);
