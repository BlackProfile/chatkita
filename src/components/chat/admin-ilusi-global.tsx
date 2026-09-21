"use client";

/**
 * v72 — Ilusi Global (tab "Ilusi Global" di Dashboard Aplikasi).
 *
 * SATU tempat untuk saklar ilusi yang berlaku untuk SEMUA user sekaligus
 * (sisi server: settings.illusion_global via admin:illusion_get/set).
 * Prinsip ilusi tetap sama: hanya mengubah PERSEPSI user — admin selalu
 * melihat keadaan sebenarnya, dan semua perubahan masuk jejak audit.
 *
 * Isi:
 *  - presenceStaleMin : last seen Admin tampak lebih tua di mata user.
 *  - checksDelayMin   : ✓✓ semua user tertunda N menit setelah dibaca.
 *  - sendDelayMs      : pesan user menggantung "mengirim…" N detik.
 *  - adminInvisible   : Admin offline total (tanpa last seen/typing/✓✓).
 *  - tsShiftMin       : semua timestamp yang dilihat user digeser N menit.
 *  - phantomPushMin   : push hantu "1 pesan baru" berkala.
 *
 * Ilusi PER-USER ada di dialog Kendali Akun (tab Ilusi) — terpisah dari sini.
 */

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { EyeOff, Ghost, Loader2, ScanEye, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  AckOf,
  AdminIllusionGetAck,
  AdminIllusionSetAck,
  GlobalIllusions,
} from "@/lib/chat-types";

/** Pilihan numerik (0 = Nonaktif). */
const STALE_OPTIONS = [0, 5, 15, 30, 60, 180] as const;
const CHECKS_OPTIONS = [0, 1, 5, 15, 60] as const;
const SEND_OPTIONS = [0, 2000, 5000, 15000, 30000, 60000] as const;
const SHIFT_OPTIONS = [-120, -60, -15, 0, 15, 60, 120] as const;
const PUSH_OPTIONS = [0, 5, 15, 30, 60, 180] as const;

const labelMenit = (m: number) => (m === 0 ? "Nonaktif" : m >= 60 ? `${Math.round(m / 60)} jam` : `${m} menit`);
const labelDetik = (s: number) => (s === 0 ? "Nonaktif" : `${Math.round(s / 1000)} detik`);

