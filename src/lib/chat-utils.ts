/**
 * Pure helpers shared by the ChatKita chat UI (client-side only usage).
 */

import { CHAT_DATA_SAVER_KEY, CHAT_FONT_KEY, type ChatMessage } from "./chat-types";

/* ------------------------------ font size ------------------------------ */

export const FONT_SCALES = { sm: 13, md: 15, lg: 17 } as const;
export type FontScale = keyof typeof FONT_SCALES;

export function readFontScale(): FontScale {
  try {
    const v = window.localStorage.getItem(CHAT_FONT_KEY);
    if (v === "sm" || v === "md" || v === "lg") return v;
  } catch {
    /* ignore */
  }
  return "md";
}

export function saveFontScale(scale: FontScale): void {
  try {
    window.localStorage.setItem(CHAT_FONT_KEY, scale);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ data saver ------------------------------ */

/** Mode hemat data (v8): media berat tidak dimuat otomatis — tap untuk memuat.
 *  Thumbnail (<30 KB) tetap tampil. */
export function readDataSaver(): boolean {
  try {
    return window.localStorage.getItem(CHAT_DATA_SAVER_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDataSaver(on: boolean): void {
  try {
    window.localStorage.setItem(CHAT_DATA_SAVER_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/* ------------------------------ edit window ------------------------------ */

/** Own text messages are editable for 15 minutes (mirrors the server). */
export const EDIT_WINDOW_MS = 15 * 60_000;

export function canEditMessage(m: ChatMessage, myId: string): boolean {
  return m.senderId === myId && m.type === "text" && !m.deletedAt
    ? Date.now() - Date.parse(m.createdAt) < EDIT_WINDOW_MS
    : false;
}

/** Format an ISO 8601 timestamp as HH:MM in Indonesian locale. */
export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Initials for avatar fallbacks: first letter of the first two words,
 * or the first two characters of a single word. Max 2 uppercase letters.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

/**
 * Solid tailwind background classes (always paired with white text at the
 * call site). Chosen deterministically by hashing the name so a given
 * person always gets the same avatar color.
 */
const AVATAR_COLOR_CLASSES = [
  "bg-emerald-600",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-600",
  "bg-teal-600",
  "bg-orange-500",
  "bg-pink-600",
] as const;

export function avatarColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_COLOR_CLASSES.length;
  return AVATAR_COLOR_CLASSES[index];
}

/**
 * Human "last seen" in Indonesian, e.g. "baru saja", "5 menit lalu",
 * "2 jam lalu", "kemarin 20.31", "20.31, 12/08".
 */
export function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "offline";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "offline";
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "terakhir dilihat baru saja";
  if (diffMin < 60) return `terakhir dilihat ${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `terakhir dilihat ${diffHour} jam lalu`;
  const yesterday = new Date(Date.now() - 86400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const time = date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(date, yesterday)) return `terakhir dilihat kemarin ${time}`;
  const dayMonth = date.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
  return `terakhir dilihat ${time}, ${dayMonth}`;
}

/* ------------------------------ file helpers ------------------------------ */

/**
 * Ukuran file dalam bentuk manusiawi (gaya id-ID: koma desimal),
 * mis. "842 B", "1,5 KB", "24,8 MB". Nilai tak diketahui → "—".
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = "B";
  for (const next of ["KB", "MB", "GB"] as const) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  const maximumFractionDigits = value < 10 ? 1 : 0;
  return `${value.toLocaleString("id-ID", { maximumFractionDigits })} ${unit}`;
}

/** Kategori file untuk pemilihan ikon + cara pratinjau. */
export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "sheet"
  | "text"
  | "other";

const IMG_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg", "heic", "heif"]);
const VID_EXT = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv"]);
const AUD_EXT = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "aac", "flac"]);
const ARC_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "bz2"]);
const SHEET_EXT = new Set(["xls", "xlsx", "csv", "ods"]);
const TXT_EXT = new Set(["txt", "md", "log", "doc", "docx", "rtf", "odt"]);

/**
 * Kategori file dari mimeType (utama) + ekstensi nama file (fallback ketika
 * mimeType kosong/generik seperti application/octet-stream). Dipakai bubble,
 * viewer media, dan dialog konfirmasi lampiran.
 */
export function resolveFileKind(mimeType?: string, fileName?: string): FileKind {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  const generic = mime === "" || mime === "application/octet-stream" || mime === "application/force-download";

  if (!generic) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "application/pdf") return "pdf";
    if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "archive";
    if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "sheet";
    if (mime.startsWith("text/")) return "text";
    if (mime.includes("word") || mime.includes("wordprocessingml")) return "text";
  }

  const raw = fileName ?? "";
  const ext = raw.includes(".") ? (raw.split(".").pop() ?? "").toLowerCase() : "";
  if (IMG_EXT.has(ext)) return "image";
  if (VID_EXT.has(ext)) return "video";
  if (AUD_EXT.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (ARC_EXT.has(ext)) return "archive";
  if (SHEET_EXT.has(ext)) return "sheet";
  if (TXT_EXT.has(ext)) return "text";
  return "other";
}

/**
 * Sidebar/quote one-liner for a message of any type.
 * `fileName` hanya untuk pesan type "file" (pratinjau daftar percakapan);
 * `mediaExpired` = media sudah dihapus pembersih retensi (v8);
 * `caption` = teks yang menyertai foto/file (v20) — tampil di pratinjau.
 */
export function messagePreview(
  type: string,
  content: string,
  deleted: boolean,
  fileName?: string,
  mediaExpired?: boolean,
  caption?: string
): string {
  if (deleted) return "🚫 Pesan ini dihapus";
  if (mediaExpired) return "⏳ Media kedaluwarsa";
  if (type === "image") return caption || "📷 Foto";
  if (type === "voice") return "🎤 Pesan suara";
  if (type === "file") return caption || `📎 ${fileName ?? "File"}`;
  if (type === "system") return content;
  return content;
}

/* ------------------------- pipeline media (v8) ------------------------- */

/** Batas ukuran file yang diunggah ke /api/upload (25 MiB). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface UploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * POST /api/upload — simpan blob/file ke db/media (SHA-256 dedup di server)
 * dan dapatkan URL publik /api/media/<nama> + metadata. Melempar Error bila
 * gagal; pemanggil menampilkan pesan kesalahan.
 *
 * v20 — pakai XHR agar bisa melaporkan progres unggahan (0–100) lewat
 * callback `onProgress` (fetch tidak punya event progress upload).
 */
export type UploadProgress = (percent: number) => void;

export async function uploadMedia(
  file: File,
  onProgress?: UploadProgress
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    xhr.responseType = "json";
    xhr.timeout = 5 * 60_000; // file 25 MB pada koneksi lambat
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      const data = (typeof xhr.response === "object" && xhr.response !== null
        ? xhr.response
        : null) as (UploadResult & { ok: true }) | { ok: false; error: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok === true) {
        onProgress?.(100);
        resolve(data);
      } else {
        reject(new Error("upload-failed"));
      }
    };
    xhr.onerror = () => reject(new Error("upload-failed"));
    xhr.ontimeout = () => reject(new Error("upload-failed"));
    xhr.onabort = () => reject(new Error("upload-failed"));
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}

/**
 * Kompres foto di browser (meringankan server & bandwidth): full ≤1600px
 * JPEG q0.82 + thumbnail ≤320px q0.6 (biasanya <30 KB). Gagal decode
 * (mis. HEIC) melempar Error — pemanggil boleh fallback unggah file asli.
 */
export async function compressImageToBlobs(
  file: File
): Promise<{ full: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file);
  const draw = (max: number, quality: number): Promise<Blob> => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolveBlob, rejectBlob) =>
      canvas.toBlob(
        (b) => (b ? resolveBlob(b) : rejectBlob(new Error("blob"))),
        "image/jpeg",
        quality
      )
    );
  };
  try {
    const full = await draw(1600, 0.82);
    const thumb = await draw(320, 0.6);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

/**
 * Thumbnail video (poster): ambil satu frame sebagai JPEG kecil via
 * <video> tersembunyi. Best-effort — null bila browser menolak/timeout.
 */
export async function videoPosterBlob(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 4000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("video"));
      };
    });
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 320;
    const scale = Math.min(1, 320 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.6)
    );
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ----------------------- v42 — slash commands ----------------------- */

/** Hasil parsing slash command (v42). */
export interface SlashResult {
  /** true bila input dikenali sebagai perintah (tidak dikirim mentah). */
  handled: boolean;
  /** Teks hasil transformasi (null bila tidak layak dikirim, mis. /me kosong). */
  text: string | null;
}

/**
 * v42 — slash commands diparse di KLIEN sebelum kirim (tanpa event server):
 *   /dadu          → "🎲 Dadu: N (1–6)"
 *   /koin          → "🪙 Koin: Kepala/Ekor"
 *   /me <teks>     → "✦ <nama> <teks>"
 *   /shrug <teks>  → "<teks> ¯\_(ツ)_/¯"
 * Nama pengirim diambil dari konteks pemanggil (admin → "Admin").
 */
export function applySlashCommand(raw: string, senderName: string): SlashResult {
  const content = raw.trim();
  if (!content.startsWith("/")) return { handled: false, text: null };
  const spaceIdx = content.indexOf(" ");
  const cmd = (spaceIdx === -1 ? content : content.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : content.slice(spaceIdx + 1).trim();
  switch (cmd) {
    case "/dadu":
      return { handled: true, text: `🎲 Dadu: ${1 + Math.floor(Math.random() * 6)} (1–6)` };
    case "/koin":
      return { handled: true, text: `🪙 Koin: ${Math.random() < 0.5 ? "Kepala" : "Ekor"}` };
    case "/me":
      return { handled: true, text: rest ? `✦ ${senderName} ${rest}` : null };
    case "/shrug":
      return { handled: true, text: `${rest} ¯\\_(ツ)_/¯`.trim() };
    default:
      return { handled: false, text: null };
  }
}

/* ------------------------- v42 — export PDF ------------------------- */

/** Metadata percakapan untuk ekspor PDF (v42). */
export interface ChatPdfMeta {
  /** Judul dokumen (mis. "Chat dengan Admin" / nama partner). */
  title: string;
  /** Baris kecil di bawah judul (mis. "13 pesan"). */
  subtitle?: string;
  /** ID viewer → bubble kanan = pesan milik viewer. */
  viewerId: string;
  /** Nama tampilan viewer (label bubble kanan). */
  viewerName: string;
  /** Nama tampilan partner (label bubble kiri). */
  partnerName: string;
}

/**
 * v42 — ekspor chat ke PDF MURNI DI KLIEN (0 dependensi baru): buka tab
 * baru, tulis HTML bergaya rapi (bubble kiri/kanan ala chat), lalu
 * window.print() — browser menyediakan dialog Save-as-PDF. Data diambil
 * dari messagesMap/daftar pesan yang sudah ada. Return false bila popup
 * diblokir browser.
 */
export function exportChatPdf(messages: ChatMessage[], meta: ChatPdfMeta): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  let lastDay = "";
  const rows: string[] = [];
  for (const m of messages) {
    // Pesan terjadwal yang BELUM terkirim tidak ikut ke PDF.
    if (m.scheduledAt) continue;
    const day = new Date(m.createdAt).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (day !== lastDay) {
      lastDay = day;
      rows.push(`<div class="day">${day}</div>`);
    }
    const mine = m.senderId === meta.viewerId;
    const deleted = !!m.deletedAt;
    let inner: string;
    if (m.type === "system") {
      rows.push(`<div class="sysnote">${esc(m.content)}</div>`);
      continue;
    } else if (deleted) {
      inner = "<em>Pesan ini dihapus</em>";
    } else if (m.poll) {
      const counts = m.poll.counts ?? [];
      const total = m.poll.total ?? 0;
      const opts = m.poll.options
        .map((o, i) => {
          const pct = total > 0 ? Math.round(((counts[i] ?? 0) / total) * 100) : 0;
          return `<li>${esc(o)}${total > 0 ? ` — <b>${pct}%</b>` : ""}</li>`;
        })
        .join("");
      inner = `${esc(m.poll.q)}<ul class="poll">${opts}</ul>${
        total > 0 ? `<span class="pollmeta">${total} suara</span>` : ""
      }`;
    } else if (m.type === "image") {
      inner = `📷 Foto${m.caption ? `: ${esc(m.caption)}` : ""}`;
    } else if (m.type === "voice") {
      const dur = m.durationMs ? ` (${Math.max(1, Math.round(m.durationMs / 1000))} dtk)` : "";
      const tr = m.transcript ? `<br/><small>📝 ${esc(m.transcript)}</small>` : "";
      inner = `🎤 Pesan suara${dur}${tr}`;
    } else if (m.type === "file") {
      inner = `📎 ${esc(m.fileName ?? "File")}${m.caption ? `: ${esc(m.caption)}` : ""}`;
    } else {
      inner = esc(m.content).replace(/\n/g, "<br/>");
    }
    const who = `<span class="who">${esc(mine ? meta.viewerName : meta.partnerName)}</span>`;
    const meta2 = `<span class="time">${fmtTime(m.createdAt)}${m.editedAt ? " · diedit" : ""}</span>`;
    rows.push(
      `<div class="row ${mine ? "right" : "left"}"><div class="bubble ${mine ? "mine" : "theirs"}">${who}${inner}${meta2}</div></div>`
    );
  }
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<title>ChatKita — ${esc(meta.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f4f6f5; color: #111; }
  header { padding: 18px 24px 10px; border-bottom: 2px solid #059669; background: #fff; }
  header h1 { margin: 0; font-size: 18px; color: #047857; }
  header p { margin: 4px 0 0; font-size: 12px; color: #666; }
  main { padding: 16px 24px 8px; }
  .day { text-align: center; font-size: 11px; color: #888; margin: 14px 0 8px; }
  .row { display: flex; margin: 6px 0; }
  .row.left { justify-content: flex-start; }
  .row.right { justify-content: flex-end; }
  .bubble { max-width: 72%; border-radius: 14px; padding: 7px 11px; font-size: 13px; line-height: 1.45; box-shadow: 0 1px 1px rgba(0,0,0,.06); }
  .bubble.theirs { background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
  .bubble.mine { background: #059669; color: #fff; border-bottom-right-radius: 4px; }
  .bubble.mine .who { color: #d1fae5; }
  .who { display: block; font-size: 10px; font-weight: 700; color: #059669; margin-bottom: 2px; }
  .time { display: block; text-align: right; font-size: 9px; opacity: .65; margin-top: 2px; }
  .poll { margin: 6px 0 2px; padding-left: 18px; }
  .poll li { margin: 2px 0; }
  .pollmeta { font-size: 10px; opacity: .7; }
  .sysnote { text-align: center; font-size: 11px; color: #888; margin: 8px 0; }
  footer { padding: 10px 24px 16px; text-align: center; font-size: 10px; color: #999; }
  @media print { body { background: #fff; } .bubble { box-shadow: none; } }
</style></head>
<body>
<header><h1>${esc(meta.title)}</h1><p>${esc(meta.subtitle ?? "")}</p></header>
<main>${rows.join("")}</main>
<footer>Dihasilkan ChatKita · ${esc(new Date().toLocaleString("id-ID"))}</footer>
</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  try {
    win.print();
  } catch {
    /* headless/browser tanpa dialog print — tab tetap terbuka */
  }
  return true;
}
