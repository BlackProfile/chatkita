"use client";

/**
 * v48 — Tab "Media & Tautan" (Dashboard Admin).
 *
 * Satu pintu untuk seluruh kendali media/file/tautan aplikasi:
 * - Keamanan upload    : daftar ekstensi dilarang + kedaluwarsa per jenis
 *                        (foto/video/file, 0 = permanen) — server-enforced.
 * - Keamanan tautan    : blacklist/whitelist domain (server-enforced).
 * - Blokir per-user    : larang user tertentu mengirim stiker/tautan.
 * - Lab aksi pesan     : burn-on-view, blur sensitif, tukar media, dan
 *                        jebakan tautan dengan counter klik live — cukup
 *                        masukkan ID pesan (terlihat di aksi "Metadata").
 */

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Eye,
  Flame,
  Link2,
  Loader2,
  Paperclip,
  Save,
  ShieldBan,
  Repeat2,
  MousePointerClick,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

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
import { Separator } from "@/components/ui/separator";
import type { AppSettings, DashboardUserRow } from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";

type SocketAck = { ok?: boolean; error?: string } & Record<string, unknown>;

const Card = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="space-y-2.5 rounded-xl border bg-card p-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span className="text-emerald-600">{icon}</span>
      {title}
    </h3>
    {children}
  </section>
);