export function AdminIlusiGlobal({ socket }: { socket: Socket | null }) {
  const [ill, setIll] = useState<GlobalIllusions>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!socket || !socket.connected) return;
    socket.emit("admin:illusion_get", {}, (res: AckOf<AdminIllusionGetAck>) => {
      if (res.ok) setIll(res.illusions);
      setLoaded(true);
    });
  }, [socket]);

  const save = (patch: GlobalIllusions, pesan: string) => {
    if (!socket || !socket.connected) return;
    setSaving(true);
    // Optimis: gabungkan dulu supaya UI terasa responsif, koreksi dari server.
    setIll((prev) => ({ ...prev, ...patch }));
    socket.emit("admin:illusion_set", { patch }, (res: AckOf<AdminIllusionSetAck>) => {
      setSaving(false);
      if (res.ok) {
        setIll(res.illusions);
        toast.success(pesan);
      } else {
        toast.error(res.error === "UNAUTHORIZED" ? "Sesi admin berakhir." : "Gagal menyimpan ilusi.");
      }
    });
  };

  const toggleInvisible = () => save({ adminInvisible: ill.adminInvisible === 1 ? false : true }, ill.adminInvisible === 1 ? "Admin terlihat normal kembali ✓" : "Mode \"Admin tak terlihat\" aktif ✓");

  return (
    <div className="space-y-3">
      {/* Info utama */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
        >
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Ilusi Global</p>
            <Badge className="bg-emerald-600 text-white">Semua user</Badge>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Saklar ilusi untuk SEMUA user sekaligus. Hanya mengubah persepsi di
            layar user — data asli tidak berubah dan panel admin selalu melihat
            keadaan sebenarnya. Untuk ilusi satu user tertentu, buka Kendali
            Akun user tersebut (tab Ilusi). Setiap perubahan tercatat di jejak audit.
          </p>
        </div>
      </div>

      {!loaded ? (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <div className="space-y-2.5 rounded-xl border bg-card p-3">
          {/* Admin tak terlihat */}
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <EyeOff className="size-3.5" aria-hidden="true" /> Admin tak terlihat
              </p>
              <p className="text-[11px] text-muted-foreground">
                Semua user melihat Admin offline total: tanpa status online, last
                seen, sinyal mengetik, dan ✓✓ tidak pernah naik.
              </p>
            </div>
            <Switch
              checked={ill.adminInvisible === 1}
              onCheckedChange={toggleInvisible}
              aria-label="Admin tak terlihat"
            />
          </div>

          {/* Last seen lebih tua */}
          <div className="space-y-1 p-1">
            <Label className="flex items-center gap-1.5 text-xs">
              <ScanEye className="size-3.5" aria-hidden="true" /> Last seen Admin tampak lebih tua
            </Label>
            <Select
              value={String(ill.presenceStaleMin ?? 0)}
              onValueChange={(v) => save({ presenceStaleMin: Number(v) }, "Last seen Admin disetel ✓")}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Last seen lebih tua">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STALE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="text-xs">
                    {labelMenit(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Waktu &quot;terakhir dilihat&quot; Admin digeser lebih tua di mata semua user.
            </p>
          </div>

          {/* ✓✓ tertunda */}
          <div className="space-y-1 p-1">
            <Label className="text-xs">✓✓ tertunda (semua user)</Label>
            <Select
              value={String(ill.checksDelayMin ?? 0)}
              onValueChange={(v) => save({ checksDelayMin: Number(v) }, "Centang tertunda disetel ✓")}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Centang dua tertunda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECKS_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="text-xs">
                    {labelMenit(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Setelah Admin membaca, centang dua di pesan user baru muncul setelah jeda ini.
            </p>
          </div>

          {/* Sinyal lemah global */}
          <div className="space-y-1 p-1">
            <Label className="text-xs">Ilusi &quot;mengirim…&quot; (semua user)</Label>
            <Select
              value={String(ill.sendDelayMs ?? 0)}
              onValueChange={(v) => save({ sendDelayMs: Number(v) }, "Ilusi mengirim disetel ✓")}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Ilusi mengirim">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEND_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs">
                    {labelDetik(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Pesan user menggantung &quot;mengirim…&quot; selama jeda ini di layar mereka sendiri.
            </p>
          </div>

          {/* Geser waktu */}
          <div className="space-y-1 p-1">
            <Label className="flex items-center gap-1.5 text-xs">
              <Ghost className="size-3.5" aria-hidden="true" /> Zona waktu ilusi (geser jam)
            </Label>
            <Select
              value={String(ill.tsShiftMin ?? 0)}
              onValueChange={(v) => save({ tsShiftMin: Number(v) }, "Zona waktu ilusi disetel ✓")}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Geser waktu">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="text-xs">
                    {m === 0 ? "Waktu sebenarnya" : `${m > 0 ? "+" : ""}${m} menit`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Semua waktu pesan yang dilihat user digeser dari waktu sebenarnya.
            </p>
          </div>

          {/* Push hantu */}
          <div className="space-y-1 p-1">
            <Label className="text-xs">Push hantu berkala</Label>
            <Select
              value={String(ill.phantomPushMin ?? 0)}
              onValueChange={(v) => save({ phantomPushMin: Number(v) }, "Push hantu disetel ✓")}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Push hantu berkala">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PUSH_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="text-xs">
                    {labelMenit(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Notifikasi &quot;1 pesan baru&quot; tanpa pesan sungguhan, terkirim berkala ke semua user.
            </p>
          </div>
        </div>
      )}

      <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        Catatan: ilusi global menimpa satu per satu oleh ilusi per-user yang
        lebih spesifik (mis. ✓✓ tertunda memakai nilai yang LEBIH BESAR antara
        global dan per-user; geser waktu dijumlahkan). Push hantu memakai
        kanal toast/notifikasi biasa sehingga tak bisa dibedakan user.
      </p>
    </div>
  );
}
