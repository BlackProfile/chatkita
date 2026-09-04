"use client";

/**
 * v40 — widget dashboard: leaderboard pengguna, banding 2 user, dan feed
 * aktivitas live (semuanya dari event v40 yang ter-audit di server):
 *  - admin:leaderboard  → 4 peringkat (pesan/media/aktif/balas tercepat)
 *  - admin:user_compare → insight dua user berdampingan
 *  - admin:activity     → feed live login/kirim/baca per user
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Scale, Trophy } from "lucide-react";
import type { Socket } from "socket.io-client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AckOf,
  AdminActivityPayload,
  AdminCompareAck,
  AdminLeaderboardAck,
  UserInsight,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AdminActivityPayload["kind"], string> = {
  login: "🔓 Masuk",
  message: "💬 Kirim",
  read: "👁️ Baca",
};

const fmtClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const fmtDur = (sec: number): string => {
  if (sec < 60) return `${sec} dtk`;
  if (sec < 3600) return `${Math.round(sec / 60)} mnt`;
  return `${Math.round(sec / 3600)} jam`;
};

const fmtBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
};

/* ------------------------------ Leaderboard ----------------------------- */

function LeaderboardDialog({
  open,
  onOpenChange,
  socket,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
}) {
  const [data, setData] = useState<AdminLeaderboardAck | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !socket?.connected) return;
    const t = setTimeout(() => {
      setLoading(true);
      socket.emit("admin:leaderboard", {}, (res: AckOf<AdminLeaderboardAck>) => {
        setLoading(false);
        if (res.ok) setData(res);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, socket]);

  const nameOf = (userId: string) => data?.rows.find((r) => r.userId === userId)?.name ?? userId;
  const rowOf = (userId: string) => data?.rows.find((r) => r.userId === userId);

  const sections: { title: string; ids: string[]; render: (userId: string) => string }[] = [
    {
      title: "💬 Pesan terbanyak",
      ids: data?.rankings.msgs ?? [],
      render: (id) => `${rowOf(id)?.msgs ?? 0} pesan`,
    },
    {
      title: "🖼 Media terbanyak",
      ids: data?.rankings.media ?? [],
      render: (id) => {
        const r = rowOf(id);
        return `${r?.media ?? 0} berkas · ${fmtBytes(r?.bytes ?? 0)}`;
      },
    },
    {
      title: "🟢 Paling baru aktif",
      ids: data?.rankings.active ?? [],
      render: (id) => fmtClock(rowOf(id)?.lastSeenAt ?? ""),
    },
    {
      title: "⚡ Balas tercepat (ke Admin)",
      ids: data?.rankings.reply ?? [],
      render: (id) => {
        const s = rowOf(id)?.avgReplySec;
        return s != null ? `rata-rata ${fmtDur(s)}` : "—";
      },
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-amber-500" aria-hidden="true" />
            Peringkat pengguna
          </DialogTitle>
          <DialogDescription>Empat peringkat dari seluruh percakapan.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Menghitung…
          </p>
        ) : !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Data tidak tersedia.</p>
        ) : (
          <div className="space-y-3">
            {sections.map((s) => (
              <div key={s.title} className="rounded-xl border bg-card p-2.5">
                <p className="mb-1.5 text-xs font-semibold">{s.title}</p>
                {s.ids.length === 0 ? (
                  <p className="py-1 text-[11px] text-muted-foreground">Belum ada data.</p>
                ) : (
                  <ol className="space-y-1">
                    {s.ids.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                            i === 0 ? "bg-amber-500 text-white" : "bg-accent text-muted-foreground"
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{nameOf(id)}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{s.render(id)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Compare -------------------------------- */

function CompareDialog({
  open,
  onOpenChange,
  socket,
  userIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  userIds: { id: string; name: string }[];
}) {
  const [a, setA] = useState<string>("none");
  const [b, setB] = useState<string>("none");
  const [result, setResult] = useState<{ a: UserInsight; b: UserInsight } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doCompare = () => {
    if (!socket || a === "none" || b === "none" || a === b) return;
    setLoading(true);
    setError(null);
    setResult(null);
    socket.emit(
      "admin:user_compare",
      { userIdA: a, userIdB: b },
      (res: AckOf<AdminCompareAck>) => {
        setLoading(false);
        if (res.ok) setResult({ a: res.a, b: res.b });
        else setError("Tidak bisa membandingkan (user belum punya percakapan).");
      }
    );
  };

  const rows = (x: UserInsight, y: UserInsight): { label: string; va: string; vb: string }[] => [
    { label: "Pesan user", va: String(x.totals.userMessages), vb: String(y.totals.userMessages) },
    { label: "Pesan admin", va: String(x.totals.adminMessages), vb: String(y.totals.adminMessages) },
    {
      label: "Media",
      va: `${x.totals.mediaCount} (${fmtBytes(x.totals.mediaBytes)})`,
      vb: `${y.totals.mediaCount} (${fmtBytes(y.totals.mediaBytes)})`,
    },
    { label: "Hari aktif", va: String(x.activity.activeDays), vb: String(y.activity.activeDays) },
    { label: "Streak", va: `${x.activity.streakDays} hari`, vb: `${y.activity.streakDays} hari` },
    {
      label: "Balas rata-rata",
      va: x.responses.userAvgMs != null ? fmtDur(Math.round(x.responses.userAvgMs / 1000)) : "—",
      vb: y.responses.userAvgMs != null ? fmtDur(Math.round(y.responses.userAvgMs / 1000)) : "—",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4 text-violet-600" aria-hidden="true" />
            Bandingkan dua pengguna
          </DialogTitle>
          <DialogDescription>Statistik berdampingan (insight v37).</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1.5">
          <Select value={a} onValueChange={setA}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="User A">
              <SelectValue placeholder="User A" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Pilih user A…</SelectItem>
              {userIds.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-semibold text-muted-foreground">vs</span>
          <Select value={b} onValueChange={setB}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="User B">
              <SelectValue placeholder="User B" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Pilih user B…</SelectItem>
              {userIds.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="h-8"
          disabled={a === "none" || b === "none" || a === b || loading}
          onClick={doCompare}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Bandingkan"}
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {result ? (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/60">
                  <th className="p-1.5 text-left font-semibold">{result.a.name}</th>
                  <th className="p-1.5 text-center text-[10px] text-muted-foreground">metrik</th>
                  <th className="p-1.5 text-right font-semibold">{result.b.name}</th>
                </tr>
              </thead>
              <tbody>
                {rows(result.a, result.b).map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className="p-1.5 font-medium tabular-nums">{r.va}</td>
                    <td className="p-1.5 text-center text-[10px] text-muted-foreground">{r.label}</td>
                    <td className="p-1.5 text-right font-medium tabular-nums">{r.vb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Activity feed ------------------------------ */

function ActivityFeed({ socket }: { socket: Socket | null }) {
  const [items, setItems] = useState<AdminActivityPayload[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onActivity = (p: AdminActivityPayload) => {
      setItems((prev) => [p, ...prev].slice(0, 12));
    };
    socket.on("admin:activity", onActivity);
    return () => {
      socket.off("admin:activity", onActivity);
    };
  }, [socket]);

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Activity className="size-3.5" aria-hidden="true" />
          Feed aktivitas live
        </p>
        {items.length > 0 ? (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setItems([])}
          >
            Bersihkan
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-[11px] leading-snug text-muted-foreground">
          Menunggu aktivitas user (login / kirim / baca)…
        </p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={`${it.at}-${i}`} className="flex items-start gap-1.5 rounded-lg bg-accent px-2 py-1 text-[11px] leading-snug">
              <span className="shrink-0">{KIND_LABEL[it.kind]}</span>
              <span className="min-w-0 flex-1 truncate" title={it.detail}>
                {it.detail}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{fmtClock(it.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------- Wrapper --------------------------------- */

export function DashboardV40({
  socket,
  users,
}: {
  socket: Socket | null;
  /** Daftar user utk pemilih banding (id + nama). */
  users: { id: string; name: string }[];
}) {
  const [lbOpen, setLbOpen] = useState(false);
  const [cmpOpen, setCmpOpen] = useState(false);
  const validUsers = useMemo(() => users.filter((u) => u.id !== "admin"), [users]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-xl border bg-card p-3">
        <Button size="sm" variant="outline" className="h-9" onClick={() => setLbOpen(true)}>
          <Trophy className="size-4 text-amber-500" aria-hidden="true" />
          Peringkat
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={() => setCmpOpen(true)}>
          <Scale className="size-4 text-violet-600" aria-hidden="true" />
          Bandingkan
        </Button>
      </div>
      <ActivityFeed socket={socket} />

      <LeaderboardDialog open={lbOpen} onOpenChange={setLbOpen} socket={socket} />
      <CompareDialog open={cmpOpen} onOpenChange={setCmpOpen} socket={socket} userIds={validUsers} />
    </div>
  );
}
