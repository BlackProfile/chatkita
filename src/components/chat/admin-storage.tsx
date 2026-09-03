"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  File as FileIcon,
  FileText,
  Film,
  HardDrive,
  ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AckOf,
  AdminMediaScanAck,
  AdminStorageMapAck,
  MediaMetaInfo,
} from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * v26 — Peta Penyimpanan (tab "Penyimpanan" di Dashboard Aplikasi):
 * - Peta disk: database + WAL + file media (dengan jumlah file & kuota).
 * - Rincian per jenis: foto / audio / video / PDF / file lain (jumlah + byte).
 * - Pemakaian per pengguna vs kuota per-akun (250 MiB).
 * - Daftar file terbesar lengkap dengan METADATA yang dibaca server dari
 *   header file: dimensi gambar (PNG/JPEG/GIF/WebP), durasi + dimensi video
 *   (MP4/MOV), jumlah halaman PDF.
 * - "Pindai metadata": isi metadata untuk media lama yang belum terbaca.
 */

const BUCKET_META: Record<
  string,
  { label: string; icon: typeof ImageIcon; color: string }
> = {
  image: { label: "Foto", icon: ImageIcon, color: "bg-emerald-500" },
  audio: { label: "Audio / suara", icon: Music, color: "bg-violet-500" },
  video: { label: "Video", icon: Film, color: "bg-rose-500" },
  pdf: { label: "PDF", icon: FileText, color: "bg-amber-500" },
  file: { label: "File lain", icon: FileIcon, color: "bg-teal-500" },
};

/** Ringkas metadata jadi satu baris: "1600×900" / "0:42 · 1080p" / "12 hlm". */
const metaLine = (meta: MediaMetaInfo | null): string | null => {
  if (!meta) return null;
  const parts: string[] = [];
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta.durationMs) {
    const s = Math.round(meta.durationMs / 1000);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }
  if (meta.pages) parts.push(`${meta.pages} hlm`);
  return parts.length > 0 ? parts.join(" · ") : null;
};

