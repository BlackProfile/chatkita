"use client";

/**
 * v13→v19 — Dashboard Aplikasi (khusus admin).
 *
 * Overlay layar penuh berisi analitik aplikasi (pengguna, pesan, media,
 * login, jam sibuk, reaksi, kata terlarang, sistem) + pengaturan aplikasi
 * (identitas, sambutan, pengumuman, pemeliharaan, registrasi, batasan,
 * retensi media, jam operasional) + alat perawatan (VACUUM, bersihkan
 * media, rapikan login, ekspor backup).
 *
 * v19 — 2 tab baru: Realtime (monitor online + arus pesan langsung via
 * event `admin:live:message` + polling) dan Pesan (pencarian & moderasi
 * seluruh pesan, hapus pesan siapa pun), plus drill-down detail pengguna
 * di tab Pengguna dan 4 kartu baru di Ringkasan.
 *
 * Data via socket chat-service: admin:analytics (scope), admin:appsettings:*,
 * admin:tools. Grafik digambar dengan div/SVG ringan (tanpa dependensi baru).
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  Eye,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogIn,
  Megaphone,
  Mic,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smile,
  Timer,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type {
  AdminLiveMessageEvent,
  AppAnalyticsConversations,
  AppAnalyticsKeywords,
  AppAnalyticsLogins,
  AppAnalyticsMedia,
  AppAnalyticsOverview,
  AppAnalyticsRealtime,
  AppAnalyticsSystem,
  AppAnalyticsTimeseries,
  AppAnalyticsUserDetail,
  AppLiveMessageRow,
  AppMessagesSearch,
  AppSettings,
  AppSettingsAck,
  AppToolsAck,
  AppUserRow,
  AppAnalyticsReactions,
} from "@/lib/chat-types";

type TabKey =
  | "overview"
  | "realtime"
  | "activity"
  | "messages"
  | "users"
  | "media"
  | "security"
  | "settings"
  | "system";

type AnalyticsScope =
  | "overview"
  | "timeseries"
  | "users"
  | "media"
  | "logins"
  | "reactions"
  | "keywords"
  | "conversations"
  | "realtime"
  | "search"
  | "user-detail"
  | "system";

/* ----------------------------- helpers ------------------------------ */

const fmtInt = (n: number): string => new Intl.NumberFormat("id-ID").format(n);

const fmtBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtDT = (ms: number | null | undefined): string => {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
};

/** v19 — jam:menit:detik untuk arus pesan realtime. */
const fmtTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
};

const fmtDay = (day: string): string => {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
};

const fmtUptime = (sec: number): string => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}h ${h} jam` : h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`;
};

