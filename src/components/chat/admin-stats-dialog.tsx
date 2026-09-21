"use client";

import { useEffect, useState } from "react";
import { BarChart3, Star } from "lucide-react";
import type { Socket } from "socket.io-client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AckOf, ChatStats, StatsAck } from "@/lib/chat-types";

const METRICS: {
  key: keyof ChatStats;
  label: string;
  hint: string;
  format: (v: number | null) => string;
}[] = [
  { key: "totalUsers", label: "Total pelanggan", hint: "semua user terdaftar", format: (v) => String(v ?? 0) },
  { key: "activeToday", label: "Aktif hari ini", hint: "sejak tengah malam WIB", format: (v) => String(v ?? 0) },
  { key: "messagesToday", label: "Pesan hari ini", hint: "dua arah", format: (v) => String(v ?? 0) },
  { key: "totalMessages", label: "Total pesan", hint: "seluruh waktu", format: (v) => String(v ?? 0) },
  {
    key: "avgResponseMin",
    label: "Rata-rata balasan",
    hint: "7 hari terakhir",
    format: (v) => (v == null ? "—" : `${v} mnt`),
  },
];

/** Pure-CSS 7-day activity chart (user vs admin messages). */
function WeeklyChart({ daily }: { daily: ChatStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.user + d.admin));
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Aktivitas 7 hari</p>
        <p className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-emerald-600" aria-hidden="true" />
            Pelanggan
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-amber-400" aria-hidden="true" />
            Admin
          </span>
        </p>
      </div>
      <div className="flex h-28 items-end justify-between gap-1.5">
        {daily.map((d) => {
          const totalH = ((d.user + d.admin) / max) * 100;
          const userH = totalH > 0 ? (d.user / (d.user + d.admin)) * totalH : 0;
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {d.user + d.admin > 0 ? d.user + d.admin : ""}
              </span>
              <div
                className="flex w-full max-w-9 flex-col justify-end overflow-hidden rounded-t-md bg-muted/60"
                style={{ height: 72 }}
                role="img"
                aria-label={`${d.date}: ${d.user} pesan pelanggan, ${d.admin} pesan admin`}
              >
                <div
                  className="w-full bg-amber-400 transition-all"
                  style={{ height: `${totalH - userH}%` }}
                />
                <div
                  className="w-full bg-emerald-600 transition-all"
                  style={{ height: `${userH}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{d.date}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Simple service statistics for the admin. */
export function AdminStatsDialog({
  open,
  onOpenChange,
  socketRef,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socketRef: React.RefObject<Socket | null>;
}) {
  const [stats, setStats] = useState<ChatStats | null>(null);

  // Mounted only while open — state is fresh on every remount.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("admin:stats", {}, (res: AckOf<StatsAck>) => {
      if (res.ok) setStats(res.stats);
    });
  }, [socketRef]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl chat-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5 text-emerald-600" aria-hidden="true" />
            Statistik Layanan
          </DialogTitle>
          <DialogDescription>Aktivitas ChatKita sekilas.</DialogDescription>
        </DialogHeader>
        {stats ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {METRICS.map((m, i) => (
                <div
                  key={m.key}
                  className={
                    "rounded-xl border bg-card p-3 " +
                    (i === METRICS.length - 1 ? "col-span-2" : "")
                  }
                >
                  <p className="text-2xl font-semibold">{m.format(stats[m.key] as number | null)}</p>
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.hint}</p>
                </div>
              ))}
            </div>

            {/* v5 — star rating summary */}
            <div className="flex items-center justify-between rounded-xl border bg-card p-3">
              <div>
                <p className="flex items-center gap-1.5 text-2xl font-semibold">
                  <Star className="size-5 fill-amber-400 text-amber-400" aria-hidden="true" />
                  {stats.avgRating == null ? "—" : stats.avgRating}
                </p>
                <p className="text-sm font-medium">Rating pelanggan</p>
                <p className="text-xs text-muted-foreground">
                  {stats.ratingCount} penilaian (skala 1–5 ⭐)
                </p>
              </div>
              <div className="flex gap-0.5" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={
                      stats.avgRating != null && n <= Math.round(stats.avgRating)
                        ? "size-5 fill-amber-400 text-amber-400"
                        : "size-5 text-muted-foreground/30"
                    }
                  />
                ))}
              </div>
            </div>

            {/* v5 — weekly activity chart */}
            <WeeklyChart daily={stats.daily} />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
