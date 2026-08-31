/**
 * Pure helpers shared by the ChatKita chat UI (client-side only usage).
 */

import { CHAT_FONT_KEY, type ChatMessage } from "./chat-types";

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
 * `fileName` hanya untuk pesan type "file" (pratinjau daftar percakapan).
 */
export function messagePreview(
  type: string,
  content: string,
  deleted: boolean,
  fileName?: string
): string {
  if (deleted) return "🚫 Pesan ini dihapus";
  if (type === "image") return "📷 Foto";
  if (type === "voice") return "🎤 Pesan suara";
  if (type === "file") return `📎 ${fileName ?? "File"}`;
  if (type === "system") return content;
  return content;
}
