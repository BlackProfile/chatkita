import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/upload — menerima satu file (multipart form-data, field `file`)
 * dari composer chat, menyimpannya di db/media/ dengan nama acak yang aman,
 * lalu mengembalikan URL publik /api/media/<nama> beserta metadata file.
 *
 * Kontrak dengan chat-service (lihat src/lib/chat-types.ts):
 *   - url        harus cocok /^\/api\/media\/[A-Za-z0-9._-]{1,120}$/
 *   - fileName   1–255 karakter (nama asli, HANYA untuk tampilan)
 *   - mimeType   type/subtype, ≤ 100 karakter
 *   - size       ≤ 25 MiB (divalidasi juga di sini → 413)
 *
 * Nama asli TIDAK PERNAH dipakai di path penyimpanan — hanya UUID + ekstensi
 * tersanitasi (alfanumerik, ≤ 8 huruf, default "bin").
 */

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB — mirror chat-service
const MEDIA_DIR = path.join(process.cwd(), "db", "media");

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Ekstensi aman dari nama asli: alfanumerik, ≤ 8 huruf, default "bin". */
function safeExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "bin";
  const cleaned = name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!cleaned) return "bin";
  return cleaned.slice(0, 8);
}

/** mimeType yang lolos validasi chat-service: bare type/subtype ≤ 100 karakter. */
function sanitizeMimeType(raw: string): string {
  const value = raw.split(";")[0].trim().toLowerCase();
  if (
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value)
  ) {
    return value;
  }
  return "application/octet-stream";
}

export async function POST(req: NextRequest) {
  let file: File;
  try {
    const formData = await req.formData();
    const entry = formData.get("file");
    if (!entry || typeof entry === "string") {
      return jsonError("Field `file` tidak ditemukan.", 400);
    }
    file = entry as File;
  } catch {
    return jsonError("Body harus multipart/form-data.", 400);
  }

  if (file.size <= 0) {
    return jsonError("File kosong.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonError("File terlalu besar (maks 25 MB).", 413);
  }

  const originalName = (file.name || "file").slice(0, 255);
  const mimeType = sanitizeMimeType(file.type);
  const stored = `${randomUUID()}.${safeExtension(originalName)}`;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(path.join(MEDIA_DIR, stored), bytes);
  } catch (err) {
    console.error("[upload] gagal menyimpan file:", err);
    return jsonError("Gagal menyimpan file.", 500);
  }

  return NextResponse.json({
    ok: true,
    url: `/api/media/${stored}`,
    fileName: originalName,
    mimeType,
    size: bytes.length,
  });
}

// Non-POST (mis. GET dari browser) → 400 JSON, sesuai kontrak.
export async function GET() {
  return jsonError("Gunakan POST multipart/form-data.", 400);
}
