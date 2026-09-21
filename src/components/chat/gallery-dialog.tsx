"use client";

/**
 * v9 — Conversation media gallery: every photo/video/voice/file of one
 * conversation in a single dialog, powered by the `messages:gallery`
 * socket event (server-side index, newest first, cap 200). Clicking an
 * item jumps to the original message in the chat.
 */

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { FileText, Images, Loader2, Mic } from "lucide-react";

import { FileKindIcon } from "@/components/chat/media-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AckOf, GalleryAck, GalleryItem } from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";

/** "2:31" style duration label (kept local to avoid wider exports). */
function formatDuration(ms: number | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function GalleryDialog({
  open,
  onOpenChange,
  socket,
  conversationId,
  onJump,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  conversationId: string;
  /** Jump to the original message (closes the dialog first). */
  onJump: (messageId: number) => void;
}) {
  /** null = still loading; ok=false = server error. */
  const [result, setResult] = useState<{ ok: boolean; items: GalleryItem[] } | null>(null);
  const loadSeq = useRef(0);

  // The parent mounts this dialog fresh per open, so state starts clean.
  useEffect(() => {
    if (!open || !socket) return;
    const seq = ++loadSeq.current;
    socket.emit(
      "messages:gallery",
      { conversationId },
      (res: AckOf<GalleryAck>) => {
        if (seq !== loadSeq.current) return;
        setResult(res.ok ? { ok: true, items: res.items } : { ok: false, items: [] });
      }
    );
  }, [open, socket, conversationId]);

  const items = result?.ok ? result.items : [];
  const loading = !!socket && result === null;
  const failed = !!socket && result !== null && !result.ok;

  const media = (items ?? []).filter((i) => i.type === "image" || (i.type === "file" && (i.mimeType ?? "").startsWith("video/")));
  const voice = (items ?? []).filter((i) => i.type === "voice");
  const files = (items ?? []).filter(
    (i) => i.type === "file" && !(i.mimeType ?? "").startsWith("video/")
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Images className="size-5 text-emerald-600" aria-hidden="true" />
            Galeri media
          </DialogTitle>
          <DialogDescription>
            Semua foto, video, pesan suara, dan file di percakapan ini (maks 200
            terbaru). Ketuk untuk melompat ke pesan aslinya.
          </DialogDescription>
        </DialogHeader>

        {!socket ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Tidak terhubung.</p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat…
          </p>
        ) : failed ? (
          <p className="py-10 text-center text-sm text-destructive">Gagal memuat galeri.</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Belum ada media di percakapan ini.
          </p>
        ) : (
          <div className="chat-scroll max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {media.length > 0 ? (
              <section aria-label="Foto dan video">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Foto &amp; video
                </h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {media.map((item) => {
                    const isVideo = item.type === "file";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="group relative aspect-square overflow-hidden rounded-lg bg-muted"
                        aria-label={`${isVideo ? "Video" : "Foto"} — lompat ke pesan`}
                        onClick={() => {
                          onOpenChange(false);
                          onJump(item.id);
                        }}
                      >
                        <img
                          src={item.thumbUrl ?? item.content}
                          alt={item.fileName ?? "Lampiran"}
                          className="size-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                        {isVideo ? (
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                            ▶ video
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {voice.length > 0 ? (
              <section aria-label="Pesan suara">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Pesan suara
                </h3>
                <ul className="space-y-1">
                  {voice.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-accent"
                        onClick={() => {
                          onOpenChange(false);
                          onJump(item.id);
                        }}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600">
                          <Mic className="size-4" aria-hidden="true" />
                        </span>
                        <span className="flex-1 text-sm">
                          Pesan suara
                          <span className="block text-[11px] text-muted-foreground">
                            {new Date(item.createdAt).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatDuration(item.durationMs)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {files.length > 0 ? (
              <section aria-label="File dan dokumen">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  File &amp; dokumen
                </h3>
                <ul className="space-y-1">
                  {files.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-accent"
                        onClick={() => {
                          onOpenChange(false);
                          onJump(item.id);
                        }}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FileKindIcon
                            mimeType={item.mimeType}
                            fileName={item.fileName}
                            className="size-4"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {item.fileName ?? <FileText className="inline size-4" aria-hidden="true" />}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatFileSize(item.fileSize)} ·{" "}
                            {new Date(item.createdAt).toLocaleDateString("id-ID", {
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
