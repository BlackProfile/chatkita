/**
 * Uji protokol v26 — Peta Penyimpanan + metadata media (Task 45).
 * Buat 3 file sintetis (PNG 3×4, PDF 7 halaman, MP4 320×240/42s) + pesan uji,
 * lalu uji admin:storage_map & admin:media_scan via socket, dan cleanup.
 * Jalankan dari root: bun .zscripts/t45-test.ts
 */
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "path";
import { io } from "socket.io-client";

const DB_PATH = "/home/z/my-project/mini-services/chat-service/chat.db";
const MEDIA_DIR = "/home/z/my-project/db/media";
const URL = "http://localhost:3003";
const now = Date.now();
const db = new Database(DB_PATH);
mkdirSync(MEDIA_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};
const emit = (sock: any, ev: string, data: unknown) =>
  new Promise<any>((res) => sock.emit(ev, data, (r: unknown) => res(r)));

// ---- 1. file sintetis ------------------------------------------------
const uid = crypto.randomUUID();
const cid = crypto.randomUUID();
const names: string[] = [];

// PNG 3×4 (signature + IHDR; parser cukup baca offset 16/20)
const png = Buffer.alloc(33);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
png.writeUInt32BE(13, 8);
png.write("IHDR", 12, "ascii");
png.writeUInt32BE(3, 16);
png.writeUInt32BE(4, 20);
png.writeUInt8(8, 24);
png.writeUInt8(2, 25);
png.write("IEND", 29, "ascii");
const pngName = `uji-meta-${uid.slice(0, 8)}.png`;
appendFileSync(join(MEDIA_DIR, pngName), png);
names.push(pngName);

// PDF 7 halaman (parser ambil /Count pertama)
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Pages/Kids[2 0 R]/Count 7>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  "latin1"
);
const pdfName = `uji-meta-${uid.slice(8, 16)}.pdf`;
appendFileSync(join(MEDIA_DIR, pdfName), pdf);
names.push(pdfName);

// MP4 320×240, 42 detik (ftyp + moov[mvhd v0 + trak[tkhd v0]])
const mvhd = Buffer.alloc(88);
mvhd.write("mvhd", 4, "ascii");
mvhd.writeUInt32BE(1000, 20); // timescale (box offset 20)
mvhd.writeUInt32BE(42000, 24); // duration → 42s (box offset 24)
const tkhd = Buffer.alloc(88);
tkhd.write("tkhd", 4, "ascii");
tkhd.writeUInt32BE(320 << 16, 80); // width 16.16 (box offset 80)
tkhd.writeUInt32BE(240 << 16, 84); // height 16.16 (box offset 84)
const trak = Buffer.alloc(8 + 88);
trak.writeUInt32BE(96, 0);
trak.write("trak", 4, "ascii");
tkhd.copy(trak, 8);
const moov = Buffer.alloc(8 + 88 + 96);
moov.writeUInt32BE(8 + 88 + 96, 0);
moov.write("moov", 4, "ascii");
mvhd.copy(moov, 8);
trak.copy(moov, 96);
const ftyp = Buffer.alloc(16);
ftyp.writeUInt32BE(16, 0);
ftyp.write("ftypisom", 4, "ascii");
const mp4 = Buffer.concat([ftyp, moov]);
const mp4Name = `uji-meta-${uid.slice(16, 24)}.mp4`;
appendFileSync(join(MEDIA_DIR, mp4Name), mp4);
names.push(mp4Name);

// ---- 2. user + conv + 3 pesan media (tanpa meta_json) ----------------
db.run("INSERT INTO users (id,name,role,created_at,last_seen_at) VALUES (?,?,?,?,?)", [
  uid,
  "UjiMeta45",
  "user",
  now,
  now,
]);
db.run(
  "INSERT INTO conversations (id,user_a_id,user_b_id,created_at,last_message_at) VALUES (?,?,?,?,?)",
  [cid, uid, "admin", now, now]
);
const insertMedia = (name: string, type: string, mime: string, size: number) =>
  db.run(
    "INSERT INTO messages (conversation_id,sender_id,content,created_at,type,file_name,file_size,mime_type) VALUES (?,?,?,?,?,?,?,?)",
    [cid, uid, `/api/media/${name}`, now, type, name, size, mime]
  );