const mimeIcon = (mime: string, type: string) => {
  const m = mime.toLowerCase();
  if (type === "voice" || m.startsWith("audio/")) return Music;
  if (type === "image" || m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Film;
  if (m === "application/pdf") return FileText;
  return FileIcon;
};

export function AdminStorage({ socket }: { socket: Socket | null }) {
  const [map, setMap] = useState<AdminStorageMapAck["map"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const fetchMap = () => {
    if (!socket?.connected) return;
    setLoading(true);
    socket.emit("admin:storage_map", {}, (res: AckOf<AdminStorageMapAck>) => {
      setLoading(false);
      if (res.ok) setMap(res.map);
    });
  };

  useEffect(() => {
    const t = setTimeout(fetchMap, 0);
    return () => clearTimeout(t);
  }, [socket]);

  const runScan = () => {
    if (!socket?.connected || scanBusy) return;
    setScanBusy(true);
    setScanMsg(null);
    socket.emit("admin:media_scan", {}, (res: AckOf<AdminMediaScanAck>) => {
      setScanBusy(false);
      if (!res.ok) {
        toast.error("Pemindaian gagal.");
        return;
      }
      setScanMsg(
        res.scanned === 0
          ? "Semua media sudah punya metadata ✓"
          : `${res.scanned} dipindai · ${res.filled} metadata baru · sisa ${res.remaining}`
      );
      toast.success("Pemindaian metadata selesai.");
      fetchMap();
    });
  };

  if (!map) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        {loading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <p className="text-sm">Data belum tersedia.</p>
        )}
      </div>
    );
  }

  const { storage } = map;
  const diskTotal = Math.max(1, storage.dbBytes + storage.walBytes + storage.mediaBytes);
  const seg = (b: number) => `${Math.max(1.5, (b / diskTotal) * 100)}%`;
  const typeEntries = Object.entries(map.byType).sort((a, b) => b[1].bytes - a[1].bytes);
  const typeMaxBytes = Math.max(1, ...typeEntries.map(([, v]) => v.bytes));
  const coveragePct =
    map.coverage.withMeta + map.coverage.withoutMeta > 0
      ? Math.round(
          (map.coverage.withMeta / (map.coverage.withMeta + map.coverage.withoutMeta)) * 100
        )
      : 100;

  return (
    <div className="space-y-3">
      {/* Info utama */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
        >
          <HardDrive className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Peta Penyimpanan</p>
            <Badge variant="secondary" className="text-[10px]">
              {new Date(map.generatedAt).toLocaleTimeString("id-ID", { hour12: false })}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-[11px]"
              onClick={fetchMap}
              disabled={loading}
            >
              <RefreshCw
                className={cn("size-3.5", loading && "animate-spin")}
                aria-hidden="true"
              />
              Segarkan
            </Button>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Pemetaan lengkap penyimpanan aplikasi: disk (database + WAL + file
            media), rincian per jenis & per pengguna, plus metadata media
            (dimensi, durasi, halaman) yang dibaca langsung dari header file.
          </p>
        </div>
      </div>

      {/* Peta disk */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Peta disk · total {formatFileSize(diskTotal)}
        </p>
        <div className="flex h-4 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="bg-gradient-to-r from-emerald-600 to-emerald-400"
            style={{ width: seg(storage.dbBytes) }}
            title={`Database: ${formatFileSize(storage.dbBytes)}`}
          />
          <div
            className="bg-amber-400"
            style={{ width: seg(storage.walBytes) }}
            title={`WAL: ${formatFileSize(storage.walBytes)}`}
          />
          <div
            className="bg-gradient-to-r from-violet-500 to-violet-400"
            style={{ width: seg(storage.mediaBytes) }}
            title={`Media: ${formatFileSize(storage.mediaBytes)}`}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {(
            [
              { label: "Database", v: storage.dbBytes, dot: "bg-emerald-500" },
              { label: "WAL journal", v: storage.walBytes, dot: "bg-amber-400" },
              {
                label: `Media (${storage.mediaFiles} file)`,
                v: storage.mediaBytes,
                dot: "bg-violet-500",
              },
            ] as const
          ).map((x) => (
            <div key={x.label} className="rounded-lg border p-2">
              <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                <span className={cn("inline-block size-2 shrink-0 rounded-full", x.dot)} />
                {x.label}
              </p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatFileSize(x.v)}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Total byte media menurut catatan DB:{" "}
          <span className="font-medium tabular-nums">{formatFileSize(map.logicalBytes)}</span> ·
          kuota per akun {formatFileSize(storage.quotaBytes)}
        </p>
      </div>

      {/* Per jenis */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground">Rincian per jenis media</p>
        {typeEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada media terkirim.</p>
        ) : (
          <div className="space-y-2">
            {typeEntries.map(([bucket, v]) => {
              const meta = BUCKET_META[bucket] ?? BUCKET_META.file;
              const Icon = meta.icon;
              return (
                <div key={bucket} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg text-white",
                      meta.color
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{meta.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {v.count} file · {formatFileSize(v.bytes)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", meta.color)}
                        style={{ width: `${Math.max(2, (v.bytes / typeMaxBytes) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per pengguna */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Pemakaian media per pengguna (kuota {formatFileSize(storage.quotaBytes)} / akun)
        </p>
        {map.byUser.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada pengiriman media.</p>
        ) : (
          <div className="chat-scroll max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {map.byUser.map((u) => {
              const pct = Math.min(100, Math.round((u.bytes / storage.quotaBytes) * 100));
              return (
                <div key={u.id} className="rounded-lg border p-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{u.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {u.count} file · {formatFileSize(u.bytes)} · {pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* File terbesar + metadata */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            File terbesar (metadata dari header file)
          </p>
          <Badge
            variant="secondary"
            className={cn(
              "ml-auto text-[10px]",
              coveragePct >= 100 &&
                "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
            )}
          >
            metadata {coveragePct}%
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={runScan}
            disabled={scanBusy}
          >
            {scanBusy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ScanSearch className="size-3.5" aria-hidden="true" />
            )}
            Pindai metadata
          </Button>
        </div>
        {scanMsg ? (
          <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px]" role="status">
            {scanMsg}
          </p>
        ) : null}
        {map.largest.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada file media.</p>
        ) : (
          <ul className="chat-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {map.largest.map((f) => {
              const Icon = mimeIcon(f.mime, f.type);
              const line = metaLine(f.meta);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2.5 rounded-lg border px-2 py-1.5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={f.fileName}>
                      {f.fileName}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      #{f.id} · {f.senderName} ·{" "}
                      {new Date(f.createdAt).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                      })}
                      {line ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          {" "}
                          · {line}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {formatFileSize(f.size)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Metadata dibaca server dari header file (PNG/JPEG/GIF/WebP → dimensi,
          MP4/MOV → dimensi + durasi, PDF → jumlah halaman). Media yang dikirim
          setelah pembaruan ini otomatis terbaca saat dikirim.
        </p>
      </div>
    </div>
  );
}
