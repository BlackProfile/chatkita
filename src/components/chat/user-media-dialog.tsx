"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/chat/admin-tools";
import { FileKindIcon } from "@/components/chat/media-viewer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AckOf,
  AdminMediaDeleteAck,
  AdminMediaDeleteAllAck,
  AdminUserMediaAck,
  AdminUserMediaItem,
  ChatErrorAck,
} from "@/lib/chat-types";
import { avatarColorClass, formatFileSize, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * v38 — KONTROL MEDIA PER-USER, dibuka langsung dari toolbar percakapan admin
 * (pill "🖼 Media"). Menampilkan semua media hidup di percakapan user↔admin
 * (foto, suara, file) dengan pemakaian penyimpanan per sisi, pratinjau galeri
 * (tap → MediaViewer), hapus satu media, dan hapus semua media milik user.
 * Penghapusan memakai pipeline hapus resmi (tombstone + bebaskan file +
 * kuota otomatis longgar) dan tercatat di jejak audit.
 */

export interface UserMediaTarget {
  id: string;
  name: string;
}

type MediaFilter = "semua" | "user" | "admin";

const TYPE_LABEL: Record<AdminUserMediaItem["type"], string> = {
  image: "Foto",
  voice: "Suara",
  file: "File",
};

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function UserMediaDialog({
  target,
  onClose,
  socket,
  onOpenViewer,
}: {
  target: UserMediaTarget | null;
  onClose: () => void;
  socket: Socket | null;
  /** Buka MediaViewer dengan galeri item media (dipasang dari AdminPanel). */
  onOpenViewer: (items: AdminUserMediaItem[], messageId: number) => void;
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl sm:max-w-lg">
        {target ? (
          <MediaBody
            key={target.id}
            target={target}
            socket={socket}
            onOpenViewer={onOpenViewer}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Isi dialog — di-remount per user (key) supaya state selalu segar. */
function MediaBody({
  target,
  socket,
  onOpenViewer,
}: {
  target: UserMediaTarget;
  socket: Socket | null;
  onOpenViewer: (items: AdminUserMediaItem[], messageId: number) => void;
}) {
  const [items, setItems] = useState<AdminUserMediaItem[]>([]);
  const [totals, setTotals] = useState<AdminUserMediaAck["totals"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>("semua");
  const [confirmAll, setConfirmAll] = useState(false);

  const reload = () => {
    if (!socket?.connected) return;
    setLoading(true);
    socket.emit(
      "admin:user_media",
      { userId: target.id },
      (res: AckOf<AdminUserMediaAck> | ChatErrorAck) => {
        setLoading(false);
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setItems(res.items);
        setTotals(res.totals);
      }
    );
  };

  useEffect(() => {
    if (!socket?.connected) return;
    const t = setTimeout(() => reload(), 0);
    return () => clearTimeout(t);
  }, [socket, target.id]);

  /** Hapus satu media (pipeline resmi; kuota longgar otomatis). */
  const deleteOne = (item: AdminUserMediaItem) => {
    if (!socket?.connected) return;
    socket.emit(
      "admin:media_delete",
      { messageId: item.messageId },
      (res: AckOf<AdminMediaDeleteAck> | ChatErrorAck) => {
        if (!res.ok) {
          toast.error(`Gagal menghapus media — ${res.error ?? "kesalahan server"}`);
          return;
        }
        setItems((prev) => prev.filter((i) => i.messageId !== item.messageId));
        setTotals((prev) =>
          prev
            ? {
                count: Math.max(0, prev.count - 1),
                bytes: Math.max(0, prev.bytes - (item.fileSize ?? 0)),
                fromUserCount: item.fromUser
                  ? Math.max(0, prev.fromUserCount - 1)
                  : prev.fromUserCount,
                fromUserBytes: item.fromUser
                  ? Math.max(0, prev.fromUserBytes - (item.fileSize ?? 0))
                  : prev.fromUserBytes,
              }
            : prev
        );
        toast.success(
          `Media #${item.messageId} dihapus${res.freedBytes > 0 ? ` — ${formatFileSize(res.freedBytes)} dibebaskan` : ""}`
        );
      }
    );
  };

  /** Hapus SEMUA media milik user ini (scope "user"). */
  const deleteAllUserMedia = () => {
    if (!socket?.connected) return;
    socket.emit(
      "admin:media_delete_all",
      { userId: target.id, scope: "user" },
      (res: AckOf<AdminMediaDeleteAllAck> | ChatErrorAck) => {
        setConfirmAll(false);
        if (!res.ok) {
          toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
          return;
        }
        toast.success(
          `${res.deleted} media ${target.name} dihapus — ${formatFileSize(res.freedBytes)} dibebaskan`
        );
        reload();
      }
    );
  };

  const shown = items.filter((i) =>
    filter === "semua" ? true : filter === "user" ? i.fromUser : !i.fromUser
  );
  const fromUserCount = totals?.fromUserCount ?? 0;

  return (
    <>
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Avatar className="size-8">
            <AvatarFallback
              className={cn("text-xs font-semibold text-white", avatarColorClass(target.name))}
            >
              {initials(target.name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate">Media {target.name}</span>
          <Badge variant="outline">Kontrol media</Badge>
        </DialogTitle>
        <DialogDescription>
          Semua media percakapan user ↔ Admin — ketuk untuk pratinjau, hapus satu
          per satu, atau bersihkan semuanya. Kuota user longgar otomatis.
        </DialogDescription>
      </DialogHeader>

      {/* Ringkasan pemakaian */}
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Media dari {target.name}
          </p>
          <p className="text-sm font-semibold">
            {fromUserCount} berkas
            {totals && totals.fromUserBytes > 0
              ? ` · ${formatFileSize(totals.fromUserBytes)}`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Total percakapan
          </p>
          <p className="text-sm font-semibold">
            {totals ? `${totals.count} berkas` : "—"}
            {totals && totals.bytes > 0 ? ` · ${formatFileSize(totals.bytes)}` : ""}
          </p>
        </div>
      </div>

      {/* Filter + muat ulang */}
      <div className="flex shrink-0 items-center gap-1.5">
        {(
          [
            ["semua", "Semua"],
            ["user", `Dari ${target.name}`],
            ["admin", "Dari Admin"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={cn(
              "flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors",
              filter === key
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8 shrink-0"
          aria-label="Muat ulang media"
          onClick={reload}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Galeri media */}
      <div className="chat-scroll min-h-40 flex-1 overflow-y-auto pr-0.5">
        {loading && items.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat media…
          </p>
        ) : failed ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Gagal memuat media. Coba muat ulang.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "Belum ada media di percakapan ini."
              : "Tidak ada media pada filter ini."}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map((item) => (
              <div
                key={item.messageId}
                className="group relative overflow-hidden rounded-xl border bg-card"
              >
                <button
                  type="button"
                  className="flex aspect-square w-full items-center justify-center overflow-hidden"
                  aria-label={`Buka ${TYPE_LABEL[item.type]} #${item.messageId}`}
                  onClick={() => onOpenViewer(shown, item.messageId)}
                >
                  {item.type === "image" && item.thumbUrl ? (
                    <img
                      src={item.thumbUrl}
                      alt={`Foto #${item.messageId}`}
                      className="size-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : item.type === "image" ? (
                    <img
                      src={item.url}
                      alt={`Foto #${item.messageId}`}
                      className="size-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : item.type === "voice" ? (
                    <span className="flex flex-col items-center gap-1 text-muted-foreground">
                      <Music className="size-7" aria-hidden="true" />
                      <span className="text-[10px]">
                        {item.durationMs
                          ? `${Math.max(1, Math.round(item.durationMs / 1000))} dtk`
                          : "Suara"}
                      </span>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-1 px-1 text-muted-foreground">
                      <FileKindIcon
                        mimeType={item.mimeType}
                        fileName={item.fileName}
                        className="size-7"
                      />
                      <span className="line-clamp-1 text-[10px]" title={item.fileName}>
                        {item.fileName || "File"}
                      </span>
                    </span>
                  )}
                </button>
                {/* Metadata strip */}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-[9px] font-semibold text-white shadow-sm",
                      item.fromUser ? "bg-violet-600/90" : "bg-emerald-700/90"
                    )}
                  >
                    {item.fromUser ? target.name : "Admin"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Hapus media #${item.messageId}`}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition-opacity hover:bg-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => deleteOne(item)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
                <div className="border-t px-1.5 py-1">
                  <p className="truncate text-[10px] text-muted-foreground" title={item.caption || item.fileName}>
                    {item.caption || item.fileName || TYPE_LABEL[item.type]}
                  </p>
                  <p className="text-[10px] tabular-nums text-muted-foreground">
                    {fmtDay(item.createdAt)}
                    {item.fileSize ? ` · ${formatFileSize(item.fileSize)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Aksi massal */}
      <div className="flex shrink-0 items-center gap-2 border-t pt-3">
        <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground">
          Hapus semua media milik {target.name} — pesan jadi tombstone, file dibebaskan
          dari disk, kuota kembali.
        </p>
        <Button
          size="sm"
          variant="destructive"
          className="h-8 shrink-0"
          disabled={fromUserCount === 0}
          onClick={() => setConfirmAll(true)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Hapus semua ({fromUserCount})
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={(v) => !v && setConfirmAll(false)}
        title={`Hapus semua media ${target.name}?`}
        description={`${fromUserCount} berkas media yang dikirim ${target.name} akan di-tombstone di kedua sisi dan file-nya dihapus dari disk (media dari Admin tidak ikut). Teks/caption tetap tersimpan untuk forensik.`}
        confirmLabel="Ya, hapus semua"
        destructive
        onConfirm={deleteAllUserMedia}
      />
    </>
  );
}
