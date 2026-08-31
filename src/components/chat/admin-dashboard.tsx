"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Activity,
  BarChart3,
  Check,
  Clock,
  Database,
  Download,
  GaugeCircle,
  HardDrive,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Megaphone,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Users,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  avatarColorClass,
  formatFileSize,
  formatLastSeen,
  initials,
} from "@/lib/chat-utils";
import type {
  AckOf,
  AppSettings,
  AppSettingsAck,
  BackupAck,
  BroadcastAck,
  ChatErrorAck,
  DashboardStats,
  DashboardStatsAck,
  DashboardUserRow,
  VacuumAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/**
 * v10 — Dashboard aplikasi khusus admin: analitik penggunaan, pengelolaan
 * pengguna, siaran/pengumuman global, pengaturan aplikasi (nama, sambutan,
 * mode pemeliharaan), backup JSON, kompresi VACUUM, dan info sistem.
 * Semua data diambil live dari chat-service via socket (admin-only events).
 */

export type DashboardTab =
  | "ringkasan"
  | "analitik"
  | "pengguna"
  | "siaran"
  | "pengaturan"
  | "sistem";

const TABS: { key: DashboardTab; label: string; icon: typeof GaugeCircle }[] = [
  { key: "ringkasan", label: "Ringkasan", icon: GaugeCircle },
  { key: "analitik", label: "Analitik", icon: BarChart3 },
  { key: "pengguna", label: "Pengguna", icon: Users },
  { key: "siaran", label: "Siaran", icon: Megaphone },
  { key: "pengaturan", label: "Pengaturan", icon: Settings2 },
  { key: "sistem", label: "Sistem", icon: Database },
];

const TYPE_COLORS: Record<string, string> = {
  text: "bg-emerald-500",
  image: "bg-sky-500",
  voice: "bg-violet-500",
  file: "bg-amber-500",
  system: "bg-muted-foreground/50",
};

const TYPE_LABELS: Record<string, string> = {
  text: "Teks",
  image: "Foto",
  voice: "Suara",
  file: "File",
  system: "Sistem",
};

const fmtUptime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
};

const fmtDay = (iso: string): string => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

