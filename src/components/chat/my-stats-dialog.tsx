"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { Clock, Flame, Loader2, MessageSquare, Paperclip } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { avatarColorClass, formatFileSize, initials } from "@/lib/chat-utils";
import type { AckOf, ChatErrorAck, UserInsight, UserMyStatsAck } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/** Satu sel KPI ringkas. */
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

/**
 * v42 — dialog "Statistikku" (sisi user): KPI utama dari helper insight
 * server (buildUserInsight v37) via event user:mystats — total pesan,
 * media, streak 🔥, dan jam paling aktif (WIB).
 */
function MyStatsBody({
  myName,
  socket,
}: {
  myName: string;
  socket: Socket | null;
}) {
  const [data, setData] = useState<UserInsight | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!socket) return;
    let alive = true;
    socket.emit("user:mystats", {}, (res: AckOf<UserMyStatsAck> | ChatErrorAck) => {
      if (!alive) return;
      if (res.ok) setData(res.insight);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [socket]);

  const peakHour = data
    ? data.activity.hours.indexOf(Math.max(...data.activity.hours))
    : 0;
  const totalMessages = data ? data.totals.userMessages + data.totals.adminMessages : 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Avatar className="size-8">
            <AvatarFallback
              className={cn("text-xs font-semibold text-white", avatarColorClass(myName))}
            >
              {initials(myName)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate">Statistikku</span>
        </DialogTitle>
        <DialogDescription>
          Ringkasan aktivitas chat kamu: pesan, media, streak, dan jam favorit.
        </DialogDescription>
      </DialogHeader>

      {!data && !failed ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Menghitung statistik…
        </div>
      ) : null}

      {failed ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Statistik gagal dimuat. Coba tutup lalu buka lagi.
        </div>
      ) : null}

      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            <Kpi
              icon={MessageSquare}
              label="Total pesan"
              value={String(totalMessages)}
              sub={`${data.totals.userMessages} darimu · ${data.totals.adminMessages} dari Admin`}
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
              icon={Flame}
              label="Streak harian"
              value={
                data.activity.streakDays >= 1 ? `🔥 ${data.activity.streakDays} hari` : "—"
              }
              sub={
                data.activity.streakDays >= 2
                  ? "pertahankan ya!"
                  : data.activity.streakDays === 1
                    ? "mulai hari ini"
                    : "belum ada streak"
              }
            />
            <Kpi
              icon={Clock}
              label="Jam paling aktif"
              value={`${String(peakHour).padStart(2, "0")}:00 WIB`}
              sub={`${data.activity.activeDays} hari aktif`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bergabung {new Date(data.user.createdAt).toLocaleDateString("id-ID")}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** Dialog "Statistikku" — di-mount di Messenger (menu lainnya ⋯). */
export function MyStatsDialog({
  open,
  myName,
  socket,
  onClose,
}: {
  open: boolean;
  myName: string;
  socket: Socket | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl sm:max-w-sm">
        {open ? <MyStatsBody key={myName} myName={myName} socket={socket} /> : null}
      </DialogContent>
    </Dialog>
  );
}
