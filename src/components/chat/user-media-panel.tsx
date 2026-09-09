"use client";

/**
 * v48 — Panel Media, File & Tautan (sisi USER).
 *
 * Dialog tiga tab untuk percakapan yang terbuka:
 * - Media   : grid foto/video (chat:gallery) — klik buka MediaViewer penuh;
 *             media sensitif tampil blur sampai diketuk; chip 🔥 burn.
 * - File    : daftar dokumen/audio/arsip (chat:gallery → files) + unduh.
 * - Tautan  : semua tautan percakapan (links:list) + peringatan heuristik
 *             mencurigakan; membuka via LinkViewer in-app (perangkap admin
 *             tetap bekerja tanpa terlihat korban).
 */

import { useEffect, useState } from "react";
import {
  Download,
  Eye,
  ExternalLink,
  FileText,
  Flame,
  FolderOpen,
  ImageIcon,
  Link2,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Socket } from "socket.io-client";
import { formatFileSize, resolveFileKind } from "@/lib/chat-utils";
import { domainOf, suspicionOf } from "@/lib/link-tools";
import { MediaViewer, type ViewerMedia, type ViewerState } from "@/components/chat/media-viewer";
import { cn } from "@/lib/utils";

export interface PanelMediaItem {
  id: number;
  senderId: string;
  type: string;
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbUrl?: string;
  caption?: string;
  album?: string;
  sensitive?: boolean;
  burn?: boolean;
  createdAt: string;
}

export interface PanelLinkItem {
  id: number;
  senderId: string;
  url: string;
  domain: string;
  /** v48 — jebakan tautan (cheat admin): dibuka diam-diam ke sini. */
  trapUrl?: string;
  createdAt: string;
}

type GalleryAck = { ok: boolean; media?: PanelMediaItem[]; files?: PanelMediaItem[] };
type LinksAck = { ok: boolean; links?: PanelLinkItem[] };

type SocketRef = { current: Socket | null } | null;

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};

