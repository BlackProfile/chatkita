import { cn } from "@/lib/utils";

/**
 * Pemisah tanggal WhatsApp-style — chip kecil di tengah daftar pesan,
 * ditampilkan di atas pesan PERTAMA setiap hari. Dipakai bersama oleh
 * Messenger (user) dan AdminPanel (admin).
 */

/** Kunci hari lokal ("2025-8-31") — pesan dalam satu hari berbagi kunci. */
export function dayKey(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const DAY_NAMES = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
] as const;

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/** Label ramah: Hari ini / Kemarin / nama hari (≤6 hari) / "31 Agustus". */
export function dayLabel(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  const startOfDay = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  ).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86_400_000);

  if (diffDays <= 0) return "Hari ini";
  if (diffDays === 1) return "Kemarin";
  if (diffDays <= 6) return DAY_NAMES[d.getDay()];
  const sameYear = d.getFullYear() === today.getFullYear();
  return sameYear
    ? `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
    : `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Chip tanggal di tengah — render di atas pesan pertama setiap hari. */
export function DaySeparator({
  createdAt,
  className,
}: {
  createdAt: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex justify-center py-1", className)}
      role="separator"
      aria-label={dayLabel(createdAt)}
    >
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
        {dayLabel(createdAt)}
      </span>
    </div>
  );
}
