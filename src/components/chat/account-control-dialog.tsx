"use client";

/**
 * v45 — Kendali Akun Penuh (Account 360) + Cheat Lab.
 * v46 — KONSOLIDASI: dialog ini kini SATU-SATUNYA pintu kendali per-user.
 *  - Tab Akun     : admin:account_get/set/password/delete (catatan pindah ke
 *                   Moderasi — ditulis via admin:user_note, sekalian tag)
 *                   + Perangkat & Sesi (force logout + lepas kunci, v47
 *                   pindahan dropdown dashboard & panel v40).
 *  - Tab Moderasi : pembatasan cepat (freeze/mute/slowmode/mediablock —
 *                   event terbukti v11 yang mem-push user:restricted), bot
 *                   balasan (pindahan X-Ray v39, kini via admin:account_set),
 *                   + embedded UserControlsV40 (pindahan panel inline X-Ray).
 *  - Tab Ilusi    : flags (blackhole/suppressReads/fakePresence/autoReact),
 *                   notify_user + push custom (pindahan X-Ray), inject media,
 *                   flood, + CHEAT LAB II (v47): kebal hapus, bekukan ✓✓,
 *                   ✓✓ instan, kunci hapus/edit, hancur-sendiri, mutator teks,
 *                   delay pengiriman, pengganda, mode hantu, alarm admin.
 *  - Tab Massal   : retro_replace, time_shift, delete_keyword, + hapus semua
 *                   pesan user (pindahan X-Ray v39).
 *  - Tab Siaran   : DIHAPUS — duplikat tab "Siaran" di Dashboard Aplikasi.
 * Prop xrayProfile (profil X-Ray dari UserManager) dipakai UserControlsV40;
 * onRestricted menyampaikan state pembatasan terbaru ke penelepon.
 */

import { useEffect, useState } from "react";
import {
  BellRing,
  Bot,
  CircleOff,
  Copy,
  EyeOff,
  Loader2,
  LogOut,
  Pencil,
  Paperclip,
  RadioTower,
  ShieldBan,
  ShieldX,
  Smartphone,
  Timer,
  Trash2,
  UserCog,
  VolumeX,
  Wand2,
  Zap,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/chat/admin-tools";
import { UserControlsV40 } from "@/components/chat/user-controls-v40";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AckOf,
  AdminAccountDeleteAck,
  AdminAccountGetAck,
  AdminAccountPasswordAck,
  AdminAccountProfile,
  AdminAccountSetAck,
  AdminAccountSetPayload,
  AdminBulkDeleteUserAck,
  AdminCheatFlags,
  AdminCheatFloodAck,
  AdminCheatFloodStopAck,
  AdminDeleteKeywordAck,
  AdminForceLogoutAck,
  AdminInjectMediaAck,
  AdminMediaGalleryAck,
  AdminMediaGalleryItem,
  AdminNotifyUserAck,
  AdminPushAck,
  AdminRetroReplaceAck,
  AdminTimeShiftAck,
  AdminUnbindDevicesAck,
  FreezeAck,
  MediaBlockAck,
  MuteAck,
  SlowModeAck,
  UserRestrictionState,
  XrayAck,
} from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const MUTE_OPTIONS = [0, 5, 30, 60];
const SLOW_OPTIONS = [0, 1, 2, 3, 5, 10];
const BOT_DELAY_OPTIONS = [0, 3, 10, 30, 60];
/* v47 — cheat lab II: pilihan numerik. */
const SELF_DESTRUCT_OPTIONS = [0, 10, 30, 60, 300, 900, 3600];
const DELAY_OPTIONS = [0, 2000, 5000, 10000, 30000, 60000];
const MULTIPLIER_OPTIONS = [1, 2, 3, 4, 5];
const TEXT_MUTATOR_OPTIONS: Array<{ value: string; label: string }> = [
  /* v47 — "off" = sentinel utk "" (Radix Select melarang value string kosong). */
  { value: "off", label: "Nonaktif" },
  { value: "upper", label: "HURUF BESAR" },
  { value: "lower", label: "huruf kecil" },
  { value: "reverse", label: "terbalik" },
  { value: "leet", label: "1337 5p34k" },
  { value: "emoji", label: "emoji acak 😜" },
];

