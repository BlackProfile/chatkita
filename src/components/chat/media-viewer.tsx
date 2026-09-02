"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
 *
 * Task 19 — mode galeri "geser-gesir": viewer menerima daftar LENGKAP media
 * yang bisa dilihat (foto + video, urutan pesan) dari percakapan yang
 * terbuka + index item yang dibuka. Navigasi: tombol chevron (desktop
 * hover), swipe sentuh kiri/kanan (threshold ~50 px, scroll vertikal aman),
 * dan tombol panah keyboard. Chip posisi "3 / 12" di tengah atas. Dengan
 * satu item saja, panah + counter disembunyikan. Escape menutup (Radix).
 * Elemen video/audio di-unmount saat pindah item (key=url) supaya tidak ada
 * audio "hantu". Gambar mendukung zoom ketuk-dua-kali / klik-dua-kali.
 */

/** Satu item media untuk viewer (pesan file memuat metadata lengkap). */
export interface ViewerMedia {
  url: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  /** id pesan sumber — dipakai untuk memetakan posisi galeri. */
  sourceId?: number;
}

/** Struktur minimum pesan untuk membangun galeri (kompatibel ChatMessage). */
export interface GalleryMessageLike {
  id: number;
  type: string;
  content: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  deletedAt?: string | null;
  mediaExpiredAt?: string | null;
}

/** State viewer: item terbuka + galeri percakapan + posisi item di galeri. */
export interface ViewerState {
  /** Sesi buka (monoton naik) — key remount agar posisi selalu reset. */
  seq: number;
  media: ViewerMedia;
  /** Foto + video percakapan (urutan pesan); minimal berisi [media]. */
  gallery: ViewerMedia[];
  index: number;
}

let VIEWER_SEQ = 0;

function makeViewerState(
  media: ViewerMedia,
  gallery: ViewerMedia[],
  index: number
): ViewerState {
  VIEWER_SEQ += 1;
  return { seq: VIEWER_SEQ, media, gallery, index };
}

/**
 * Bangun daftar galeri dari pesan percakapan: HANYA foto + video yang masih
 * hidup (bukan terhapus / kedaluwarsa), dalam urutan pesan.
 */
export function buildMediaGallery(messages: GalleryMessageLike[]): ViewerMedia[] {
  const out: ViewerMedia[] = [];
  for (const m of messages) {
    if (m.deletedAt || m.mediaExpiredAt) continue;
    if (m.type === "image") {
      out.push({
        url: m.content,
        mimeType: m.mimeType,
        fileName: m.fileName,
        fileSize: m.fileSize,
        sourceId: m.id,
      });
    } else if (m.type === "file") {
      const kind = resolveFileKind(m.mimeType, m.fileName);
      if (kind === "image" || kind === "video") {
        out.push({
          url: m.content,
          mimeType: m.mimeType,
          fileName: m.fileName,
          fileSize: m.fileSize,
          sourceId: m.id,
        });
      }
    }
  }
  return out;
}

/**
 * Bentuk ViewerState untuk pesan yang diketuk: index dihitung dari id pesan
 * di galeri; pesan non-galeri (PDF, dokumen, audio, …) dibuka sendirian
 * (galeri [item] tanpa navigasi).
 */
export function viewerStateForMessage(
  gallery: ViewerMedia[],
  message: GalleryMessageLike
): ViewerState {
  const media: ViewerMedia = {
    url: message.content,
    mimeType: message.mimeType,
    fileName: message.fileName,
    fileSize: message.fileSize,
    sourceId: message.id,
  };
  const idx = gallery.findIndex((g) => g.sourceId === message.id);
  if (idx >= 0) return makeViewerState(gallery[idx], gallery, idx);
  return makeViewerState(media, [media], 0);
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
  state,
  onClose,
}: {
  state: ViewerState | null;
  onClose: () => void;
}) {
  // Tanpa hooks di sini: null-check sebelum merender komponen ber-hook,
  // dan key=seq memastikan posisi/zoom di-reset tiap kali dibuka.
  if (!state) return null;
  return <ViewerDialog key={state.seq} state={state} onClose={onClose} />;
}

