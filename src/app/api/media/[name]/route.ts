import { promises as fs, type Stats } from "node:fs";
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
 * v8 — penghematan beban server:
 *   - ETag kuat `"<sizeHex>-<mtimeHex>"` + If-None-Match → 304 tanpa body
 *     (browser memakai ulang salinan cache; isi file tidak dibaca/dikirim).
 *   - `Accept-Ranges: bytes` + dukungan HTTP Range (bentuk tunggal
 *     `bytes=S-E` / `bytes=-N`) → 206 dengan potongan byte untuk seek
 *     video/audio; range yang mulai di luar ukuran file → 416 dengan
 *     header Content-Range yang menyatakan total ukuran file.
 *
 * Nama divalidasi ketat: [A-Za-z0-9._-] tanpa ".." — tidak ada traversal.
 */

export const runtime = "nodejs";

const MEDIA_DIR = path.join(process.cwd(), "db", "media");
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
const CACHE_IMMUTABLE = "private, max-age=31536000, immutable";

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

  // v8: stat dulu — ukuran + mtime cukup untuk ETag & perhitungan Range,
  // sehingga 304 bisa dijawab TANPA membaca isi file sama sekali.
  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return notFound();
  }
  // Direktori bukan media yang valid (readFile lama gagal EISDIR → 404 juga).
  if (!stat.isFile()) return notFound();

  // ETag kuat dari ukuran + mtime (hex): file tersimpan immutable (dedup
  // SHA-256 di /api/upload), jadi pasangan ini stabil sebagai identitas versi.
  const etag = `"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

  // If-None-Match memuat ETag persis ini → cache browser masih valid → 304.
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.includes(etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": CACHE_IMMUTABLE },
    });
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
  const contentDisposition = `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

  // v8: parse Range — HANYA bentuk tunggal `bytes=S-E` / `bytes=-N`.
  // Selain itu (multi-range berkoma, unit lain, "bytes=-" kosong dua-duanya)
  // header diabaikan → layani 200 penuh.
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let range: { start: number; end: number } | null = null;
  let unsatisfiable = false;

  if (rangeMatch && !(rangeMatch[1] === "" && rangeMatch[2] === "")) {
    const size = stat.size;
    // Suffix `bytes=-N` → N byte terakhir (clamp ke 0);
    // normal `bytes=S-E` → clamp E ke akhir file; `bytes=S-` → sampai akhir.
    const start =
      rangeMatch[1] === ""
        ? Math.max(0, size - Number(rangeMatch[2]))
        : Number(rangeMatch[1]);
    const end =
      rangeMatch[1] === "" || rangeMatch[2] === ""
        ? size - 1
        : Math.min(Number(rangeMatch[2]), size - 1);
    if (size > 0 && start >= size) {
      // Tidak ada byte yang memenuhi range → 416.
      unsatisfiable = true;
    } else if (start <= end) {
      range = { start, end };
    }
    // Range sampah (start > end, mis. "100-50") → header diabaikan → 200 penuh.
  }

  if (unsatisfiable) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return notFound();
  }

  if (range) {
    // 206: potongan byte yang diminta (seek video/audio di player).
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Content-Type": mime,
        "Content-Length": String(slice.length),
        "Cache-Control": CACHE_IMMUTABLE,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": contentDisposition,
      },
    });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": CACHE_IMMUTABLE,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition,
      ETag: etag,
      "Accept-Ranges": "bytes",
    },
  });
}
