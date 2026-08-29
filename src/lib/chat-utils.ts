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
