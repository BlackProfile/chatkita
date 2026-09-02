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