function ViewerDialog({
  state,
  onClose,
}: {
  state: ViewerState;
  onClose: () => void;
}) {
  const gallery = state.gallery;
  const total = gallery.length;
  const canNavigate = total > 1;

  const [pos, setPos] = useState(() =>
    Math.min(Math.max(state.index, 0), Math.max(total - 1, 0))
  );
  const [zoomed, setZoomed] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!canNavigate) return;
      setZoomed(false);
      setPos((p) => (p + dir + total) % total);
    },
    [canNavigate, total]
  );

  /* Navigasi keyboard (Escape ditangani Radix Dialog). */
  useEffect(() => {
    if (!canNavigate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNavigate, go]);

  const current = gallery[pos] ?? state.media;

  // Perkaya metadata: data URL menyimpan mime di prefiks, URL /api/media
  // menyimpan ekstensi di path — dipakai ketika mimeType tidak dikirim.
  let mime = current.mimeType?.toLowerCase();
  let name = current.fileName;
  if (!mime && current.url.startsWith("data:")) {
    const match = /^data:([^;,]+)/.exec(current.url);
    if (match) mime = match[1];
  }
  if (!name && !current.url.startsWith("data:")) {
    try {
      const pathname = new URL(current.url, window.location.origin).pathname;
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
  const href = downloadHref(current, displayName);
  const isImage = kind === "image";

  /* Swipe: abaikan sentuhan di kontrol interaktif (video/audio/iframe/
   * tombol) agar scrubber & tombol putar tidak memicu navigasi. */
  const touchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("video, audio, iframe, button, a, input")) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const touchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;

    if (moved) {
      // Geser horizontal → navigasi (scroll vertikal tidak terganggu:
      // gesture vertikal lolos begitu saja + container pakai touch-action pan-y).
      if (!zoomed && canNavigate && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        go(dx < 0 ? 1 : -1);
      }
      return;
    }
    // Ketukan (bukan geser): ketuk dua kali < 300 ms → toggle zoom (gambar).
    if (!isImage) return;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      setZoomed((z) => !z);
    } else {
      lastTapRef.current = now;
    }
  };

  const swipeProps = {
    onTouchStart: touchStart,
    onTouchEnd: touchEnd,
    style: { touchAction: (zoomed ? "auto" : "pan-y") as React.CSSProperties["touchAction"] },
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[95vh] w-full max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl border-white/10 bg-black p-3 text-white sm:max-w-3xl sm:p-4">
        <DialogTitle className="sr-only">Pratinjau {displayName}</DialogTitle>
        <DialogDescription className="sr-only">
          Pratinjau lampiran yang dikirim di chat. Tutup dengan tombol silang atau tekan Escape.
          {canNavigate ? " Geser atau tekan panah kiri/kanan untuk pindah media." : ""}
        </DialogDescription>

        {/* Chip posisi galeri: "3 / 12" (sembunyi bila satu-satunya) */}
        {canNavigate ? (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs font-medium tabular-nums text-white">
            {pos + 1} / {total}
          </div>
        ) : null}

        {/* Isi pratinjau per jenis. v20 — panggung TETAP tinggi (72vh):
            media kecil pun dirender BESAR memenuhi panggung (object-contain),
            tidak lagi mengikuti dimensi asli file. */}
        {isImage ? (
          <div
            {...swipeProps}
            className={cn(
              "flex h-[72vh] w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black",
              zoomed && "items-start justify-start overflow-auto"
            )}
          >
            <img
              src={current.url}
              alt={displayName}
              draggable={false}
              onDoubleClick={() => setZoomed((z) => !z)}
              className={cn(
                "object-contain",
                zoomed
                  ? "w-[200%] max-w-none shrink-0 cursor-zoom-out"
                  : "h-full w-full cursor-zoom-in"
              )}
            />
          </div>
        ) : kind === "video" ? (
          <div
            {...swipeProps}
            className="flex h-[72vh] w-full shrink-0 items-center justify-center"
          >
            {/* key=url: elemen lama benar-benar di-unmount saat navigasi
                (tidak ada audio/video "hantu" yang terus berjalan). */}
            <video
              key={current.url}
              src={current.url}
              controls
              autoPlay
              playsInline
              className="h-full w-full rounded-lg bg-black object-contain"
            />
          </div>
        ) : kind === "audio" ? (
          <div
            {...swipeProps}
            className="flex min-h-40 flex-1 items-center justify-center"
          >
            <audio key={current.url} src={current.url} controls className="w-64 max-w-full" />
          </div>
        ) : kind === "pdf" ? (
          <iframe
            src={current.url}
            title={displayName}
            className="h-[72vh] w-full rounded-lg bg-white"
          />
        ) : (
          <div
            {...swipeProps}
            className="flex min-h-52 flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-white/5 p-6 text-center"
          >
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

        {/* Chevron galeri: samar di desktop, terang saat hover / selalu
            terlihat di layar sentuh; sembunyi bila daftar hanya satu. */}
        {canNavigate ? (
          <>
            <button
              type="button"
              aria-label="Media sebelumnya"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-2 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-70 transition hover:bg-black/75 hover:opacity-100 md:opacity-40 md:hover:opacity-100"
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Media berikutnya"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-2 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-70 transition hover:bg-black/75 hover:opacity-100 md:opacity-40 md:hover:opacity-100"
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </>
        ) : null}

        {/* Footer selalu tampil: nama + ukuran + Unduh (semua jenis file) */}
        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-white/60">
              {current.fileSize != null
                ? formatFileSize(current.fileSize)
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
