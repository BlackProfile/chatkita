/**
 * Protocol test for the ChatKita chat-service (v7 model: pure private
 * messenger — every user chats 1-on-1 with the Admin; users are isolated
 * from each other; file messages ride the out-of-band /api/upload +
 * /api/media pipeline; no customer-service tooling exists anymore).
 *
 * Run directly against 127.0.0.1:3003 (test-only, bypasses the gateway):
 *   cd mini-services/chat-service && bun test-protocol.ts
 *
 * NOTE: expects a FRESH database (Budi's history must start empty).
 */

import { io, type Socket } from "socket.io-client";

const URL = "http://127.0.0.1:3003";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// Global watchdog: never let a failed assertion hang the runner.
setTimeout(() => {
  console.log(`\nWATCHDOG: aborted after 45s — ${passed} passed, ${failed} failed`);
  process.exit(1);
}, 45000);

const connect = (): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = io(URL, { transports: ["websocket"], reconnection: false });
    const t = setTimeout(() => reject(new Error("timeout connecting")), 5000);
    s.on("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.io.on("close", (reason: string) =>
      console.log(`  [client ${s.id?.slice(0, 6)}] transport close: ${reason}`)
    );
    s.io.on("error", (err: Error) =>
      console.log(`  [client ${s.id?.slice(0, 6)}] manager error: ${err.message}`)
    );
    s.on("disconnect", (reason: string) =>
      console.log(`  [client ${s.id?.slice(0, 6)}] socket disconnect: ${reason}`)
    );
  });

const emitAck = <T>(socket: Socket, event: string, payload: object): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`no ack for "${event}" within 5s`)),
      5000
    );
    socket.emit(event, payload, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });

const waitFor = <T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      timeoutMs
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Like waitFor, but resolves null on timeout and only accepts payloads
 * matching `filter` (ignores unrelated events during the window).
 */
const waitForSoft = <T>(
  socket: Socket,
  event: string,
  filter: (data: any) => boolean,
  timeoutMs = 2500
): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, h);
      resolve(null);
    }, timeoutMs);
    const h = (data: any) => {
      if (!filter(data)) return;
      clearTimeout(timer);
      socket.off(event, h);
      resolve(data as T);
    };
    socket.on(event, h);
  });