insertMedia(pngName, "image", "image/png", png.length);
insertMedia(pdfName, "file", "application/pdf", pdf.length);
insertMedia(mp4Name, "file", "video/mp4", mp4.length);

// ---- 3. uji socket ----------------------------------------------------
const sock = io(URL, { transports: ["websocket"], reconnection: false });
await new Promise((r) => sock.on("connect", r));

const noAuth = await emit(sock, "admin:storage_map", {});
check("storage_map tanpa auth ditolak", noAuth?.ok === false, JSON.stringify(noAuth));

check("auth admin", (await emit(sock, "admin:auth", { password: "admin123" }))?.ok === true);

const map = await emit(sock, "admin:storage_map", {});
check("storage_map ok", map?.ok === true && !!map?.map?.storage);
check(
  "byType: image+pdf+video terbaca",
  map?.map?.byType?.image?.count >= 1 &&
    map?.map?.byType?.pdf?.count >= 1 &&
    map?.map?.byType?.video?.count >= 1
);
check(
  "byUser memuat UjiMeta45",
  (map?.map?.byUser ?? []).some((u: any) => u.name === "UjiMeta45")
);
check(
  "largest punya kolom meta",
  (map?.map?.largest ?? []).every((f: any) => "meta" in f) && map.map.largest.length > 0
);
check(
  "coverage menghitung tanpa metadata",
  map?.map?.coverage?.withoutMeta >= 3
);

const scan = await emit(sock, "admin:media_scan", {});
check("media_scan ok", scan?.ok === true, `scanned=${scan?.scanned} filled=${scan?.filled}`);

const pngRow = db
  .query("SELECT meta_json FROM messages WHERE content = ?")
  .get(`/api/media/${pngName}`) as any;
const pdfRow = db
  .query("SELECT meta_json FROM messages WHERE content = ?")
  .get(`/api/media/${pdfName}`) as any;
const mp4Row = db
  .query("SELECT meta_json FROM messages WHERE content = ?")
  .get(`/api/media/${mp4Name}`) as any;
const pngMeta = JSON.parse(pngRow?.meta_json ?? "{}");
const pdfMeta = JSON.parse(pdfRow?.meta_json ?? "{}");
const mp4Meta = JSON.parse(mp4Row?.meta_json ?? "{}");
check("PNG dims 3×4", pngMeta.width === 3 && pngMeta.height === 4, JSON.stringify(pngMeta));
check("PDF 7 halaman", pdfMeta.pages === 7, JSON.stringify(pdfMeta));
check(
  "MP4 320×240 + 0:42",
  mp4Meta.width === 320 && mp4Meta.height === 240 && mp4Meta.durationMs === 42000,
  JSON.stringify(mp4Meta)
);

const map2 = await emit(sock, "admin:storage_map", {});
check(
  "coverage withMeta >= 3 file uji",
  (map2?.map?.coverage?.withMeta ?? 0) >= 3
);
sock.close();

// ---- 4. cleanup --------------------------------------------------------
db.run("DELETE FROM messages WHERE conversation_id=?", [cid]);
db.run("DELETE FROM conversations WHERE id=?", [cid]);
db.run("DELETE FROM users WHERE id=?", [uid]);
for (const n of names) {
  try {
    rmSync(join(MEDIA_DIR, n));
  } catch {
    /* sudah hilang */
  }
}
check("cleanup bersih", db.query("SELECT COUNT(*) c FROM users WHERE name='UjiMeta45'").get()!.c === 0);

console.log(`\nHASIL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
