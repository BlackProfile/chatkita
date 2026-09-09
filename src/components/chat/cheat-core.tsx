"use client";

/**
 * v46 — CheatBody: SATU sumber untuk seluruh UI cheat admin.
 *
 * Hasil konsolidasi admin-cheat.tsx (tab Cheat dashboard) dan
 * user-cheat-dialog.tsx (pill 🎭 di toolbar percakapan) yang sebelumnya
 * ~90% duplikat. Kedua pemakai kini hanya menjadi wrapper:
 *  - admin-cheat.tsx      → pemilih user + CheatBody
 *  - user-cheat-dialog.tsx → dialog + CheatBody (target percakapan aktif)
 *
 * Isi (semua event server ter-audit, adminGuard):
 *  - Peek isi percakapan user ↔ Admin (admin:cheat_peek)
 *  - Spoof kirim sebagai user + backdate   (admin:cheat_send)
 *  - Edit isi pesan siapa saja             (admin:cheat_edit)
 *  - Reaksi atas nama user                 (admin:cheat_react)
 *  - Ubah waktu pesan                      (admin:cheat_time)
 *  - Hapus pesan                           (admin:delete_message)
 *  - Sinyal ilusi: typing, ✓✓ palsu, selalu online, mirror, hantu,
 *    last seen palsu (admin:fake_typing/fake_receipts/always_online/
 *    mirror/ghost/fake_last_seen)
 * Di-remount per target via key di wrapper supaya state selalu segar.
 */

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Clock,
  Eraser,
  Ghost,
  MessageSquareWarning,
  PencilLine,
  SendHorizonal,
  Smile,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  AckOf,
  AdminCheatPeekAck,
  ChatMessage,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

export interface CheatTarget {
  id: string;
  name: string;
}

/** Palet reaksi — mirror REACTION_EMOJIS di chat-service. */
const CHEAT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

const ADMIN_USER_ID = "admin";

/** datetime-local (YYYY-MM-DDTHH:mm) → epoch ms, atau null bila kosong. */
const dtToEpoch = (v: string): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** epoch ms → nilai untuk <input type="datetime-local"> (zona lokal). */
const epochToDt = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtMsgTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
};

interface CheatLogEntry {
  at: string;
  text: string;
  ok: boolean;
}

