"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Activity,
  BarChart3,
  Bell,
  Check,
  Clock,
  Cpu,
  Database,
  Download,
  Eye,
  Flag,
  GaugeCircle,
  HardDrive,
  Hourglass,
  Image as ImageIcon,
  KeyRound,
  Landmark,
  Link2,
  Loader2,
  MessageSquare,
  MessageSquareReply,
  MessagesSquare,
  Megaphone,
  Mic,
  MoreVertical,
  Paperclip,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Smile,
  Ticket,
  Timer,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";

import { AdminCheat } from "@/components/chat/admin-cheat";
import { AdminPusat } from "@/components/chat/admin-pusat";
import { AdminStorage } from "@/components/chat/admin-storage";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  AdminAuditClearAck,
  AdminInviteCreateAck,
  AdminInviteListAck,
  AdminInvitesClearAck,
  AdminPasswordChangeAck,
  AdminResetPasswordAck,
  AdminSettingsResetAck,
  AdminUnbindDevicesAck,
  AdminUserCreateAck,
  AdminUserDeleteAck,
  AppSettings,
  AppSettingsAck,
  BackupAck,
  BroadcastAck,
  ChatErrorAck,
  CleanupAck,
  DashboardStats,
  DashboardStatsAck,
  DashboardUserRow,
  InviteCodeInfo,
  SystemInfo,
  SystemInfoAck,
  VacuumAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * v13 — Dashboard aplikasi khusus admin: analitik pemakaian mendalam
 * (tren harian 14/30 hari, pengguna baru, distribusi weekday/jam, komposisi
 * pengirim, kecepatan respons, engagement), pengelolaan pengguna (cari/
 * urut/filter), siaran global, pengaturan perilaku aplikasi lengkap
 * (identitas, akses, batas, fitur, pemeliharaan), backup JSON, VACUUM,
 * pembersihan manual, info runtime + jejak audit.
 * Semua data diambil live dari chat-service via socket (admin-only events).
 */

export type DashboardTab =
  | "pusat"
  | "cheat"
  | "penyimpanan"
  | "ringkasan"
  | "analitik"
  | "pengguna"
  | "siaran"
  | "pengaturan"
  | "sistem";

const TABS: { key: DashboardTab; label: string; icon: typeof GaugeCircle }[] = [
  { key: "pusat", label: "Pusat", icon: Landmark },
  { key: "cheat", label: "Cheat", icon: Wand2 },
  { key: "penyimpanan", label: "Penyimpanan", icon: HardDrive },
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

/** v13 — dd/mm dari ISO datetime penuh (aman utk joinedAt dll). */
const fmtIsoDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

/** v13 — durasi respons human-readable (ms → detik/menit/jam). */
const fmtLag = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)} detik`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} menit`;
  return `${(ms / 3_600_000).toFixed(1)} jam`;
};

