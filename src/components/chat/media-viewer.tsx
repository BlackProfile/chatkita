"use client";

import {
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFileSize, resolveFileKind, type FileKind } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * Viewer media full-screen (pengganti lightbox gambar lama). Dipakai bareng
 * oleh Messenger (user) dan AdminPanel (admin) lewat prop `onMediaOpen` di
 * ChatBubble — jadi SEMUA jenis lampiran (foto, video, audio, PDF, dokumen)
 * bisa dibuka & diunduh dari dalam aplikasi.
 */

/** Satu item media untuk viewer (pesan file memuat metadata lengkap). */
export interface ViewerMedia {
  url: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  archive: FileArchive,
  sheet: FileSpreadsheet,
  text: FileText,
  other: File,
};

/** Ikon lucide untuk kategori file (dipakai bubble + dialog konfirmasi). */
export function FileKindIcon({
  mimeType,
  fileName,
  className,
}: {
  mimeType?: string;
  fileName?: string;
  className?: string;
}) {
  const Icon = KIND_ICONS[resolveFileKind(mimeType, fileName)];
  return <Icon className={className} aria-hidden="true" />;
}

/** href unduh: data URL dipakai apa adanya, /api/media pakai ?download=1&name=. */
function downloadHref(media: ViewerMedia, displayName: string): string {
  if (media.url.startsWith("data:")) return media.url;
  return `${media.url}?download=1&name=${encodeURIComponent(displayName)}`;
}

export function MediaViewer({
  media,
  onClose,
}: {
  media: ViewerMedia | null;
  onClose: () => void;
}) {
  if (!media) return null;

  // Perkaya metadata: data URL menyimpan mime di prefiks, URL /api/media
  // menyimpan ekstensi di path — dipakai ketika mimeType tidak dikirim.
  let mime = media.mimeType?.toLowerCase();
  let name = media.fileName;
  if (!mime && media.url.startsWith("data:")) {
    const match = /^data:([^;,]+)/.exec(media.url);
    if (match) mime = match[1];
  }
  if (!name && !media.url.startsWith("data:")) {
    try {
      const pathname = new URL(media.url, window.location.origin).pathname;
      const last = pathname.split("/").pop() ?? "";
      if (last && /\.[a-z0-9]{1,8}$/i.test(last)) {
        name = decodeURIComponent(last);
      }
    } catch {
      /* URL tidak valid — biarkan tanpa nama */
    }
  }

  const kind = resolveFileKind(mime, name);
  const displayName = name || "File";
  const href = downloadHref(media, displayName);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[95vh] w-full max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl border-white/10 bg-black p-3 text-white sm:max-w-3xl sm:p-4">
        <DialogTitle className="sr-only">Pratinjau {displayName}</DialogTitle>
        <DialogDescription className="sr-only">
          Pratinjau lampiran yang dikirim di chat. Tutup dengan tombol silang atau tekan Escape.
        </DialogDescription>

        {/* Isi pratinjau per jenis */}
        {kind === "image" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <img
              src={media.url}
              alt={displayName}
              className="max-h-[72vh] max-w-full rounded-lg object-contain"
            />
          </div>
        ) : kind === "video" ? (
          <video
            src={media.url}
            controls
            autoPlay
            playsInline
            className="max-h-[72vh] w-full rounded-lg bg-black"
          />
        ) : kind === "audio" ? (
          <div className="flex min-h-40 flex-1 items-center justify-center">
            <audio src={media.url} controls className="w-64 max-w-full" />
          </div>
        ) : kind === "pdf" ? (
          <iframe
            src={media.url}
            title={displayName}
            className="h-[72vh] w-full rounded-lg bg-white"
          />
        ) : (
          <div className="flex min-h-52 flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-white/5 p-6 text-center">
            <FileQuestion className="size-10 text-white/50" aria-hidden="true" />
            <p className="text-sm font-medium">Pratinjau tidak tersedia</p>
            <p className="text-xs text-white/60">
              Unduh untuk membuka file ini di perangkat Anda.
            </p>
            <Button
              asChild
              className="mt-1 h-10 bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              <a href={href} download={displayName}>
                <Download className="size-4" aria-hidden="true" />
                Unduh
              </a>
            </Button>
          </div>
        )}

        {/* Footer selalu tampil: nama + ukuran + Unduh (semua jenis file) */}
        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-white/60">
              {media.fileSize != null
                ? formatFileSize(media.fileSize)
                : mime || "Lampiran"}
            </p>
          </div>
          <a
            href={href}
            download={displayName}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-sm font-medium text-white",
              "transition-colors hover:bg-emerald-600/90"
            )}
          >
            <Download className="size-4" aria-hidden="true" />
            Unduh
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