const fmtDurationMs = (ms: number): string => {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)} detik`;
  const m = Math.floor(ms / 60_000);
  return `${m} menit`;
};

/** Perangkat + peramban singkat dari User-Agent. */
const uaLabel = (ua: string): string => {
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Perangkat lain";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "";
  return browser ? `${browser} · ${os}` : os;
};

const TYPE_COLORS: Record<string, string> = {
  text: "#059669", // emerald-600
  image: "#f59e0b", // amber-500
  voice: "#0d9488", // teal-600
  file: "#ea580c", // orange-600
  system: "#a8a29e", // stone-400
};

const TYPE_LABELS: Record<string, string> = {
  text: "Teks",
  image: "Foto",
  voice: "Suara",
  file: "Berkas",
  system: "Sistem",
};

const SCROLLBAR =
  "max-h-96 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

/* --------------------------- mini widgets --------------------------- */

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "amber" | "emerald";
}) {
  return (
    <Card
      className={cn(
        "rounded-xl p-4",
        tone === "amber" && "border-amber-500/40 bg-amber-500/5",
        tone === "emerald" && "border-emerald-600/30 bg-emerald-600/5"
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            tone === "amber"
              ? "bg-amber-500/15 text-amber-600"
              : "bg-emerald-600/10 text-emerald-600"
          )}
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums leading-none">{value}</p>
      {sub ? <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function SectionCard({
  title,
  desc,
  icon,
  children,
  right,
}: {
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {icon ? <span className="text-emerald-600">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {desc ? <p className="text-xs text-muted-foreground">{desc}</p> : null}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Grafik batang 14 hari (bertumpuk: pesan biasa + media). */
function DayBars({ days }: { days: AppAnalyticsTimeseries["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.messages));
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {days.map((d, i) => {
          const mediaH = (d.media / max) * 100;
          const textH = ((d.messages - d.media) / max) * 100;
          return (
            <div
              key={d.day}
              className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end gap-px"
              title={`${fmtDay(d.day)} — ${fmtInt(d.messages)} pesan (${fmtInt(d.media)} media, ${fmtInt(d.logins)} login, ${fmtInt(d.newUsers)} user baru)`}
            >
              {d.messages === 0 ? (
                <div className="h-1 w-full rounded-sm bg-muted" aria-hidden="true" />
              ) : (
                <>
                  <div
                    className="w-full rounded-t-sm bg-amber-500 transition group-hover:bg-amber-400"
                    style={{ height: `${mediaH}%` }}
                  />
                  <div
                    className="w-full bg-emerald-600 transition group-hover:bg-emerald-500"
                    style={{ height: `${textH}%` }}
                  />
                </>
              )}
              <span
                className={cn(
                  "absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground",
                  i % 2 !== 0 && "hidden sm:inline"
                )}
              >
                {fmtDay(d.day)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-7 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-600" aria-hidden="true" /> Teks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500" aria-hidden="true" /> Media
        </span>
      </div>
    </div>
  );
}

/** Peta panas 24 jam (7 hari terakhir, zona waktu perangkat admin). */
function HoursHeat({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <div className="grid grid-cols-12 gap-1 sm:[grid-template-columns:repeat(24,minmax(0,1fr))]">
        {hours.map((n, h) => (
          <div key={h} className="flex flex-col items-center gap-1">
            <div
              className="h-8 w-full rounded-sm bg-emerald-600"
              style={{ opacity: n === 0 ? 0.08 : 0.15 + 0.85 * (n / max) }}
              title={`${String(h).padStart(2, "0")}:00 — ${fmtInt(n)} pesan`}
            />
            {h % 6 === 0 ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {String(h).padStart(2, "0")}
              </span>
            ) : (
              <span className="text-[10px] text-transparent select-none">·</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Warna makin pekat = makin ramai (7 hari terakhir, waktu perangkat Anda).
      </p>
    </div>
  );
}

/** v16 — batang per hari dalam seminggu (Sen–Min), 28 hari terakhir. */
function WeekdayBars({ data }: { data: number[] }) {
  // Server kirim indeks getUTCDay (0=Minggu..6=Sabtu) — tampilkan Senin dulu.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const labels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const max = Math.max(1, ...data);
  return (
    <div className="grid grid-cols-7 gap-2">
      {order.map((idx, i) => (
        <div key={idx} className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground">{fmtInt(data[idx])}</span>
          <div
            className="h-20 w-full rounded-t-md bg-emerald-600/85"
            style={{ height: `${Math.max(4, Math.round((data[idx] / max) * 80))}px` }}
            title={`${labels[i]} — ${fmtInt(data[idx])} pesan (28 hari)`}
          />
          <span className="text-xs font-medium">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Donat distribusi tipe pesan. */
function TypeDonut({ byType }: { byType: Record<string, number> }) {
  const slices = Object.entries(byType).filter(([, v]) => v > 0);
  const total = slices.reduce((a, [, v]) => a + v, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">Belum ada pesan.</p>;
  const R = 15.915; // r untuk keliling 100
  const C = 100;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 42 42" className="size-36 shrink-0 -rotate-90" role="img" aria-label="Distribusi tipe pesan">
        <circle cx="21" cy="21" r={R} fill="transparent" stroke="currentColor" strokeWidth="7" className="text-muted" />
        {slices.map(([k, v]) => {
          const frac = v / total;
          const el = (
            <circle
              key={k}
              cx="21"
              cy="21"
              r={R}
              fill="transparent"
              stroke={TYPE_COLORS[k] ?? "#a8a29e"}
              strokeWidth="7"
              strokeDasharray={`${(frac * C).toFixed(3)} ${(C - frac * C).toFixed(3)}`}
              strokeDashoffset={-acc}
            >
              <title>{`${TYPE_LABELS[k] ?? k}: ${fmtInt(v)}`}</title>
            </circle>
          );
          acc += frac * C;
          return el;
        })}
        <text
          x="21"
          y="21"
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-foreground text-[7px] font-bold"
          transform="rotate(90 21 21)"
        >
          {fmtInt(total)}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {slices
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <li key={k} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: TYPE_COLORS[k] ?? "#a8a29e" }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{TYPE_LABELS[k] ?? k}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtInt(v)} ({Math.round((v / total) * 100)}%)
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Baris bar horizontal (top pengguna / top emoji). */
function HBar({
  label,
  value,
  max,
  right,
  color = "bg-emerald-600",
}: {
  label: string;
  value: number;
  max: number;
  right?: React.ReactNode;
  color?: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="tabular-nums text-muted-foreground">{right ?? fmtInt(value)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** v19 — ikon kecil sesuai tipe pesan (arus realtime & hasil pencarian). */
function TypeIcon({ type }: { type: string }) {
  if (type === "image") return <ImageIcon className="size-3.5 shrink-0 text-amber-500" />;
  if (type === "voice") return <Mic className="size-3.5 shrink-0 text-teal-600" />;
  if (type === "file") return <Paperclip className="size-3.5 shrink-0 text-orange-600" />;
  if (type === "system") return <Megaphone className="size-3.5 shrink-0 text-stone-400" />;
  return <MessageSquare className="size-3.5 shrink-0 text-emerald-600" />;
}

/** v19 — kartu statistik kecil untuk drill-down pengguna. */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums leading-tight">{value}</p>
    </div>
  );
}

/** v19 — grafik batang mini 14 hari (drill-down pengguna). */
function MiniDayBars({ days }: { days: { day: string; messages: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.messages));
  return (
    <div className="flex h-12 items-end gap-1">
      {days.map((d) => (
        <div
          key={d.day}
          className="min-w-0 flex-1 rounded-sm bg-emerald-600/80"
          style={{ height: `${d.messages === 0 ? 3 : Math.max(6, (d.messages / max) * 100)}%` }}
          title={`${fmtDay(d.day)} — ${fmtInt(d.messages)} pesan`}
        />
      ))}
    </div>
  );
}

/* ---------------------------- main view ----------------------------- */

export function AppDashboard({
  open,
  onClose,
  socket,
}: {
  open: boolean;
  onClose: () => void;
  socket: Socket | null;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [overview, setOverview] = useState<AppAnalyticsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<AppAnalyticsTimeseries | null>(null);
  const [userRows, setUserRows] = useState<AppUserRow[] | null>(null);
  const [mediaInfo, setMediaInfo] = useState<AppAnalyticsMedia | null>(null);
  const [logins, setLogins] = useState<AppAnalyticsLogins | null>(null);
  const [reactions, setReactions] = useState<AppAnalyticsReactions | null>(null);
  const [keywords, setKeywords] = useState<AppAnalyticsKeywords | null>(null);
  const [conversations, setConversations] = useState<AppAnalyticsConversations | null>(null);
  const [system, setSystem] = useState<AppAnalyticsSystem | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userSort, setUserSort] = useState<"messages" | "recent" | "name" | "bytes">("messages");
  const [blockedText, setBlockedText] = useState("");
  /* v19 — monitor realtime */
  const [realtime, setRealtime] = useState<AppAnalyticsRealtime | null>(null);
  const [liveFeed, setLiveFeed] = useState<AppLiveMessageRow[]>([]);
  /* v19 — pencarian & moderasi pesan */
  const [searchQ, setSearchQ] = useState("");
  const [searchType, setSearchType] = useState("all");
  const [searchUser, setSearchUser] = useState("all");
  const [searchDays, setSearchDays] = useState("0");
  const [searchResult, setSearchResult] = useState<AppMessagesSearch | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /* v19 — drill-down detail pengguna */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AppAnalyticsUserDetail>>({});

  const emitAck = useCallback(
    <T,>(event: string, payload: unknown): Promise<T> =>
      new Promise((resolve) => {
        if (!socket || !socket.connected) {
          resolve({ ok: false, error: "NO_SOCKET" } as T);
          return;
        }
        socket.emit(event, payload, (res: T) => resolve(res));
      }),
    [socket]
  );

  const fetchScope = useCallback(
    async (scope: AnalyticsScope) => {
      const tz = new Date().getTimezoneOffset();
      const res = await emitAck<{ ok: boolean; payload?: unknown }>("admin:analytics", {
        scope,
        tzOffset: tz,
      });
      if (!res.ok || res.payload == null) return;
      switch (scope) {
        case "overview":
          setOverview(res.payload as AppAnalyticsOverview);
          break;
        case "timeseries":
          setTimeseries(res.payload as AppAnalyticsTimeseries);
          break;
        case "users":
          setUserRows((res.payload as { users: AppUserRow[] }).users);
          break;
        case "media":
          setMediaInfo(res.payload as AppAnalyticsMedia);
          break;
        case "logins":
          setLogins(res.payload as AppAnalyticsLogins);
          break;
        case "reactions":
          setReactions(res.payload as AppAnalyticsReactions);
          break;
        case "keywords":
          setKeywords(res.payload as AppAnalyticsKeywords);
          break;
        case "conversations":
          setConversations(res.payload as AppAnalyticsConversations);
          break;
        case "search":
          setSearchResult(res.payload as AppMessagesSearch);
          break;
        case "user-detail": {
          const d = res.payload as AppAnalyticsUserDetail;
          if (d.user) setDetailCache((prev) => ({ ...prev, [d.user!.id]: d }));
          break;
        }
        case "system":
          setSystem(res.payload as AppAnalyticsSystem);
          break;
      }
    },
    [emitAck]
  );

  /* v19 — muat scope realtime + gabungkan ke arus pesan (seed = ganti total). */
  const loadRealtime = useCallback(
    async (seed = false) => {
      const tz = new Date().getTimezoneOffset();
      const res = await emitAck<{ ok: boolean; payload?: unknown }>("admin:analytics", {
        scope: "realtime",
        tzOffset: tz,
      });
      if (!res.ok || res.payload == null) return;
      const payload = res.payload as AppAnalyticsRealtime;
      setRealtime(payload);
      setLiveFeed((prev) => {
        if (seed) return payload.recent.slice(0, 60);
        const map = new Map<number, AppLiveMessageRow>();
        for (const r of prev) map.set(r.id, r);
        for (const r of payload.recent) if (!map.has(r.id)) map.set(r.id, r);
        return [...map.values()].sort((a, b) => b.id - a.id).slice(0, 60);
      });
    },
    [emitAck]
  );

  /* Muat data sesuai tab yang dibuka (+ selalu ambil overview & setelan). */
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const jobs: Promise<void>[] = [fetchScope("overview")];
      const res = await emitAck<AppSettingsAck>("admin:appsettings:get", {});
      if (res.ok && res.settings) {
        setSettings(res.settings);
        setBlockedText(res.settings.blockedExtensions.join(", "));
      }
      if (tab === "activity") {
        jobs.push(
          fetchScope("timeseries"),
          fetchScope("users"),
          fetchScope("reactions"),
          fetchScope("conversations")
        );
      } else if (tab === "overview") {
        // Ringkasan juga menampilkan grafik 14 hari.
        jobs.push(fetchScope("timeseries"));
      } else if (tab === "realtime") {
        // Arus realtime ditangani effect terpisah (polling 15 dtk + push).
      } else if (tab === "messages") {
        // Daftar pengguna utk filter pencarian.
        jobs.push(fetchScope("users"));
      } else if (tab === "users") {
        jobs.push(fetchScope("users"));
      } else if (tab === "media") {
        jobs.push(fetchScope("media"));
      } else if (tab === "security") {
        jobs.push(fetchScope("logins"), fetchScope("keywords"), fetchScope("reactions"));
      } else if (tab === "system") {
        jobs.push(fetchScope("system"));
      }
      await Promise.all(jobs);
    })();
  }, [open, tab, fetchScope, emitAck]);

  /* v19 — tab Realtime: poll 15 dtk + push `admin:live:message` langsung. */
  useEffect(() => {
    if (!open || tab !== "realtime") return;
    void (async () => {
      await loadRealtime(true);
    })();
    const t = setInterval(() => {
      void loadRealtime(false);
    }, 15_000);
    const onLive = (msg: AdminLiveMessageEvent) => {
      setLiveFeed((prev) => (prev.some((r) => r.id === msg.id) ? prev : [msg, ...prev].slice(0, 60)));
    };
    const onPresence = () => {
      void loadRealtime(false);
    };
    socket?.on("admin:live:message", onLive);
    socket?.on("presence:update", onPresence);
    return () => {
      clearInterval(t);
      socket?.off("admin:live:message", onLive);
      socket?.off("presence:update", onPresence);
    };
  }, [open, tab, loadRealtime, socket]);

  /* Segarkan otomatis ringkasan/aktivitas tiap 30 detik. */
  useEffect(() => {
    if (!open || (tab !== "overview" && tab !== "activity")) return;
    const t = setInterval(() => {
      void fetchScope("overview");
      if (tab === "activity") void fetchScope("timeseries");
    }, 30_000);
    return () => clearInterval(t);
  }, [open, tab, fetchScope]);

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>, okMsg: string) => {
      const res = await emitAck<AppSettingsAck>("admin:appsettings:set", { patch });
      if (res.ok && res.settings) {
        setSettings(res.settings);
        setBlockedText(res.settings.blockedExtensions.join(", "));
        toast({ title: okMsg });
      } else {
        toast({
          variant: "destructive",
          title: res.error === "NO_SOCKET" ? "Tidak terhubung ke server" : "Gagal menyimpan setelan",
        });
      }
    },
    [emitAck]
  );

  const runTool = useCallback(
    async (action: string, after?: () => void) => {
      setToolBusy(action);
      const res = await emitAck<AppToolsAck>("admin:tools", { action });
      setToolBusy(null);
      if (res.ok) {
        toast({ title: res.message ?? "Selesai" });
        if (action === "export-backup" && res.backup) {
          try {
            const blob = new Blob([JSON.stringify(res.backup, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `chatkita-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            toast({ variant: "destructive", title: "Gagal membuat berkas backup" });
          }
        }
        if (action === "vacuum" || action === "prune-logins" || action === "cleanup-media") {
          void fetchScope("system");
          void fetchScope("overview");
          after?.();
        }
      } else {
        toast({ variant: "destructive", title: "Alat gagal dijalankan" });
      }
    },
    [emitAck, fetchScope]
  );

  /* v19 — jalankan pencarian pesan (append = muat halaman berikutnya). */
  const runSearch = useCallback(
    async (opts?: { append?: boolean }) => {
      setSearchLoading(true);
      const tz = new Date().getTimezoneOffset();
      const res = await emitAck<{ ok: boolean; payload?: unknown }>("admin:analytics", {
        scope: "search",
        tzOffset: tz,
        query: {
          q: searchQ.trim(),
          type: searchType === "all" ? "" : searchType,
          userId: searchUser === "all" ? "" : searchUser,
          days: Number(searchDays) || 0,
          limit: 30,
          offset: opts?.append ? (searchResult?.rows.length ?? 0) : 0,
        },
      });
      setSearchLoading(false);
      if (!res.ok || res.payload == null) {
        toast({ variant: "destructive", title: "Pencarian gagal" });
        return;
      }
      const payload = res.payload as AppMessagesSearch;
      setSearchResult((prev) =>
        opts?.append && prev
          ? { total: payload.total, rows: [...prev.rows, ...payload.rows] }
          : payload
      );
    },
    [emitAck, searchQ, searchType, searchUser, searchDays, searchResult]
  );

  /* v19 — buka/tutup panel detail pengguna (drill-down). */
  const toggleDetail = useCallback(
    (uid: string) => {
      if (detailId === uid) {
        setDetailId(null);
        return;
      }
      setDetailId(uid);
      if (detailCache[uid]) return;
      void (async () => {
        const tz = new Date().getTimezoneOffset();
        const res = await emitAck<{ ok: boolean; payload?: unknown }>("admin:analytics", {
          scope: "user-detail",
          tzOffset: tz,
          query: { userId: uid },
        });
        if (!res.ok || res.payload == null) return;
        const d = res.payload as AppAnalyticsUserDetail;
        if (d.user) setDetailCache((prev) => ({ ...prev, [uid]: d }));
      })();
    },
    [detailId, detailCache, emitAck]
  );

  /* v19 — moderasi: hapus pesan siapa pun utk semua pengguna. */
  const moderateDelete = useCallback(
    async (row: AppSearchRow) => {
      if (
        !window.confirm(
          `Hapus pesan #${row.id} dari ${row.senderName} untuk semua pengguna?\n\nIsi: "${row.preview}"`
        )
      )
        return;
      setDeletingId(row.id);
      const res = await emitAck<AppToolsAck>("admin:tools", {
        action: "delete-message",
        messageId: row.id,
      });
      setDeletingId(null);
      if (res.ok) {
        toast({ title: res.message ?? "Pesan dihapus" });
        setSearchResult((prev) =>
          prev
            ? {
                ...prev,
                rows: prev.rows.map((r) =>
                  r.id === row.id ? { ...r, deleted: true, preview: "Pesan ini dihapus" } : r
                ),
              }
            : prev
        );
      } else {
        toast({
          variant: "destructive",
          title: res.error === "NOT_FOUND" ? "Pesan tidak ditemukan" : "Gagal menghapus pesan",
        });
      }
    },
    [emitAck]
  );

  const filteredUsers = useMemo(() => {
    if (!userRows) return null;
    const q = userQuery.trim().toLowerCase();
    let rows = q ? userRows.filter((u) => u.name.toLowerCase().includes(q)) : [...userRows];
    rows.sort((a, b) => {
      if (userSort === "name") return a.name.localeCompare(b.name, "id");
      if (userSort === "recent") return b.last_seen_at - a.last_seen_at;
      if (userSort === "bytes") return b.bytes - a.bytes;
      return b.messages - a.messages;
    });
    return rows;
  }, [userRows, userQuery, userSort]);

  if (!open) return null;

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Ringkasan", icon: <LayoutDashboard className="size-4" /> },
    { key: "realtime", label: "Realtime", icon: <Radio className="size-4" /> },
    { key: "activity", label: "Aktivitas", icon: <BarChart3 className="size-4" /> },
    { key: "messages", label: "Pesan", icon: <Search className="size-4" /> },
    { key: "users", label: "Pengguna", icon: <Users className="size-4" /> },
    { key: "media", label: "Media", icon: <HardDrive className="size-4" /> },
    { key: "security", label: "Keamanan", icon: <ShieldCheck className="size-4" /> },
    { key: "settings", label: "Pengaturan", icon: <Settings className="size-4" /> },
    { key: "system", label: "Sistem", icon: <Server className="size-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex bg-background" role="dialog" aria-label="Dashboard aplikasi">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-600">
            <Gauge className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">Dashboard Aplikasi</p>
            <p className="truncate text-xs text-muted-foreground">
              {overview?.appName ?? "ChatKita"} {overview?.version ? `· ${overview.version}` : ""}
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Bagian dashboard">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                tab === t.key
                  ? "bg-emerald-600/10 font-semibold text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={onClose}>
            <X className="size-4" /> Tutup dashboard
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 md:hidden">
            <Gauge className="size-4" />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold md:text-base">
            {TABS.find((t) => t.key === tab)?.label}
            <span className="ml-2 hidden text-xs font-normal text-muted-foreground sm:inline">
              data langsung dari server
            </span>
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Segarkan data"
            onClick={() => {
              void fetchScope("overview");
              if (tab === "activity") {
                void fetchScope("timeseries");
                void fetchScope("conversations");
              }
              if (tab === "realtime") void loadRealtime(true);
              if (tab === "messages") void runSearch();
              if (tab === "users") void fetchScope("users");
              if (tab === "media") void fetchScope("media");
              if (tab === "security") {
                void fetchScope("logins");
                void fetchScope("keywords");
              }
              if (tab === "system") void fetchScope("system");
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-9 md:hidden" aria-label="Tutup" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        {/* Chip nav (mobile) */}
        <nav
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] md:hidden"
          aria-label="Bagian dashboard"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                tab === t.key
                  ? "border-emerald-600/40 bg-emerald-600/10 font-semibold text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
          {/* -------------------------- RINGKASAN -------------------------- */}
          {tab === "overview" ? (
            overview ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    icon={<Users className="size-4" />}
                    label="Total pengguna"
                    value={fmtInt(overview.usersTotal)}
                    sub={`${fmtInt(overview.usersNew7d)} baru dalam 7 hari`}
                  />
                  <StatCard
                    icon={<Activity className="size-4" />}
                    label="Aktif 7 hari"
                    value={fmtInt(overview.usersActive7d)}
                    sub={`${overview.usersTotal ? Math.round((overview.usersActive7d / overview.usersTotal) * 100) : 0}% dari total`}
                    tone="emerald"
                  />
                  <StatCard
                    icon={<MessageSquare className="size-4" />}
                    label="Pesan 24 jam"
                    value={fmtInt(overview.messagesToday)}
                    sub={`${fmtInt(overview.messages7d)} dalam 7 hari`}
                  />
                  <StatCard
                    icon={<MessagesSquare className="size-4" />}
                    label="Total pesan"
                    value={fmtInt(overview.messagesTotal)}
                    sub={`${fmtInt((overview.byType.image ?? 0) + (overview.byType.voice ?? 0) + (overview.byType.file ?? 0))} berupa media`}
                  />
                  <StatCard
                    icon={<HardDrive className="size-4" />}
                    label="Media tersimpan"
                    value={fmtBytes(overview.storageBytes)}
                    sub={`${fmtInt(overview.mediaDisk.files)} file di disk (${fmtBytes(overview.mediaDisk.bytes)})`}
                  />
                  <StatCard
                    icon={<LogIn className="size-4" />}
                    label="Login 24 jam"
                    value={fmtInt(overview.loginsToday)}
                    sub={`${fmtInt(overview.logins7d)} dalam 7 hari`}
                  />
                  <StatCard
                    icon={<Clock className="size-4" />}
                    label="Balasan rata-rata"
                    value={fmtDurationMs(overview.avgResponseMs)}
                    sub="jeda pesan user → balasan admin (7 hari)"
                  />
                  <StatCard
                    icon={<Smile className="size-4" />}
                    label="Reaksi"
                    value={fmtInt(overview.reactionsTotal)}
                    sub={
                      overview.reactionsTop.length > 0
                        ? `terpopuler ${overview.reactionsTop[0].emoji} (${fmtInt(overview.reactionsTop[0].n)})`
                        : "belum ada reaksi"
                    }
                  />
                  <StatCard
                    icon={<Radio className="size-4" />}
                    label="Online sekarang"
                    value={fmtInt(overview.onlineNow)}
                    sub={`${fmtInt(overview.msgs1h)} pesan dalam 1 jam`}
                    tone="emerald"
                  />
                  <StatCard
                    icon={<MessagesSquare className="size-4" />}
                    label="Percakapan"
                    value={fmtInt(overview.conversationsTotal)}
                    sub="total seluruhnya"
                  />
                  <StatCard
                    icon={<Trash2 className="size-4" />}
                    label="Pesan dihapus"
                    value={fmtInt(overview.deletedTotal)}
                    sub={`${fmtInt(overview.deletedForUser)} disembunyikan dr pengguna`}
                    tone="amber"
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-3">
                    <SectionCard title="Aktivitas 14 hari" desc="Pesan per hari — batang kuning = media" icon={<BarChart3 className="size-4" />}>
                      <DayBars days={timeseries?.days ?? []} />
                    </SectionCard>
                  </div>
                  <div className="lg:col-span-2">
                    <SectionCard title="Tipe pesan" desc="Komposisi seluruh pesan" icon={<MessagesSquare className="size-4" />}>
                      <TypeDonut byType={overview.byType} />
                    </SectionCard>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" /> Memuat ringkasan…
              </div>
            )
          ) : null}

          {/* -------------------------- AKTIVITAS -------------------------- */}
          {tab === "activity" ? (
            <div className="space-y-4">
              <SectionCard title="Pesan per hari" desc="14 hari terakhir (zona waktu perangkat Anda)" icon={<BarChart3 className="size-4" />}>
                {timeseries ? <DayBars days={timeseries.days} /> : <p className="text-sm text-muted-foreground">Memuat…</p>}
              </SectionCard>
              <SectionCard title="Jam sibuk" desc="Distribusi pesan per jam" icon={<Clock className="size-4" />}>
                {timeseries ? <HoursHeat hours={timeseries.hours} /> : <p className="text-sm text-muted-foreground">Memuat…</p>}
              </SectionCard>
              {conversations ? (
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    icon={<MessageSquare className="size-4" />}
                    label="Aktif 24 jam"
                    value={`${conversations.retention.total > 0 ? Math.round((conversations.retention.active24h / conversations.retention.total) * 100) : 0}%`}
                    sub={`${fmtInt(conversations.retention.active24h)} dari ${fmtInt(conversations.retention.total)} user`}
                  />
                  <StatCard
                    icon={<MessageSquare className="size-4" />}
                    label="Aktif 7 hari"
                    value={`${conversations.retention.total > 0 ? Math.round((conversations.retention.active7d / conversations.retention.total) * 100) : 0}%`}
                    sub={`${fmtInt(conversations.retention.active7d)} dari ${fmtInt(conversations.retention.total)} user`}
                  />
                  <StatCard
                    icon={<MessageSquare className="size-4" />}
                    label="Aktif 30 hari"
                    value={`${conversations.retention.total > 0 ? Math.round((conversations.retention.active30d / conversations.retention.total) * 100) : 0}%`}
                    sub={`${fmtInt(conversations.retention.active30d)} dari ${fmtInt(conversations.retention.total)} user`}
                  />
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard title="Hari sibuk" desc="Pesan per hari dalam seminggu (28 hari)" icon={<CalendarDays className="size-4" />}>
                  {conversations ? <WeekdayBars data={conversations.weekday} /> : <p className="text-sm text-muted-foreground">Memuat…</p>}
                </SectionCard>
                <SectionCard
                  title="Kondisi percakapan"
                  desc="Arsip & bekuan saat ini"
                  icon={<MessagesSquare className="size-4" />}
                >
                  {conversations ? (
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Total percakapan</span>
                        <span className="tabular-nums">{fmtInt(overview?.conversationsTotal ?? 0)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Diarsipkan</span>
                        <span className="tabular-nums">{fmtInt(conversations.totals.archived)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Dibekukan (baca-saja)</span>
                        <span className="tabular-nums">{fmtInt(conversations.totals.frozen)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Percakapan teratas</span>
                        <span className="tabular-nums">
                          {conversations.top[0]
                            ? `${conversations.top[0].userA ?? "?"} & ${conversations.top[0].userB ?? "?"}`
                            : "—"}
                        </span>
                      </li>
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Memuat…</p>
                  )}
                </SectionCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard title="Komposisi pesan" icon={<MessagesSquare className="size-4" />}>
                  {overview ? <TypeDonut byType={overview.byType} /> : <p className="text-sm text-muted-foreground">Memuat…</p>}
                </SectionCard>
                <SectionCard title="Reaksi terpopuler" desc={`${fmtInt(reactions?.total ?? 0)} reaksi total`} icon={<Smile className="size-4" />}>
                  {reactions && reactions.top.length > 0 ? (
                    <div className="space-y-2.5">
                      {reactions.top.slice(0, 6).map((r) => (
                        <HBar
                          key={r.emoji}
                          label={`${r.emoji}`}
                          value={r.n}
                          max={reactions.top[0].n}
                          color="bg-amber-500"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Belum ada reaksi.</p>
                  )}
                </SectionCard>
              </div>
              <SectionCard title="Pengguna paling aktif" desc="Berdasarkan jumlah pesan terkirim" icon={<Users className="size-4" />}>
                {userRows && userRows.length > 0 ? (
                  <div className="space-y-3">
                    {userRows.slice(0, 8).map((u) => (
                      <HBar
                        key={u.id}
                        label={u.name}
                        value={u.messages}
                        max={userRows[0].messages}
                        right={`${fmtInt(u.messages)} pesan`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Belum ada data.</p>
                )}
              </SectionCard>
              <SectionCard title="Konversasi teratas" desc="20 percakapan dengan pesan terbanyak" icon={<MessagesSquare className="size-4" />}>
                {conversations && conversations.top.length > 0 ? (
                  <div className={SCROLLBAR}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Percakapan</th>
                          <th className="py-2 pr-3 text-right font-medium">Pesan</th>
                          <th className="py-2 pr-3 text-right font-medium">Media</th>
                          <th className="py-2 pr-3 text-right font-medium">Terakhir</th>
                          <th className="py-2 text-right font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conversations.top.map((c) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="max-w-[180px] truncate py-2 pr-3" title={`${c.userA ?? "?"} & ${c.userB ?? "?"}`}>
                              {c.userA ?? "?"} & {c.userB ?? "?"}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(c.messages)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(c.media)}</td>
                            <td className="py-2 pr-3 text-right text-xs text-muted-foreground">{fmtDT(c.lastAt)}</td>
                            <td className="py-2 text-right text-xs">
                              {c.frozen ? (
                                <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600 dark:text-rose-400">beku</span>
                              ) : c.archived ? (
                                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">arsip</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Belum ada percakapan.</p>
                )}
              </SectionCard>
            </div>
          ) : null}

          {/* ------------------------- REALTIME (v19) ----------------------- */}
          {tab === "realtime" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  icon={<Radio className="size-4" />}
                  label="Online sekarang"
                  value={fmtInt(realtime?.online.length ?? 0)}
                  sub={realtime && realtime.onlineAdmins > 0 ? `${fmtInt(realtime.onlineAdmins)} sesi admin aktif` : "admin belum terhubung"}
                  tone="emerald"
                />
                <StatCard
                  icon={<MessageSquare className="size-4" />}
                  label="Pesan 5 menit"
                  value={fmtInt(realtime?.msgs5m ?? 0)}
                  sub={`${fmtInt(realtime?.msgs1h ?? 0)} dalam 1 jam`}
                />
                <StatCard
                  icon={<Activity className="size-4" />}
                  label="Pesan 24 jam"
                  value={fmtInt(realtime?.msgs24h ?? 0)}
                  sub="total hari ini"
                />
                <StatCard
                  icon={<MessagesSquare className="size-4" />}
                  label="Percakapan aktif"
                  value={fmtInt(realtime?.activeConvs24h ?? 0)}
                  sub="ada pesan dalam 24 jam"
                />
              </div>
              <SectionCard
                title="Sedang online"
                desc="Pengguna dengan koneksi aktif saat ini"
                icon={<Radio className="size-4" />}
              >
                {realtime ? (
                  realtime.online.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {realtime.online.map((o) => (
                        <span
                          key={o.id}
                          className="flex items-center gap-1.5 rounded-full border bg-emerald-600/5 px-2.5 py-1 text-xs font-medium"
                          title={`Terakhir dilihat ${fmtDT(o.lastSeenAt)}`}
                        >
                          <span className="relative flex size-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                            <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
                          </span>
                          {o.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Tidak ada pengguna yang online.</p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">Memuat…</p>
                )}
              </SectionCard>
              <SectionCard
                title="Arus pesan langsung"
                desc="40 pesan terakhir dari semua percakapan — diperbarui otomatis"
                icon={<Activity className="size-4" />}
                right={
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <span className="size-2 animate-pulse rounded-full bg-emerald-600" aria-hidden="true" />
                    live
                  </span>
                }
              >
                <div className={SCROLLBAR}>
                  <ul className="space-y-2">
                    {liveFeed.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
                          m.deleted && "opacity-60"
                        )}
                      >
                        <span className="mt-0.5">
                          <TypeIcon type={m.type} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="shrink-0 font-medium">{m.senderName}</span>
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                              di {m.userA} & {m.userB}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {fmtTime(m.createdAt)}
                            </span>
                          </div>
                          <p className={cn("truncate text-xs text-muted-foreground", m.deleted && "line-through")}>
                            {m.preview}
                          </p>
                        </div>
                        {m.keyword ? (
                          <Badge variant="outline" className="shrink-0 border-rose-500/40 text-rose-600">
                            {m.keyword}
                          </Badge>
                        ) : null}
                        {m.deleted ? (
                          <Badge variant="outline" className="shrink-0">
                            dihapus
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                    {liveFeed.length === 0 ? (
                      <li className="py-6 text-center text-sm text-muted-foreground">Belum ada pesan.</li>
                    ) : null}
                  </ul>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {/* ------------------------ PESAN (v19) --------------------------- */}
          {tab === "messages" ? (
            <div className="space-y-4">
              <SectionCard
                title="Cari & moderasi pesan"
                desc="Telusuri seluruh pesan di semua percakapan — isi pesan yang dihapus tetap terlihat"
                icon={<Search className="size-4" />}
              >
                <form
                  className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_140px_110px_auto] sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch();
                  }}
                >
                  <Input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Kata kunci isi pesan / nama file…"
                    className="col-span-2 h-9 text-sm sm:col-span-1"
                    aria-label="Kata kunci pesan"
                  />
                  <Select value={searchType} onValueChange={setSearchType}>
                    <SelectTrigger className="h-9 text-xs" aria-label="Tipe pesan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua tipe</SelectItem>
                      <SelectItem value="text">Teks</SelectItem>
                      <SelectItem value="image">Foto</SelectItem>
                      <SelectItem value="voice">Suara</SelectItem>
                      <SelectItem value="file">Berkas</SelectItem>
                      <SelectItem value="media">Semua media</SelectItem>
                      <SelectItem value="system">Sistem</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={searchUser} onValueChange={setSearchUser}>
                    <SelectTrigger className="h-9 text-xs" aria-label="Pengguna">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="all">Semua pengguna</SelectItem>
                      {(userRows ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={searchDays} onValueChange={setSearchDays}>
                    <SelectTrigger className="h-9 text-xs" aria-label="Rentang waktu">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sepanjang waktu</SelectItem>
                      <SelectItem value="1">24 jam terakhir</SelectItem>
                      <SelectItem value="7">7 hari</SelectItem>
                      <SelectItem value="30">30 hari</SelectItem>
                      <SelectItem value="90">90 hari</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" className="h-9" disabled={searchLoading}>
                    {searchLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    Cari
                  </Button>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">
                  Kosongkan kata kunci untuk menelusuri semua pesan sesuai filter lain.
                </p>
              </SectionCard>

              {searchResult ? (
                <SectionCard
                  title={`${fmtInt(searchResult.total)} pesan ditemukan`}
                  desc={`Menampilkan ${fmtInt(searchResult.rows.length)} — terbaru dulu`}
                  icon={<MessageSquare className="size-4" />}
                >
                  {searchResult.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Tidak ada pesan yang cocok dengan filter.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className={cn(SCROLLBAR, "space-y-2 pr-1")}>
                        {searchResult.rows.map((r) => (
                          <div
                            key={r.id}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-sm",
                              r.deleted && "bg-muted/40"
                            )}
                          >
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <TypeIcon type={r.type} />
                              <span className="font-medium text-foreground">{r.senderName}</span>
                              <span className="min-w-0 truncate">
                                {r.userA} & {r.userB}
                              </span>
                              <span className="ml-auto shrink-0 tabular-nums">{fmtTime(r.createdAt)}</span>
                              {r.keyword ? (
                                <Badge variant="outline" className="shrink-0 border-rose-500/40 text-rose-600">
                                  {r.keyword}
                                </Badge>
                              ) : null}
                              {r.deleted ? (
                                <Badge variant="outline" className="shrink-0">
                                  dihapus
                                </Badge>
                              ) : r.deletedForUser ? (
                                <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600">
                                  disembunyikan
                                </Badge>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-muted-foreground hover:text-rose-600"
                                aria-label={`Hapus pesan #${r.id}`}
                                disabled={r.deleted || deletingId === r.id}
                                onClick={() => void moderateDelete(r)}
                              >
                                {deletingId === r.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </Button>
                            </div>
                            <p
                              className={cn(
                                "mt-1 break-words text-[13px]",
                                r.deleted && "text-muted-foreground line-through"
                              )}
                              title={r.type === "text" ? r.content : r.preview}
                            >
                              {r.preview}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              #{r.id}
                              {r.fileSize ? ` · ${fmtBytes(r.fileSize)}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                      {searchResult.rows.length < searchResult.total ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={searchLoading}
                          onClick={() => void runSearch({ append: true })}
                        >
                          {searchLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                          Muat lebih ({fmtInt(searchResult.total - searchResult.rows.length)} lagi)
                        </Button>
                      ) : null}
                    </div>
                  )}
                </SectionCard>
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Atur filter di atas lalu klik <span className="font-semibold text-foreground">Cari</span> untuk
                  menelusuri pesan.
                </div>
              )}
            </div>
          ) : null}

          {/* -------------------------- PENGGUNA --------------------------- */}
          {tab === "users" ? (
            <SectionCard
              title="Statistik pengguna"
              desc={filteredUsers ? `${fmtInt(filteredUsers.length)} pengguna` : "Memuat…"}
              icon={<Users className="size-4" />}
              right={
                <div className="flex items-center gap-2">
                  <Input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Cari nama…"
                    className="h-8 w-32 text-xs sm:w-44"
                    aria-label="Cari pengguna"
                  />
                  <Select value={userSort} onValueChange={(v) => setUserSort(v as typeof userSort)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Urutkan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="messages">Paling aktif</SelectItem>
                      <SelectItem value="recent">Terakhir aktif</SelectItem>
                      <SelectItem value="bytes">Media terbesar</SelectItem>
                      <SelectItem value="name">Nama A-Z</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              {filteredUsers ? (
                filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tidak ada pengguna yang cocok.</p>
                ) : (
                  <div className={SCROLLBAR}>
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Nama</th>
                          <th className="py-2 pr-3 font-medium">Pesan</th>
                          <th className="py-2 pr-3 font-medium">Media</th>
                          <th className="py-2 pr-3 font-medium">Ukuran</th>
                          <th className="py-2 pr-3 font-medium">Login</th>
                          <th className="py-2 font-medium">Terakhir aktif</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <Fragment key={u.id}>
                            <tr className={cn("border-t", detailId === u.id && "bg-muted/20")}>
                              <td className="py-2 pr-3 font-medium">
                                <button
                                  type="button"
                                  onClick={() => toggleDetail(u.id)}
                                  aria-expanded={detailId === u.id}
                                  className="flex items-center gap-1 rounded text-left transition hover:text-emerald-600"
                                >
                                  {detailId === u.id ? (
                                    <ChevronDown className="size-3.5 shrink-0" />
                                  ) : (
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  {u.name}
                                </button>
                              </td>
                              <td className="py-2 pr-3 tabular-nums">{fmtInt(u.messages)}</td>
                              <td className="py-2 pr-3 tabular-nums">{fmtInt(u.mediaCount)}</td>
                              <td className="py-2 pr-3 tabular-nums">{fmtBytes(u.bytes)}</td>
                              <td className="py-2 pr-3 tabular-nums">{fmtInt(u.logins)}×</td>
                              <td className="py-2 text-muted-foreground">{fmtDT(u.last_seen_at)}</td>
                            </tr>
                            {detailId === u.id ? (
                              <tr className="border-t bg-muted/20">
                                <td colSpan={6} className="p-3 sm:p-4">
                                  {(() => {
                                    const d = detailCache[u.id];
                                    if (!d || !d.user || !d.stats) {
                                      return (
                                        <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
                                          <Loader2 className="mr-2 size-4 animate-spin" /> Memuat detail…
                                        </div>
                                      );
                                    }
                                    return (
                                      <div className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                          <span>
                                            Bergabung <span className="font-medium text-foreground">{fmtDT(d.user.createdAt)}</span>
                                          </span>
                                          <span>·</span>
                                          <span>
                                            Terakhir aktif{" "}
                                            <span className="font-medium text-foreground">{fmtDT(d.user.lastSeenAt)}</span>
                                          </span>
                                          {d.topPartner ? (
                                            <>
                                              <span>·</span>
                                              <span>
                                                Paling banyak chat dengan{" "}
                                                <span className="font-medium text-foreground">{d.topPartner.name}</span> (
                                                {fmtInt(d.topPartner.messages)} pesan)
                                              </span>
                                            </>
                                          ) : null}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                                          <MiniStat label="Pesan" value={fmtInt(d.stats.messages)} />
                                          <MiniStat label="Media" value={fmtInt(d.stats.media)} />
                                          <MiniStat label="Ukuran" value={fmtBytes(d.stats.bytes)} />
                                          <MiniStat label="Login" value={fmtInt(d.stats.logins)} />
                                          <MiniStat label="Percakapan" value={fmtInt(d.stats.conversations)} />
                                          <MiniStat label="Reaksi" value={fmtInt(d.stats.reactions)} />
                                        </div>
                                        <div>
                                          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                            Aktivitas 14 hari
                                          </p>
                                          <MiniDayBars days={d.days ?? []} />
                                        </div>
                                        <div className="grid gap-3 lg:grid-cols-2">
                                          <div>
                                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                              Login terakhir
                                            </p>
                                            <ul className="space-y-1 text-xs">
                                              {(d.lastLogins ?? []).slice(0, 5).map((l, i) => (
                                                <li key={i} className="flex items-center justify-between gap-2">
                                                  <span className="min-w-0 truncate">{uaLabel(l.ua)}</span>
                                                  <span className="shrink-0 text-muted-foreground">
                                                    {fmtDT(l.at)} · {l.ip || "—"}
                                                  </span>
                                                </li>
                                              ))}
                                              {(d.lastLogins ?? []).length === 0 ? (
                                                <li className="text-muted-foreground">Belum ada riwayat login.</li>
                                              ) : null}
                                            </ul>
                                          </div>
                                          <div>
                                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                              Pesan terakhir
                                            </p>
                                            <ul className="space-y-1 text-xs">
                                              {(d.recentMessages ?? []).slice(0, 6).map((m) => (
                                                <li
                                                  key={m.id}
                                                  className={cn("flex items-center gap-1.5", m.deleted && "opacity-60")}
                                                >
                                                  <span className="shrink-0 text-muted-foreground">
                                                    {m.outgoing ? "→" : "←"}
                                                  </span>
                                                  <span className="min-w-0 flex-1 truncate">
                                                    {m.partnerName}: {m.preview}
                                                  </span>
                                                  <span className="shrink-0 tabular-nums text-muted-foreground">
                                                    {fmtTime(m.createdAt)}
                                                  </span>
                                                </li>
                                              ))}
                                              {(d.recentMessages ?? []).length === 0 ? (
                                                <li className="text-muted-foreground">Belum ada pesan.</li>
                                              ) : null}
                                            </ul>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="flex h-24 items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Memuat…
                </div>
              )}
            </SectionCard>
          ) : null}

          {/* --------------------------- MEDIA ----------------------------- */}
          {tab === "media" ? (
            mediaInfo ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard icon={<HardDrive className="size-4" />} label="File di disk" value={fmtInt(mediaInfo.disk.files)} sub={fmtBytes(mediaInfo.disk.bytes)} />
                  <StatCard icon={<Eye className="size-4" />} label="Media aktif" value={fmtInt(mediaInfo.liveCount)} sub="belum kedaluwarsa" />
                  <StatCard icon={<Trash2 className="size-4" />} label="Kedaluwarsa" value={fmtInt(mediaInfo.expiredCount)} sub="payload sudah dihapus" tone="amber" />
                  <StatCard icon={<Timer className="size-4" />} label="Retensi" value={`${fmtInt(mediaInfo.retentionDays)} hari`} sub="media lebih tua dihapus otomatis" />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="Per jenis media" desc="Berdasarkan tipe MIME" icon={<HardDrive className="size-4" />}>
                    {mediaInfo.groups.length > 0 ? (
                      <div className="space-y-3">
                        {mediaInfo.groups.map((g) => (
                          <HBar
                            key={g.kind}
                            label={g.kind === "application" ? "dokumen" : g.kind}
                            value={g.bytes}
                            max={mediaInfo.groups[0].bytes}
                            right={`${fmtInt(g.n)} file · ${fmtBytes(g.bytes)}`}
                            color={g.kind === "image" ? "bg-amber-500" : g.kind === "video" ? "bg-rose-500" : "bg-emerald-600"}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Belum ada media.</p>
                    )}
                  </SectionCard>
                  <SectionCard title="Berkas terbesar" desc="15 teratas" icon={<Database className="size-4" />}>
                    {mediaInfo.top.length > 0 ? (
                      <div className={SCROLLBAR}>
                        <table className="w-full min-w-[380px] text-sm">
                          <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="py-2 pr-3 font-medium">Berkas</th>
                              <th className="py-2 pr-3 font-medium">Ukuran</th>
                              <th className="py-2 font-medium">Pengirim</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mediaInfo.top.map((f, i) => (
                              <tr key={i} className="border-t">
                                <td className="max-w-[180px] truncate py-2 pr-3" title={f.fileName ?? ""}>
                                  {f.fileName ?? "(tanpa nama)"}
                                </td>
                                <td className="py-2 pr-3 tabular-nums">{fmtBytes(f.fileSize ?? 0)}</td>
                                <td className="py-2 text-muted-foreground">{f.senderName ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Belum ada berkas.</p>
                    )}
                  </SectionCard>
                </div>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" /> Memuat media…
              </div>
            )
          ) : null}

          {/* -------------------------- KEAMANAN --------------------------- */}
          {tab === "security" ? (
            <div className="space-y-4">
              <SectionCard
                title="Login terakhir"
                desc={logins ? `${fmtInt(logins.total)} total · maks ${logins.perUserCap}/pengguna disimpan` : "Memuat…"}
                icon={<LogIn className="size-4" />}
              >
                {logins && logins.logins.length > 0 ? (
                  <div className={SCROLLBAR}>
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Waktu</th>
                          <th className="py-2 pr-3 font-medium">Pengguna</th>
                          <th className="py-2 pr-3 font-medium">Perangkat</th>
                          <th className="py-2 font-medium">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logins.logins.map((l, i) => (
                          <tr key={i} className="border-t">
                            <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{fmtDT(l.at)}</td>
                            <td className="py-2 pr-3 font-medium">{l.name ?? "(akun terhapus)"}</td>
                            <td className="py-2 pr-3">{uaLabel(l.ua)}</td>
                            <td className="py-2 font-mono text-xs text-muted-foreground">{l.ip || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Belum ada riwayat login.</p>
                )}
              </SectionCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Kata terlarang terdeteksi"
                  desc="Dari pantauan kata (diatur di menu Saklar admin)"
                  icon={<ShieldAlert className="size-4" />}
                >
                  {keywords && keywords.counts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {keywords.counts.map((c) => (
                        <Badge key={c.k} variant="outline" className="border-rose-500/40 text-rose-600">
                          {c.k} · {fmtInt(c.n)}×
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Belum ada pelanggaran tercatat.</p>
                  )}
                </SectionCard>
                <SectionCard title="Kejadian terbaru" desc="25 pesan bertanda terakhir" icon={<AlertTriangle className="size-4" />}>
                  {keywords && keywords.recent.length > 0 ? (
                    <div className={cn(SCROLLBAR, "space-y-2")}>
                      {keywords.recent.map((r) => (
                        <div key={r.id} className="rounded-lg border p-2.5 text-sm">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="border-rose-500/40 text-rose-600">
                              {r.k}
                            </Badge>
                            <span className="truncate font-medium text-foreground">{r.senderName ?? "—"}</span>
                            <span className="ml-auto shrink-0">{fmtDT(r.at)}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Tidak ada kejadian.</p>
                  )}
                </SectionCard>
              </div>
            </div>
          ) : null}

          {/* ------------------------- PENGATURAN -------------------------- */}
          {tab === "settings" ? (
            settings ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {/* Identitas & pesan otomatis */}
                <SectionCard title="Identitas & pesan otomatis" desc="Nama aplikasi, sambutan akun baru, pengumuman" icon={<Megaphone className="size-4" />}>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-app-name">Nama aplikasi</Label>
                      <Input
                        id="dash-app-name"
                        value={settings.appName}
                        maxLength={40}
                        onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Tampil di judul tab & kartu login.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-tagline">Tagline (subjudul login)</Label>
                      <Input
                        id="dash-tagline"
                        value={settings.appTagline}
                        maxLength={120}
                        placeholder="cth. Chat resmi toko Kita — balas cepat setiap hari"
                        onChange={(e) => setSettings({ ...settings, appTagline: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Tampil di bawah judul layar login (kosongkan untuk sembunyi).</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-welcome">Pesan sambutan (akun baru)</Label>
                      <Textarea
                        id="dash-welcome"
                        value={settings.welcomeText}
                        maxLength={500}
                        rows={3}
                        placeholder="Kosongkan untuk menonaktifkan"
                        onChange={(e) => setSettings({ ...settings, welcomeText: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Terkirim otomatis sebagai catatan sistem saat seseorang mendaftar.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-announce">Pengumuman (banner semua user)</Label>
                      <Textarea
                        id="dash-announce"
                        value={settings.announcement}
                        maxLength={300}
                        rows={2}
                        placeholder="Kosongkan untuk menonaktifkan"
                        onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
                      />
                    </div>
                    <Button
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                      disabled={!settings.appName.trim()}
                      onClick={() =>
                        void saveSettings(
                          {
                            appName: settings.appName,
                            appTagline: settings.appTagline,
                            welcomeText: settings.welcomeText,
                            announcement: settings.announcement,
                          },
                          "Identitas & pesan tersimpan"
                        )
                      }
                    >
                      <Check className="size-4" /> Simpan identitas & pesan
                    </Button>
                  </div>
                </SectionCard>

                {/* Akses */}
                <SectionCard title="Akses & ketersediaan" desc="Kontrol siapa yang bisa masuk" icon={<ShieldCheck className="size-4" />}>
                  <div className="space-y-4">
                    <div className={cn("rounded-xl border p-3", settings.maintenance ? "border-amber-500/50 bg-amber-500/5" : "border-border")}>
                      <div className="flex items-center gap-3">
                        <span className={cn("flex size-9 items-center justify-center rounded-lg", settings.maintenance ? "bg-amber-500/15 text-amber-600" : "bg-muted text-muted-foreground")}>
                          <AlertTriangle className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Mode pemeliharaan</p>
                          <p className="text-xs text-muted-foreground">Blokir SEMUA login user. Admin tetap bisa masuk.</p>
                        </div>
                        <Switch
                          checked={settings.maintenance}
                          onCheckedChange={(v) => void saveSettings({ maintenance: v }, v ? "Mode pemeliharaan AKTIF" : "Mode pemeliharaan nonaktif")}
                          aria-label="Mode pemeliharaan"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <KeyRound className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Pendaftaran nama baru</p>
                        <p className="text-xs text-muted-foreground">Nonaktif = hanya akun yang sudah ada yang bisa masuk.</p>
                      </div>
                      <Switch
                        checked={settings.registrationOpen}
                        onCheckedChange={(v) => void saveSettings({ registrationOpen: v }, v ? "Pendaftaran dibuka" : "Pendaftaran ditutup")}
                        aria-label="Pendaftaran nama baru"
                      />
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <KeyRound className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Wajib PIN akun baru</p>
                        <p className="text-xs text-muted-foreground">Akun yang baru mendaftar diminta membuat PIN.</p>
                      </div>
                      <Switch
                        checked={settings.requirePinNew}
                        onCheckedChange={(v) => void saveSettings({ requirePinNew: v }, v ? "PIN wajib untuk akun baru" : "PIN opsional")}
                        aria-label="Wajib PIN akun baru"
                      />
                    </div>
                    {settings.maintenance ? (
                      <div className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="dash-maint-text">Teks banner pemeliharaan</Label>
                          <Textarea
                            id="dash-maint-text"
                            rows={2}
                            maxLength={500}
                            placeholder="Kosongkan = teks default (Sedang pemeliharaan — coba lagi nanti)"
                            value={settings.maintenanceText}
                            onChange={(e) => setSettings({ ...settings, maintenanceText: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => void saveSettings({ maintenanceText: settings.maintenanceText }, "Teks pemeliharaan tersimpan")}
                        >
                          <Check className="size-4" /> Simpan teks pemeliharaan
                        </Button>
                      </div>
                    ) : null}
                    {/* v16 — saklar jenis media (enforce server + UI). */}
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span className={cn("flex size-9 items-center justify-center rounded-lg", settings.allowImages ? "bg-emerald-600/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
                        <ImageIcon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Izinkan kirim foto</p>
                        <p className="text-xs text-muted-foreground">Jika mati, tombol kamera/foto disembunyikan & server menolak.</p>
                      </div>
                      <Switch
                        checked={settings.allowImages}
                        onCheckedChange={(v) => void saveSettings({ allowImages: v }, v ? "Kirim foto diizinkan" : "Kirim foto dinonaktifkan")}
                        aria-label="Izinkan kirim foto"
                      />
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span className={cn("flex size-9 items-center justify-center rounded-lg", settings.allowVoice ? "bg-emerald-600/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
                        <Mic className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Izinkan pesan suara</p>
                        <p className="text-xs text-muted-foreground">Jika mati, tombol rekam suara disembunyikan & server menolak.</p>
                      </div>
                      <Switch
                        checked={settings.allowVoice}
                        onCheckedChange={(v) => void saveSettings({ allowVoice: v }, v ? "Pesan suara diizinkan" : "Pesan suara dinonaktifkan")}
                        aria-label="Izinkan pesan suara"
                      />
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span className={cn("flex size-9 items-center justify-center rounded-lg", settings.allowFiles ? "bg-emerald-600/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
                        <Paperclip className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Izinkan kirim berkas</p>
                        <p className="text-xs text-muted-foreground">Jika mati, tombol lampir berkas disembunyikan & server menolak.</p>
                      </div>
                      <Switch
                        checked={settings.allowFiles}
                        onCheckedChange={(v) => void saveSettings({ allowFiles: v }, v ? "Kirim berkas diizinkan" : "Kirim berkas dinonaktifkan")}
                        aria-label="Izinkan kirim berkas"
                      />
                    </div>
                  </div>
                </SectionCard>

                {/* Batasan */}
                <SectionCard title="Batasan pesan & berkas" desc="Melindungi server dari beban berlebih" icon={<Gauge className="size-4" />}>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="dash-maxlen">Panjang pesan maks</Label>
                        <Input
                          id="dash-maxlen"
                          type="number"
                          min={50}
                          max={1000}
                          value={settings.maxMessageLength}
                          onChange={(e) => setSettings({ ...settings, maxMessageLength: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">50–1000 karakter</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="dash-maxup">Ukuran upload maks (MB)</Label>
                        <Input
                          id="dash-maxup"
                          type="number"
                          min={1}
                          max={25}
                          value={settings.maxUploadMb}
                          onChange={(e) => setSettings({ ...settings, maxUploadMb: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">1–25 MB</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-rate">Batas laju pesan teks</Label>
                      <Select
                        value={String(settings.rateLimitPerMin)}
                        onValueChange={(v) => setSettings({ ...settings, rateLimitPerMin: Number(v) })}
                      >
                        <SelectTrigger id="dash-rate" aria-label="Batas laju pesan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Default server (30/menit)</SelectItem>
                          <SelectItem value="10">10 pesan / menit</SelectItem>
                          <SelectItem value="20">20 pesan / menit</SelectItem>
                          <SelectItem value="30">30 pesan / menit</SelectItem>
                          <SelectItem value="60">60 pesan / menit</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-blocked">Ekstensi berkas terlarang</Label>
                      <Input
                        id="dash-blocked"
                        value={blockedText}
                        placeholder="cth. exe, bat, sh, apk"
                        onChange={(e) => setBlockedText(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Pisahkan dengan koma. User tidak bisa mengirim berkas dengan ekstensi ini.</p>
                    </div>
                    <Button
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                      onClick={() =>
                        void saveSettings(
                          {
                            maxMessageLength: settings.maxMessageLength,
                            maxUploadMb: settings.maxUploadMb,
                            rateLimitPerMin: settings.rateLimitPerMin,
                            blockedExtensions: blockedText
                              .split(",")
                              .map((x) => x.trim().replace(/^\./, "").toLowerCase())
                              .filter(Boolean),
                          },
                          "Batasan tersimpan"
                        )
                      }
                    >
                      <Check className="size-4" /> Simpan batasan
                    </Button>
                  </div>
                </SectionCard>

                {/* Retensi & jam operasional */}
                <SectionCard title="Retensi media & jam operasional" desc="Penghematan disk & jam kerja admin" icon={<Timer className="size-4" />}>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="dash-retention">Retensi media (hari)</Label>
                      <Select
                        value={String(settings.mediaRetentionDays)}
                        onValueChange={(v) => setSettings({ ...settings, mediaRetentionDays: Number(v) })}
                      >
                        <SelectTrigger id="dash-retention" aria-label="Retensi media">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Default server (30 hari)</SelectItem>
                          <SelectItem value="7">7 hari</SelectItem>
                          <SelectItem value="14">14 hari</SelectItem>
                          <SelectItem value="30">30 hari</SelectItem>
                          <SelectItem value="60">60 hari</SelectItem>
                          <SelectItem value="90">90 hari</SelectItem>
                          <SelectItem value="180">180 hari</SelectItem>
                          <SelectItem value="365">365 hari</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Media lebih tua dari batas ini dihapus dari disk (pesan jadi &quot;kedaluwarsa&quot;). Pembersihan besar tiap 6 jam, atau lewat tab Sistem.
                      </p>
                    </div>
                    <div className="rounded-xl border p-3">
                      <div className="flex items-center gap-3">
                        <span className={cn("flex size-9 items-center justify-center rounded-lg", settings.officeHoursEnabled ? "bg-emerald-600/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
                          <Clock className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Jam operasional</p>
                          <p className="text-xs text-muted-foreground">Di luar jam, user dibalas otomatis.</p>
                        </div>
                        <Switch
                          checked={settings.officeHoursEnabled}
                          onCheckedChange={(v) => setSettings({ ...settings, officeHoursEnabled: v })}
                          aria-label="Jam operasional"
                        />
                      </div>
                      {settings.officeHoursEnabled ? (
                        <div className="mt-3 space-y-3 border-t pt-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="dash-office-start">Mulai</Label>
                              <Input
                                id="dash-office-start"
                                type="time"
                                value={settings.officeStart}
                                onChange={(e) => setSettings({ ...settings, officeStart: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="dash-office-end">Selesai</Label>
                              <Input
                                id="dash-office-end"
                                type="time"
                                value={settings.officeEnd}
                                onChange={(e) => setSettings({ ...settings, officeEnd: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="dash-office-away">Balasan di luar jam</Label>
                            <Textarea
                              id="dash-office-away"
                              rows={2}
                              maxLength={500}
                              placeholder="cth. Terima kasih! Jam kerja kami 09.00-17.00, pesan Anda akan dibalas besok pagi."
                              value={settings.officeAwayText}
                              onChange={(e) => setSettings({ ...settings, officeAwayText: e.target.value })}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <Button
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                      onClick={() =>
                        void saveSettings(
                          {
                            mediaRetentionDays: settings.mediaRetentionDays,
                            officeHoursEnabled: settings.officeHoursEnabled,
                            officeStart: settings.officeStart,
                            officeEnd: settings.officeEnd,
                            officeAwayText: settings.officeAwayText,
                          },
                          "Retensi & jam operasional tersimpan"
                        )
                      }
                    >
                      <Check className="size-4" /> Simpan retensi & jam kerja
                    </Button>
                  </div>
                </SectionCard>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" /> Memuat setelan…
              </div>
            )
          ) : null}

          {/* --------------------------- SISTEM ----------------------------- */}
          {tab === "system" ? (
            system ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard icon={<Database className="size-4" />} label="Ukuran database" value={fmtBytes(system.dbBytes)} sub="SQLite + WAL" />
                  <StatCard icon={<HardDrive className="size-4" />} label="Media di disk" value={fmtBytes(system.mediaDisk.bytes)} sub={`${fmtInt(system.mediaDisk.files)} file`} />
                  <StatCard icon={<Server className="size-4" />} label="Server menyala" value={fmtUptime(system.uptimeSec)} sub={fmtDT(system.bootAt)} />
                  <StatCard icon={<Gauge className="size-4" />} label="Versi" value={system.version} sub="chat-service" />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="Isi database" desc="Jumlah baris per tabel" icon={<Database className="size-4" />}>
                    <div className={SCROLLBAR}>
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(system.tables).map(([t, n]) => (
                            <tr key={t} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-mono text-xs">{t}</td>
                              <td className="py-2 text-right tabular-nums">{fmtInt(n)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                  <SectionCard title="Batas efektif server" desc="Hasil setelan + default" icon={<Gauge className="size-4" />}>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Panjang pesan maks</span>
                        <span className="tabular-nums">{fmtInt(system.limits.maxMessageLength)} karakter</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Ukuran upload maks</span>
                        <span className="tabular-nums">{fmtInt(system.limits.maxUploadMb)} MB</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Kuota media per akun</span>
                        <span className="tabular-nums">{fmtInt(system.limits.quotaMb)} MB</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Laju pesan (teks / media)</span>
                        <span className="tabular-nums">
                          {system.limits.rateTextPerMin}/m · {system.limits.rateMediaPerMin}/m
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Retensi media</span>
                        <span className="tabular-nums">
                          {system.limits.retentionDays} hari (default {system.limits.envRetentionDays})
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Halaman riwayat</span>
                        <span className="tabular-nums">{system.limits.historyPageSize} pesan</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Push subscription aktif</span>
                        <span className="tabular-nums">{fmtInt(system.pushSubscriptions)}</span>
                      </li>
                    </ul>
                  </SectionCard>
                </div>
                <SectionCard title="Alat perawatan" desc="Jalankan sesekali untuk menjaga performa" icon={<Settings className="size-4" />}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" disabled={toolBusy !== null} onClick={() => void runTool("vacuum")}>
                      {toolBusy === "vacuum" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                      Kompres database (VACUUM)
                    </Button>
                    <Button variant="outline" disabled={toolBusy !== null} onClick={() => void runTool("cleanup-media")}>
                      {toolBusy === "cleanup-media" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      Bersihkan media kedaluwarsa
                    </Button>
                    <Button variant="outline" disabled={toolBusy !== null} onClick={() => void runTool("prune-logins")}>
                      {toolBusy === "prune-logins" ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                      Rapikan riwayat login
                    </Button>
                    <Button
                      variant="outline"
                      className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                      disabled={toolBusy !== null}
                      onClick={() => {
                        if (window.confirm("Hapus SEMUA riwayat login? IP & perangkat tercatat akan hilang.")) {
                          void runTool("clear-logins");
                        }
                      }}
                    >
                      {toolBusy === "clear-logins" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      Hapus semua riwayat login
                    </Button>
                    <Button variant="outline" disabled={toolBusy !== null} onClick={() => void runTool("export-backup")}>
                      {toolBusy === "export-backup" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                      Ekspor backup (JSON)
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Backup berisi pengguna (tanpa PIN), percakapan, pesan, setelan, dan riwayat login — tanpa token notifikasi perangkat.
                  </p>
                </SectionCard>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-5 animate-spin" /> Memuat sistem…
              </div>
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
