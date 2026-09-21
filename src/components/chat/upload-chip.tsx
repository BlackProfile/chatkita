"use client";

/**
 * v18 — chip lampiran di atas composer (foto & file) TANPA dialog.
 * Saat mengunggah: persentase nyata (XHR upload.onprogress) + strip progres
 * di tepi bawah chip. Saat siap: tombol X untuk membatalkan.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface UploadChipProps {
  /** URL pratinjau (foto terkompresi) — kosong bila memakai `icon`. */
  thumbUrl?: string;
  /** Node ikon (FileKindIcon) untuk file non-gambar. */
  icon?: ReactNode;
  /** Judul chip: nama file / "Foto siap dikirim". */
  title: string;
  /** Subjudul: ukuran file dsb. (opsional). */
  subtitle?: string;
  /** 0–100 saat mengunggah; null = siap dikirim (belum mengalir). */
  progress: number | null;
  /** Label aria untuk tombol buang (mis. "Batal kirim file"). */
  removeLabel: string;
  onRemove: () => void;
}

export function UploadChip({
  thumbUrl,
  icon,
  title,
  subtitle,
  progress,
  removeLabel,
  onRemove,
}: UploadChipProps) {
  const uploading = progress !== null;
  return (
    <div
      className="relative mx-3 mb-1 flex items-center gap-2 overflow-hidden rounded-xl border bg-card/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
      {...(uploading
        ? {
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": progress,
            "aria-label": `Mengunggah ${progress}%`,
          }
        : {})}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt="Pratinjau foto"
          className="size-10 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-snug">{title}</p>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {uploading ? (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {progress}%
        </span>
      ) : (
        <button
          type="button"
          aria-label={removeLabel}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="size-4" />
        </button>
      )}
      {/* Strip progres di tepi bawah chip */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[3px] bg-transparent"
      >
        <div
          className="h-full rounded-r-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-[width] duration-200 ease-out"
          style={{ width: `${uploading ? Math.max(3, progress) : 0}%` }}
        />
      </div>
    </div>
  );
}
