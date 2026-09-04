"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Clock,
  Flame,
  Lightbulb,
  Loader2,
  MessageSquare,
  Paperclip,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  avatarColorClass,
  formatFileSize,
  formatLastSeen,
  initials,
} from "@/lib/chat-utils";
import type {
  AckOf,
  AdminUserInsightAck,
  ChatErrorAck,
  DashboardUserRow,
  UserInsight,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/** Label hari pendek (0=Minggu) — sejajar histogram server (WIB). */
const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** ms → durasi ringkas (61_000 → "1 mnt"; sejajar gaya server). */
const fmtDur = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} mnt`;
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `${h} jam`;
  return `${Math.round(h / 24)} hari`;
};

/** Kecil: satu sel KPI berikon. */
function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Histogram mini (jam 24 / hari 7) — batang CSS murni, tanpa pustaka chart. */
function MiniBars({
  values,
  labels,
  highlight,
  unit,
}: {
  values: number[];
  labels: string[];
  highlight: number;
  unit: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`Histogram ${unit}`}>
        {values.map((v, i) => (
          <div
            key={i}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
          >
            <div
              title={`${labels[i]} · ${v} ${unit}`}
              className={cn(
                "w-full rounded-t-[3px] transition-all",
                v === 0
                  ? "bg-muted"
                  : i === highlight
                    ? "bg-gradient-to-t from-emerald-600 to-emerald-400"
                    : "bg-emerald-500/45"
              )}
              style={{ height: `${Math.max(6, Math.round((v / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-center text-[9px] leading-none text-muted-foreground">
        {labels.map((l, i) => (
          <span
            key={i}
            className={cn("min-w-0 flex-1 truncate", i === highlight && "font-semibold text-foreground")}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Isi dialog — di-remount per user (key) supaya state selalu segar. */
function InsightBody({
  target,
  socket,
}: {
  target: DashboardUserRow;
  socket: Socket | null;
}) {
  const [data, setData] = useState<UserInsight | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!socket) return;
    let alive = true;
    socket.emit(
      "admin:user_insight",
      { userId: target.id },
      (res: AckOf<AdminUserInsightAck> | ChatErrorAck) => {
        if (!alive) return;
        if (res.ok) setData(res.insight);
        else setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [socket, target.id]);

  const hourLabels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}`);
  const peakHour = data ? data.activity.hours.indexOf(Math.max(...data.activity.hours)) : 0;
  const peakDay = data ? data.activity.weekdays.indexOf(Math.max(...data.activity.weekdays)) : 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Avatar className="size-8">
            <AvatarFallback
              className={cn("text-xs font-semibold text-white", avatarColorClass(target.name))}
            >
              {initials(target.name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate">Insight {target.name}</span>
          {target.online ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Online
            </Badge>
          ) : null}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Statistik dan ide per-pengguna: aktivitas, kecepatan membalas, tren, dan saran.
        </DialogDescription>
      </DialogHeader>

      {!data && !failed ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Menghitung insight…
        </div>
      ) : null}

      {failed ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Insight gagal dimuat. Coba tutup lalu buka lagi.
        </div>
      ) : null}

      {data ? (
        <div className="space-y-4">
          {/* KPI utama */}
          <div className="grid grid-cols-2 gap-2.5">
            <Kpi
              icon={MessageSquare}
              label="Pesan terkirim"
              value={String(data.totals.userMessages)}
              sub={`${data.totals.adminMessages} pesan dari kamu`}
            />
            <Kpi
              icon={Paperclip}
              label="Media terkirim"
              value={String(data.totals.mediaCount)}
              sub={
                data.totals.mediaBytes > 0
                  ? formatFileSize(data.totals.mediaBytes)
                  : "belum ada media"
              }
            />
            <Kpi
              icon={Clock}
              label="Balas rata-rata"
              value={
                data.responses.userAvgMs !== null
                  ? fmtDur(data.responses.userAvgMs)
                  : "—"
              }
              sub={`${data.responses.userSamples} sampel balasan`}
            />
            <Kpi
              icon={Flame}
              label="Hari aktif"
              value={String(data.activity.activeDays)}
              sub={
                data.activity.streakDays >= 2
                  ? `streak ${data.activity.streakDays} hari 🔥`
                  : "belum ada streak"
              }
            />
          </div>

          {/* Histogram jam + hari (WIB) */}
          <div className="rounded-xl border bg-card p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Jam aktif (WIB) — puncak {String(peakHour).padStart(2, "0")}:00
            </p>
            <MiniBars values={data.activity.hours} labels={hourLabels} highlight={peakHour} unit="pesan" />
            <p className="mt-3 mb-2 text-xs font-medium text-muted-foreground">Hari aktif</p>
            <MiniBars values={data.activity.weekdays} labels={DAY_LABELS} highlight={peakDay} unit="pesan" />
          </div>

          {/* Tren + kebiasaan */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-xs">
            {data.trend.last7 > 0 && data.trend.pct >= 0 ? (
              <TrendingUp className="size-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <TrendingDown className="size-4 text-amber-600" aria-hidden="true" />
            )}
            <span>
              7 hari terakhir: <span className="font-semibold tabular-nums">{data.trend.last7}</span> pesan
              {data.trend.prev7 > 0
                ? ` (${data.trend.pct >= 0 ? "+" : ""}${data.trend.pct}% vs minggu lalu)`
                : ""}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>
              {data.reads.readPct}% pesanmu dibaca
            </span>
            {data.reactions.given > 0 ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span>{data.reactions.given} reaksi diberi</span>
              </>
            ) : null}
          </div>

          {/* Ide / observasi otomatis */}
          <div className="rounded-xl border bg-gradient-to-br from-amber-50 to-orange-50 p-3 dark:from-amber-950/30 dark:to-orange-950/20">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <Lightbulb className="size-4" aria-hidden="true" />
              Ide buat kamu
            </p>
            <ul className="space-y-1.5">
              {data.insights.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed">
                  <span aria-hidden="true" className="text-amber-600 dark:text-amber-400">
                    •
                  </span>
                  <span>{s}</span>
                </li>
              ))}
              {data.insights.length === 0 ? (
                <li className="text-xs text-muted-foreground">
                  Belum ada cukup data untuk memberi ide.
                </li>
              ) : null}
            </ul>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Bergabung {new Date(data.user.createdAt).toLocaleDateString("id-ID")} · terakhir{" "}
            {target.online ? "online sekarang" : formatLastSeen(target.lastSeenAt)}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** Dialog "Insight pengguna" — di-mount sekali di dashboard admin. */
export function UserInsightDialog({
  target,
  socket,
  onClose,
}: {
  target: DashboardUserRow | null;
  socket: Socket | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        {target ? <InsightBody key={target.id} target={target} socket={socket} /> : null}
      </DialogContent>
    </Dialog>
  );
}