const mediaTypeLabel = (name: string): string => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "foto";
  if (["mp3", "ogg", "oga", "wav", "m4a"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  return "berkas";
};

interface AccountControlDialogProps {
  socket: Socket | null;
  userId: string;
  userName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
  /** Profil X-Ray (dari UserManager) — dipakai UserControlsV40 di tab Moderasi. */
  xrayProfile?: XrayAck["profile"] | null;
  /** Sampaikan state pembatasan terbaru (dari ack freeze/mute/slowmode/mediablock). */
  onRestricted?: (state: UserRestrictionState) => void;
  /** Notifikasi teks ke host (toast panel admin). */
  onNotice?: (text: string) => void;
}

export function AccountControlDialog({
  socket,
  userId,
  userName,
  open,
  onOpenChange,
  onChanged,
  xrayProfile,
  onRestricted,
  onNotice,
}: AccountControlDialogProps) {
  const [account, setAccount] = useState<AdminAccountProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // form akun
  const [name, setName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [quotaMb, setQuotaMb] = useState("");

  // bot balasan (pindahan X-Ray v39 — kini via account_set)
  const [botOn, setBotOn] = useState(false);
  const [botText, setBotText] = useState("");
  const [botDelay, setBotDelay] = useState("3");

  // notifikasi push custom (pindahan X-Ray v39)
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");

  // galeri media
  const [gallery, setGallery] = useState<AdminMediaGalleryItem[]>([]);
  const [galleryLoaded, setGalleryLoaded] = useState(false);
  const [pickedMedia, setPickedMedia] = useState<string | null>(null);
  const [asUser, setAsUser] = useState(true);

  // cheat lab
  const [toastTitle, setToastTitle] = useState("⚠️ Login baru terdeteksi");
  const [toastBody, setToastBody] = useState(
    "Chrome di Windows — Jakarta, 14:20. Bukan kamu? Segera amankan akunmu."
  );
  const [floodText, setFloodText] = useState("Halo? Kamu di mana ya?");
  const [floodCount, setFloodCount] = useState("5");
  const [floodInterval, setFloodInterval] = useState("600");

  // massal
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [shiftMinutes, setShiftMinutes] = useState("-1440");
  const [keyword, setKeyword] = useState("");

  // konfirmasi destruktif
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  // v47 — konfirmasi perangkat & sesi (pindahan dropdown/panel v40)
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);

  const load = () => {
    if (!socket?.connected || !userId) return;
    setLoading(true);
    socket.emit("admin:account_get", { userId }, (res: AckOf<AdminAccountGetAck>) => {
      setLoading(false);
      if (res.ok) {
        setAccount(res.account);
        setName(res.account.name);
        setQuotaMb(String(res.account.mediaQuotaMb));
        setBotOn(res.account.botReplyOn);
        setBotText(res.account.botReplyText ?? "");
        setBotDelay(String(Math.round((res.account.botReplyDelayMs ?? 3000) / 1000)));
      } else if (res.error !== "UNAUTHORIZED") {
        toast.error("Gagal memuat profil akun");
      }
    });
  };

  // Reset seluruh state dialog saat ditutup (aman utk dipakai ulang antar user).
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setAccount(null);
      setPickedMedia(null);
      setGalleryLoaded(false);
      setNewPassword("");
      setConfirmDelete(false);
      setConfirmFreeze(false);
      setConfirmBulk(false);
      setConfirmLogout(false);
      setConfirmUnbind(false);
    }
    onOpenChange(v);
  };

  useEffect(() => {
    if (!open) return;
    // setTimeout: hindari setState sinkron di body effect (React Compiler).
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [open, userId]);

  const setPatch = (patch: AdminAccountSetPayload, okMsg: string, busyKey: string) => {
    if (!socket?.connected) return;
    setBusy(busyKey);
    socket.emit("admin:account_set", { userId, patch }, (res: AckOf<AdminAccountSetAck>) => {
      setBusy(null);
      if (res.ok) {
        toast.success(okMsg);
        load();
        onChanged?.();
      } else if (res.error === "NAME_TAKEN") toast.error("Nama sudah dipakai user lain");
      else if (res.error === "NAME_RESERVED") toast.error("Nama itu dipakai Admin");
      else toast.error("Gagal menyimpan perubahan");
    });
  };

  const saveProfile = () => {
    if (!account) return;
    const patch: AdminAccountSetPayload = {};
    if (name.trim() && name.trim() !== account.name) patch.name = name.trim();
    const q = quotaMb.trim();
    if (q !== "" && Number(q) !== account.mediaQuotaMb) patch.mediaQuotaMb = Math.max(0, Number(q));
    if (!Object.keys(patch).length) {
      toast.info("Tidak ada perubahan");
      return;
    }
    setPatch(patch, "Profil akun diperbarui ✓", "save");
  };

  const saveBot = () => {
    if (botOn && !botText.trim()) {
      toast.error("Isi dulu teks balasan bot");
      return;
    }
    setPatch(
      {
        botReplyOn: botOn,
        botReplyText: botText.trim(),
        botReplyDelayMs: Number(botDelay) * 1000,
      },
      botOn ? "Bot balasan AKTIF ✓" : "Bot balasan dimatikan ✓",
      "bot"
    );
  };

  const setPassword = () => {
    if (!socket?.connected || newPassword.length < 4) {
      toast.error("Password minimal 4 karakter");
      return;
    }
    setBusy("password");
    socket.emit(
      "admin:account_password",
      { userId, password: newPassword },
      (res: AckOf<AdminAccountPasswordAck>) => {
        setBusy(null);
        if (res.ok) {
          toast.success("Password akun diganti ✓");
          setNewPassword("");
          load();
        } else toast.error("Gagal mengganti password");
      }
    );
  };

  const doDeleteAccount = () => {
    if (!socket?.connected) return;
    setBusy("delete");
    socket.emit(
      "admin:account_delete",
      { userId, confirm: "HAPUS" },
      (res: AckOf<AdminAccountDeleteAck>) => {
        setBusy(null);
        setConfirmDelete(false);
        if (res.ok) {
          toast.success(`Akun dihapus permanen (${res.conversations} percakapan dibersihkan)`);
          onOpenChange(false);
          onChanged?.();
        } else toast.error("Gagal menghapus akun");
      }
    );
  };

  /* ---------------- Pembatasan cepat (event v11, push user:restricted) ---------------- */

  const doFreeze = (on: boolean) => {
    if (!socket?.connected) return;
    setBusy("freeze");
    socket.emit("admin:freeze", { userId, on }, (res: AckOf<FreezeAck>) => {
      setBusy(null);
      setConfirmFreeze(false);
      if (res.ok) {
        onRestricted?.(res.restricted);
        onNotice?.(res.frozen ? `${userName} dibekukan 🚫` : `${userName} dibebaskan`);
        toast.success(res.frozen ? "Akun dibekukan" : "Bekukan dilepas");
        load();
      } else toast.error("Gagal mengubah status bekukan");
    });
  };

  const doMute = (minutes: number) => {
    if (!socket?.connected) return;
    setBusy("mute");
    socket.emit("admin:mute", { userId, minutes }, (res: AckOf<MuteAck>) => {
      setBusy(null);
      if (res.ok) {
        onRestricted?.(res.restricted);
        onNotice?.(
          res.mutedUntil
            ? `${userName} dibisukan ${minutes} menit`
            : `Bisukan ${userName} dilepas`
        );
        load();
      } else toast.error("Gagal mengubah bisukan");
    });
  };

  const doSlow = (perMinute: number) => {
    if (!socket?.connected) return;
    setBusy("slow");
    socket.emit("admin:slowmode", { userId, perMinute }, (res: AckOf<SlowModeAck>) => {
      setBusy(null);
      if (res.ok) {
        onRestricted?.(res.restricted);
        onNotice?.(
          res.perMinute > 0
            ? `Mode lambat ${userName}: ${res.perMinute} pesan/menit`
            : `Mode lambat ${userName} dimatikan`
        );
        load();
      } else toast.error("Gagal mengubah mode lambat");
    });
  };

  const doMediaBlock = (on: boolean) => {
    if (!socket?.connected) return;
    setBusy("mediablock");
    socket.emit("admin:mediablock", { userId, on }, (res: AckOf<MediaBlockAck>) => {
      setBusy(null);
      if (res.ok) {
        onRestricted?.(res.restricted);
        onNotice?.(res.mediaBlocked ? `Media ${userName} diblokir 📎` : `Blokir media ${userName} dilepas`);
        load();
      } else toast.error("Gagal mengubah blokir media");
    });
  };

  /* ------- v47 — Perangkat & sesi (pindahan dropdown dashboard + panel v40) ------- */

  const doForceLogout = () => {
    if (!socket?.connected) return;
    setBusy("logout");
    socket.emit(
      "admin:user_force_logout",
      { userId },
      (res: AckOf<AdminForceLogoutAck>) => {
        setBusy(null);
        setConfirmLogout(false);
        if (res.ok) {
          toast.success(`Semua perangkat ${userName} dipaksa logout ✓`);
          load();
          onChanged?.();
        } else toast.error("Gagal memaksa logout");
      }
    );
  };

  const doUnbindDevices = () => {
    if (!socket?.connected) return;
    setBusy("unbind");
    socket.emit(
      "admin:user_unbind_devices",
      { userId },
      (res: AckOf<AdminUnbindDevicesAck>) => {
        setBusy(null);
        setConfirmUnbind(false);
        if (res.ok) {
          toast.success(`Semua kunci perangkat ${userName} dilepas ✓`);
          load();
        } else toast.error("Gagal melepas kunci perangkat");
      }
    );
  };

  /** v39 pindahan X-Ray — tombstone SEMUA pesan hidup milik user. */
  const doBulkDelete = () => {
    if (!socket?.connected) return;
    setBusy("bulk");
    socket.emit("admin:bulk_delete_user", { userId }, (res: AckOf<AdminBulkDeleteUserAck>) => {
      setBusy(null);
      setConfirmBulk(false);
      if (res.ok) {
        toast.success(
          res.deleted > 0
            ? `${res.deleted} pesan ${userName} dihapus ✓`
            : `${userName} belum punya pesan`
        );
        onChanged?.();
        load();
      } else toast.error("Gagal menghapus pesan user");
    });
  };

  const loadGallery = () => {
    if (!socket?.connected) return;
    setBusy("gallery");
    socket.emit("admin:media_gallery", {}, (res: AckOf<AdminMediaGalleryAck>) => {
      setBusy(null);
      setGalleryLoaded(true);
      if (res.ok) setGallery(res.items);
    });
  };

  const injectMedia = (mediaName: string) => {
    if (!socket?.connected) return;
    setBusy("inject");
    socket.emit(
      "admin:cheat_inject_media",
      { userId, mediaName, asUser },
      (res: AckOf<AdminInjectMediaAck>) => {
        setBusy(null);
        if (res.ok) {
          toast.success(`Media #${res.message.id} disuntik ke percakapan ✓`);
          setPickedMedia(null);
        } else toast.error("Gagal menyuntik media");
      }
    );
  };

  const doFlood = () => {
    if (!socket?.connected) return;
    setBusy("flood");
    socket.emit(
      "admin:cheat_flood",
      {
        userId,
        text: floodText,
        count: Math.max(1, Math.min(20, Number(floodCount) || 1)),
        intervalMs: Math.max(100, Math.min(10000, Number(floodInterval) || 600)),
        asUser,
      },
      (res: AckOf<AdminCheatFloodAck>) => {
        setBusy(null);
        if (res.ok) toast.success(`${res.scheduled} pesan akan mengalir…`);
        else toast.error("Gagal menjadwalkan flood");
      }
    );
  };

  const stopFlood = () => {
    if (!socket?.connected) return;
    socket.emit("admin:cheat_flood_stop", { userId }, (res: AckOf<AdminCheatFloodStopAck>) => {
      if (res.ok) toast.success("Flood dihentikan");
    });
  };

  const doRetroReplace = () => {
    if (!socket?.connected || !findText.trim()) return;
    setBusy("retro");
    socket.emit(
      "admin:cheat_retro_replace",
      { userId, find: findText, replace: replaceText, scope: scopeAll ? "all" : "user" },
      (res: AckOf<AdminRetroReplaceAck>) => {
        setBusy(null);
        if (res.ok) toast.success(`${res.changed} pesan diubah (${res.scanned} dipindai)`);
        else toast.error("Gagal mengubah riwayat");
      }
    );
  };

  const doTimeShift = () => {
    if (!socket?.connected) return;
    const minutes = Number(shiftMinutes);
    if (!minutes) {
      toast.error("Isi geseran waktu (menit, boleh minus)");
      return;
    }
    setBusy("shift");
    socket.emit(
      "admin:cheat_time_shift",
      { userId, minutes, scope: scopeAll ? "all" : "user" },
      (res: AckOf<AdminTimeShiftAck>) => {
        setBusy(null);
        if (res.ok) toast.success(`${res.moved} pesan digeser ${minutes > 0 ? "+" : ""}${minutes} menit`);
        else toast.error("Gagal menggeser waktu");
      }
    );
  };

  const doDeleteKeyword = () => {
    if (!socket?.connected || !keyword.trim()) return;
    setBusy("sweep");
    socket.emit(
      "admin:cheat_delete_keyword",
      { userId, keyword, scope: scopeAll ? "all" : "user" },
      (res: AckOf<AdminDeleteKeywordAck>) => {
        setBusy(null);
        if (res.ok) toast.success(`${res.deleted} pesan terhapus`);
        else toast.error("Gagal menyapu pesan");
      }
    );
  };

  const doNotify = () => {
    if (!socket?.connected || !toastTitle.trim() || !toastBody.trim()) return;
    setBusy("notify");
    socket.emit(
      "admin:notify_user",
      { userId, title: toastTitle.trim(), body: toastBody.trim() },
      (res: AckOf<AdminNotifyUserAck>) => {
        setBusy(null);
        if (res.ok) toast.success("Toast terkirim ke user ✓");
        else toast.error("Gagal mengirim toast");
      }
    );
  };

  /** v39 pindahan X-Ray — notifikasi web push ke perangkat user. */
  const doPush = () => {
    if (!socket?.connected || !pushTitle.trim() || !pushBody.trim()) return;
    setBusy("push");
    socket.emit(
      "admin:user_push",
      { userId, title: pushTitle.trim(), body: pushBody.trim() },
      (res: AckOf<AdminPushAck>) => {
        setBusy(null);
        if (res.ok) {
          toast.success(
            res.subscriptions > 0
              ? `Push terkirim ke ${res.subscriptions} langganan ✓`
              : "Push dikirim — user belum punya langganan notifikasi"
          );
          setPushTitle("");
          setPushBody("");
        } else toast.error("Gagal mengirim push");
      }
    );
  };

  const flag = (key: keyof AdminCheatFlags): boolean =>
    key === "autoReact" ? false : Number(account?.flags?.[key] ?? 0) === 1;

  const toggleFlag = (
    key:
      | "blackhole"
      | "suppressReads"
      | "fakePresence"
      | "antiDelete"
      | "freezeChecks"
      | "fakeReads"
      | "lockDelete"
      | "lockEdit"
      | "alarmAdmin"
      | "alwaysOffline",
    label: string
  ) => {
    if (!account) return;
    const next = !flag(key);
    setPatch({ [key]: next } as AdminAccountSetPayload, `${label} ${next ? "AKTIF" : "MATI"} ✓`, `flag-${key}`);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserCog className="size-4" aria-hidden="true" />
              Kendali akun penuh — {userName}
            </DialogTitle>
            <DialogDescription>
              Satu pintu untuk semua kendali user ini: akun, moderasi, cheat, dan aksi massal.
              Semua aksi tercatat di jejak audit.
            </DialogDescription>
          </DialogHeader>

          {!account && loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Memuat profil…
            </p>
          ) : !account ? (
            <p className="py-8 text-sm text-muted-foreground">Profil belum termuat.</p>
          ) : (
            <Tabs defaultValue="akun">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="akun" className="text-xs">Akun</TabsTrigger>
                <TabsTrigger value="moderasi" className="text-xs">Moderasi</TabsTrigger>
                <TabsTrigger value="ilusi" className="text-xs">Ilusi</TabsTrigger>
                <TabsTrigger value="massal" className="text-xs">Massal</TabsTrigger>
              </TabsList>

              {/* ---------------------------- AKUN ---------------------------- */}
              <TabsContent value="akun" className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                  <span>Pesan hidup: <b className="text-foreground">{account.liveMessages}</b></span>
                  <span>Perangkat: <b className="text-foreground">{account.devices}</b></span>
                  <span>Login tercatat: <b className="text-foreground">{account.logins}</b></span>
                  <span>Media: <b className="text-foreground">{formatFileSize(account.usedBytes)}</b></span>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Nama tampilan / login</Label>
                  <div className="flex gap-1.5">
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-8 text-xs" />
                    <Button size="sm" className="h-8 shrink-0" disabled={busy === "save"} onClick={saveProfile}>
                      {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Simpan"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Set password baru</Label>
                  <div className="flex gap-1.5">
                    <Input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="minimal 4 karakter"
                      className="h-8 text-xs"
                    />
                    <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy === "password"} onClick={setPassword}>
                      {busy === "password" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Set"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Terakhir di-set: {account.passwordSetAt ? new Date(account.passwordSetAt).toLocaleString("id-ID") : "belum pernah"}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Kuota media khusus (MiB, 0 = default 250)</Label>
                  <Input value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} inputMode="numeric" className="h-8 text-xs" />
                </div>

                {/* v47 — Perangkat & sesi: satu tempat untuk semua aksi sesi
                    (pindahan dropdown dashboard + panel v40). */}
                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Smartphone className="size-3.5" aria-hidden="true" /> Perangkat &amp; sesi
                    <Badge variant="outline" className="ml-1">{account.devices} aktif</Badge>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-full"
                    disabled={busy === "logout"}
                    onClick={() => setConfirmLogout(true)}
                  >
                    <LogOut className="size-3.5" aria-hidden="true" /> Paksa logout semua perangkat
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-full"
                    disabled={busy === "unbind"}
                    onClick={() => setConfirmUnbind(true)}
                  >
                    <ShieldX className="size-3.5" aria-hidden="true" /> Lepas kunci perangkat
                  </Button>
                </div>

                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 dark:border-rose-900 dark:bg-rose-950/40">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Zona bahaya</p>
                  <p className="mb-2 text-[11px] text-rose-600 dark:text-rose-400">
                    Menghapus akun ini permanen beserta seluruh pesan, reaksi, perangkat, dan jejaknya.
                  </p>
                  <Button size="sm" variant="destructive" className="h-8" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3.5" aria-hidden="true" /> Hapus akun permanen
                  </Button>
                </div>
              </TabsContent>

              {/* ---------------------------- MODERASI ---------------------------- */}
              <TabsContent value="moderasi" className="space-y-4 pt-2">
                <div className="space-y-2 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Pembatasan cepat</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs">
                      <ShieldBan className="size-3.5" aria-hidden="true" /> Bekukan akun
                    </p>
                    <Switch
                      checked={account.frozen}
                      onCheckedChange={(v) => (v ? setConfirmFreeze(true) : doFreeze(false))}
                      disabled={busy === "freeze"}
                      aria-label="Bekukan akun"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs">
                      <VolumeX className="size-3.5" aria-hidden="true" /> Bisukan
                    </p>
                    <Select
                      value={account.mutedUntil > Date.now() ? "aktif" : "0"}
                      onValueChange={(v) => doMute(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Durasi bisukan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MUTE_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)} className="text-xs">
                            {m === 0 ? "Lepas bisukan" : `${m} menit`}
                          </SelectItem>
                        ))}
                        {account.mutedUntil > Date.now() ? (
                          <SelectItem value="aktif" disabled>
                            Aktif s/d {new Date(account.mutedUntil).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs">
                      <Timer className="size-3.5" aria-hidden="true" /> Mode lambat
                    </p>
                    <Select
                      value={String(account.slowMode)}
                      onValueChange={(v) => doSlow(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Batas pesan per menit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SLOW_OPTIONS.map((v) => (
                          <SelectItem key={v} value={String(v)} className="text-xs">
                            {v === 0 ? "Nonaktif" : `${v} pesan/menit`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs">
                      <Paperclip className="size-3.5" aria-hidden="true" /> Blokir semua media
                    </p>
                    <Switch
                      checked={account.mediaBlocked}
                      onCheckedChange={(v) => doMediaBlock(v)}
                      disabled={busy === "mediablock"}
                      aria-label="Blokir media"
                    />
                  </div>
                </div>

                {/* Bot balasan — pindahan X-Ray v39, kini via account_set. */}
                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <Bot className="size-3.5" aria-hidden="true" /> Bot balasan otomatis
                    </p>
                    <Switch checked={botOn} onCheckedChange={setBotOn} aria-label="Aktifkan bot balasan" />
                  </div>
                  <Input
                    value={botText}
                    onChange={(e) => setBotText(e.target.value)}
                    placeholder="Teks balasan atas nama Admin…"
                    maxLength={300}
                    className="h-8 text-xs"
                    aria-label="Teks balasan bot"
                  />
                  <div className="flex items-center gap-1.5">
                    <Select value={botDelay} onValueChange={setBotDelay} disabled={!botOn}>
                      <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Jeda balasan bot">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOT_DELAY_OPTIONS.map((s) => (
                          <SelectItem key={s} value={String(s)} className="text-xs">
                            {s === 0 ? "Langsung (0 dtk)" : `${s} detik`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      disabled={busy === "bot"}
                      onClick={saveBot}
                    >
                      {busy === "bot" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Simpan"}
                    </Button>
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Saat {userName} mengirim pesan, Admin membalas otomatis dengan teks ini.
                  </p>
                </div>

                {/* Pusat kendali v40 — pindahan panel inline X-Ray (catatan+tag,
                    filter kata, persetujuan, blokir per jenis, PIN, balasan
                    cepat, terjadwal, nudge, auto-bersih, ZIP, paksa logout,
                    riwayat login). */}
                {xrayProfile ? (
                  <UserControlsV40 socket={socket} profile={xrayProfile} onNotice={onNotice} />
                ) : (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                    Detail kendali lanjutan (filter kata, PIN, balasan cepat, dsb.) tersedia setelah
                    profil X-Ray user ini termuat.
                  </p>
                )}
              </TabsContent>

              {/* ---------------------------- ILUSI ---------------------------- */}
              <TabsContent value="ilusi" className="space-y-4 pt-2">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <CircleOff className="size-3.5" aria-hidden="true" /> Lubang hitam
                      </p>
                      <p className="text-[11px] text-muted-foreground">Pesan user selalu ✓✓ terkirim di sisinya, tapi tak pernah muncul live di panel admin.</p>
                    </div>
                    <Switch checked={flag("blackhole")} onCheckedChange={() => toggleFlag("blackhole", "Lubang hitam")} aria-label="Lubang hitam" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <EyeOff className="size-3.5" aria-hidden="true" /> Bungkam ✓✓
                      </p>
                      <p className="text-[11px] text-muted-foreground">Bacaan admin atas chat user ini tak pernah dikabarkan — ✓✓ user beku selamanya.</p>
                    </div>
                    <Switch checked={flag("suppressReads")} onCheckedChange={() => toggleFlag("suppressReads", "Bungkam ✓✓")} aria-label="Bungkam centang dua" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <RadioTower className="size-3.5" aria-hidden="true" /> Selalu online (ilusi)
                      </p>
                      <p className="text-[11px] text-muted-foreground">User ini selalu tampak online di mata admin, walau perangkatnya mati.</p>
                    </div>
                    <Switch checked={flag("fakePresence")} onCheckedChange={() => toggleFlag("fakePresence", "Ilusi online")} aria-label="Ilusi selalu online" />
                  </div>
                </div>

                {/* v47 — CHEAT LAB II */}
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cheat lab II — v47</p>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Copy className="size-3.5" aria-hidden="true" /> Kebal hapus pesan
                      </p>
                      <p className="text-[11px] text-muted-foreground">Pesan yang dihapus tetap terlihat isinya di sisi user ini, lengkap dengan badge "dihapus".</p>
                    </div>
                    <Switch checked={flag("antiDelete")} onCheckedChange={() => toggleFlag("antiDelete", "Kebal hapus pesan")} aria-label="Kebal hapus pesan" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <EyeOff className="size-3.5" aria-hidden="true" /> Bekukan ✓✓ user (centang 1 abadi)
                      </p>
                      <p className="text-[11px] text-muted-foreground">Bacaan user ini tidak pernah dikabarkan — pesan lawan bicara tetap centang 1 walau sudah dibaca.</p>
                    </div>
                    <Switch checked={flag("freezeChecks")} onCheckedChange={() => toggleFlag("freezeChecks", "Bekukan ✓✓ user")} aria-label="Bekukan centang dua" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <RadioTower className="size-3.5" aria-hidden="true" /> ✓✓ instan (ilusi terbaca)
                      </p>
                      <p className="text-[11px] text-muted-foreground">Setiap pesan user ini langsung bercentang dua seolah langsung dibaca lawan bicara.</p>
                    </div>
                    <Switch checked={flag("fakeReads")} onCheckedChange={() => toggleFlag("fakeReads", "✓✓ instan")} aria-label="Centang dua instan" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Trash2 className="size-3.5" aria-hidden="true" /> Kunci hapus pesan
                      </p>
                      <p className="text-[11px] text-muted-foreground">User ini tidak dapat menghapus pesannya sendiri (DELETE_LOCKED).</p>
                    </div>
                    <Switch checked={flag("lockDelete")} onCheckedChange={() => toggleFlag("lockDelete", "Kunci hapus pesan")} aria-label="Kunci hapus pesan" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Pencil className="size-3.5" aria-hidden="true" /> Kunci edit pesan
                      </p>
                      <p className="text-[11px] text-muted-foreground">User ini tidak dapat mengedit pesannya sendiri (EDIT_LOCKED).</p>
                    </div>
                    <Switch checked={flag("lockEdit")} onCheckedChange={() => toggleFlag("lockEdit", "Kunci edit pesan")} aria-label="Kunci edit pesan" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <BellRing className="size-3.5" aria-hidden="true" /> Alarm admin
                      </p>
                      <p className="text-[11px] text-muted-foreground">Setiap pesan dari user ini memicu toast alarm di panel admin.</p>
                    </div>
                    <Switch checked={flag("alarmAdmin")} onCheckedChange={() => toggleFlag("alarmAdmin", "Alarm admin")} aria-label="Alarm admin" />
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <CircleOff className="size-3.5" aria-hidden="true" /> Mode hantu
                      </p>
                      <p className="text-[11px] text-muted-foreground">User ini tidak pernah terlihat online dan tanpa jejak last seen di mana pun.</p>
                    </div>
                    <Switch checked={flag("alwaysOffline")} onCheckedChange={() => toggleFlag("alwaysOffline", "Mode hantu")} aria-label="Mode hantu" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Hancur sendiri (per pesan)</Label>
                    <Select
                      value={String(account.flags.selfDestructSec ?? 0)}
                      onValueChange={(v) =>
                        setPatch({ selfDestructSec: Number(v) }, "Hancur sendiri diperbarui ✓", "sd")
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Durasi hancur sendiri">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SELF_DESTRUCT_OPTIONS.map((s) => (
                          <SelectItem key={s} value={String(s)} className="text-xs">
                            {s === 0 ? "Nonaktif" : s >= 60 ? `${Math.round(s / 60)} menit` : `${s} detik`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Delay pengiriman</Label>
                    <Select
                      value={String(account.flags.delayMs ?? 0)}
                      onValueChange={(v) =>
                        setPatch({ delayMs: Number(v) }, "Delay pengiriman diperbarui ✓", "dly")
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Delay pengiriman">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELAY_OPTIONS.map((s) => (
                          <SelectItem key={s} value={String(s)} className="text-xs">
                            {s === 0 ? "Nonaktif" : `${Math.round(s / 1000)} detik`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Pengganda pesan</Label>
                    <Select
                      value={String(account.flags.multiplier ?? 1)}
                      onValueChange={(v) =>
                        setPatch({ multiplier: Number(v) }, "Pengganda pesan diperbarui ✓", "mlt")
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Pengganda pesan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MULTIPLIER_OPTIONS.map((s) => (
                          <SelectItem key={s} value={String(s)} className="text-xs">
                            {s === 1 ? "×1 (normal)" : `×${s} (digandakan)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Mutator teks keluar</Label>
                    <Select
                      value={account.flags.textMutator || "off"}
                      onValueChange={(v) =>
                        setPatch(
                          { textMutator: v === "off" ? "" : v },
                          "Mutator teks diperbarui ✓",
                          "mut"
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label="Mutator teks">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEXT_MUTATOR_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Catatan: delay &amp; pengganda mengubah pengiriman pesan baru user ini (pesan lama tidak terpengaruh). Hancur-sendiri aktif untuk pesan berikutnya (min. 5 detik).
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs">Auto-react Admin (emoji otomatis ke tiap pesan user)</Label>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn("h-8 flex-1", !account.flags.autoReact && "bg-accent")}
                      onClick={() => setPatch({ autoReact: "" }, "Auto-react dimatikan ✓", "react")}
                    >
                      Off
                    </Button>
                    {REACTIONS.map((e) => (
                      <Button
                        key={e}
                        size="sm"
                        variant="outline"
                        className={cn("h-8 flex-1 text-base", account.flags.autoReact === e && "bg-accent")}
                        onClick={() => setPatch({ autoReact: e }, `Auto-react ${e} aktif ✓`, "react")}
                      >
                        {e}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Toast ke user (alert palsu)</p>
                  <Input value={toastTitle} onChange={(e) => setToastTitle(e.target.value)} maxLength={80} className="h-8 text-xs" placeholder="Judul" aria-label="Judul toast" />
                  <Textarea value={toastBody} onChange={(e) => setToastBody(e.target.value)} rows={2} maxLength={300} className="text-xs" placeholder="Isi toast" aria-label="Isi toast" />
                  <Button size="sm" className="h-8" disabled={busy === "notify"} onClick={doNotify}>
                    {busy === "notify" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Zap className="size-3.5" aria-hidden="true" />}
                    Kirim toast
                  </Button>
                </div>

                {/* Push custom — pindahan X-Ray v39 (kanal notifikasi web). */}
                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <BellRing className="size-3.5" aria-hidden="true" /> Notifikasi push (web)
                  </p>
                  <Input
                    value={pushTitle}
                    onChange={(e) => setPushTitle(e.target.value)}
                    placeholder="Judul notifikasi…"
                    maxLength={60}
                    className="h-8 text-xs"
                    aria-label="Judul push"
                  />
                  <Input
                    value={pushBody}
                    onChange={(e) => setPushBody(e.target.value)}
                    placeholder="Isi notifikasi…"
                    maxLength={200}
                    className="h-8 text-xs"
                    aria-label="Isi push"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={!pushTitle.trim() || !pushBody.trim() || busy === "push"}
                    onClick={doPush}
                  >
                    {busy === "push" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BellRing className="size-3.5" aria-hidden="true" />}
                    Kirim push
                  </Button>
                </div>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Suntik media dari galeri server</p>
                  <div className="flex items-center justify-between">
                    <span />
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={asUser} onChange={(e) => setAsUser(e.target.checked)} className="accent-foreground" />
                      atas nama user
                    </label>
                  </div>
                  {!galleryLoaded ? (
                    <Button size="sm" variant="outline" className="h-8" disabled={busy === "gallery"} onClick={loadGallery}>
                      {busy === "gallery" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Muat galeri"}
                    </Button>
                  ) : (
                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                      {gallery.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Galeri kosong.</p>
                      ) : (
                        gallery.map((g) => (
                          <button
                            key={g.name}
                            type="button"
                            onClick={() => setPickedMedia(g.name === pickedMedia ? null : g.name)}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[11px] hover:bg-accent",
                              pickedMedia === g.name && "border-primary bg-accent"
                            )}
                          >
                            <span className="truncate font-mono">{g.name}</span>
                            <span className="shrink-0 text-muted-foreground">{mediaTypeLabel(g.name)} · {formatFileSize(g.bytes)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {pickedMedia ? (
                    <Button size="sm" className="h-8 w-full" disabled={busy === "inject"} onClick={() => injectMedia(pickedMedia)}>
                      {busy === "inject" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="size-3.5" aria-hidden="true" />}
                      Suntik {pickedMedia.slice(0, 18)}… {asUser ? "atas nama user" : "atas nama Admin"}
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Banjir pesan (flood)</p>
                  <Input value={floodText} onChange={(e) => setFloodText(e.target.value)} maxLength={1000} className="h-8 text-xs" placeholder="Teks" aria-label="Teks flood" />
                  <div className="flex gap-1.5">
                    <Input value={floodCount} onChange={(e) => setFloodCount(e.target.value)} inputMode="numeric" className="h-8 w-20 text-xs" aria-label="Jumlah" />
                    <Input value={floodInterval} onChange={(e) => setFloodInterval(e.target.value)} inputMode="numeric" className="h-8 w-24 text-xs" aria-label="Interval ms" />
                    <span className="self-center text-[10px] text-muted-foreground">× ms</span>
                    <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={asUser} onChange={(e) => setAsUser(e.target.checked)} className="accent-foreground" />
                      atas nama user
                    </label>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-8" disabled={busy === "flood"} onClick={doFlood}>
                      {busy === "flood" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Mulai"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={stopFlood}>Hentikan</Button>
                  </div>
                </div>
              </TabsContent>

              {/* ---------------------------- MASSAL ---------------------------- */}
              <TabsContent value="massal" className="space-y-4 pt-2">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={scopeAll}
                    onChange={(e) => setScopeAll(e.target.checked)}
                    className="accent-foreground"
                  />
                  Berlaku untuk SELURUH pesan percakapan (bukan hanya pesan user)
                </label>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Retro-edit massal — ganti kata di seluruh riwayat</p>
                  <div className="flex gap-1.5">
                    <Input value={findText} onChange={(e) => setFindText(e.target.value)} maxLength={60} className="h-8 flex-1 text-xs" placeholder="cari kata…" aria-label="Kata dicari" />
                    <Input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} maxLength={200} className="h-8 flex-1 text-xs" placeholder="ganti jadi…" aria-label="Pengganti" />
                  </div>
                  <Button size="sm" className="h-8" disabled={busy === "retro" || !findText.trim()} onClick={doRetroReplace}>
                    {busy === "retro" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Ganti semua"}
                  </Button>
                </div>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Mesin waktu — geser waktu pesan (menit)</p>
                  <div className="flex gap-1.5">
                    <Input value={shiftMinutes} onChange={(e) => setShiftMinutes(e.target.value)} inputMode="numeric" className="h-8 flex-1 text-xs" aria-label="Menit geser" />
                    <Button size="sm" className="h-8" disabled={busy === "shift"} onClick={doTimeShift}>
                      {busy === "shift" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Geser"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Minus = mundur (backdate massal), plus = maju. Maks ±30 hari.</p>
                </div>

                <div className="space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-xs font-semibold">Sapu kata — hapus semua pesan yang memuat kata</p>
                  <div className="flex gap-1.5">
                    <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={60} className="h-8 flex-1 text-xs" placeholder="kata kunci…" aria-label="Kata kunci sapu" />
                    <Button size="sm" variant="destructive" className="h-8" disabled={busy === "sweep" || !keyword.trim()} onClick={doDeleteKeyword}>
                      {busy === "sweep" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Sapu"}
                    </Button>
                  </div>
                </div>

                {/* Hapus massal — pindahan X-Ray v39. */}
                <div className="space-y-1.5 rounded-lg border border-destructive/30 p-2.5">
                  <p className="text-xs font-semibold text-destructive">Hapus semua pesan user</p>
                  <p className="text-[11px] text-muted-foreground">
                    Semua pesan hidup yang dikirim {userName} di semua percakapan jadi tombstone
                    (isi asli masih tersimpan untuk forensik admin).
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-full border-destructive/40 text-destructive hover:text-destructive"
                    disabled={busy === "bulk"}
                    onClick={() => setConfirmBulk(true)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Hapus semua pesan user
                  </Button>
                </div>

                <div className="rounded-lg border p-2.5 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="mb-1">v47</Badge>
                  <p>Cheat lab II aktif di tab Ilusi (kebal hapus, bekukan ✓✓, kunci hapus/edit, hancur-sendiri, mutator teks, delay, pengganda, mode hantu, alarm admin) + perangkat &amp; sesi kini di tab Akun.</p>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Hapus akun ${userName} permanen?`}
        description="Seluruh pesan, reaksi, perangkat, dan jejak akun ini dihapus permanen. Tindakan ini tidak bisa dibatalkan."
        confirmLabel="Ya, hapus akun"
        destructive
        onConfirm={doDeleteAccount}
      />
      <ConfirmDialog
        open={confirmFreeze}
        onOpenChange={setConfirmFreeze}
        title={`Bekukan akun ${userName}?`}
        description={`${userName} tidak akan bisa mengirim pesan apa pun sampai dibebaskan. User melihat banner "Akun dibekukan admin".`}
        confirmLabel="Ya, bekukan"
        destructive
        onConfirm={() => doFreeze(true)}
      />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Hapus semua pesan ${userName}?`}
        description={`Semua pesan hidup yang dikirim ${userName} di semua percakapan akan dihapus permanen (isi asli masih tersimpan untuk forensik admin). Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, hapus semua"
        destructive
        onConfirm={doBulkDelete}
      />
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={`Paksa logout semua perangkat ${userName}?`}
        description="Semua sesi login user ini dicabut dan perangkatnya dipaksa keluar. User harus login ulang."
        confirmLabel="Ya, paksa logout"
        destructive
        onConfirm={doForceLogout}
      />
      <ConfirmDialog
        open={confirmUnbind}
        onOpenChange={setConfirmUnbind}
        title={`Lepas kunci perangkat ${userName}?`}
        description="Semua binding perangkat user ini dilepas sehingga perangkat apa pun dapat login sebagai user tersebut."
        confirmLabel="Ya, lepas kunci"
        destructive
        onConfirm={doUnbindDevices}
      />
    </>
  );
}