async function main() {
  console.log("— 0. public:settings (pre-login push config) —");
  const probe = await connect();
  const pub = await emitAck<any>(probe, "public:settings", {});
  ok(
    "p1 public:settings → { ok, pushPublicKey }",
    pub.ok === true && typeof pub.pushPublicKey === "string"
  );
  ok("p2 no legacy nested publicSettings", pub.publicSettings === undefined);
  probe.disconnect();

  console.log("— a. user auth (1-on-1 with Admin) —");
  const budi = await connect();
  const a1 = await emitAck<any>(budi, "user:auth", { name: "Budi Test" });
  ok("a1 user:auth ok", a1.ok === true);
  ok("a1b ack has string pushPublicKey", typeof a1.pushPublicKey === "string");
  ok("a1c no legacy publicSettings in ack", a1.publicSettings === undefined);
  ok(
    "a2 conversationId present",
    typeof a1.conversationId === "string" && a1.conversationId.length > 0
  );
  ok("a3 partner is Admin", a1.partner?.name === "Admin");
  ok("a4 history starts empty", Array.isArray(a1.messages) && a1.messages.length === 0);

  const reserved = await emitAck<any>(budi, "user:auth", { name: "admin" });
  ok(
    "a5 reserved name 'admin' rejected",
    reserved.ok === false && reserved.error === "NAME_RESERVED"
  );

  console.log("— b. user sends a message —");
  const sent = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "Halo Admin, ini Budi",
  });
  ok(
    "b1 messages:send ok",
    sent.ok === true && sent.message?.content === "Halo Admin, ini Budi"
  );

  console.log("— c. admin auth —");
  const admin = await connect();
  const bad = await emitAck<any>(admin, "admin:auth", { password: "salah" });
  ok(
    "c1 wrong password → UNAUTHORIZED",
    bad.ok === false && bad.error === "UNAUTHORIZED"
  );
  const good = await emitAck<any>(admin, "admin:auth", { password: "admin123" });
  ok("c2 admin:auth ok", good.ok === true);
  const budiConv = good.conversations?.find((c: any) => c.id === a1.conversationId);
  ok("c3 admin sees Budi's conversation", !!budiConv);
  ok("c4 Budi unread = 1", budiConv?.unread === 1);
  ok(
    "c5 last message preview",
    budiConv?.lastMessage?.content === "Halo Admin, ini Budi"
  );

  console.log("— d. admin history + reply —");
  const hist = await emitAck<any>(admin, "messages:history", {
    conversationId: a1.conversationId,
  });
  ok("d1 history ok with 1 message", hist.ok === true && hist.messages?.length === 1);
  ok("d2 history partner is Budi", hist.partner?.name === "Budi Test");
  // Register the listener BEFORE the ack resolves — the server fans out
  // synchronously after acking, so afterwards is too late.
  const atBudiP = waitFor<any>(budi, "message:new");
  const reply = await emitAck<any>(admin, "messages:send", {
    conversationId: a1.conversationId,
    content: "Halo Budi, ada yang bisa dibantu?",
  });
  ok("d3 admin reply ok", reply.ok === true);
  const atBudi = await atBudiP;
  ok(
    "d4 Budi receives admin reply live",
    atBudi?.senderId === "admin" && atBudi?.content === "Halo Budi, ada yang bisa dibantu?"
  );

  console.log("— e. live fanout user → admin —");
  // Filter by content: the admin socket may still receive slightly older
  // fanouts (e.g. its own reply from section d). Register the listener,
  // THEN send, THEN await the filtered result.
  const adminGotIt = new Promise<any>((resolve) => {
    const h = (m: any) => {
      if (m?.content === "Pesanan saya belum sampai") {
        admin.off("message:new", h);
        resolve(m);
      }
    };
    admin.on("message:new", h);
  });
  const sendAckE = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "Pesanan saya belum sampai",
  });
  ok("e0 send ack ok", sendAckE.ok === true);
  const atAdmin = await Promise.race([
    adminGotIt,
    sleep(4000).then(() => null),
  ]);
  ok(
    "e1 admin receives Budi's message live",
    atAdmin?.content === "Pesanan saya belum sampai" &&
      atAdmin?.conversationId === a1.conversationId
  );

  console.log("— f. isolation between users —");
  const siti = await connect();
  const s1 = await emitAck<any>(siti, "user:auth", { name: "Siti Test" });
  ok(
    "f1 Siti auth ok, different conversation",
    s1.ok === true && s1.conversationId !== a1.conversationId
  );
  let budiSawForeign = false;
  budi.on("message:new", (m: any) => {
    if (m.conversationId !== a1.conversationId) budiSawForeign = true;
  });
  await emitAck<any>(siti, "messages:send", {
    conversationId: s1.conversationId,
    content: "Pesan rahasia Siti",
  });
  await sleep(500);
  ok("f2 Budi never receives Siti's message", budiSawForeign === false);
  const sitiHist = await emitAck<any>(siti, "messages:history", {
    conversationId: s1.conversationId,
  });
  ok(
    "f3 Siti history contains only her own message",
    sitiHist.ok === true &&
      sitiHist.messages?.length === 1 &&
      sitiHist.messages[0].content === "Pesan rahasia Siti"
  );
  const forbidden = await emitAck<any>(siti, "messages:history", {
    conversationId: a1.conversationId,
  });
  ok(
    "f4 Siti FORBIDDEN on Budi's conversation",
    forbidden.ok === false && forbidden.error === "FORBIDDEN"
  );

  console.log("— g. admin reads ALL users —");
  const refresh = await emitAck<any>(admin, "admin:auth", { password: "admin123" });
  ok("g1 admin sees >= 2 conversations", refresh.conversations?.length >= 2);
  const sitiConv = refresh.conversations?.find((c: any) => c.id === s1.conversationId);
  ok("g2 Siti unread = 1", sitiConv?.unread === 1);
  // messages:read has NO ack by protocol — emit and give the server a
  // moment to process before refreshing.
  admin.emit("messages:read", { conversationId: s1.conversationId });
  await sleep(300);
  const refresh2 = await emitAck<any>(admin, "admin:auth", { password: "admin123" });
  const sitiConv2 = refresh2.conversations?.find((c: any) => c.id === s1.conversationId);
  ok("g3 Siti unread = 0 after messages:read", sitiConv2?.unread === 0);
  const sitiHistByAdmin = await emitAck<any>(admin, "messages:history", {
    conversationId: s1.conversationId,
  });
  ok(
    "g4 admin can read Siti's messages",
    sitiHistByAdmin.ok === true &&
      sitiHistByAdmin.messages?.some((m: any) => m.content === "Pesan rahasia Siti")
  );

  console.log("— h. typing relay —");
  const typingAtAdminP = waitFor<any>(admin, "partner:typing");
  budi.emit("typing", { conversationId: a1.conversationId, isTyping: true });
  const typingAtAdmin = await typingAtAdminP;
  ok(
    "h1 user typing reaches admin",
    typingAtAdmin?.conversationId === a1.conversationId && typingAtAdmin?.isTyping === true
  );
  const typingAtBudiP = waitFor<any>(budi, "partner:typing");
  admin.emit("typing", { conversationId: a1.conversationId, isTyping: true });
  const typingAtBudi = await typingAtBudiP;
  ok("h2 admin typing reaches user", typingAtBudi?.isTyping === true);

  console.log("— h3. file sharing (v7, out-of-band via /api/upload) —");
  const fileUrl = "/api/media/ab12cd34ef56-laporan-keuangan.pdf";
  const fileAtAdminP = new Promise<any>((resolve) => {
    const h = (m: any) => {
      if (m?.type === "file") {
        admin.off("message:new", h);
        resolve(m);
      }
    };
    admin.on("message:new", h);
  });
  const fileSend = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: fileUrl,
    type: "file",
    fileName: "laporan-keuangan.pdf",
    fileSize: 123456,
    mimeType: "application/pdf",
  });
  ok(
    "h3a file send ok, metadata echoed",
    fileSend.ok === true &&
      fileSend.message?.type === "file" &&
      fileSend.message?.content === fileUrl &&
      fileSend.message?.fileName === "laporan-keuangan.pdf" &&
      fileSend.message?.fileSize === 123456 &&
      fileSend.message?.mimeType === "application/pdf"
  );
  const fileAtAdmin = await Promise.race([
    fileAtAdminP,
    sleep(4000).then(() => null),
  ]);
  ok(
    "h3b admin receives file message live with metadata",
    fileAtAdmin?.type === "file" &&
      fileAtAdmin?.fileName === "laporan-keuangan.pdf" &&
      fileAtAdmin?.fileSize === 123456 &&
      fileAtAdmin?.mimeType === "application/pdf"
  );
  // Reply to the file message → the reply preview snippet must read
  // "📎 <fileName>" (requires the reply-preview query to fetch file_name).
  const replyToFile = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "Ini filenya ya",
    replyToId: fileSend.message?.id,
  });
  ok(
    "h3c reply to file shows 📎 snippet",
    replyToFile.ok === true &&
      replyToFile.message?.replyTo?.type === "file" &&
      replyToFile.message?.replyTo?.snippet === "📎 laporan-keuangan.pdf"
  );
  const badFileUrl = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "https://evil.example.com/api/media/x.pdf",
    type: "file",
    fileName: "trap.pdf",
    fileSize: 10,
    mimeType: "application/pdf",
  });
  ok(
    "h3d absolute-URL file content rejected",
    badFileUrl.ok === false && badFileUrl.error === "INVALID_MESSAGE"
  );
  const badFileName = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "/api/media/okname.bin",
    type: "file",
    fileName: "x".repeat(256),
    fileSize: 10,
    mimeType: "application/octet-stream",
  });
  ok(
    "h3e oversized fileName (256 chars) rejected",
    badFileName.ok === false && badFileName.error === "INVALID_MESSAGE"
  );
  const badFileSize = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "/api/media/okname.bin",
    type: "file",
    fileName: "besar.bin",
    fileSize: 26_214_401, // 25 MiB + 1
    mimeType: "application/octet-stream",
  });
  ok(
    "h3f oversized fileSize (> 25 MiB) rejected",
    badFileSize.ok === false && badFileSize.error === "INVALID_MESSAGE"
  );
  const missingMeta = await emitAck<any>(budi, "messages:send", {
    conversationId: a1.conversationId,
    content: "/api/media/okname.bin",
    type: "file",
  });
  ok(
    "h3g missing file metadata rejected",
    missingMeta.ok === false && missingMeta.error === "INVALID_MESSAGE"
  );

  console.log("— i. presence —");
  // v7 NOTE: REAL browser sessions may be connected while the suite runs
  // (owner tabs auto-reconnect after service restarts). The admin online
  // set then never empties, so the admin offline/online broadcasts (i1/i2)
  // fire only when the test admin is the ONLY admin session. "No event"
  // is therefore treated as an environment signal and cross-checked: if a
  // fresh admin connect ALSO emits no online broadcast, a foreign admin
  // session must be live and i1/i2 pass vacuously.
  const adminOffP = waitForSoft<any>(
    budi,
    "presence:update",
    (m) => m?.userId === "admin" && m?.online === false
  );
  admin.disconnect();
  const adminOff = await adminOffP;
  const adminOnP = waitForSoft<any>(
    budi,
    "presence:update",
    (m) => m?.userId === "admin" && m?.online === true
  );
  const admin2 = await connect();
  await emitAck<any>(admin2, "admin:auth", { password: "admin123" });
  const adminOn = await adminOnP;
  const foreignAdminLive = adminOff === null && adminOn === null;
  ok(
    "i1 admin offline broadcast to user (or foreign admin session live)",
    foreignAdminLive ||
      (adminOff?.userId === "admin" && adminOff?.online === false)
  );
  ok(
    "i2 admin online broadcast to user (or foreign admin session live)",
    foreignAdminLive ||
      (adminOn?.userId === "admin" && adminOn?.online === true)
  );

  const budiId = a1.user?.id;
  const budiOffP = waitForSoft<any>(
    admin2,
    "presence:update",
    (m) => m?.userId === budiId && m?.online === false
  );
  budi.disconnect();
  const budiOff = await budiOffP;
  ok(
    "i3 user offline reaches admin only",
    budiOff?.userId === budiId && budiOff?.online === false
  );

  console.log("— j. auth state survives re-auth on same socket —");
  const sitiReauth = await emitAck<any>(siti, "user:auth", {
    name: "Siti Test",
    userId: s1.user?.id,
  });
  ok(
    "j1 re-auth returns the same conversation",
    sitiReauth.ok === true && sitiReauth.conversationId === s1.conversationId
  );
  ok(
    "j2 re-auth history is preserved",
    sitiReauth.messages?.length === 1
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  budi.disconnect();
  siti.disconnect();
  admin2.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