const WEEKDAYS = ["Aha", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Label singkat aksi audit untuk chip. */
const AUDIT_LABELS: Record<string, string> = {
  settings: "Pengaturan",
  broadcast: "Siaran",
  backup: "Backup",
  restore: "Pemulihan",
  vacuum: "VACUUM",
  cleanup: "Pembersihan",
  ghost: "Mode hantu",
  slowmode: "Slowmode",
  freeze: "Bekukan",
  mute: "Bisu",
  kick: "Keluarkan",
  mediablock: "Blokir media",
  delete: "Hapus pesan",
  reset: "Reset aplikasi",
  reset_conversation: "Reset chat",
  pin: "Pin",
  unpin: "Lepas pin",
  keywords: "Kata terlarang",
  quick_replies: "Balasan cepat",
  cheat_send: "Cheat kirim",
  cheat_edit: "Cheat edit",
  cheat_react: "Cheat reaksi",
  cheat_time: "Cheat waktu",
  storage_map: "Peta penyimpanan",
  media_scan: "Pindai metadata",
  invite_create: "Buat kode undangan",
  invite_delete: "Hapus kode undangan",
  user_create: "Buat akun",
  user_reset_password: "Reset password user",
  user_unbind_devices: "Lepas perangkat",
  // v29 — reset & hapus menyeluruh.
  user_delete: "Hapus akun permanen",
  user_clear_chat: "User bersihkan chat",
  invite_clear_unused: "Hapus kode belum terpakai",
  audit_clear: "Bersihkan audit log",
  settings_reset: "Reset pengaturan default",
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
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-600/25">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold leading-tight tabular-nums">{value}</p>
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
              className="w-full rounded-t-sm bg-gradient-to-t from-emerald-600 to-emerald-400 transition-[height,filter] hover:brightness-110"
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

/** v13 — chart 7 kolom berlabel (weekday) dengan nilai di atas batang. */
function WeekdayChart({ weekday, title }: { weekday: number[]; title: string }) {
  const max = Math.max(1, ...weekday);
  // Tampilkan mulai Senin: index 1..6 lalu 0 (Ahad).
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex h-24 items-end gap-2">
        {order.map((idx) => (
          <div key={idx} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">{weekday[idx]}</span>
            <div
              className="w-full rounded-t-sm bg-gradient-to-t from-teal-600 to-teal-400 transition-[height,filter] hover:brightness-110"
              style={{ height: `${Math.max(4, (weekday[idx] / max) * 100)}%` }}
              title={`${WEEKDAYS[idx]}: ${weekday[idx]} pesan`}
            />
            <span className="text-[10px] font-medium text-muted-foreground">{WEEKDAYS[idx]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** v13 — bar proporsi dua kategori (pengguna vs admin). */
function SenderSplit({ user, admin }: { user: number; admin: number }) {
  const total = Math.max(1, user + admin);
  const up = Math.round((user / total) * 100);
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Komposisi pengirim</p>
      <div className="flex h-3 overflow-hidden rounded-full">
        <div
          className="bg-gradient-to-r from-emerald-600 to-emerald-400"
          style={{ width: `${up}%` }}
          title={`Pengguna: ${user} pesan (${up}%)`}
        />
        <div
          className="bg-gradient-to-r from-teal-500 to-teal-600"
          style={{ width: `${100 - up}%` }}
          title={`Admin: ${admin} pesan (${100 - up}%)`}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Pengguna · <span className="font-semibold tabular-nums">{user}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-teal-600" aria-hidden="true" />
          Admin · <span className="font-semibold tabular-nums">{admin}</span>
        </span>
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
  usingDefaultPassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Socket admin yang sudah terautentikasi. */
  socket: Socket | null;
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  /** v23 — true bila password admin masih bawaan admin123. */
  usingDefaultPassword?: boolean;
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
  // v23 — form ganti password admin (tab Pengaturan).
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  // v13 — analitik & sistem.
  const [range, setRange] = useState<14 | 30>(14);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  // v13 — tab Pengguna: pencarian / urutan / filter.
  const [userQuery, setUserQuery] = useState("");
  const [userSort, setUserSort] = useState<"messages" | "recent" | "name" | "new">("messages");
  const [onlineOnly, setOnlineOnly] = useState(false);
  // v27 — 1 orang 1 akun: buat akun, reset password, lepas perangkat, kode undangan.
  const [userCreateOpen, setUserCreateOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPw, setNewUserPw] = useState("");
  const [newUserMsg, setNewUserMsg] = useState<string | null>(null);
  const [userCreating, setUserCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<DashboardUserRow | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<DashboardUserRow | null>(null);
  const [unbindBusy, setUnbindBusy] = useState(false);
  const [invites, setInvites] = useState<InviteCodeInfo[] | null>(null);
  const [inviteCount, setInviteCount] = useState(5);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  // v29 — hapus akun permanen + kembalikan default pengaturan.
  const [deleteTarget, setDeleteTarget] = useState<DashboardUserRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [settingsResetOpen, setSettingsResetOpen] = useState(false);
  const [settingsResetBusy, setSettingsResetBusy] = useState(false);

  const fetchStats = useCallback(() => {
    if (!socket || !socket.connected) return;
    setLoading(true);
    socket.emit("admin:dashboard", {}, (res: AckOf<DashboardStatsAck>) => {
      setLoading(false);
      if (res.ok) setStats(res.stats);
    });
  }, [socket]);

  /** v13 — muat info runtime + jejak audit (tab Sistem). */
  const fetchSystem = useCallback(() => {
    if (!socket || !socket.connected) return;
    setSystemLoading(true);
    socket.emit("admin:system", {}, (res: AckOf<SystemInfoAck>) => {
      setSystemLoading(false);
      if (res.ok) setSystem(res.system);
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

  // v13 — tab Sistem memuat snapshot runtime + audit.
  useEffect(() => {
    if (!open || tab !== "sistem") return;
    const t = setTimeout(fetchSystem, 0);
    return () => clearTimeout(t);
  }, [open, tab, fetchSystem]);

  /* ---------------- v27 — 1 orang 1 akun ---------------- */

  /** Muat daftar kode undangan (tab Pengguna). */
  const fetchInvites = () => {
    if (!socket || !socket.connected) return;
    socket.emit("admin:invite_list", {}, (res: AckOf<AdminInviteListAck>) => {
      if (res.ok) setInvites(res.invites);
    });
  };

  // Muat kode undangan saat tab Pengguna dibuka.
  useEffect(() => {
    if (!open || tab !== "pengguna") return;
    fetchInvites();
  }, [open, tab]);

  // v29 — akun dihapus dari sesi admin mana pun → segarkan daftar pengguna.
  useEffect(() => {
    if (!socket || !open) return;
    const onChanged = () => fetchStats();
    socket.on("users:changed", onChanged);
    return () => {
      socket.off("users:changed", onChanged);
    };
  }, [socket, open, fetchStats]);

  /** Admin membuat akun langsung (nama + password). */
  const createUser = () => {
    if (!socket || userCreating) return;
    const nm = newUserName.trim();
    if (!nm || newUserPw.length < 4) {
      setNewUserMsg("Nama wajib diisi & password minimal 4 karakter.");
      return;
    }
    setUserCreating(true);
    setNewUserMsg(null);
    socket.emit(
      "admin:user_create",
      { name: nm, password: newUserPw },
      (res: AckOf<AdminUserCreateAck>) => {
        setUserCreating(false);
        if (res.ok) {
          setNewUserMsg(null);
          setNewUserName("");
          setNewUserPw("");
          setUserCreateOpen(false);
          toast.success(`Akun "${res.name}" dibuat`);
          fetchStats();
        } else {
          setNewUserMsg(
            res.error === "NAME_TAKEN"
              ? "Nama sudah dipakai akun lain."
              : res.error === "NAME_RESERVED"
                ? "Nama “Admin” tidak tersedia."
                : res.error === "WEAK_PASSWORD"
                  ? "Password minimal 4 karakter."
                  : res.error === "INVALID_NAME"
                    ? "Nama tidak valid (1–40 karakter)."
                    : "Gagal membuat akun."
          );
        }
      }
    );
  };

  /** Reset password user dari dashboard. */
  const submitResetPassword = () => {
    if (!socket || !resetTarget || resetBusy) return;
    if (resetPw.length < 4) {
      setResetMsg("Password minimal 4 karakter.");
      return;
    }
    setResetBusy(true);
    setResetMsg(null);
    socket.emit(
      "admin:user_reset_password",
      { userId: resetTarget.id, password: resetPw },
      (res: AckOf<AdminResetPasswordAck>) => {
        setResetBusy(false);
        if (res.ok) {
          toast.success(`Password "${resetTarget.name}" direset`);
          setResetTarget(null);
          setResetPw("");
        } else {
          setResetMsg(res.error === "WEAK_PASSWORD" ? "Password minimal 4 karakter." : "Gagal reset password.");
        }
      }
    );
  };

  /** Lepas semua kunci perangkat user (1 perangkat 1 akun). */
  const submitUnbindDevices = () => {
    if (!socket || !unbindTarget || unbindBusy) return;
    setUnbindBusy(true);
    socket.emit(
      "admin:user_unbind_devices",
      { userId: unbindTarget.id },
      (res: AckOf<AdminUnbindDevicesAck>) => {
        setUnbindBusy(false);
        if (res.ok) {
          toast.success(`${res.removed} perangkat dilepas dari "${unbindTarget.name}"`);
          setUnbindTarget(null);
          fetchStats();
        } else {
          toast.error("Gagal melepas perangkat.");
        }
      }
    );
  };

  /** Buat 1–20 kode undangan sekali pakai. */
  const createInvites = () => {
    if (!socket || inviteBusy) return;
    setInviteBusy(true);
    setInviteMsg(null);
    socket.emit(
      "admin:invite_create",
      { count: inviteCount, label: inviteLabel.trim() || undefined },
      (res: AckOf<AdminInviteCreateAck>) => {
        setInviteBusy(false);
        if (res.ok) {
          setInviteMsg(`${res.created.length} kode dibuat`);
          setInviteLabel("");
          fetchInvites();
        } else {
          setInviteMsg("Gagal membuat kode.");
        }
      }
    );
  };

  const deleteInvite = (code: string) => {
    if (!socket || inviteBusy) return;
    setInviteBusy(true);
    socket.emit("admin:invite_delete", { code }, () => {
      setInviteBusy(false);
      fetchInvites();
    });
  };

  const copyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Kode ${code} disalin`);
    } catch {
      toast.error("Gagal menyalin kode.");
    }
  };

  /** v29 — hapus SEMUA kode undangan yang belum terpakai sekali jalan. */
  const clearUnusedInvites = () => {
    if (!socket || inviteBusy) return;
    setInviteBusy(true);
    socket.emit("admin:invites_clear_unused", {}, (res: AckOf<AdminInvitesClearAck>) => {
      setInviteBusy(false);
      if (res.ok) {
        setInviteMsg(
          res.removed > 0
            ? `${res.removed} kode belum terpakai dihapus`
            : "Tidak ada kode yang belum terpakai."
        );
        fetchInvites();
      } else {
        setInviteMsg("Gagal menghapus kode.");
      }
    });
  };

  /** v29 — hapus PERMANEN akun user + seluruh datanya. */
  const submitDeleteUser = () => {
    if (!socket || !deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    socket.emit(
      "admin:user_delete",
      { userId: deleteTarget.id },
      (res: AckOf<AdminUserDeleteAck>) => {
        setDeleteBusy(false);
        if (res.ok) {
          toast.success(`Akun "${deleteTarget.name}" dihapus permanen`);
          setDeleteTarget(null);
          fetchStats();
        } else {
          toast.error(
            res.error === "NOT_FOUND" ? "Akun tidak ditemukan." : "Gagal menghapus akun."
          );
        }
      }
    );
  };

  /** v29 — kembalikan seluruh pengaturan aplikasi ke default. */
  const resetSettingsToDefault = () => {
    if (!socket || settingsResetBusy) return;
    setSettingsResetBusy(true);
    socket.emit("admin:settings:reset", {}, (res: AckOf<AdminSettingsResetAck>) => {
      setSettingsResetBusy(false);
      if (res.ok) {
        setSettings(res.settings);
        setSettingsResetOpen(false);
        setSettingsMsg("Pengaturan dikembalikan ke default.");
        toast.success("Pengaturan dikembalikan ke default");
      } else {
        toast.error("Gagal mengembalikan pengaturan.");
      }
    });
  };

  const runCleanup = () => {
    if (!socket || busy) return;
    setBusy("vacuum");
    setCleanupResult(null);
    socket.emit("admin:cleanup", {}, (res: AckOf<CleanupAck>) => {
      setBusy(null);
      if (!res.ok) return;
      const freed = res.before.bytes - res.after.bytes;
      setCleanupResult(
        `Pembersihan selesai — ${res.after.files} file media (${formatFileSize(res.after.bytes)})${freed > 0 ? ` · hemat ${formatFileSize(freed)}` : ""}`
      );
      fetchStats();
      fetchSystem();
      setTimeout(() => setCleanupResult(null), 6000);
    });
  };

  /** v13 — daftar pengguna hasil filter + urut untuk tab Pengguna. */
  const visibleUsers = useMemo(() => {
    if (!stats) return [];
    const q = userQuery.trim().toLowerCase();
    let rows = stats.users.filter((u) => (q ? u.name.toLowerCase().includes(q) : true));
    if (onlineOnly) rows = rows.filter((u) => u.online);
    const sorted = [...rows];
    if (userSort === "messages") sorted.sort((a, b) => b.messages - a.messages);
    else if (userSort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
    else if (userSort === "new")
      sorted.sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""));
    else sorted.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return sorted;
  }, [stats, userQuery, onlineOnly, userSort]);

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

  /** v23 — ganti password admin (verifikasi password lama di server, bcrypt). */
  const changeAdminPassword = () => {
    if (!socket || pwBusy) return;
    setPwMsg(null);
    if (pwNext.length < 6 || pwNext.length > 64) {
      setPwMsg({ kind: "err", text: "Password baru harus 6–64 karakter." });
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwMsg({ kind: "err", text: "Konfirmasi password tidak sama." });
      return;
    }
    setPwBusy(true);
    socket.emit(
      "admin:password_change",
      { currentPassword: pwCurrent, newPassword: pwNext },
      (res: AckOf<AdminPasswordChangeAck> | ChatErrorAck) => {
        setPwBusy(false);
        if (res.ok) {
          setPwMsg({ kind: "ok", text: "Password admin diganti ✓ (berlaku untuk login berikutnya)." });
          setPwCurrent("");
          setPwNext("");
          setPwConfirm("");
        } else if (res.error === "UNAUTHORIZED") {
          setPwMsg({ kind: "err", text: "Password sekarang salah." });
        } else if (res.error === "WEAK_PASSWORD") {
          setPwMsg({ kind: "err", text: "Password baru harus 6–64 karakter." });
        } else if (res.error === "RATE_LIMITED") {
          setPwMsg({ kind: "err", text: "Terlalu banyak percobaan — tunggu 1 menit." });
        } else {
          setPwMsg({ kind: "err", text: "Gagal mengganti password." });
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
          {u.online
            ? "Online"
            : formatLastSeen(u.lastSeenAt)}
          {u.joinedAt ? ` · bergabung ${fmtIsoDay(u.joinedAt)}` : ""}
          {/* v27 — status password + jumlah perangkat terikat. */}
          {typeof u.hasPassword === "boolean"
            ? u.hasPassword
              ? " · 🔑 ber-password"
              : " · ⚠ tanpa password"
            : ""}
          {typeof u.devices === "number" && u.devices > 0 ? ` · ${u.devices} perangkat` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{u.messages}</p>
        <p className="text-[10px] text-muted-foreground">
          pesan
          {u.mediaCount ? ` · ${u.mediaCount} media` : ""}
        </p>
      </div>
      {/* v27 — aksi per akun: reset password / lepas kunci perangkat. */}
      {!rank ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              aria-label={`Aksi akun ${u.name}`}
            >
              <MoreVertical className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => {
              setResetTarget(u);
              setResetPw("");
              setResetMsg(null);
            }}>
              <KeyRound className="size-4" aria-hidden="true" />
              Reset password…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setUnbindTarget(u)}>
              <Smartphone className="size-4" aria-hidden="true" />
              Lepas kunci perangkat
            </DropdownMenuItem>
            {/* v29 — hapus permanen akun + seluruh datanya. */}
            <DropdownMenuItem
              onSelect={() => setDeleteTarget(u)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Hapus akun…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b bg-muted/30 px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-600/25">
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
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all",
                tab === t.key
                  ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
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
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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
                  icon={UserPlus}
                  label="Pengguna baru (7 hari)"
                  value={String(totals!.newUsers7d ?? 0)}
                />
                <Kpi
                  icon={TrendingUp}
                  label="Rata-rata / pengguna"
                  value={String(
                    totals!.users > 0 ? Math.round(totals!.messages / totals!.users) : 0
                  )}
                  sub="pesan sejak bergabung"
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

              {(() => {
                const busiest = [...(stats.daily30 ?? stats.daily)].sort(
                  (a, b) => b.count - a.count
                )[0];
                if (!busiest || busiest.count === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-3 py-2 text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <TrendingUp className="size-3.5 text-emerald-600" aria-hidden="true" />
                      Hari tersibuk: {fmtDay(busiest.date)} ({busiest.count} pesan)
                    </span>
                    {stats.firstMessageAt ? (
                      <span className="text-muted-foreground">
                        Pesan pertama: {fmtDateTime(stats.firstMessageAt)}
                      </span>
                    ) : null}
                    {stats.avgResponseMs != null ? (
                      <span className="text-muted-foreground">
                        Respons admin rata-rata: {fmtLag(stats.avgResponseMs)}
                      </span>
                    ) : null}
                  </div>
                );
              })()}

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
              {/* Pemilih rentang */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Rentang tren harian
                </p>
                <div className="flex gap-1">
                  {([14, 30] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={range === r}
                      onClick={() => setRange(r)}
                      className={cn(
                        "h-7 rounded-full px-3 text-xs font-medium transition-all",
                        range === r
                          ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
                          : "bg-muted/60 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {r} hari
                    </button>
                  ))}
                </div>
              </div>

              <BarChart
                values={(range === 30 ? stats.daily30 : stats.daily).map((d) => d.count)}
                labels={(range === 30 ? stats.daily30 : stats.daily).map((d) => fmtDay(d.date))}
                title={`Pesan per hari (${range} hari terakhir)`}
              />

              <BarChart
                values={stats.newUsersDaily?.map((d) => d.count) ?? []}
                labels={stats.newUsersDaily?.map((d) => fmtDay(d.date)) ?? []}
                title="Pengguna baru per hari (14 hari)"
              />

              {stats.weekday ? (
                <WeekdayChart weekday={stats.weekday} title="Aktivitas per hari minggu (28 hari)" />
              ) : null}

              <BarChart
                values={stats.hourly}
                labels={stats.hourly.map((_, i) => `${i}h`)}
                title="Aktivitas per jam (7 hari terakhir, UTC)"
              />

              {(() => {
                const max = Math.max(...stats.hourly);
                const top3 = [...stats.hourly]
                  .map((c, i) => ({ c, i }))
                  .sort((a, b) => b.c - a.c)
                  .slice(0, 3)
                  .filter((x) => x.c > 0);
                if (top3.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Hourglass className="size-3.5 text-emerald-600" aria-hidden="true" />
                      Jam tersibuk:
                    </span>
                    {top3.map((x) => (
                      <Badge key={x.i} variant="secondary" className="font-mono text-[10px]">
                        {String(x.i).padStart(2, "0")}:00–{String(x.i).padStart(2, "0")}:59 · {x.c}
                        {x.c === max ? " 🏆" : ""}
                      </Badge>
                    ))}
                  </div>
                );
              })()}

              {stats.bySender ? (
                <SenderSplit user={stats.bySender.user} admin={stats.bySender.admin} />
              ) : null}

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Kpi
                  icon={Timer}
                  label="Respons admin (rata-rata)"
                  value={stats.avgResponseMs != null ? fmtLag(stats.avgResponseMs) : "—"}
                  sub="7 hari terakhir"
                />
                <Kpi
                  icon={Smile}
                  label="Reaksi dikirim"
                  value={String(totals!.reactionsTotal ?? 0)}
                />
                <Kpi
                  icon={MessageSquareReply}
                  label="Pesan balasan"
                  value={String(totals!.repliesTotal ?? 0)}
                />
                <Kpi
                  icon={PencilLine}
                  label="Pesan diedit"
                  value={String(totals!.editsTotal ?? 0)}
                />
              </div>

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

              <div className="grid grid-cols-2 gap-2.5">
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
            <div className="space-y-3">
              {/* Toolbar: cari + urut + filter online */}
              <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Cari pengguna…"
                    className="h-9 pl-8"
                    aria-label="Cari pengguna"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { key: "messages", label: "Terbanyak" },
                      { key: "recent", label: "Aktif" },
                      { key: "new", label: "Terbaru" },
                      { key: "name", label: "A–Z" },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={userSort === s.key}
                      onClick={() => setUserSort(s.key)}
                      className={cn(
                        "h-8 rounded-full px-2.5 text-xs font-medium transition-all",
                        userSort === s.key
                          ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
                          : "bg-muted/60 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    checked={onlineOnly}
                    onCheckedChange={setOnlineOnly}
                    aria-label="Hanya pengguna online"
                  />
                  <span>Online saja</span>
                </label>
                {/* v27 — buat akun langsung dari dashboard. */}
                <Button
                  size="sm"
                  className="h-8 shrink-0 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-600/90"
                  onClick={() => {
                    setNewUserName("");
                    setNewUserPw("");
                    setNewUserMsg(null);
                    setUserCreateOpen(true);
                  }}
                >
                  <UserPlus className="size-3.5" aria-hidden="true" />
                  Buat akun
                </Button>
              </div>

              <div className="rounded-xl border bg-card p-2">
                <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
                  {visibleUsers.length} dari {stats.users.length} pengguna
                </p>
                {visibleUsers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {stats.users.length === 0
                      ? "Belum ada pengguna terdaftar."
                      : "Tidak ada pengguna yang cocok."}
                  </p>
                ) : (
                  <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
                    {visibleUsers.map((u) => userRow(u))}
                  </div>
                )}
              </div>

              {/* v27 — kode undangan sekali pakai (1 kode = 1 akun baru). */}
              <div className="rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Ticket className="size-4 text-emerald-600" aria-hidden="true" />
                  <p className="text-sm font-medium">Kode undangan</p>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    1 kode = 1 akun
                  </Badge>
                  {/* v29 — semburan semua kode yang belum terpakai. */}
                  {invites && invites.some((iv) => !iv.usedBy) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 gap-1.5 px-2 text-[11px] font-medium text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                      disabled={inviteBusy}
                      onClick={clearUnusedInvites}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Hapus belum terpakai ({invites.filter((iv) => !iv.usedBy).length})
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={fetchInvites}
                    aria-label="Muat ulang kode undangan"
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                  <select
                    value={inviteCount}
                    onChange={(e) => setInviteCount(Number(e.target.value))}
                    aria-label="Jumlah kode"
                    className="h-9 rounded-lg border bg-background px-2 text-xs"
                  >
                    {[1, 5, 10, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} kode
                      </option>
                    ))}
                  </select>
                  <Input
                    value={inviteLabel}
                    onChange={(e) => setInviteLabel(e.target.value)}
                    placeholder="Catatan (opsional) — cth. undangan keluarga"
                    maxLength={60}
                    className="h-9 flex-1"
                    aria-label="Catatan kode undangan"
                  />
                  <Button
                    size="sm"
                    className="h-9 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-600/90"
                    disabled={inviteBusy}
                    onClick={createInvites}
                  >
                    {inviteBusy ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Ticket className="size-3.5" aria-hidden="true" />
                    )}
                    Buat kode
                  </Button>
                </div>
                {inviteMsg ? (
                  <p className="mb-2 text-xs text-emerald-600">{inviteMsg}</p>
                ) : null}
                <div className="max-h-64 divide-y divide-border/60 overflow-y-auto">
                  {!invites ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      Memuat kode…
                    </p>
                  ) : invites.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      Belum ada kode undangan — buat kode untuk mengundang anggota baru.
                    </p>
                  ) : (
                    invites.map((iv) => (
                      <div key={iv.code} className="flex items-center gap-2 py-2">
                        <button
                          type="button"
                          onClick={() => copyInvite(iv.code)}
                          title="Klik untuk salin"
                          className="rounded-md bg-muted/70 px-2 py-1 font-mono text-xs font-semibold tracking-wider transition-colors hover:bg-accent"
                        >
                          {iv.code}
                        </button>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                          {iv.usedBy
                            ? `Dipakai oleh ${iv.usedByName ?? iv.usedBy}${iv.usedAt ? ` · ${fmtIsoDay(iv.usedAt)}` : ""}`
                            : "Belum dipakai"}
                          {iv.label ? ` · ${iv.label}` : ""}
                        </span>
                        {iv.usedBy ? (
                          <Badge variant="secondary" className="text-[10px]">
                            terpakai
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-600 text-[10px] text-white">
                            tersedia
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => deleteInvite(iv.code)}
                          aria-label={`Hapus kode ${iv.code}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
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
                        "h-8 rounded-full px-3 text-xs font-medium transition-all",
                        broadcastKind === k.key
                          ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
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
                    className="btn-gradient h-9 text-white"
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
                  className="btn-gradient h-9 text-white"
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

              {/* v23 — Custom login admin: ganti password (hash bcrypt di server). */}
              <div className="space-y-3 rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-amber-600" aria-hidden="true" />
                  <p className="text-sm font-semibold">Login admin</p>
                </div>
                {usingDefaultPassword ? (
                  <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                    ⚠ Masih memakai password bawaan admin123 — segera ganti di bawah.
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="dash-pw-current">Password sekarang</Label>
                  <Input
                    id="dash-pw-current"
                    type="password"
                    value={pwCurrent}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-9"
                    onChange={(e) => {
                      setPwCurrent(e.target.value);
                      setPwMsg(null);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-pw-next">Password baru</Label>
                  <Input
                    id="dash-pw-next"
                    type="password"
                    value={pwNext}
                    autoComplete="new-password"
                    placeholder="Min. 6 karakter"
                    className="h-9"
                    onChange={(e) => {
                      setPwNext(e.target.value);
                      setPwMsg(null);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-pw-confirm">Ulangi password baru</Label>
                  <Input
                    id="dash-pw-confirm"
                    type="password"
                    value={pwConfirm}
                    autoComplete="new-password"
                    placeholder="Ulangi password baru"
                    className="h-9"
                    onChange={(e) => {
                      setPwConfirm(e.target.value);
                      setPwMsg(null);
                    }}
                  />
                </div>
                {pwMsg ? (
                  <p
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-xs",
                      pwMsg.kind === "ok"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {pwMsg.text}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  className="btn-gradient h-9 text-white"
                  disabled={pwBusy || !pwCurrent || !pwNext || !pwConfirm}
                  onClick={changeAdminPassword}
                >
                  {pwBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="size-4" aria-hidden="true" />
                  )}
                  Ganti password
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Tersimpan ter-hash di server. Login salah dibatasi (anti coba-coba).
                </p>
              </div>

              {/* v13 — Akses & Pendaftaran */}
              <div className="space-y-3 rounded-xl border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Akses & pendaftaran
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Buka pendaftaran</p>
                    <p className="text-[11px] text-muted-foreground">
                      Bila dimatikan, nama baru tidak bisa masuk — akun lama tetap bisa.
                    </p>
                  </div>
                  <Switch
                    checked={settings?.allowRegistration ?? true}
                    onCheckedChange={(v) => {
                      setSettings((s) => (s ? { ...s, allowRegistration: v } : s));
                      saveSettings({ allowRegistration: v });
                    }}
                    aria-label="Buka pendaftaran"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-slowmode">
                    Slowmode global (detik antar pesan pengguna)
                  </Label>
                  <Input
                    id="dash-slowmode"
                    type="number"
                    min={0}
                    max={60}
                    value={settings?.slowmodeSeconds ?? 0}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, slowmodeSeconds: Number(e.target.value) } : s
                      )
                    }
                    className="h-9 w-28"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    0 = nonaktif. Jeda minimum antara dua pesan beruntun tiap pengguna
                    (0–60 detik); admin tidak terpengaruh.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() => saveSettings({ slowmodeSeconds: settings?.slowmodeSeconds })}
                >
                  <Save className="size-4" aria-hidden="true" />
                  Simpan akses
                </Button>
              </div>

              {/* v13 — Batas pesan & media */}
              <div className="space-y-3 rounded-xl border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">Batas pesan & media</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="dash-maxlen">Maks. karakter pesan</Label>
                    <Input
                      id="dash-maxlen"
                      type="number"
                      min={50}
                      max={1000}
                      value={settings?.maxMessageLength ?? 1000}
                      onChange={(e) =>
                        setSettings((s) =>
                          s ? { ...s, maxMessageLength: Number(e.target.value) } : s
                        )
                      }
                      className="h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      50–1000 karakter. Admin selalu boleh 1000.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dash-maxupload">Maks. ukuran file (MiB)</Label>
                    <Input
                      id="dash-maxupload"
                      type="number"
                      min={1}
                      max={25}
                      value={settings?.maxUploadMb ?? 25}
                      onChange={(e) =>
                        setSettings((s) =>
                          s ? { ...s, maxUploadMb: Number(e.target.value) } : s
                        )
                      }
                      className="h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      1–25 MiB per file (foto, suara, dokumen).
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    saveSettings({
                      maxMessageLength: settings?.maxMessageLength,
                      maxUploadMb: settings?.maxUploadMb,
                    })
                  }
                >
                  <Save className="size-4" aria-hidden="true" />
                  Simpan batas
                </Button>
              </div>

              {/* v13 — Fitur percakapan */}
              <div className="space-y-3 rounded-xl border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">Fitur percakapan</p>
                {(
                  [
                    {
                      key: "allowImages",
                      icon: ImageIcon,
                      label: "Foto",
                      hint: "Pengguna boleh mengirim gambar.",
                    },
                    {
                      key: "allowVoice",
                      icon: Mic,
                      label: "Pesan suara",
                      hint: "Pengguna boleh merekam pesan suara.",
                    },
                    {
                      key: "allowFiles",
                      icon: Paperclip,
                      label: "Dokumen/file",
                      hint: "Pengguna boleh melampirkan file apa pun.",
                    },
                    {
                      key: "allowLinks",
                      icon: Link2,
                      label: "Tautan",
                      hint: "Bila dimatikan, pesan berisi URL ditolak.",
                    },
                    {
                      key: "linkPreview",
                      icon: Eye,
                      label: "Pratinjau tautan",
                      hint: "Kartu pratinjau pada pesan berisi URL.",
                    },
                    {
                      key: "allowReactions",
                      icon: Smile,
                      label: "Reaksi emoji",
                      hint: "Reaksi pada pesan oleh pengguna.",
                    },
                    {
                      key: "readReceipts",
                      icon: Check,
                      label: "Tanda dibaca (✓✓)",
                      hint: "Bila dimatikan, ✓✓ tidak pernah tampil di pihak lain.",
                    },
                  ] as const
                ).map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <f.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{f.hint}</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings?.[f.key] ?? true}
                      onCheckedChange={(v) => {
                        setSettings((s) => (s ? { ...s, [f.key]: v } : s));
                        saveSettings({ [f.key]: v } as Partial<AppSettings>);
                      }}
                      aria-label={f.label}
                    />
                  </div>
                ))}
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

              {/* v29 — zona berbahaya: kembalikan seluruh pengaturan ke default. */}
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium">Kembalikan pengaturan ke default</p>
                <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  Identitas, akses, batas, fitur, dan pemeliharaan dikembalikan ke nilai
                  awal. Password admin & undangan push tidak tersentuh.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={settingsResetBusy}
                  onClick={() => setSettingsResetOpen(true)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Kembalikan default
                </Button>
              </div>

              {settingsMsg ? (
                <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="size-3.5" aria-hidden="true" />
                  {settingsMsg}
                </p>
              ) : null}
            </div>
          ) : tab === "penyimpanan" ? (
            /* v26 — Peta Penyimpanan: disk + rincian per jenis/user + metadata media. */
            <AdminStorage socket={socket} />
          ) : tab === "cheat" ? (
            /* v25 — Pusat Cheat: semua fitur cheat admin dalam satu tempat. */
            <AdminCheat socket={socket} users={stats.users} />
          ) : tab === "pusat" ? (
            <AdminPusat socket={socket} version={stats.version} />
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
                  Kuota media 250 MiB ·{" "}
                  {stats.storage.retentionDays === 0
                    ? "retensi otomatis nonaktif — media disimpan permanen"
                    : `retensi otomatis ${stats.storage.retentionDays} hari`}
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

              {/* v13 — info runtime + keadaan aplikasi */}
              <div className="rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Runtime & keadaan aplikasi
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-muted-foreground"
                    onClick={fetchSystem}
                    disabled={systemLoading}
                  >
                    <RefreshCw
                      className={cn("size-3.5", systemLoading && "animate-spin")}
                      aria-hidden="true"
                    />
                    Muat ulang
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {(
                    [
                      { icon: Cpu, label: "Runtime", value: system?.runtime ?? "—" },
                      { icon: Database, label: "Platform", value: system?.platform ?? "—" },
                      {
                        icon: HardDrive,
                        label: "Memori (RSS)",
                        value: system ? formatFileSize(system.memory.rss) : "—",
                      },
                      {
                        icon: Activity,
                        label: "Koneksi socket",
                        value: system ? String(system.socketClients) : "—",
                      },
                      {
                        icon: Users,
                        label: "Pengguna online",
                        value: system ? String(system.onlineUsers) : "—",
                      },
                      {
                        icon: Bell,
                        label: "Langganan push",
                        value: system ? String(system.pushSubs) : "—",
                      },
                      {
                        icon: ShieldCheck,
                        label: "Kata terlarang",
                        value: system ? String(system.keywords) : "—",
                      },
                      {
                        icon: Flag,
                        label: "Pesan ditandai",
                        value: system ? String(system.flaggedCount) : "—",
                      },
                    ] as const
                  ).map((r) => (
                    <div key={r.label} className="rounded-lg border bg-background/50 p-2">
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <r.icon className="size-3" aria-hidden="true" />
                        {r.label}
                      </p>
                      <p className="truncate text-xs font-semibold tabular-nums" title={r.value}>
                        {r.value}
                      </p>
                    </div>
                  ))}
                </div>
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
                  variant="outline"
                  className="h-9 text-amber-700 dark:text-amber-400"
                  onClick={runCleanup}
                  disabled={busy !== null}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Bersihkan media lama
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
                  <p className="w-full text-xs font-medium text-emerald-600">{vacuumResult}</p>
                ) : null}
                {cleanupResult ? (
                  <p className="w-full text-xs font-medium text-emerald-600">{cleanupResult}</p>
                ) : null}
              </div>

              {/* v13 — jejak audit */}
              <div className="rounded-xl border bg-card p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ScrollText className="size-3.5" aria-hidden="true" />
                  Jejak audit ({system?.auditCount ?? 0} total) — 30 terakhir
                </p>
                {!system || system.audit.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {systemLoading ? "Memuat…" : "Belum ada aktivitas admin tercatat."}
                  </p>
                ) : (
                  <div className="chat-scroll max-h-64 space-y-1.5 overflow-y-auto">
                    {system.audit.map((a, i) => (
                      <div
                        key={`${a.at}-${i}`}
                        className="flex items-start gap-2 rounded-lg border bg-background/50 px-2 py-1.5 text-xs"
                      >
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {AUDIT_LABELS[a.action] ?? a.action}
                        </Badge>
                        <span className="min-w-0 flex-1 break-words text-muted-foreground">
                          {a.detail}
                        </span>
                        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                          {fmtDateTime(a.at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="mb-1 text-sm font-medium text-foreground">Info aplikasi</p>
                <p>
                  <span className="font-medium text-foreground">
                    {settings?.appName || "ChatKita"}
                  </span>{" "}
                  — messenger pribadi 1-on-1 dengan Admin (gaya WhatsApp/Telegram).
                  Semua pesan terenkripsi transport (WSS), media disimpan di server
                  dengan deduplikasi SHA-256, dan{" "}
                  {stats.storage.retentionDays === 0
                    ? "disimpan permanen — tidak dihapus otomatis."
                    : `dibersihkan otomatis setelah ${stats.storage.retentionDays} hari.`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* v27 — dialog buat akun (nama + password, tanpa kode undangan). */}
        <Dialog open={userCreateOpen} onOpenChange={setUserCreateOpen}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5 text-emerald-600" aria-hidden="true" />
                Buat akun baru
              </DialogTitle>
              <DialogDescription>
                Akun dibuat langsung oleh admin — tanpa kode undangan dan tanpa
                perangkat. Bagikan password-nya ke pemakai.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-user-name">Nama akun</Label>
                <Input
                  id="new-user-name"
                  value={newUserName}
                  maxLength={40}
                  placeholder="cth. Budi Santoso"
                  onChange={(e) => {
                    setNewUserName(e.target.value);
                    setNewUserMsg(null);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-pw">Password (min. 4 karakter)</Label>
                <Input
                  id="new-user-pw"
                  type="text"
                  value={newUserPw}
                  maxLength={72}
                  placeholder="Password awal"
                  onChange={(e) => {
                    setNewUserPw(e.target.value);
                    setNewUserMsg(null);
                  }}
                />
              </div>
              {newUserMsg ? <p className="text-sm text-destructive">{newUserMsg}</p> : null}
              <Button
                className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={userCreating || !newUserName.trim() || newUserPw.length < 4}
                onClick={createUser}
              >
                {userCreating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Membuat…
                  </>
                ) : (
                  "Buat akun"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* v27 — dialog reset password user. */}
        <Dialog
          open={!!resetTarget}
          onOpenChange={(o) => {
            if (!o) setResetTarget(null);
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-5 text-emerald-600" aria-hidden="true" />
                Reset password
              </DialogTitle>
              <DialogDescription>
                Password baru untuk akun{" "}
                <span className="font-semibold">{resetTarget?.name}</span>. Kabari
                pemakainya setelah direset.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="reset-pw">Password baru (min. 4 karakter)</Label>
                <Input
                  id="reset-pw"
                  type="text"
                  value={resetPw}
                  maxLength={72}
                  placeholder="Password baru"
                  onChange={(e) => {
                    setResetPw(e.target.value);
                    setResetMsg(null);
                  }}
                />
              </div>
              {resetMsg ? <p className="text-sm text-destructive">{resetMsg}</p> : null}
              <Button
                className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={resetBusy || resetPw.length < 4}
                onClick={submitResetPassword}
              >
                {resetBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyimpan…
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* v27 — konfirmasi lepas kunci perangkat. */}
        <Dialog
          open={!!unbindTarget}
          onOpenChange={(o) => {
            if (!o) setUnbindTarget(null);
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="size-5 text-emerald-600" aria-hidden="true" />
                Lepas kunci perangkat
              </DialogTitle>
              <DialogDescription>
                Semua perangkat yang terikat ke akun{" "}
                <span className="font-semibold">{unbindTarget?.name}</span> akan
                dilepas — perangkat itu bisa dipakai mendaftarkan akun lain.
                Cocok saat pemakai berganti HP. Lanjutkan?
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 flex-1" onClick={() => setUnbindTarget(null)}>
                Batal
              </Button>
              <Button
                className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={unbindBusy}
                onClick={submitUnbindDevices}
              >
                {unbindBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Lepas perangkat"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* v29 — konfirmasi hapus PERMANEN akun user + seluruh datanya. */}
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="size-5 text-destructive" aria-hidden="true" />
                Hapus akun permanen
              </DialogTitle>
              <DialogDescription>
                Akun <span className="font-semibold">{deleteTarget?.name}</span> beserta
                SELURUH pesan, media, percakapan, perangkat, dan langganan push-nya akan
                dihapus permanen dan tidak bisa dikembalikan. Nama akun bebas dipakai
                lagi setelah ini. Lanjutkan?
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 flex-1" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button
                className="h-10 flex-1 bg-rose-600 text-white hover:bg-rose-600/90"
                disabled={deleteBusy}
                onClick={submitDeleteUser}
              >
                {deleteBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Hapus permanen"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* v29 — konfirmasi kembalikan seluruh pengaturan ke default. */}
        <Dialog open={settingsResetOpen} onOpenChange={setSettingsResetOpen}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="size-5 text-destructive" aria-hidden="true" />
                Kembalikan pengaturan ke default?
              </DialogTitle>
              <DialogDescription>
                Nama aplikasi, pesan sambutan, mode pemeliharaan, akses (registrasi,
                media, tautan), batas panjang/unggah/slowmode, dan read receipts
                dikembalikan ke nilai awal. Password admin, kode undangan, dan data
                chat TIDAK terpengaruh. Lanjutkan?
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-10 flex-1"
                onClick={() => setSettingsResetOpen(false)}
              >
                Batal
              </Button>
              <Button
                className="h-10 flex-1 bg-rose-600 text-white hover:bg-rose-600/90"
                disabled={settingsResetBusy}
                onClick={resetSettingsToDefault}
              >
                {settingsResetBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Kembalikan default"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