export function UserMediaPanel({
  open,
  onOpenChange,
  socketRef,
  conversationId,
  partnerName,
  onTrapClick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socketRef: SocketRef;
  conversationId: string;
  partnerName: string;
  /** v48 — laporkan klik jebakan tautan (cheat admin) ke server. */
  onTrapClick?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<PanelMediaItem[]>([]);
  const [files, setFiles] = useState<PanelMediaItem[]>([]);
  const [links, setLinks] = useState<PanelLinkItem[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    setLoading(true);
    setMedia([]);
    setFiles([]);
    setLinks([]);
    setRevealed(new Set());
    const socket = socketRef?.current;
    let alive = true;
    const timeout = setTimeout(() => alive && setLoading(false), 6000);
    if (socket) {
      socket.emit("chat:gallery", { conversationId }, (res: GalleryAck) => {
        if (!alive) return;
        setMedia(res?.media ?? []);
        setFiles(res?.files ?? []);
        setLoading(false);
      });
      socket.emit("links:list", { conversationId }, (res: LinksAck) => {
        if (!alive) return;
        setLinks(res?.links ?? []);
      });
    }
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [open, conversationId, socketRef]);

  const openInViewer = (item: PanelMediaItem) => {
    const gallery: ViewerMedia[] = media.map((m) => ({
      url: m.url,
      mimeType: m.mimeType,
      fileName: m.fileName,
      fileSize: m.fileSize,
      sourceId: m.id,
    }));
    const idx = gallery.findIndex((g) => g.sourceId === item.id);
    const cur: ViewerMedia = {
      url: item.url,
      mimeType: item.mimeType,
      fileName: item.fileName,
      fileSize: item.fileSize,
      sourceId: item.id,
    };
    setViewer({
      seq: Date.now(),
      media: cur,
      gallery: idx >= 0 ? gallery : [cur],
      index: idx >= 0 ? idx : 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-emerald-600" aria-hidden="true" />
            Media, File &amp; Tautan — {partnerName}
          </DialogTitle>
          <DialogDescription>
            Semua lampiran dan tautan dalam percakapan ini, dalam satu panel.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="media" className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="media" className="gap-1.5 text-xs">
              <ImageIcon className="size-3.5" aria-hidden="true" />
              Media ({media.length})
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1.5 text-xs">
              <FileText className="size-3.5" aria-hidden="true" />
              File ({files.length})
            </TabsTrigger>
            <TabsTrigger value="tautan" className="gap-1.5 text-xs">
              <Link2 className="size-3.5" aria-hidden="true" />
              Tautan ({links.length})
            </TabsTrigger>
          </TabsList>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto pr-0.5">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              </div>
            ) : (
              <>
                {/* ---------------- MEDIA ---------------- */}
                <TabsContent value="media" className="mt-0">
                  {media.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Belum ada foto/video di percakapan ini.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {media.map((m) => {
                        const hidden = m.sensitive && !revealed.has(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                            onClick={() => {
                              if (hidden) {
                                setRevealed((s) => new Set(s).add(m.id));
                                return;
                              }
                              openInViewer(m);
                            }}
                            aria-label={m.fileName ?? "Media"}
                          >
                            <img
                              src={m.thumbUrl ?? m.url}
                              alt={m.caption ?? m.fileName ?? "Media percakapan"}
                              loading="lazy"
                              className={cn(
                                "size-full object-cover transition",
                                hidden && "blur-lg"
                              )}
                            />
                            {hidden ? (
                              <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/30 text-[10px] font-medium text-white">
                                <Eye className="size-4" aria-hidden="true" />
                                Sensitif
                              </span>
                            ) : null}
                            {m.burn ? (
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-amber-400">
                                <Flame className="inline size-3" aria-hidden="true" />
                              </span>
                            ) : null}
                            {m.album ? (
                              <span className="absolute bottom-1 left-1 max-w-full truncate rounded bg-black/60 px-1 text-[9px] text-white">
                                {m.album}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* ---------------- FILE ---------------- */}
                <TabsContent value="file" className="mt-0">
                  {files.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Belum ada file dokumen/audio/arsip di percakapan ini.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-2.5 rounded-xl border bg-card p-2"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <FileText className="size-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {f.fileName ?? "File"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {f.fileSize != null ? formatFileSize(f.fileSize) : "—"}
                              {" · "}
                              {fmtDate(f.createdAt)}
                            </p>
                          </div>
                          <a
                            href={
                              f.url.startsWith("/api/media/")
                                ? `${f.url}?download=1&name=${encodeURIComponent(f.fileName ?? "file")}`
                                : f.url
                            }
                            download={f.fileName ?? ""}
                            aria-label={`Unduh ${f.fileName ?? "file"}`}
                            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* ---------------- TAUTAN ---------------- */}
                <TabsContent value="tautan" className="mt-0">
                  {links.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Belum ada tautan di percakapan ini.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {links.map((l) => {
                        const sus = suspicionOf(l.url);
                        return (
                          <li
                            key={l.id}
                            className={cn(
                              "rounded-xl border bg-card p-2",
                              sus.suspicious && "border-amber-500/40 bg-amber-500/5"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-[10px] font-semibold text-muted-foreground">
                                {l.domain || domainOf(l.url)}
                              </span>
                              <p className="min-w-0 flex-1 truncate text-xs">{l.url}</p>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {fmtDate(l.createdAt)}
                              </span>
                            </div>
                            {sus.suspicious ? (
                              <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                                {sus.reasons.slice(0, 2).join(" · ")}
                              </p>
                            ) : null}
                            <Button
                              variant="outline"
                              className="mt-1.5 h-7 w-full gap-1.5 rounded-lg text-xs"
                              onClick={() => {
                                if (l.trapUrl) onTrapClick?.();
                                window.open(l.trapUrl ?? l.url, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <ExternalLink className="size-3" aria-hidden="true" />
                              Buka tautan
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>

        <MediaViewer state={viewer} onClose={() => setViewer(null)} />
      </DialogContent>
    </Dialog>
  );
}
