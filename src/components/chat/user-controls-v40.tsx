"use client";

/**
 * v40 — Pusat kendali per-user level berikutnya (panel X-Ray).
 *
 * Semua seksi di bawah memakai event server v40 yang ter-audit:
 *  - Catatan & tag admin          → admin:user_note
 *  - Filter kata (blok/sensor)    → admin:word_filter
 *  - Mode persetujuan pra-kirim   → admin:approval_mode
 *  - Blokir media per jenis       → admin:media_types
 *  - Paksa logout semua perangkat → admin:user_force_logout
 *  - Kunci PIN percakapan         → admin:user_pinlock
 *  - Balasan cepat per-user       → admin:quick_reply_list/set + quick_send
 *  - Pesan terjadwal              → admin:schedule_message/list/cancel
 *  - Pengingat otomatis (nudge)   → admin:user_nudge
 *  - Auto-bersih chat             → admin:user_autoclean
 *  - Unduh media ZIP              → admin:user_media_zip
 *  - Riwayat login                → admin:user_logins
 *
 * State diinisialisasi dari profil X-Ray — komponen di-remount per user (key).
 */

import { useEffect, useState } from "react";
import { CalendarClock, KeyRound, ListChecks, Loader2, LogOut, Package, StickyNote, Timer, Trash2, Waves, Zap } from "lucide-react";
import type { Socket } from "socket.io-client";

