"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { Socket } from "socket.io-client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AckOf, ChatStats, StatsAck } from "@/lib/chat-types";

const METRICS: { key: keyof ChatStats; label: string; hint: string; format: (v: number | null) => string }[] = [
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
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5 text-emerald-600" aria-hidden="true" />
            Statistik Layanan
          </DialogTitle>
          <DialogDescription>Aktivitas ChatKita sekilas.</DialogDescription>
        </DialogHeader>
        {stats ? (
          <div className="grid grid-cols-2 gap-2">
            {METRICS.map((m, i) => (
              <div
                key={m.key}
                className={
                  "rounded-xl border bg-card p-3 " + (i === METRICS.length - 1 ? "col-span-2" : "")
                }
              >
                <p className="text-2xl font-semibold">{m.format(stats[m.key])}</p>
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.hint}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