/** KPI kecil dengan ikon — dipakai di tab Ringkasan. */
function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold leading-tight">{value}</p>
        {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Bar chart CSS murni (tinggi %). */
function BarChart({
  values,
  labels,
  title,
  className,
}: {
  values: number[];
  labels: string[];
  title: string;
  className?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("rounded-xl border bg-card p-3", className)}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex h-28 items-end gap-1">
        {values.map((v, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className="w-full rounded-t-sm bg-emerald-500/80 transition-[height] hover:bg-emerald-500"
              style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
              title={`${labels[i]}: ${v} pesan`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export function AdminDashboard({
  open,
  onOpenChange,
  socket,
  tab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Socket admin yang sudah terautentikasi. */
  socket: Socket | null;
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastKind, setBroadcastKind] = useState<"siaran" | "pengumuman">("siaran");
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [vacuumResult, setVacuumResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<"backup" | "vacuum" | null>(null);

  const fetchStats = useCallback(() => {
    if (!socket || !socket.connected) return;
    setLoading(true);
    socket.emit("admin:dashboard", {}, (res: AckOf<DashboardStatsAck>) => {
      setLoading(false);
      if (res.ok) setStats(res.stats);
    });
  }, [socket]);

  // Muat stats + settings saat dialog dibuka (deferred — bukan setState
  // sinkron di body effect) + auto-refresh ringan tiap 30 detik.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      fetchStats();
      if (socket?.connected) {
        socket.emit("admin:settings:get", {}, (res: AckOf<AppSettingsAck>) => {
          if (res.ok) setSettings(res.settings);
        });
      }
    }, 0);
    const iv = setInterval(fetchStats, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [open, fetchStats, socket]);

  const totals = stats?.totals;

  const typeEntries = useMemo(() => {
    if (!totals) return [];
    return Object.entries(totals.byType).filter(([, v]) => v > 0);
  }, [totals]);
  const typeMax = Math.max(1, ...typeEntries.map(([, v]) => v));
  const typeTotal = typeEntries.reduce((s, [, v]) => s + v, 0);

  const saveSettings = (patch: Partial<AppSettings>) => {
    if (!socket) return;
    setSettingsMsg(null);
    socket.emit(
      "admin:settings:set",
      patch,
      (res: AckOf<AppSettingsAck> | ChatErrorAck) => {
        if (res.ok) {
          setSettings(res.settings);
          setSettingsMsg("Tersimpan ✓");
          setTimeout(() => setSettingsMsg(null), 2000);
        } else {
          setSettingsMsg("Gagal menyimpan");
        }
      }
    );
  };

  const sendBroadcast = () => {
    const text = broadcastText.trim();
    if (!socket || !text || broadcasting) return;
    setBroadcasting(true);
    setBroadcastMsg(null);
    socket.emit(
      "admin:broadcast",
      { text, kind: broadcastKind },
      (res: AckOf<BroadcastAck>) => {
        setBroadcasting(false);
        if (res.ok) {
          setBroadcastMsg(`Terkirim ke ${res.count} percakapan ✓`);
          setBroadcastText("");
          setTimeout(() => setBroadcastMsg(null), 3000);
        } else {
          setBroadcastMsg("Gagal mengirim");
        }
      }
    );
  };

  const downloadBackup = () => {
    if (!socket || busy) return;
    setBusy("backup");
    socket.emit("admin:backup", {}, (res: AckOf<BackupAck>) => {
      setBusy(null);
      if (!res.ok) return;
      try {
        const blob = new Blob([JSON.stringify(res, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chatkita-backup-${res.exportedAt.slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    });
  };

  const runVacuum = () => {
    if (!socket || busy) return;
    setBusy("vacuum");
    setVacuumResult(null);
    socket.emit("admin:vacuum", {}, (res: AckOf<VacuumAck>) => {
      setBusy(null);
      if (!res.ok) return;
      const saved = res.before.walBytes - res.after.walBytes;
      setVacuumResult(
        `Selesai — DB ${(res.after.dbBytes / 1024).toFixed(0)} KB, WAL ${(res.after.walBytes / 1024).toFixed(0)} KB${saved > 0 ? ` (hemat ${(saved / 1024).toFixed(0)} KB)` : ""}`
      );
      fetchStats();
      setTimeout(() => setVacuumResult(null), 5000);
    });
  };

  /** Baris pengguna (tabel tab Pengguna / papan top users). */
  const userRow = (u: DashboardUserRow, rank?: number) => (
    <div
      key={u.id}
      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/50"
    >
      <span className="relative shrink-0">
        <Avatar className="size-9">
          <AvatarFallback
            className={cn("text-xs font-semibold text-white", avatarColorClass(u.name))}
          >
            {initials(u.name)}
          </AvatarFallback>
        </Avatar>
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background",
            u.online ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {rank === 1 ? "🥇 " : rank === 2 ? "🥈 " : rank === 3 ? "🥉 " : ""}
          {u.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {u.online ? "Online" : `Terakhir dilihat ${formatLastSeen(u.lastSeenAt)}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{u.messages}</p>
        <p className="text-[10px] text-muted-foreground">pesan</p>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
              <GaugeCircle className="size-4.5" aria-hidden="true" />
            </span>
            Dashboard Aplikasi
            {stats ? (
              <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
                {stats.version}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Analitik, pengaturan, dan pengelolaan aplikasi ChatKita.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 sm:px-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => onTabChange(t.key)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                tab === t.key
                  ? "bg-emerald-600 text-white"
                  : "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <t.icon className="size-3.5" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Konten tab */}
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
          {!stats && loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            </div>
          ) : !stats ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Data belum tersedia.
            </p>
          ) : tab === "ringkasan" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                <Kpi
                  icon={Users}
                  label="Total pengguna"
                  value={String(totals!.users)}
                  sub={`${totals!.onlineUsers} online sekarang`}
                />
                <Kpi
                  icon={MessagesSquare}
                  label="Percakapan"
                  value={String(totals!.conversations)}
                />
                <Kpi
                  icon={MessageSquare}
                  label="Pesan 24 jam"
                  value={String(totals!.last24h)}
                  sub={`${totals!.last7d} dalam 7 hari`}
                />
                <Kpi
                  icon={Activity}
                  label="Total pesan"
                  value={String(totals!.messages)}
                  sub={`${totals!.deletedMessages} dihapus`}
                />
                <Kpi
                  icon={HardDrive}
                  label="Media tersimpan"
                  value={formatFileSize(totals!.mediaBytes)}
                  sub={`${totals!.mediaCount} file aktif`}
                />
                <Kpi
                  icon={Clock}
                  label="Uptime service"
                  value={fmtUptime(stats.uptimeMs)}
                />
              </div>

              <BarChart
                values={stats.daily.map((d) => d.count)}
                labels={stats.daily.map((d) => fmtDay(d.date))}
                title="Pesan per hari (14 hari terakhir)"
              />

              <div className="rounded-xl border bg-card p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Komposisi jenis pesan
                </p>
                <div className="space-y-2">
                  {typeEntries.map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-xs">
                        {TYPE_LABELS[type] ?? type}
                      </span>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            TYPE_COLORS[type] ?? "bg-emerald-500"
                          )}
                          style={{ width: `${(count / typeMax) * 100}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {typeTotal > 0 ? `${Math.round((count / typeTotal) * 100)}%` : "0%"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : tab === "analitik" ? (
            <div className="space-y-3">
              <BarChart
                values={stats.hourly}
                labels={stats.hourly.map((_, i) => `${i}h`)}
                title="Aktivitas per jam (7 hari terakhir, UTC)"
              />

              <div className="rounded-xl border bg-card p-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Pengguna paling aktif (10 besar)
                </p>
                {stats.topUsers.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Belum ada pesan dari pengguna.
                  </p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {stats.topUsers.map((u, i) => userRow(u, i + 1))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                <Kpi
                  icon={MessageSquare}
                  label="Rata-rata pesan / hari (14d)"
                  value={String(
                    Math.round(
                      stats.daily.reduce((s, d) => s + d.count, 0) / 14
                    )
                  )}
                />
                <Kpi
                  icon={HardDrive}
                  label="Pesan ber-media"
                  value={`${typeTotal > 0 ? Math.round(((totals!.byType.image + totals!.byType.voice + totals!.byType.file) / typeTotal) * 100) : 0}%`}
                  sub="foto + suara + file"
                />
                <Kpi
                  icon={Activity}
                  label="Pesan dihapus"
                  value={`${totals!.messages > 0 ? Math.round((totals!.deletedMessages / totals!.messages) * 100) : 0}%`}
                  sub={`${totals!.deletedMessages} pesan`}
                />
              </div>
            </div>
          ) : tab === "pengguna" ? (
            <div className="rounded-xl border bg-card p-2">
              {stats.users.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Belum ada pengguna terdaftar.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {stats.users.map((u) => userRow(u))}
                </div>
              )}
            </div>
          ) : tab === "siaran" ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-card p-3">
                <p className="mb-2 text-sm font-medium">Kirim ke semua percakapan</p>
                <div className="mb-2 flex gap-1.5">
                  {(
                    [
                      { key: "siaran", label: "📣 Siaran" },
                      { key: "pengumuman", label: "📢 Pengumuman" },
                    ] as const
                  ).map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      aria-pressed={broadcastKind === k.key}
                      onClick={() => setBroadcastKind(k.key)}
                      className={cn(
                        "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                        broadcastKind === k.key
                          ? "bg-emerald-600 text-white"
                          : "bg-muted/60 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder={
                    broadcastKind === "pengumuman"
                      ? "Isi pengumuman untuk semua pengguna…"
                      : "Isi pesan siaran untuk semua pengguna…"
                  }
                  aria-label={`Teks ${broadcastKind}`}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {broadcastText.length}/500 · dikirim sebagai pesan sistem ke{" "}
                    {stats.totals.conversations} percakapan
                  </p>
                  <Button
                    size="sm"
                    className="h-9 bg-emerald-600 text-white hover:bg-emerald-600/90"
                    disabled={!broadcastText.trim() || broadcasting}
                    onClick={sendBroadcast}
                  >
                    {broadcasting ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                    Kirim
                  </Button>
                </div>
                {broadcastMsg ? (
                  <p className="mt-1.5 text-xs font-medium text-emerald-600">
                    {broadcastMsg}
                  </p>
                ) : null}
              </div>
              <p className="px-1 text-xs text-muted-foreground">
                Siaran & pengumuman tampil sebagai pesan sistem di setiap chat,
                sama seperti di WhatsApp Business.
              </p>
            </div>
          ) : tab === "pengaturan" ? (
            <div className="space-y-3">
              <div className="space-y-3 rounded-xl border bg-card p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dash-app-name">Nama aplikasi</Label>
                  <Input
                    id="dash-app-name"
                    value={settings?.appName ?? ""}
                    maxLength={40}
                    placeholder="ChatKita"
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, appName: e.target.value } : s))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Tampil di kartu login aplikasi (maks. 40 karakter).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-welcome">Pesan sambutan (opsional)</Label>
                  <Textarea
                    id="dash-welcome"
                    value={settings?.welcomeMessage ?? ""}
                    maxLength={200}
                    rows={2}
                    placeholder="Sambutan singkat di layar login…"
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, welcomeMessage: e.target.value } : s
                      )
                    }
                  />
                </div>
                <Button
                  size="sm"
                  className="h-9 bg-emerald-600 text-white hover:bg-emerald-600/90"
                  onClick={() =>
                    saveSettings({
                      appName: settings?.appName,
                      welcomeMessage: settings?.welcomeMessage,
                    })
                  }
                  disabled={!settings?.appName.trim()}
                >
                  <Save className="size-4" aria-hidden="true" />
                  Simpan identitas
                </Button>
              </div>

              <div className="space-y-3 rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Mode pemeliharaan</p>
                    <p className="text-[11px] text-muted-foreground">
                      Semua pengguna melihat banner pemeliharaan.
                    </p>
                  </div>
                  <Switch
                    checked={settings?.maintenanceMode ?? false}
                    onCheckedChange={(v) => {
                      setSettings((s) => (s ? { ...s, maintenanceMode: v } : s));
                      saveSettings({ maintenanceMode: v });
                    }}
                    aria-label="Mode pemeliharaan"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-maint-note">Catatan pemeliharaan</Label>
                  <Textarea
                    id="dash-maint-note"
                    value={settings?.maintenanceNote ?? ""}
                    maxLength={200}
                    rows={2}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, maintenanceNote: e.target.value } : s
                      )
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    saveSettings({ maintenanceNote: settings?.maintenanceNote })
                  }
                >
                  <Save className="size-4" aria-hidden="true" />
                  Simpan catatan
                </Button>
              </div>

              {settingsMsg ? (
                <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="size-3.5" aria-hidden="true" />
                  {settingsMsg}
                </p>
              ) : null}
            </div>
          ) : (
            /* Sistem */
            <div className="space-y-3">
              <div className="space-y-2.5 rounded-xl border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">Penyimpanan</p>
                {(
                  [
                    {
                      label: `Database (${formatFileSize(stats.storage.dbBytes)})`,
                      value: stats.storage.dbBytes,
                      max: Math.max(stats.storage.dbBytes, 1),
                      color: "bg-emerald-500",
                    },
                    {
                      label: `WAL journal (${formatFileSize(stats.storage.walBytes)})`,
                      value: stats.storage.walBytes,
                      max: Math.max(stats.storage.walBytes, 1),
                      color: "bg-amber-500",
                    },
                    {
                      label: `Media (${formatFileSize(stats.storage.mediaBytes)} · ${stats.storage.mediaFiles} file)`,
                      value: stats.storage.mediaBytes,
                      max: stats.storage.quotaBytes,
                      color: "bg-sky-500",
                    },
                  ] as const
                ).map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="truncate">{row.label}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", row.color)}
                        style={{
                          width: `${Math.min(100, (row.value / row.max) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Kuota media 250 MiB · retensi otomatis {stats.storage.retentionDays} hari
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <Kpi icon={Clock} label="Uptime" value={fmtUptime(stats.uptimeMs)} />
                <Kpi
                  icon={Database}
                  label="Versi service"
                  value={stats.version}
                  sub={`Data: ${fmtDateTime(stats.generatedAt)}`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={downloadBackup}
                  disabled={busy !== null}
                >
                  {busy === "backup" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  Unduh backup JSON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={runVacuum}
                  disabled={busy !== null}
                >
                  {busy === "vacuum" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  )}
                  Kompres VACUUM
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-muted-foreground"
                  onClick={fetchStats}
                  disabled={loading}
                >
                  <RefreshCw
                    className={cn("size-4", loading && "animate-spin")}
                    aria-hidden="true"
                  />
                  Segarkan
                </Button>
                {vacuumResult ? (
                  <p className="w-full text-xs font-medium text-emerald-600">
                    {vacuumResult}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="mb-1 text-sm font-medium text-foreground">Info aplikasi</p>
                <p>
                  <span className="font-medium text-foreground">
                    {settings?.appName || "ChatKita"}
                  </span>{" "}
                  — messenger pribadi 1-on-1 dengan Admin (gaya WhatsApp/Telegram).
                  Semua pesan terenkripsi transport (WSS), media disimpan di server
                  dengan deduplikasi SHA-256, dan dibersihkan otomatis setelah{" "}
                  {stats.storage.retentionDays} hari.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
