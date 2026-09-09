"use client";

import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  ArrowLeft,
  Download,
  Globe,
  Loader2,
  RefreshCw,
  Smartphone,
  UserCog,
} from "lucide-react";

import { downloadTextFile } from "@/components/chat/admin-tools";
import { AccountControlDialog } from "@/components/chat/account-control-dialog";
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
  UserRestrictionState,
  UserStatsAck,
  XrayAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/**
 * v11 — Manajemen pengguna: daftar semua user (dari admin:dashboard) +
 * X-Ray per user (admin:xray + admin:user_stats).
 *
 * v46 — KONSOLIDASI: seluruh tombol aksi duplikat (bekukan, bisukan, mode
 * lambat, blokir media, paksa keluar) dan panel "Kendali tambahan" v39
 * (rename/bot/kuota/push/hapus massal) + panel v40 inline DIHAPUS dari
 * X-Ray — semuanya kini ada di SATU dialog "Kendali akun penuh"
 * (AccountControlDialog). X-Ray tinggal: profil, grafik, chip status,
 * tombol Kendali akun penuh, dan Ekspor data.
 */

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
  // v45 — dialog Kendali Akun Penuh (v46: satu-satunya pintu kendali per-user).
  const [account360, setAccount360] = useState(false);
  const [profile, setProfile] = useState<XrayAck["profile"] | null>(null);
  const [stats, setStats] = useState<UserStatsAck | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restricted, setRestricted] = useState<UserRestrictionState | null>(null);

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
      onOpenChange={onOpenChange}
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
              <DialogDescription>Profil live + pintu kendali (dicatat di audit log).</DialogDescription>
            </DialogHeader>

            {detailLoading && !profile ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Memuat profil…
              </p>
            ) : !profile ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Profil tidak tersedia.</p>
            ) : (
              <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
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

                {/* Aksi — v46: semua kendali ada di satu dialog. */}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!detailId}
                    onClick={() => setAccount360(true)}
                  >
                    <UserCog className="size-3.5" aria-hidden="true" />
                    Kendali akun penuh
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

      {/* v45/v46 — SATU dialog untuk seluruh kendali per-user: akun, moderasi
          (freeze/mute/slowmode/mediablock/kick + bot + panel v40), ilusi/cheat,
          dan aksi massal. */}
      <AccountControlDialog
        socket={socket}
        userId={detailId ?? ""}
        userName={detailName}
        open={account360}
        onOpenChange={setAccount360}
        onChanged={() => {
          if (detailId) loadDetail(detailId, detailName);
          fetchUsers();
        }}
        xrayProfile={profile}
        onRestricted={(state) => {
          if (detailId) remember(detailId, state);
        }}
        onNotice={onNotice}
      />
    </Dialog>
  );
}