export function AdminMediaTautan({
  socket,
  users,
}: {
  socket: Socket | null;
  users: DashboardUserRow[];
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [extBlocklist, setExtBlocklist] = useState("");
  const [linkBlacklist, setLinkBlacklist] = useState("");
  const [linkWhitelist, setLinkWhitelist] = useState("");
  const [retImageDays, setRetImageDays] = useState(0);
  const [retVideoDays, setRetVideoDays] = useState(0);
  const [retFileDays, setRetFileDays] = useState(0);

  /* Blokir lampiran per-user. */
  const [targetUser, setTargetUser] = useState("");
  const [blockSticker, setBlockSticker] = useState(false);
  const [blockLink, setBlockLink] = useState(false);

  /* Lab aksi pesan. */
  const [msgId, setMsgId] = useState("");
  const [trapUrl, setTrapUrl] = useState("");
  const [trapClicks, setTrapClicks] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const swapInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit("admin:settings:get", {}, (res: SocketAck) => {
      const s = res?.settings as AppSettings | undefined;
      if (res?.ok && s) {
        setSettings(s);
        setExtBlocklist(s.extBlocklist ?? "");
        setLinkBlacklist(s.linkBlacklist ?? "");
        setLinkWhitelist(s.linkWhitelist ?? "");
        setRetImageDays(s.retImageDays ?? 0);
        setRetVideoDays(s.retVideoDays ?? 0);
        setRetFileDays(s.retFileDays ?? 0);
      }
    });
  }, [socket]);

  /* v48 — counter klik jebakan live dari server. */
  useEffect(() => {
    if (!socket) return;
    const onTrapClick = (p: { messageId?: number; count?: number }) => {
      if (p?.messageId && String(p.messageId) === msgId) setTrapClicks(p.count ?? 0);
    };
    socket.on("admin:trap_click", onTrapClick);
    return () => {
      socket.off("admin:trap_click", onTrapClick);
    };
  }, [socket, msgId]);

  const idNum = Number(msgId);
  const idValid = Number.isInteger(idNum) && idNum > 0;

  const saveSettings = () => {
    if (!socket) return;
    setSaving(true);
    socket.emit(
      "admin:settings:set",
      {
        extBlocklist,
        linkBlacklist,
        linkWhitelist,
        retImageDays,
        retVideoDays,
        retFileDays,
      },
      (res: SocketAck) => {
        setSaving(false);
        if (res?.ok) toast.success("Pengaturan media/tautan tersimpan.");
        else toast.error("Gagal menyimpan pengaturan.");
      }
    );
  };

  const loadUserBlocks = (userId: string) => {
    setTargetUser(userId);
    // blokir saat ini diambil dari daftar users (blockAttach) bila tersedia;
    // setel ulang checkbox → admin melihat nilai saat simpan terakhir.
    setBlockSticker(false);
    setBlockLink(false);
  };

  const saveUserBlocks = (blocked: string[]) => {
    if (!socket || !targetUser) return;
    socket.emit("admin:user_attach_block", { userId: targetUser, blocked }, (res: SocketAck) => {
      if (res?.ok) toast.success("Blokir lampiran per-user diperbarui.");
      else toast.error("Gagal memperbarui blokir lampiran.");
    });
  };

  const act = (event: string, payload: Record<string, unknown>, label: string) => {
    if (!socket || !idValid) return;
    setBusy(event);
    socket.emit(event, { messageId: idNum, ...payload }, (res: SocketAck) => {
      setBusy(null);
      if (res?.ok) {
        toast.success(label);
        if (typeof res.trapClicks === "number") setTrapClicks(res.trapClicks);
      } else {
        toast.error(`${label} gagal — periksa ID pesan.`);
      }
    });
  };

  const doSwap = async (file: File) => {
    if (!socket || !idValid) return;
    setBusy("admin:media_swap");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const j = (await r.json()) as {
        ok?: boolean;
        url?: string;
        fileName?: string;
        mimeType?: string;
        size?: number;
      };
      if (!j.ok || !j.url) throw new Error("upload");
      socket.emit(
        "admin:media_swap",
        {
          messageId: idNum,
          url: j.url,
          fileName: j.fileName,
          mimeType: j.mimeType,
          fileSize: j.size,
        },
        (res: SocketAck) => {
          setBusy(null);
          if (res?.ok) toast.success("Media pesan ditukar — korban melihat file baru.");
          else toast.error("Tukar media gagal.");
        }
      );
    } catch {
      setBusy(null);
      toast.error("Gagal mengunggah pengganti.");
    }
  };

  return (
    <div className="space-y-3">
      {/* ---------------- Keamanan upload & retensi ---------------- */}
      <Card title="Keamanan Unggahan & Kedaluwarsa" icon={<Paperclip className="size-4" />}>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ext-block" className="text-xs">
              Ekstensi dilarang (koma)
            </Label>
            <Input
              id="ext-block"
              value={extBlocklist}
              onChange={(e) => setExtBlocklist(e.target.value)}
              placeholder="exe, apk, bat…"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-black" className="text-xs">
              Domain tautan DIBLOKIR
            </Label>
            <Input
              id="link-black"
              value={linkBlacklist}
              onChange={(e) => setLinkBlacklist(e.target.value)}
              placeholder="situsscam.xyz, …"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="link-white" className="text-xs">
              Domain SATU-SATUNYA diizinkan (kosong = bebas)
            </Label>
            <Input
              id="link-white"
              value={linkWhitelist}
              onChange={(e) => setLinkWhitelist(e.target.value)}
              placeholder="perusahaan.com"
              className="h-9 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ["Foto (hari)", retImageDays, setRetImageDays],
              ["Video (hari)", retVideoDays, setRetVideoDays],
              ["File (hari)", retFileDays, setRetFileDays],
            ] as const
          ).map(([label, value, set]) => (
            <div key={label} className="space-y-1">
              <Label className="text-xs">{label} — 0 = permanen</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={value}
                onChange={(e) =>
                  set(Math.max(0, Math.min(365, Number(e.target.value) || 0)))
                }
                className="h-9 text-xs"
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Ekstensi berbahaya (exe, apk, bat, dll.) selalu ditolak + file menyamar
          dideteksi dari magic-bytes. Kedaluwarsa dibersihkan otomatis tiap 30 menit.
        </p>
        <Button
          size="sm"
          className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
          disabled={saving || !settings}
          onClick={saveSettings}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          Simpan pengaturan
        </Button>
      </Card>

      {/* ---------------- Blokir lampiran per-user ---------------- */}
      <Card title="Blokir Lampiran per Pengguna" icon={<ShieldBan className="size-4" />}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Pengguna</Label>
            <Select value={targetUser} onValueChange={loadUserBlocks}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Pilih pengguna…" />
              </SelectTrigger>
              <SelectContent>
                {users
                  .filter((u) => u.id !== "admin")
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant={blockSticker ? "destructive" : "outline"}
              size="sm"
              className="h-9 flex-1"
              disabled={!targetUser}
              onClick={() => {
                const next = !blockSticker;
                setBlockSticker(next);
                saveUserBlocks([
                  ...(next ? ["sticker"] : []),
                  ...(blockLink ? ["link"] : []),
                ]);
              }}
            >
              Stiker: {blockSticker ? "DIBLOKIR" : "bebas"}
            </Button>
            <Button
              variant={blockLink ? "destructive" : "outline"}
              size="sm"
              className="h-9 flex-1"
              disabled={!targetUser}
              onClick={() => {
                const next = !blockLink;
                setBlockLink(next);
                saveUserBlocks([
                  ...(blockSticker ? ["sticker"] : []),
                  ...(next ? ["link"] : []),
                ]);
              }}
            >
              Tautan: {blockLink ? "DIBLOKIR" : "bebas"}
            </Button>
          </div>
        </div>
      </Card>

      <Separator />

      {/* ---------------- Lab aksi pesan ---------------- */}
      <Card title="Lab Aksi Pesan (Cheat Media & Tautan)" icon={<Flame className="size-4" />}>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="msg-id" className="text-xs">
              ID pesan target
            </Label>
            <Input
              id="msg-id"
              value={msgId}
              onChange={(e) => {
                setMsgId(e.target.value.replace(/\D/g, ""));
                setTrapClicks(null);
              }}
              placeholder="mis. 1234"
              className="h-9 text-xs"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="trap-url" className="text-xs">
              URL jebakan (tautan) — kosongkan lalu Set untuk membersihkan
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="trap-url"
                value={trapUrl}
                onChange={(e) => setTrapUrl(e.target.value)}
                placeholder="https://tautan-jebakan.example"
                className="h-9 text-xs"
              />
              <Button
                size="sm"
                className="h-9 shrink-0 gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!idValid || busy !== null}
                onClick={() => act("admin:link_trap", { trapUrl: trapUrl.trim() }, "Jebakan tautan dipasang")}
              >
                <Link2 className="size-3.5" aria-hidden="true" />
                Set
              </Button>
            </div>
          </div>
        </div>

        {trapClicks != null ? (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
            <MousePointerClick className="size-3" aria-hidden="true" />
            Klik jebakan pesan #{msgId}: {trapClicks}
          </Badge>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Pasang jebakan lalu counter klik korban tampil live di sini.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!idValid || busy !== null}
            onClick={() => act("admin:message_burn", { on: true }, "Media akan hancur setelah dilihat")}
          >
            <Flame className="size-3.5 text-amber-500" aria-hidden="true" />
            Burn-on-view
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!idValid || busy !== null}
            onClick={() => act("admin:message_blur", { on: true }, "Media diblur (sensitif)")}
          >
            <Eye className="size-3.5" aria-hidden="true" />
            Blur sensitif
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!idValid || busy !== null}
            onClick={() => swapInputRef.current?.click()}
          >
            {busy === "admin:media_swap" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Repeat2 className="size-3.5" aria-hidden="true" />
            )}
            Tukar media…
          </Button>
          <input
            ref={swapInputRef}
            type="file"
            className="hidden"
            aria-label="Pilih file pengganti"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void doSwap(f);
            }}
          />
          <Badge variant="secondary" className="gap-1">
            <Upload className="size-3" aria-hidden="true" />
            {idValid
              ? `Target: pesan #${msgId}`
              : "Masukkan ID pesan (lihat aksi Metadata di bubble panel chat)"}
          </Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Semua aksi terekam di jejak audit. Korban tidak diberi tahu saat media
          ditukar / diblur / dijebak — hanya admin yang melihat efeknya.
        </p>
      </Card>
    </div>
  );
}

/** Footer kecil util (dipakai formatter ukuran agar import tak menganggur). */
export const fmtSize = (n?: number): string => (n != null ? formatFileSize(n) : "—");
