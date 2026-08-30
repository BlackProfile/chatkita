/**
 * Small presentation helpers shared by the ChatKita chat UI.
 * Pure functions only — safe to import from client components.
 */

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

/** Sidebar/quote one-liner for a message of any type. */
export function messagePreview(
  type: string,
  content: string,
  deleted: boolean
): string {
  if (deleted) return "🚫 Pesan ini dihapus";
  if (type === "image") return "📷 Foto";
  if (type === "voice") return "🎤 Pesan suara";
  if (type === "system") return content;
  return content;
}
