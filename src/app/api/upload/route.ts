import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/upload — penerima unggahan media ChatKita (dibangun ulang v21;
 * versi lama hilang bersama rollback sandbox). Penyimpanan disk:
 *
 *   - Isi file dibaca, dihitung SHA-256-nya, lalu disimpan ke `db/media/`
 *     dengan nama `<32-hex-hash><ekstensi>` — file dengan isi identik
 *     (dedup SHA-256) tidak ditulis ulang.
 *   - Nama tersimpan HANYA berisi [A-Za-z0-9._-] (cocok dengan
 *     FILE_URL_PATTERN chat-service dan NAME_PATTERN /api/media).
 *   - Cap ukuran 25 MiB (MAX_UPLOAD_BYTES — sama dengan sisi klien);
 *     cap per-pengguna ditegakkan chat-service saat pesan dikirim.
 *   - Respons: { ok, url: "/api/media/<nama>", fileName (nama asli),
 *     mimeType, size } — bentuk yang diharapkan uploadMedia() di klien.
 */

export const runtime = "nodejs";

const MEDIA_DIR = path.join(process.cwd(), "db", "media");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Ekstensi dari mimeType (fallback ketika nama file tanpa ekstensi). */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
};

/** Ekstensi asal file: titik + 1–10 karakter alfanumerik (mis. ".jpg"). */
const EXT_PATTERN = /^\.[A-Za-z0-9]{1,10}$/;

/** mimeType minimal type/subtype (sejajar MIME_TYPE_PATTERN chat-service). */
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

const jsonError = (error: string, status = 400) =>
  NextResponse.json({ ok: false, error }, { status });

/* v48 — kebijakan ekstensi dari chat-service (diatur admin di Pengaturan). */
let extPolicyCache: { list: string[]; at: number } = { list: [], at: 0 };

async function blockedExtensions(): Promise<string[]> {
  if (Date.now() - extPolicyCache.at < 30_000) return extPolicyCache.list;
  try {
    const r = await fetch("http://127.0.0.1:3003/http/upload_policy", {
      signal: AbortSignal.timeout(3000),
    });
    const j = (await r.json()) as { extBlocklist?: string };
    const list = (j.extBlocklist ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean);
    extPolicyCache = { list, at: Date.now() };
    return list;
  } catch {
    return extPolicyCache.list; // server mati → pakai cache terakhir (fail-open)
  }
}

/**
 * v48 — deteksi magic-bytes: jenis file NYATA dari header. Dipakai untuk
 * menolak file yang menyamar ganti ekstensi (mis. .exe dinamai .pdf).
 * Mengembalikan "unknown" bila pola tidak dikenali (dibiarkan lewat).
 */
function sniffKind(b: Buffer): string {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 6 && b.subarray(0, 6).toString("ascii") === "GIF87a") return "gif";
  if (b.length >= 6 && b.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return "zip";
  if (b.length >= 4 && b[0] === 0x1f && b[1] === 0x8b) return "gz";
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.length >= 5 && b.subarray(0, 5).toString("ascii") === "<?xml") return "svg";
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "\x00\x01\x00\x00") return "exe"; // PE/DOS MZ
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return "exe"; // MZ (Windows/DOS executable)
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "\x7fELF") return "elf"; // Linux executable
  return "unknown";
}

/** Jenis yang sah untuk sebuah ekstensi (bila magic-bytes tidak cocok → tolak). */
const KIND_BY_EXT: Record<string, string[]> = {
  png: ["png"], jpg: ["jpg", "mp4"], jpeg: ["jpg", "mp4"], webp: ["webp"],
  gif: ["gif"], bmp: ["bmp"], svg: ["svg"], heic: ["unknown"],
  mp4: ["mp4"], mov: ["mp4", "unknown"], m4v: ["mp4"], webm: ["unknown", "mp4"],
  ogg: ["ogg"], oga: ["ogg"], opus: ["ogg"], weba: ["ogg"], mp3: ["mp3", "unknown"],
  m4a: ["mp4", "unknown"], wav: ["wav"],
  pdf: ["pdf"], zip: ["zip", "gz"], gz: ["gz"], tgz: ["gz"],
  txt: ["unknown"], md: ["unknown"], json: ["unknown"], csv: ["unknown"],
  log: ["unknown"], ts: ["unknown"], js: ["unknown"], css: ["unknown"], html: ["unknown", "svg"],
};

/** Eksekutabel/arsip aktif: SELALU ditolak untuk user, apa pun kebijakannya. */
const HARD_BLOCK_EXT = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "apk", "jar",
  "app", "deb", "rpm", "dmg", "sh", "elf", "bin", "dll",
]);

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("invalid-form");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("no-file");
  if (file.size <= 0) return jsonError("empty-file");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("too-large", 413);

  const bytes = Buffer.from(await file.arrayBuffer());

  // Nama tampilan (nama asli, dianyaki panjangnya; ≤255 seperti server).
  const originalName =
    (file.name || "file").replace(/[\r\n]+/g, " ").trim().slice(0, 255) || "file";

  // Ekstensi tersimpan: dari nama asli bila wajar, else dari mimeType.
  const extFromName = path.extname(originalName).toLowerCase();
  const ext = EXT_PATTERN.test(extFromName)
    ? extFromName
    : `.${EXT_BY_MIME[(file.type || "").toLowerCase()] ?? "bin"}`;
  const extBare = ext.replace(/^\./, "");

  // v48 — blokir ekstensi berbahaya: daftar admin + daftar keras selalu aktif.
  const blocklist = new Set(await blockedExtensions());
  for (const e of HARD_BLOCK_EXT) blocklist.add(e);
  if (blocklist.has(extBare)) {
    return jsonError(`ext-blocked:${extBare}`, 403);
  }

  // v48 — magic-bytes vs ekstensi: tolak file menyamar (hanya bila keduanya
  // dikenali dan bertentangan; teks/unknown dibiarkan lewat).
  const kind = sniffKind(bytes);
  const allowedKinds = KIND_BY_EXT[extBare];
  if (kind === "exe" || kind === "elf") {
    return jsonError("executable-blocked", 403);
  }
  if (allowedKinds && kind !== "unknown" && !allowedKinds.includes(kind)) {
    return jsonError(`mime-mismatch:${kind}`, 403);
  }

  // mimeType: kirim balik apa adanya bila masuk akal, else fallback ekstensi.
  const mimeType = MIME_PATTERN.test(file.type)
    ? file.type
    : (Object.entries(EXT_BY_MIME).find(([, e]) => `.${e}` === ext)?.[0] ??
      "application/octet-stream");

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const storedName = `${hash}${ext}`;

  try {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    const target = path.join(MEDIA_DIR, storedName);
    try {
      await fs.access(target); // dedup: isi identik sudah ada — skip tulis
    } catch {
      await fs.writeFile(target, bytes);
    }
  } catch {
    return jsonError("storage-failed", 500);
  }

  return NextResponse.json({
    ok: true,
    url: `/api/media/${storedName}`,
    fileName: originalName,
    mimeType,
    size: file.size,
  });
}