export function CheatBody({
  socket,
  target,
}: {
  socket: Socket | null;
  target: CheatTarget;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [convId, setConvId] = useState("");
  const [selMsgId, setSelMsgId] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(true);

  // Form spoof (kirim sebagai user) + backdate opsional.
  const [spoofText, setSpoofText] = useState("");
  const [spoofAt, setSpoofAt] = useState("");
  // Form edit & ubah waktu pesan terpilih.
  const [editText, setEditText] = useState("");
  const [timeAt, setTimeAt] = useState("");
  // Ilusi "sedang mengetik" — dimiliki CheatBody (konsolidasi v46).
  const [typingOn, setTypingOn] = useState(false);
  // Sinyal ilusi global (keadaan dibaca dari cheat_peek).
  const [alwaysOnline, setAlwaysOnline] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [lastSeen, setLastSeen] = useState("");
  // Log aksi cheat (lokal, terbaru di atas).
  const [log, setLog] = useState<CheatLogEntry[]>([]);
  const busyRef = useRef(false);

  const selMsg = msgs.find((m) => m.id === selMsgId) ?? null;

  const pushLog = (text: string, ok = true) => {
    setLog((prev) =>
      [
        {
          at: new Date().toLocaleTimeString("id-ID", { hour12: false }),
          text,
          ok,
        },
        ...prev,
      ].slice(0, 40)
    );
  };

  /** Muat ulang isi percakapan target + keadaan saklar cheat. */
  const refreshPeek = (keepSelection = false) => {
    if (!socket?.connected) return;
    setPeeking(true);
    socket.emit(
      "admin:cheat_peek",
      { userId: target.id },
      (res: AckOf<AdminCheatPeekAck> | { ok: false; error: string }) => {
        setPeeking(false);
        if (!res.ok) {
          setMsgs([]);
          setConvId("");
          setSelMsgId(null);
          pushLog(
            res.error === "NOT_FOUND"
              ? "Percakapan tidak ditemukan untuk target ini."
              : `Gagal memuat pesan (${res.error}).`,
            false
          );
          return;
        }
        setConvId(res.conversationId);
        setMsgs(res.messages);
        setAlwaysOnline(res.cheatState.alwaysOnline);
        setMirror(res.cheatState.mirror);
        setGhost(res.cheatState.ghost);
        setLastSeen(res.cheatState.fakeLastSeen);
        if (!keepSelection) setSelMsgId(null);
      }
    );
  };

  useEffect(() => {
    if (!socket?.connected) return;
    const t = setTimeout(() => refreshPeek(), 0);
    return () => clearTimeout(t);
  }, [socket, target.id]);

  const pickMessage = (m: ChatMessage) => {
    if (selMsgId === m.id) {
      setSelMsgId(null);
      return;
    }
    setSelMsgId(m.id);
    setEditText(m.type === "text" && !m.deletedAt ? m.content : "");
    setTimeAt(epochToDt(new Date(m.createdAt).getTime()));
  };

  /** Bungkus emit cheat + log + toast; kembalikan true bila ok. */
  const runCheat = (
    event: string,
    payload: Record<string, unknown>,
    okText: string,
    afterOk?: () => void
  ) => {
    if (!socket?.connected || busyRef.current) return;
    busyRef.current = true;
    socket.emit(event, payload, (res: { ok: boolean; error?: string }) => {
      busyRef.current = false;
      pushLog(okText, res.ok);
      if (res.ok) {
        toast.success(okText);
        afterOk?.();
      } else {
        toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
      }
    });
  };

  // 1 — Kirim pesan sebagai user (spoof), backdate opsional.
  const sendSpoof = () => {
    const text = spoofText.trim();
    if (!text) return;
    const createdAt = dtToEpoch(spoofAt);
    runCheat(
      "admin:cheat_send",
      { userId: target.id, text, ...(createdAt ? { createdAt } : {}) },
      createdAt
        ? "Pesan spoof terkirim (dengan waktu palsu)."
        : "Pesan spoof terkirim sebagai user.",
      () => {
        setSpoofText("");
        setSpoofAt("");
        refreshPeek(true);
      }
    );
  };

  // 2 — Edit isi pesan terpilih (teks saja).
  const applyEdit = () => {
    const text = editText.trim();
    if (!selMsgId || !text) return;
    runCheat("admin:cheat_edit", { messageId: selMsgId, text }, `Pesan #${selMsgId} diedit.`, () =>
      refreshPeek(true)
    );
  };

  // 3 — Reaksi sebagai user pada pesan terpilih.
  const applyReact = (emoji: string) => {
    if (!selMsgId) return;
    runCheat(
      "admin:cheat_react",
      { messageId: selMsgId, userId: target.id, emoji },
      `Reaksi ${emoji} dikirim sebagai ${target.name} (#${selMsgId}).`,
      () => refreshPeek(true)
    );
  };

  // 4 — Ubah waktu pesan terpilih.
  const applyTime = () => {
    if (!selMsgId) return;
    const ts = dtToEpoch(timeAt);
    if (ts == null) {
      toast.error("Isi dulu waktu barunya.");
      return;
    }
    runCheat(
      "admin:cheat_time",
      { messageId: selMsgId, createdAt: ts },
      `Waktu pesan #${selMsgId} diganti.`,
      () => refreshPeek(true)
    );
  };

  // 5 — Hapus pesan terpilih (pipeline hapus admin biasa).
  const applyDelete = () => {
    if (!selMsgId) return;
    runCheat("admin:delete_message", { messageId: selMsgId }, `Pesan #${selMsgId} dihapus.`, () =>
      refreshPeek(true)
    );
  };

  // 6 — Ilusi sedang mengetik (on/off) untuk percakapan target.
  const toggleTyping = () => {
    if (!convId) return;
    const next = !typingOn;
    setTypingOn(next);
    runCheat(
      "admin:fake_typing",
      { conversationId: convId, on: next },
      next ? "Ilusi \u201csedang mengetik\u201d AKTIF." : "Ilusi \u201csedang mengetik\u201d dimatikan."
    );
  };

  // 7 — Tandai semua pesan sudah dibaca (ilusi, tanpa sentuh DB).
  const fakeRead = () => {
    if (!convId) return;
    runCheat("admin:fake_receipts", { conversationId: convId }, "Centang dibaca (palsu) dikirim.");
  };

  // 8 — Saklar ilusi presence/mirror/ghost (pengaturan global).
  const toggleSetting = (
    event: string,
    on: boolean,
    okText: string,
    setter: (v: boolean) => void
  ) => {
    const prev = !on;
    setter(on); // optimis
    if (!socket?.connected) {
      setter(prev);
      return;
    }
    socket.emit(event, { on }, (res: { ok: boolean; error?: string }) => {
      pushLog(okText, res.ok);
      if (res.ok) {
        toast.success(okText);
      } else {
        setter(prev);
        toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
      }
    });
  };

  // 9 — "Terakhir dilihat" palsu.
  const applyLastSeen = () => {
    const value = lastSeen.trim();
    if (value.length > 40) {
      toast.error("Maksimal 40 karakter.");
      return;
    }
    runCheat(
      "admin:fake_last_seen",
      { value },
      value ? `"${value}" dipasang sebagai terakhir dilihat.` : "Terakhir dilihat palsu dimatikan."
    );
  };

  const noMsg = selMsgId == null;
  const canEdit = !!selMsg && selMsg.type === "text" && !selMsg.deletedAt;

  return (
    <div className="space-y-3">
      {/* Pilih pesan target */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Percakapan {target.name} ↔ Admin (ketuk pesan untuk memilih)
          </Label>
          {peeking ? (
            <span className="text-[11px] text-muted-foreground">Memuat…</span>
          ) : null}
        </div>
        {convId && !peeking && msgs.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            Belum ada pesan di percakapan ini.
          </p>
        ) : null}
        <div className="chat-scroll max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-background/60 p-1.5">
          {msgs.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pickMessage(m)}
              aria-pressed={selMsgId === m.id}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors",
                selMsgId === m.id
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-transparent hover:bg-accent"
              )}
            >
              <span className="flex w-full items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono">#{m.id}</span>
                <span
                  className={cn(
                    "rounded px-1 font-medium",
                    m.senderId === ADMIN_USER_ID
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                  )}
                >
                  {m.senderId === ADMIN_USER_ID ? "Admin" : target.name}
                </span>
                <span className="ml-auto tabular-nums">{fmtMsgTime(m.createdAt)}</span>
              </span>
              <span className="line-clamp-2 w-full text-xs">
                {m.deletedAt
                  ? "(dihapus)"
                  : m.mediaExpiredAt
                    ? "(media kedaluwarsa)"
                    : m.content || `(${m.type})`}
              </span>
              {m.reactions && m.reactions.length > 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  {m.reactions
                    .map((r) => `${r.emoji}${r.count > 1 ? `×${r.count}` : ""}`)
                    .join(" ")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {!noMsg && selMsg ? (
          <p className="text-[11px] text-muted-foreground">
            Terpilih: <span className="font-mono">#{selMsg.id}</span> — isi form di bawah ikut
            terisi otomatis.
          </p>
        ) : null}
      </div>

      {/* A. Impersonasi & manipulasi pesan */}
      <div className="grid gap-2.5 md:grid-cols-2">
        {/* Spoof kirim */}
        <div className="space-y-2 rounded-xl border bg-card p-3 md:col-span-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SendHorizonal className="size-3.5" aria-hidden="true" />
            Kirim pesan sebagai {target.name} (spoof)
          </p>
          <Textarea
            value={spoofText}
            onChange={(e) => setSpoofText(e.target.value)}
            placeholder="Tulis pesan yang akan muncul seolah-olah dikirim user…"
            rows={2}
            className="min-h-16 text-sm"
            aria-label="Teks pesan spoof"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="cheat-spoof-at" className="text-[11px] text-muted-foreground">
                Waktu pesan (opsional — kosong = sekarang)
              </Label>
              <Input
                id="cheat-spoof-at"
                type="datetime-local"
                value={spoofAt}
                onChange={(e) => setSpoofAt(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <Button
              size="sm"
              className="h-9 bg-violet-600 text-white hover:bg-violet-600/90"
              onClick={sendSpoof}
              disabled={!spoofText.trim()}
            >
              <SendHorizonal className="size-4" aria-hidden="true" />
              Kirim spoof
            </Button>
          </div>
        </div>

        {/* Edit pesan */}
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PencilLine className="size-3.5" aria-hidden="true" />
            Edit pesan siapa saja
          </p>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Pilih pesan di atas, lalu tulis isi barunya…"
            rows={2}
            className="min-h-16 text-sm"
            disabled={!canEdit}
            aria-label="Isi baru pesan"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full"
            onClick={applyEdit}
            disabled={!canEdit || !editText.trim()}
          >
            <PencilLine className="size-4" aria-hidden="true" />
            Simpan isi baru
          </Button>
        </div>

        {/* Reaksi sebagai user */}
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Smile className="size-3.5" aria-hidden="true" />
            Reaksi atas nama {target.name}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CHEAT_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => applyReact(e)}
                disabled={noMsg}
                aria-label={`Reaksi ${e} sebagai user`}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg border text-lg transition-all",
                  "hover:scale-110 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                )}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ketuk lagi untuk menghapus reaksi (toggle).
          </p>
        </div>

        {/* Ubah waktu pesan */}
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Timer className="size-3.5" aria-hidden="true" />
            Ubah waktu pesan (backdate)
          </p>
          <Input
            type="datetime-local"
            value={timeAt}
            onChange={(e) => setTimeAt(e.target.value)}
            className="h-9 text-xs"
            disabled={noMsg}
            aria-label="Waktu baru pesan"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full"
            onClick={applyTime}
            disabled={noMsg || !timeAt}
          >
            <Clock className="size-4" aria-hidden="true" />
            Terapkan waktu baru
          </Button>
        </div>

        {/* Hapus pesan */}
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Hapus pesan siapa saja
          </p>
          <p className="text-[11px] text-red-700/80 dark:text-red-400/80">
            Pesan jadi tombstone “dihapus” di kedua sisi. Pilih pesannya di atas dulu.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="h-9 w-full"
            onClick={applyDelete}
            disabled={noMsg}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Hapus pesan terpilih
          </Button>
        </div>
      </div>

      {/* B. Sinyal ilusi */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Ghost className="size-3.5" aria-hidden="true" />
          Sinyal ilusi (presence, typing, dibaca)
        </p>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {(
            [
              {
                label: "Selalu online",
                desc: "Admin tampak online terus",
                checked: alwaysOnline,
                event: "admin:always_online",
                set: setAlwaysOnline,
              },
              {
                label: "Mirror mengetik",
                desc: "User melihat \u201cAdmin mengetik\u201d saat dia mengetik",
                checked: mirror,
                event: "admin:mirror",
                set: setMirror,
              },
              {
                label: "Mode hantu",
                desc: "Baca pesan tanpa jejak dibaca",
                checked: ghost,
                event: "admin:ghost",
                set: setGhost,
              },
            ] as const
          ).map((t) => (
            <div
              key={t.event}
              className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{t.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{t.desc}</p>
              </div>
              <Switch
                checked={t.checked}
                onCheckedChange={(v) =>
                  toggleSetting(
                    t.event,
                    v,
                    `${t.label}: ${v ? "AKTIF" : "mati"}`,
                    t.set as (v: boolean) => void
                  )
                }
                aria-label={t.label}
                disabled={!socket?.connected}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="cheat-lastseen" className="text-[11px] text-muted-foreground">
              &quot;Terakhir dilihat&quot; palsu (maks 40 karakter, kosong = mati)
            </Label>
            <Input
              id="cheat-lastseen"
              value={lastSeen}
              onChange={(e) => setLastSeen(e.target.value)}
              placeholder="cth: hari ini 09.12"
              className="h-9 text-sm"
              maxLength={40}
            />
          </div>
          <Button size="sm" variant="outline" className="h-9" onClick={applyLastSeen}>
            Pasang
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={typingOn ? "default" : "outline"}
            className={cn(
              "h-9",
              typingOn && "bg-violet-600 text-white hover:bg-violet-600/90"
            )}
            onClick={toggleTyping}
            disabled={!convId}
          >
            <MessageSquareWarning className="size-4" aria-hidden="true" />
            {typingOn ? "Hentikan ilusi mengetik" : "Ilusi “sedang mengetik…”"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={fakeRead}
            disabled={!convId}
          >
            Tandai sudah dibaca (palsu)
          </Button>
        </div>
      </div>

      {/* Log cheat */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Eraser className="size-3.5" aria-hidden="true" />
            Log cheat sesi ini
          </p>
          {log.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setLog([])}
            >
              Bersihkan
            </Button>
          ) : null}
        </div>
        {log.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Belum ada aksi. Semua cheat yang dijalankan muncul di sini (juga terekam di jejak
            audit server — tab Sistem).
          </p>
        ) : (
          <ul className="chat-scroll max-h-44 space-y-1 overflow-y-auto" aria-label="Log cheat">
            {log.map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px]",
                  entry.ok
                    ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/30"
                    : "border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/30"
                )}
              >
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {entry.at}
                </span>
                <span className="min-w-0">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
