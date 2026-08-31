import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/media/<name> — melayani file yang diunggah lewat POST /api/upload
 * (tersimpan di db/media/).
 *
 *   - Default  : inline preview (gambar/video/audio/pdf tampil di viewer chat).
 *   - ?download=1 : Content-Disposition attachment (paksa unduh), nama file
 *     diambil dari query `?name=` (nama asli, disanitasi) — jadi SETIAP file
 *     bisa disimpan dari dalam aplikasi dengan nama aslinya.
 *   - text/html & image/svg+xml SELALU attachment (stored-XSS safety).
 *
 * Nama divalidasi ketat: [A-Za-z0-9._-] tanpa ".." — tidak ada traversal.
 */

export const runtime = "nodejs";

const MEDIA_DIR = path.join(process.cwd(), "db", "media");
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

/** Content-Type dari ekstensi; fallback application/octet-stream (unduh aman). */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  opus: "audio/opus",
  oga: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function notFound() {
  return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
}

/**
 * Nama attachment dari query `?name=`: buang karakter kontrol/kutip/pemisah
 * header, batasi 255 karakter. Fallback: nama tersimpan (sudah punya ekstensi).
 */
function attachmentName(raw: string | null, storedName: string): string {
  const cleaned = (raw ?? "")
    .slice(0, 255)
    .replace(/[\r\n\x00-\x1f"\\/]/g, "")
    .trim();
  if (cleaned) return cleaned;
  const ext = MIME_BY_EXT[storedName.split(".").pop()?.toLowerCase() ?? ""]
    ? `.${storedName.split(".").pop()}`
    : "";
  return `file${ext}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  // Validasi ketat sebelum menyentuh filesystem.
  if (!NAME_PATTERN.test(name) || name.includes("..")) return notFound();

  const filePath = path.join(MEDIA_DIR, name);
  // Defense in depth: hasil resolve wajib tetap di dalam db/media/.
  if (path.resolve(filePath) !== path.join(path.resolve(MEDIA_DIR), name)) {
    return notFound();
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return notFound();
  }

  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  const wantsDownload =
    req.nextUrl.searchParams.get("download") === "1" ||
    req.nextUrl.searchParams.get("download") === "true";
  // html/svg dipaksa unduh supaya tidak bisa dieksekusi di origin kita.
  const forceAttachment = mime === "text/html" || mime === "image/svg+xml";
  const disposition = wantsDownload || forceAttachment ? "attachment" : "inline";

  const fileName = attachmentName(req.nextUrl.searchParams.get("name"), name);
  const asciiFallback =
    fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || name;

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
