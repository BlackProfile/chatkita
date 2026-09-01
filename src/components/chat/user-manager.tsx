"use client";

import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  ArrowLeft,
  Download,
  Globe,
  Loader2,
  LogOut,
  Paperclip,
  RefreshCw,
  ShieldBan,
  Smartphone,
  Timer,
  VolumeX,
} from "lucide-react";

import { ConfirmDialog, downloadTextFile } from "@/components/chat/admin-tools";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  avatarColorClass,
  formatFileSize,
  formatLastSeen,
  initials,
} from "@/lib/chat-utils";
import type {
  AckOf,
  DashboardStatsAck,
  DashboardUserRow,
  ExportAck,
  FreezeAck,
  KickAck,
  MediaBlockAck,
  MuteAck,
  SlowModeAck,
  UserRestrictionState,
  UserStatsAck,
  XrayAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/**
 * v11 — Manajemen pengguna: daftar semua user (dari admin:dashboard) +
 * X-Ray per user (admin:xray + admin:user_stats) lengkap dengan aksi
 * sesi: bekukan, bisukan, mode lambat, blokir media, paksa keluar,
 * ekspor data. Semua event admin-only; setiap perubahan pembatasan
 * otomatis di-push server ke user terkait (user:restricted).
 */

const SLOW_OPTIONS = [0, 1, 2, 3, 5, 10];
const MUTE_OPTIONS = [5, 30, 60];

/** Cache pembatasan terakhir per user (scope sesi halaman). */
const restrictionCache = new Map<string, UserRestrictionState>();

const fmtHM = (d: Date): string =>
  `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;

const fmtDay = (iso: string): string => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

function truncateUA(ua: string | null): string {
  if (!ua) return "—";
  return ua.length > 44 ? `${ua.slice(0, 44)}…` : ua;
}

/** Grafik batang 14 hari (CSS murni, pola dashboard). */
function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Pesan 14 hari terakhir</p>
      <div className="flex h-20 items-end gap-0.5">
        {values.map((v, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className="w-full rounded-t-sm bg-emerald-500/80 transition-[height]"
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

export function UserManager({
  open,
  onOpenChange,
  socket,
  initialUserId,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Socket admin yang sudah terautentikasi. */
  socket: Socket | null;
  /** Buka langsung ke X-Ray user ini (mis. tombol "Info user"). */
  initialUserId?: string | null;
  onNotice?: (text: string) => void;
}) {
  const [users, setUsers] = useState<DashboardUserRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailName, setDetailName] = useState("");
  const [profile, setProfile] = useState<XrayAck["profile"] | null>(null);
  const [stats, setStats] = useState<UserStatsAck | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restricted, setRestricted] = useState<UserRestrictionState | null>(null);
  const [confirm, setConfirm] = useState<"freeze" | "kick" | null>(null);

  const fetchUsers = useCallback(() => {
    if (!socket?.connected) return;
    setListLoading(true);
    socket.emit("admin:dashboard", {}, (res: AckOf<DashboardStatsAck>) => {
      setListLoading(false);
      if (res.ok) setUsers(res.stats.users);
    });
  }, [socket]);

  const loadDetail = useCallback(
    (userId: string, name?: string) => {
      if (!socket?.connected) return;
      setDetailId(userId);
      if (name) setDetailName(name);
      setDetailLoading(true);
      setProfile(null);
      setStats(null);
      setRestricted(restrictionCache.get(userId) ?? null);
      socket.emit("admin:xray", { userId }, (res: AckOf<XrayAck>) => {
        setDetailLoading(false);
        if (res.ok) setProfile(res.profile);
      });
      socket.emit("admin:user_stats", { userId }, (res: AckOf<UserStatsAck>) => {
        if (res.ok) setStats(res);
      });
    },
    [socket]
  );

  // Refresh on open; hormati target X-Ray awal (dari tombol "Info user").
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (initialUserId) loadDetail(initialUserId);
      else setDetailId(null);
      fetchUsers();
    }, 0);
    return () => clearTimeout(t);
  }, [open, initialUserId, loadDetail, fetchUsers]);

  const remember = (userId: string, state: UserRestrictionState) => {
    restrictionCache.set(userId, state);
    setRestricted(state);
  };

  const doFreeze = (on: boolean) => {
    if (!socket || !detailId) return;
    socket.emit(
      "admin:freeze",
      { userId: detailId, on },
      (res: AckOf<FreezeAck>) => {
        if (res.ok) {
          remember(detailId, res.restricted);
          onNotice?.(res.frozen ? `${detailName} dibekukan 🚫` : `${detailName} dibebaskan`);
        } else onNotice?.("Gagal mengubah status bekukan");
      }
    );
  };

  const doMute = (minutes: number) => {
    if (!socket || !detailId) return;
    socket.emit(
      "admin:mute",
      { userId: detailId, minutes },
      (res: AckOf<MuteAck>) => {
        if (res.ok) {
          remember(detailId, res.restricted);
          onNotice?.(
            res.mutedUntil
              ? `${detailName} dibisukan s/${fmtHM(new Date(res.mutedUntil))}`
              : `Bisukan ${detailName} dilepas`
          );
        } else onNotice?.("Gagal mengubah bisukan");
      }
    );
  };

  const doSlow = (perMinute: number) => {
    if (!socket || !detailId) return;
    socket.emit(
      "admin:slowmode",
      { userId: detailId, perMinute },
      (res: AckOf<SlowModeAck>) => {
        if (res.ok) {
          remember(detailId, res.restricted);
          onNotice?.(
            res.perMinute > 0
              ? `Mode lambat ${detailName}: ${res.perMinute} pesan/menit`
              : `Mode lambat ${detailName} dimatikan`
          );
        } else onNotice?.("Gagal mengubah mode lambat");
      }
    );
  };

  const doMediaBlock = (on: boolean) => {
    if (!socket || !detailId) return;
    socket.emit(
      "admin:mediablock",
      { userId: detailId, on },
      (res: AckOf<MediaBlockAck>) => {
        if (res.ok) {
          remember(detailId, res.restricted);
          onNotice?.(res.mediaBlocked ? `Media ${detailName} diblokir 📎` : `Blokir media ${detailName} dilepas`);
        } else onNotice?.("Gagal mengubah blokir media");
      }
    );
  };

  const doKick = () => {
    if (!socket || !detailId) return;
    socket.emit("admin:kick", { userId: detailId }, (res: AckOf<KickAck>) => {
      if (res.ok) onNotice?.(`${detailName} dikeluarkan (${res.sockets} socket)`);
      else onNotice?.("Gagal memaksa keluar");
    });
  };

  const doExport = () => {
    if (!socket || !detailId) return;
    onNotice?.("Menyiapkan ekspor…");
    socket.emit("admin:export_user", { userId: detailId }, (res: AckOf<ExportAck>) => {
      if (!res.ok) {
        onNotice?.("Ekspor gagal");
        return;
      }
      downloadTextFile(res.fileName, res.content, "application/json");
      onNotice?.(`Data ${detailName} terunduh (${res.count} pesan) ✓`);
    });
  };

  const mutedActive =
    !!restricted?.mutedUntil && Date.parse(restricted.mutedUntil) > Date.now();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setConfirm(null);
      }}
    >
      <DialogContent className="max-w-lg rounded-2xl">
        {detailId === null ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="size-4 text-emerald-600" aria-hidden="true" />
                Manajemen pengguna
              </DialogTitle>
              <DialogDescription>
                Ketuk user untuk X-Ray: profil, aktivitas, dan kontrol sesi.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-96 min-h-40 overflow-y-auto">
              {listLoading && users.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Memuat…
                </p>
              ) : users.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada user terdaftar.
                </p>
              ) : (
                <ul className="space-y-1">
                  {users.map((u) => {
                    const r = restrictionCache.get(u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent"
                          onClick={() => loadDetail(u.id, u.name)}
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
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{u.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.online ? "Online" : `Terakhir ${formatLastSeen(u.lastSeenAt)}`} ·{" "}
                              {u.messages} pesan
                            </span>
                          </span>
                          {r ? (
                            <span className="flex shrink-0 gap-1">
                              {r.frozen ? <Badge className="bg-rose-600 text-white">Beku</Badge> : null}
                              {r.mediaBlocked ? <Badge variant="outline">📎</Badge> : null}
                              {r.slowMode > 0 ? <Badge variant="outline">🐢</Badge> : null}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-8" onClick={fetchUsers} disabled={listLoading}>
                {listLoading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                Muat ulang
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Kembali ke daftar"
                  onClick={() => setDetailId(null)}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </Button>
                X-Ray: {profile?.name ?? (detailName || "…")}
              </DialogTitle>
              <DialogDescription>Profil live + kontrol sesi (dicatat di audit log).</DialogDescription>
            </DialogHeader>

            {detailLoading && !profile ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Memuat profil…
              </p>
            ) : !profile ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Profil tidak tersedia.</p>
            ) : (
              <div className="space-y-3">
                {/* Chip status pembatasan */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {restricted?.frozen ? (
                    <Badge className="bg-rose-600 text-white">Dibekukan</Badge>
                  ) : null}
                  {mutedActive && restricted?.mutedUntil ? (
                    <Badge className="bg-amber-500 text-white">
                      Dibisukan s/{fmtHM(new Date(restricted.mutedUntil))}
                    </Badge>
                  ) : null}
                  {restricted && restricted.slowMode > 0 ? (
                    <Badge variant="outline">Lambat {restricted.slowMode}/menit</Badge>
                  ) : null}
                  {restricted?.mediaBlocked ? <Badge variant="outline">Blokir media</Badge> : null}
                  {!restricted ||
                  (!restricted.frozen &&
                    !mutedActive &&
                    restricted.slowMode === 0 &&
                    !restricted.mediaBlocked) ? (
                    <Badge variant="outline" className="text-emerald-600">
                      Tanpa pembatasan
                    </Badge>
                  ) : null}
                </div>

                {/* Fakta profil */}
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  <Fact label="IP" value={profile.ip ?? "—"} />
                  <Fact label="Platform" value={profile.platform || "—"} />
                  <Fact label="Status" value={profile.online ? "Online" : formatLastSeen(profile.lastSeen)} />
                  <Fact label="Socket" value={String(profile.socketCount)} />
                  <Fact label="Pesan" value={String(profile.messageCount)} />
                  <Fact label="Media" value={`${profile.mediaCount} berkas`} />
                  <Fact label="Penyimpanan" value={formatFileSize(profile.mediaBytes)} />
                  <Fact label="Dibuat" value={fmtDate(profile.createdAt)} />
                  <Fact label="Pesan terakhir" value={fmtDate(profile.lastMessageAt)} />
                </div>
                <p className="truncate text-[10px] text-muted-foreground" title={profile.userAgent ?? ""}>
                  <Smartphone className="mr-1 inline size-3" aria-hidden="true" />
                  {truncateUA(profile.userAgent)}
                </p>

                {stats ? (
                  <MiniBars
                    values={stats.perDay.map((d) => d.count)}
                    labels={stats.perDay.map((d) => fmtDay(d.day))}
                  />
                ) : null}

                {/* Aksi */}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-8", restricted?.frozen && "border-rose-500 text-rose-600")}
                    onClick={() => (restricted?.frozen ? doFreeze(false) : setConfirm("freeze"))}
                  >
                    <ShieldBan className="size-3.5" aria-hidden="true" />
                    {restricted?.frozen ? "Bebaskan akun" : "Bekukan akun"}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <VolumeX className="size-3.5" aria-hidden="true" />
                        Bisukan…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Bisukan</DropdownMenuLabel>
                      {MUTE_OPTIONS.map((m) => (
                        <DropdownMenuItem key={m} onClick={() => doMute(m)}>
                          {m} menit
                        </DropdownMenuItem>
                      ))}
                      {mutedActive ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => doMute(0)}>Lepas bisukan</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <Timer className="size-3.5" aria-hidden="true" />
                        Mode lambat…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Batas per menit</DropdownMenuLabel>
                      {SLOW_OPTIONS.map((v) => (
                        <DropdownMenuItem
                          key={v}
                          className={cn(restricted?.slowMode === v && "bg-accent")}
                          onClick={() => doSlow(v)}
                        >
                          {v === 0 ? "Nonaktif" : `${v} pesan/menit`}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-8", restricted?.mediaBlocked && "border-amber-500 text-amber-600")}
                    onClick={() => doMediaBlock(!restricted?.mediaBlocked)}
                  >
                    <Paperclip className="size-3.5" aria-hidden="true" />
                    {restricted?.mediaBlocked ? "Buka media" : "Blokir media"}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => setConfirm("kick")}
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    Paksa keluar
                  </Button>

                  <Button variant="outline" size="sm" className="h-8" onClick={doExport}>
                    <Download className="size-3.5" aria-hidden="true" />
                    Ekspor data
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirm === "freeze"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Bekukan akun ini?"
        description={`${detailName} tidak akan bisa mengirim pesan apa pun sampai dibebaskan. User melihat banner "Akun dibekukan admin".`}
        confirmLabel="Ya, bekukan"
        destructive
        onConfirm={() => {
          setConfirm(null);
          doFreeze(true);
        }}
      />
      <ConfirmDialog
        open={confirm === "kick"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Paksa keluar?"
        description={`${detailName} akan diputus dari server (auto-reconnect).`}
        confirmLabel="Ya, keluarkan"
        destructive
        onConfirm={() => {
          setConfirm(null);
          doKick();
        }}
      />
    </Dialog>
  );
}