import { ConfirmDialog } from "@/components/chat/admin-tools";
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
import { Textarea } from "@/components/ui/textarea";
import type {
  AckOf,
  AdminAutocleanAck,
  AdminForceLogoutAck,
  AdminLoginsAck,
  AdminLoginEvent,
  AdminMediaTypesAck,
  AdminMediaZipAck,
  AdminNoteAck,
  AdminNudgeAck,
  AdminPinLockAck,
  AdminQuickReplyAck,
  AdminQuickSendAck,
  AdminScheduleAck,
  AdminScheduleCancelAck,
  AdminScheduleListAck,
  AdminUnlockAck,
  AdminWordFilterAck,
  AdminApprovalModeAck,
  XrayAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const NUDGE_DAYS = [0, 1, 3, 7, 14];
const AUTOCLEAN_DAYS = [0, 1, 7, 30, 90];

const TAG_META: { value: string; label: string; badge: string }[] = [
  { value: "none", label: "Tanpa label", badge: "" },
  { value: "vip", label: "🟣 VIP", badge: "bg-violet-600 text-white" },
  { value: "attention", label: "🟡 Perlu perhatian", badge: "bg-amber-500 text-white" },
  { value: "problem", label: "🔴 Bermasalah", badge: "bg-rose-600 text-white" },
];

const MEDIA_KINDS: { value: string; label: string }[] = [
  { value: "image", label: "Foto" },
  { value: "voice", label: "Voice" },
  { value: "file", label: "Berkas" },
];

const fmtDateTime = (ms: number): string =>
  new Date(ms).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Unduh blob ZIP dari base64 (admin:user_media_zip). */
const downloadZip = (b64: string, name: string) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export function UserControlsV40({
  socket,
  profile,
  onNotice,
}: {
  socket: Socket | null;
  profile: XrayAck["profile"];
  onNotice?: (text: string) => void;
}) {
  /* Catatan & tag */
  const [note, setNote] = useState(profile.adminNote ?? "");
  const [tag, setTag] = useState(profile.tag ?? "none");
  /* Filter kata */
  const [words, setWords] = useState(profile.wordFilter ?? "");
  const [wfAction, setWfAction] = useState(profile.wordFilterAction ?? "block");
  /* Persetujuan pra-kirim */
  const [approval, setApproval] = useState(profile.approvalMode ?? false);
  /* Blokir jenis media */
  const [blocked, setBlocked] = useState<string[]>(profile.blockedMediaTypes ?? []);
  /* Kunci PIN */
  const [pin, setPin] = useState("");
  const [pinLocked, setPinLocked] = useState(profile.pinLockSet ?? false);
  /* Balasan cepat */
  const [quickItems, setQuickItems] = useState<string[]>(profile.quickReplies ?? []);
  const [quickNew, setQuickNew] = useState("");
  /* Pesan terjadwal */
  const [schedText, setSchedText] = useState("");
  const [schedAt, setSchedAt] = useState("");
  const [schedItems, setSchedItems] = useState<{ id: number; text: string; sendAtMs: number }[]>([]);
  /* Pengingat otomatis */
  const [nudgeDays, setNudgeDays] = useState(String(profile.nudgeDays ?? 0));
  const [nudgeText, setNudgeText] = useState(profile.nudgeText ?? "");
  /* Auto-bersih */
  const [autoDays, setAutoDays] = useState(String(profile.autoCleanDays ?? 0));
  /* Umum */
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logins, setLogins] = useState<AdminLoginEvent[] | null>(null);
  const [showLogins, setShowLogins] = useState(false);

  const guard = profile.id;

  /* Muat antrean terjadwal + riwayat login saat panel dibuka. */
  useEffect(() => {
    if (!socket?.connected) return;
    socket.emit("admin:schedule_list", { userId: guard }, (res: AckOf<AdminScheduleListAck>) => {
      if (res.ok) setSchedItems(res.items);
    });
    socket.emit("admin:user_logins", { userId: guard }, (res: AckOf<AdminLoginsAck>) => {
      if (res.ok) setLogins(res.events);
    });
  }, [socket, guard]);

  const saveNote = () => {
    if (!socket) return;
    setBusy("note");
    socket.emit(
      "admin:user_note",
      { userId: guard, note: note.trim(), tag: tag === "none" ? "" : tag },
      (res: AckOf<AdminNoteAck>) => {
        setBusy(null);
        if (res.ok) onNotice?.("Catatan & tag admin tersimpan ✓");
        else onNotice?.("Gagal menyimpan catatan");
      }
    );
  };

  const saveWordFilter = () => {
    if (!socket) return;
    setBusy("wf");
    socket.emit(
      "admin:word_filter",
      { userId: guard, words: words.trim(), action: wfAction },
      (res: AckOf<AdminWordFilterAck>) => {
        setBusy(null);
        if (res.ok) {
          onNotice?.(
            res.words
              ? `Filter kata ${res.action === "censor" ? "SENSOR ***" : "BLOKIR"} aktif ✓`
              : "Filter kata dimatikan ✓"
          );
        } else onNotice?.("Gagal menyimpan filter kata");
      }
    );
  };

  const toggleApproval = (on: boolean) => {
    setApproval(on);
    socket?.emit("admin:approval_mode", { userId: guard, on }, (res: AckOf<AdminApprovalModeAck>) => {
      if (res.ok) onNotice?.(res.on ? "Mode persetujuan AKTIF — pesan user masuk antrean ⏳" : "Mode persetujuan dimatikan");
      else onNotice?.("Gagal mengubah mode persetujuan");
    });
  };

  const toggleMediaKind = (kind: string) => {
    const next = blocked.includes(kind) ? blocked.filter((k) => k !== kind) : [...blocked, kind];
    setBlocked(next);
    socket?.emit("admin:media_types", { userId: guard, blocked: next }, (res: AckOf<AdminMediaTypesAck>) => {
      if (res.ok) onNotice?.(res.blocked.length ? `Diblokir: ${res.blocked.join(", ")}` : "Semua jenis media bebas");
      else onNotice?.("Gagal mengubah blokir jenis media");
    });
  };

  const doForceLogout = () => {
    if (!socket) return;
    setConfirmLogout(false);
    socket.emit("admin:user_force_logout", { userId: guard }, (res: AckOf<AdminForceLogoutAck>) => {
      if (res.ok) {
        onNotice?.(`Sesi diakhiri: ${res.devices} perangkat dilepas, ${res.sockets} socket diputus ✓`);
      } else onNotice?.("Gagal memaksa logout");
    });
  };

  const savePin = () => {
    if (!socket) return;
    setBusy("pin");
    socket.emit(
      "admin:user_pinlock",
      { userId: guard, pin: pinLocked ? null : pin.trim() },
      (res: AckOf<AdminPinLockAck>) => {
        setBusy(null);
        if (res.ok) {
          setPinLocked(res.locked);
          setPin("");
          onNotice?.(res.locked ? "Kunci PIN dipasang — percakapan butuh PIN ✓" : "Kunci PIN dilepas ✓");
        } else onNotice?.("Gagal mengubah kunci PIN (gunakan 4–8 digit)");
      }
    );
  };

  const addQuick = () => {
    const v = quickNew.trim();
    if (!socket || !v || quickItems.length >= 20) return;
    const next = [...quickItems, v];
    setBusy("quick");
    socket.emit("admin:quick_reply_set", { userId: guard, items: next }, (res: AckOf<AdminQuickReplyAck>) => {
      setBusy(null);
      if (res.ok) {
        setQuickItems(res.items);
        setQuickNew("");
        onNotice?.("Template balasan cepat ditambahkan ✓");
      } else onNotice?.("Gagal menyimpan template");
    });
  };

  const removeQuick = (i: number) => {
    if (!socket) return;
    const next = quickItems.filter((_, idx) => idx !== i);
    setBusy("quick");
    socket.emit("admin:quick_reply_set", { userId: guard, items: next }, (res: AckOf<AdminQuickReplyAck>) => {
      setBusy(null);
      if (res.ok) {
        setQuickItems(res.items);
        onNotice?.("Template dihapus");
      } else onNotice?.("Gagal menghapus template");
    });
  };

  const sendQuick = (text: string) => {
    if (!socket) return;
    setBusy(`send-${text}`);
    socket.emit("admin:quick_send", { userId: guard, text }, (res: AckOf<AdminQuickSendAck>) => {
      setBusy(null);
      if (res.ok) onNotice?.(`Terkirim ke ${profile.name} ✓`);
      else onNotice?.("Gagal mengirim balasan cepat");
    });
  };

  const doSchedule = () => {
    if (!socket || !schedText.trim() || !schedAt) return;
    const ms = new Date(schedAt).getTime();
    if (!Number.isFinite(ms) || ms < Date.now() + 10_000) {
      onNotice?.("Waktu terjadwal minimal 10 detik dari sekarang");
      return;
    }
    setBusy("sched");
    socket.emit(
      "admin:schedule_message",
      { userId: guard, text: schedText.trim(), sendAtMs: ms },
      (res: AckOf<AdminScheduleAck>) => {
        setBusy(null);
        if (res.ok) {
          setSchedItems((prev) => [...prev, { id: res.id, text: schedText.trim(), sendAtMs: res.sendAtMs }]);
          setSchedText("");
          setSchedAt("");
          onNotice?.(`Pesan dijadwalkan ${fmtDateTime(res.sendAtMs)} ✓`);
        } else onNotice?.("Gagal menjadwalkan (maks 30 hari ke depan)");
      }
    );
  };

  const cancelSched = (id: number) => {
    if (!socket) return;
    socket.emit("admin:schedule_cancel", { messageId: id }, (res: AckOf<AdminScheduleCancelAck>) => {
      if (res.ok) {
        setSchedItems((prev) => prev.filter((s) => s.id !== id));
        onNotice?.("Pesan terjadwal dibatalkan");
      } else onNotice?.("Gagal membatalkan (mungkin sudah terkirim)");
    });
  };

  const saveNudge = () => {
    if (!socket) return;
    const days = Number(nudgeDays);
    if (days > 0 && !nudgeText.trim()) {
      onNotice?.("Isi teks pengingat dulu");
      return;
    }
    setBusy("nudge");
    socket.emit(
      "admin:user_nudge",
      { userId: guard, days, text: nudgeText.trim() },
      (res: AckOf<AdminNudgeAck>) => {
        setBusy(null);
        if (res.ok) {
          onNotice?.(res.days ? `Pengingat otomatis aktif: diam ≥ ${res.days} hari ✓` : "Pengingat otomatis dimatikan");
        } else onNotice?.("Gagal menyimpan pengingat");
      }
    );
  };

  const saveAutoclean = () => {
    if (!socket) return;
    setBusy("clean");
    socket.emit("admin:user_autoclean", { userId: guard, days: Number(autoDays) }, (res: AckOf<AdminAutocleanAck>) => {
      setBusy(null);
      if (res.ok) {
        onNotice?.(res.days ? `Auto-bersih aktif: pesan > ${res.days} hari dihapus ✓` : "Auto-bersih dimatikan");
      } else onNotice?.("Gagal menyimpan auto-bersih");
    });
  };

  const doZip = () => {
    if (!socket) return;
    setBusy("zip");
    socket.emit("admin:user_media_zip", { userId: guard }, (res: AckOf<AdminMediaZipAck>) => {
      setBusy(null);
      if (res.ok) {
        downloadZip(res.b64, res.name);
        onNotice?.(`ZIP ${res.count} berkas (${res.bytes} B) terunduh ✓`);
      } else if (res.error === "NO_MEDIA") onNotice?.("User belum punya media");
      else if (res.error === "TOO_LARGE") onNotice?.("Total media melebihi 40 MiB — unduh manual dari dialog Media");
      else onNotice?.("Gagal membuat ZIP");
    });
  };

  const minSched = new Date(Date.now() + 15_000);
  const minSchedLocal = new Date(minSched.getTime() - minSched.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Zap className="size-3.5" aria-hidden="true" />
        Pusat kendali v40
      </p>

      {/* Catatan & tag admin */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <StickyNote className="size-3" aria-hidden="true" />
          Catatan &amp; tag admin
        </Label>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="h-8 text-xs" aria-label="Label user">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAG_META.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Catatan pribadi tentang user ini (khusus admin)…"
          maxLength={2000}
          className="min-h-14 text-xs"
          aria-label="Catatan admin"
        />
        <Button size="sm" variant="outline" className="h-8 w-full" disabled={busy === "note"} onClick={saveNote}>
          {busy === "note" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Simpan catatan"}
        </Button>
      </div>

      {/* Filter kata */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <Waves className="size-3" aria-hidden="true" />
          Filter kata khusus
        </Label>
        <Textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder={"Satu kata per baris (atau pisah koma)…"}
          maxLength={2000}
          className="min-h-12 text-xs"
          aria-label="Daftar kata terlarang"
        />
        <div className="flex items-center gap-1.5">
          <Select value={wfAction} onValueChange={(v) => setWfAction(v as "block" | "censor")}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Aksi filter kata">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block" className="text-xs">Tolak pesan</SelectItem>
              <SelectItem value="censor" className="text-xs">Sensor jadi ***</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy === "wf"} onClick={saveWordFilter}>
            {busy === "wf" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Simpan"}
          </Button>
        </div>
      </div>

      {/* Mode persetujuan */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">⏳ Mode persetujuan</p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Pesan {profile.name} harus disetujui dulu sebelum tampil.
          </p>
        </div>
        <Switch checked={approval} onCheckedChange={toggleApproval} aria-label="Mode persetujuan" />
      </div>

      {/* Blokir jenis media */}
      <div className="space-y-1">
        <Label className="text-xs">Blokir jenis media</Label>
        <div className="flex flex-wrap gap-1.5">
          {MEDIA_KINDS.map((k) => {
            const on = blocked.includes(k.value);
            return (
              <button
                key={k.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMediaKind(k.value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  on ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                {on ? "🚫" : "✓"} {k.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kunci PIN */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <KeyRound className="size-3" aria-hidden="true" />
          Kunci percakapan (PIN)
        </Label>
        {pinLocked ? (
          <div className="flex items-center justify-between gap-2">
            <Badge className="bg-rose-600 text-white">🔒 Terkunci</Badge>
            <Button size="sm" variant="outline" className="h-7" disabled={busy === "pin"} onClick={savePin}>
              Lepas kunci
            </Button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN 4–8 digit"
              maxLength={8}
              className="h-8 text-xs"
              aria-label="PIN kunci percakapan"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              disabled={busy === "pin" || pin.trim().length < 4}
              onClick={savePin}
            >
              {busy === "pin" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Pasang"}
            </Button>
          </div>
        )}
      </div>

      {/* Balasan cepat */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <ListChecks className="size-3" aria-hidden="true" />
          Balasan cepat ({quickItems.length}/20)
        </Label>
        {quickItems.length > 0 ? (
          <ul className="max-h-28 space-y-1 overflow-y-auto pr-1">
            {quickItems.map((q, i) => (
              <li key={`${i}-${q.slice(0, 12)}`} className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded-lg bg-accent px-2 py-1 text-left text-[11px] hover:bg-accent/70"
                  title={`Kirim: ${q}`}
                  disabled={busy === `send-${q}`}
                  onClick={() => sendQuick(q)}
                >
                  {busy === `send-${q}` ? "Mengirim…" : q}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Hapus template"
                  onClick={() => removeQuick(i)}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-muted-foreground">Belum ada template — ketuk template untuk kirim instan.</p>
        )}
        <div className="flex gap-1.5">
          <Input
            value={quickNew}
            onChange={(e) => setQuickNew(e.target.value)}
            placeholder="Template baru…"
            maxLength={500}
            className="h-8 text-xs"
            aria-label="Template baru"
            onKeyDown={(e) => {
              if (e.key === "Enter") addQuick();
            }}
          />
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!quickNew.trim() || quickItems.length >= 20} onClick={addQuick}>
            Tambah
          </Button>
        </div>
      </div>

      {/* Pesan terjadwal */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <CalendarClock className="size-3" aria-hidden="true" />
          Pesan terjadwal
        </Label>
        {schedItems.length > 0 ? (
          <ul className="max-h-24 space-y-1 overflow-y-auto pr-1">
            {schedItems.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 rounded-lg bg-accent px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px]" title={s.text}>
                  ⏰ {fmtDateTime(s.sendAtMs)} — {s.text}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Batalkan terjadwal"
                  onClick={() => cancelSched(s.id)}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          value={schedText}
          onChange={(e) => setSchedText(e.target.value)}
          placeholder="Isi pesan…"
          maxLength={1000}
          className="h-8 text-xs"
          aria-label="Isi pesan terjadwal"
        />
        <div className="flex gap-1.5">
          <Input
            type="datetime-local"
            value={schedAt}
            min={minSchedLocal}
            onChange={(e) => setSchedAt(e.target.value)}
            className="h-8 flex-1 text-xs"
            aria-label="Waktu kirim"
          />
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!schedText.trim() || !schedAt || busy === "sched"} onClick={doSchedule}>
            {busy === "sched" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Jadwalkan"}
          </Button>
        </div>
      </div>

      {/* Pengingat otomatis */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <Timer className="size-3" aria-hidden="true" />
          Pengingat otomatis
        </Label>
        <div className="flex items-center gap-1.5">
          <Select value={nudgeDays} onValueChange={setNudgeDays}>
            <SelectTrigger className="h-8 w-28 shrink-0 text-xs" aria-label="Ambang hari diam">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NUDGE_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)} className="text-xs">
                  {d === 0 ? "Nonaktif" : `Diam ≥ ${d} hari`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={nudgeText}
            onChange={(e) => setNudgeText(e.target.value)}
            placeholder="Teks pengingat…"
            maxLength={500}
            className="h-8 flex-1 text-xs"
            aria-label="Teks pengingat"
          />
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy === "nudge"} onClick={saveNudge}>
            {busy === "nudge" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Simpan"}
          </Button>
        </div>
      </div>

      {/* Auto-bersih + ZIP */}
      <div className="space-y-1.5">
        <Label className="text-xs">Auto-bersih chat</Label>
        <div className="flex items-center gap-1.5">
          <Select value={autoDays} onValueChange={setAutoDays}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Umur pesan maksimum">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOCLEAN_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)} className="text-xs">
                  {d === 0 ? "Nonaktif" : `Hapus > ${d} hari`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy === "clean"} onClick={saveAutoclean}>
            {busy === "clean" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Terapkan"}
          </Button>
        </div>
        <Button size="sm" variant="outline" className="h-8 w-full" disabled={busy === "zip"} onClick={doZip}>
          {busy === "zip" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Package className="size-3.5" aria-hidden="true" />
          )}
          Unduh semua media (ZIP)
        </Button>
      </div>

      {/* Paksa logout + riwayat login */}
      <div className="space-y-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full border-destructive/40 text-destructive hover:text-destructive"
          onClick={() => setConfirmLogout(true)}
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Paksa logout semua perangkat
        </Button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowLogins((v) => !v)}
        >
          Riwayat login {logins ? `(${logins.length})` : "…"} {showLogins ? "▲" : "▼"}
        </button>
        {showLogins ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
            {(logins ?? []).map((l, i) => (
              <li key={i} className="rounded-lg bg-accent px-2 py-1 text-[10px] leading-snug">
                <span className="font-medium">{fmtDateTime(Date.parse(l.at))}</span>{" "}
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {l.kind}
                </Badge>
                <br />
                {l.ip ?? "IP tidak diketahui"} · {l.userAgent ? l.userAgent.slice(0, 46) : "—"}
              </li>
            ))}
            {logins && logins.length === 0 ? (
              <li className="py-2 text-center text-[10px] text-muted-foreground">Belum ada riwayat login.</li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={(v) => !v && setConfirmLogout(false)}
        title="Paksa logout semua perangkat?"
        description={`Semua perangkat ${profile.name} akan dilepas dan semua sesinya diputus — dia harus login ulang.`}
        confirmLabel="Ya, akhiri sesi"
        destructive
        onConfirm={doForceLogout}
      />
    </div>
  );
}
