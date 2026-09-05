"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  AudioLines,
  Clock,
  Copy,
  Eraser,
  EyeOff,
  Gauge,
  Ghost,
  Hourglass,
  Image as ImageIcon,
  PencilLine,
  Reply,
  SendHorizonal,
  Smile,
  Timer,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

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
  AdminCheatPeekAck,
  ChatMessage,
} from "@/lib/chat-types";
import { avatarColorClass, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * v38 — Pusat Cheat PER-USER, dibuka langsung dari toolbar percakapan admin
 * (pill "🎭 Cheat"). Sama seperti tab Cheat di dashboard, tapi tanpa pemilih
 * user: target otomatis = partner percakapan aktif, jadi semua aksi cheat
 * (spoof, edit, reaksi, ubah waktu, hapus, sinyal ilusi) tinggal satu ketukan
 * di konteks percakapan yang sedang dibuka. Semua aksi memakai event server
 * v25 yang sudah ada dan tercatat di jejak audit.
 */

export interface UserCheatTarget {
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

export function UserCheatDialog({
  target,
  onClose,
  socket,
  /** Keadaan "Typing palsu" percakapan aktif — dimiliki AdminPanel agar pill toolbar & dialog selalu sinkron. */
  typingOn,
  onToggleTyping,
  /** v45 — daftar user utk target CLONE percakapan (dari daftar percakapan admin). */
  partners = [],
}: {
  target: UserCheatTarget | null;
  onClose: () => void;
  socket: Socket | null;
  typingOn: boolean;
  onToggleTyping: () => void;
  partners?: UserCheatTarget[];
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg">
        {target ? (
          <CheatBody
            key={target.id}
            target={target}
            socket={socket}
            typingOn={typingOn}
            onToggleTyping={onToggleTyping}
            partners={partners}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Isi dialog — di-remount per user (key) supaya state selalu segar. */
function CheatBody({
  target,
  socket,
  typingOn,
  onToggleTyping,
  partners,
}: {
  target: UserCheatTarget;
  socket: Socket | null;
  typingOn: boolean;
  onToggleTyping: () => void;
  partners: UserCheatTarget[];
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
  // Sinyal ilusi global (keadaan dibaca dari cheat_peek).
  const [alwaysOnline, setAlwaysOnline] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [lastSeen, setLastSeen] = useState("");
  // v45 — cheat lanjutan per-user.
  const [shadowban, setShadowban] = useState(false);
  const [shadowCount, setShadowCount] = useState(0);
  const [throttleSec, setThrottleSec] = useState(0);
  const [throttlePick, setThrottlePick] = useState("0");
  const [autoReplyOn, setAutoReplyOn] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState("");
  const [autoReplyDelay, setAutoReplyDelay] = useState("3");
  const [voiceText, setVoiceText] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [floodText, setFloodText] = useState("");
  const [floodCount, setFloodCount] = useState("5");
  const [floodInterval, setFloodInterval] = useState("500");
  const [warpHours, setWarpHours] = useState("24");
  const [cloneTarget, setCloneTarget] = useState("");
  const [cloneMove, setCloneMove] = useState(false);
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
      ].slice(0, 24)
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
        // v45 — cheat lanjutan per-user.
        setShadowban(res.cheatState.shadowban);
        setShadowCount(res.cheatState.shadowCount);
        setThrottleSec(res.cheatState.throttleSec);
        setThrottlePick(String(res.cheatState.throttleSec));
        setAutoReplyOn(res.cheatState.autoreply.on);
        setAutoReplyText(res.cheatState.autoreply.text ?? "");
        setAutoReplyDelay(String(res.cheatState.autoreply.delaySec));
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

  // ---- v45 — cheat lanjutan per-user --------------------------------

  // (1) Shadowban: pesan user sukses di sisinya, tapi tak sampai ke admin.
  const toggleShadowban = (v: boolean) => {
    if (!socket?.connected) return;
    setShadowban(v); // optimis
    socket.emit("admin:cheat_shadowban", { userId: target.id, on: v }, (res: { ok: boolean; error?: string; revealed?: number }) => {
      pushLog(v ? "Shadowban AKTIF — pesan user tak sampai ke admin." : `Shadowban mati — ${res.revealed ?? 0} pesan bayangan terungkap.`, res.ok);
      if (res.ok) {
        toast.success(v ? "Shadowban AKTIF." : `Shadowban mati — ${res.revealed ?? 0} pesan terungkap.`);
        setShadowCount(0);
        refreshPeek(true);
      } else {
        setShadowban(!v);
        toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
      }
    });
  };

  // (2) Spoof suara (TTS atas nama user).
  const sendVoice = () => {
    const text = voiceText.trim();
    if (!text || !socket?.connected || voiceBusy) return;
    setVoiceBusy(true);
    socket.emit("admin:cheat_voice", { userId: target.id, text }, (res: { ok: boolean; error?: string }) => {
      setVoiceBusy(false);
      pushLog(`Suara palsu (TTS) dikirim sebagai ${target.name}.`, res.ok);
      if (res.ok) {
        toast.success("Pesan suara palsu terkirim.");
        setVoiceText("");
        refreshPeek(true);
      } else {
        toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
      }
    });
  };

  // (3) Gambar AI atas nama user.
  const sendImageAi = () => {
    const prompt = imagePrompt.trim();
    if (prompt.length < 3 || !socket?.connected || imageBusy) return;
    setImageBusy(true);
    socket.emit("admin:cheat_image_ai", { userId: target.id, prompt }, (res: { ok: boolean; error?: string }) => {
      setImageBusy(false);
      pushLog(`Gambar AI dikirim sebagai ${target.name}.`, res.ok);
      if (res.ok) {
        toast.success("Foto AI palsu terkirim.");
        setImagePrompt("");
        refreshPeek(true);
      } else {
        toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
      }
    });
  };

  // (4) Flood injector + stop.
  const startFlood = () => {
    const text = floodText.trim();
    const count = Math.round(Number(floodCount));
    const intervalMs = Math.round(Number(floodInterval));
    if (!text || !socket?.connected) return;
    if (!Number.isInteger(count) || count < 1 || count > 30) {
      toast.error("Jumlah harus 1–30.");
      return;
    }
    if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 5000) {
      toast.error("Jeda harus 250–5000 ms.");
      return;
    }
    socket.emit("admin:cheat_flood", { userId: target.id, text, count, intervalMs }, (res: { ok: boolean; error?: string }) => {
      pushLog(`Flood ${count} pesan dijadwalkan (${intervalMs}ms).`, res.ok);
      if (res.ok) toast.success(`Flood ${count} pesan dimulai.`);
      else toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
    });
  };
  const stopFlood = () => {
    if (!socket?.connected) return;
    socket.emit("admin:cheat_flood_stop", { userId: target.id }, (res: { ok: boolean; stopped?: number }) => {
      pushLog(`Flood dihentikan (${res.stopped ?? 0} dibatalkan).`, res.ok);
      toast.success(`Dihentikan — ${res.stopped ?? 0} pesan dibatalkan.`);
    });
  };

  // (5) Time warp massal: geser waktu semua pesan user.
  const applyTimewarp = () => {
    const deltaHours = Math.round(Number(warpHours));
    if (!Number.isInteger(deltaHours) || deltaHours === 0 || Math.abs(deltaHours) > 2160) {
      toast.error("Isi pergeseran jam (±1 sampai ±2160, bukan 0).");
      return;
    }
    runCheat(
      "admin:cheat_timewarp",
      { userId: target.id, deltaHours },
      `Waktu semua pesan ${target.name} digeser ${deltaHours > 0 ? "+" : ""}${deltaHours} jam.`,
      () => refreshPeek(true)
    );
  };

  // (6) Auto-reply atas nama user.
  const saveAutoReply = (on: boolean) => {
    if (!socket?.connected) return;
    const text = autoReplyText.trim();
    if (on && !text) {
      toast.error("Isi dulu teks balasan otomatis.");
      return;
    }
    const prev = autoReplyOn;
    setAutoReplyOn(on); // optimis
    socket.emit(
      "admin:cheat_autoreply",
      { userId: target.id, on, text, delaySec: Math.round(Number(autoReplyDelay) || 0) },
      (res: { ok: boolean; error?: string }) => {
        pushLog(on ? "Auto-reply user AKTIF." : "Auto-reply user mati.", res.ok);
        if (res.ok) {
          toast.success(on ? "Auto-reply AKTIF — user membalas otomatis." : "Auto-reply dimatikan.");
        } else {
          setAutoReplyOn(prev);
          toast.error(`Gagal — ${res.error ?? "kesalahan server"}`);
        }
      }
    );
  };

  // (7) Throttle pesan user.
  const applyThrottle = () => {
    const seconds = Math.round(Number(throttlePick) || 0);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300) {
      toast.error("Jeda harus 0–300 detik.");
      return;
    }
    runCheat(
      "admin:cheat_throttle",
      { userId: target.id, seconds },
      seconds > 0 ? `Pesan ${target.name} ditunda ${seconds} dtk di sisi admin.` : "Throttle pesan dimatikan.",
      () => setThrottleSec(seconds)
    );
  };

  // (8) Clone percakapan ke user lain.
  const applyClone = () => {
    if (!cloneTarget || !socket?.connected) return;
    if (cloneTarget === target.id) {
      toast.error("Target harus user lain.");
      return;
    }
    runCheat(
      "admin:clone_conversation",
      { fromUserId: target.id, toUserId: cloneTarget, move: cloneMove },
      cloneMove ? "Percakapan dipindahkan." : "Percakapan disalin.",
      () => {
        setCloneTarget("");
        setCloneMove(false);
        refreshPeek(true);
      }
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white"
          >
            <Wand2 className="size-4" />
          </span>
          <span className="min-w-0 truncate">Cheat {target.name}</span>
          <Badge className="bg-violet-600 text-white">Ter-audit</Badge>
        </DialogTitle>
        <DialogDescription>
          Semua aksi cheat untuk user ini dalam satu tempat — kirim pesan sebagai
          dia, edit/hapus/ubah waktu pesannya, bereaksi atas namanya, dan sinyal
          ilusi. Setiap aksi tercatat di jejak audit server.
        </DialogDescription>
      </DialogHeader>

      {/* Pilih pesan target */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Pesan percakapan (ketuk untuk memilih)
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
        <div className="chat-scroll max-h-52 space-y-1 overflow-y-auto rounded-lg border bg-background/60 p-1.5">
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
        {selMsg ? (
          <p className="text-[11px] text-muted-foreground">
            Terpilih: <span className="font-mono">#{selMsg.id}</span>
            {canEdit ? "" : " — pesan teks hidup saja yang bisa diedit."}
          </p>
        ) : null}
      </div>

      {/* A. Impersonasi & manipulasi pesan */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
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
            <Label htmlFor="uc-spoof-at" className="text-[11px] text-muted-foreground">
              Waktu pesan (opsional — kosong = sekarang)
            </Label>
            <Input
              id="uc-spoof-at"
              type="datetime-local"
              value={spoofAt}
              onChange={(e) => setSpoofAt(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-9 shrink-0 bg-violet-600 text-white hover:bg-violet-600/90"
            onClick={sendSpoof}
            disabled={!spoofText.trim() || !convId}
          >
            <SendHorizonal className="size-4" aria-hidden="true" />
            Kirim spoof
          </Button>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {/* Edit pesan */}
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PencilLine className="size-3.5" aria-hidden="true" />
            Edit pesan terpilih
          </p>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Pilih pesan teks di atas, lalu tulis isi barunya…"
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
                aria-label={`Reaksi ${e} sebagai ${target.name}`}
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

        {/* Ubah waktu */}
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
            Hapus pesan terpilih
          </p>
          <p className="text-[11px] text-red-700/80 dark:text-red-400/80">
            Pesan jadi tombstone “dihapus” di kedua sisi; isi asli tetap tersimpan
            untuk forensik.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="h-9 w-full"
            onClick={applyDelete}
            disabled={noMsg}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Hapus pesan #{selMsgId ?? "—"}
          </Button>
        </div>
      </div>

      {/* B. Sinyal ilusi */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Ghost className="size-3.5" aria-hidden="true" />
          Sinyal ilusi (typing, dibaca, presence)
        </p>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={typingOn}
            className={cn(
              "flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
              typingOn
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={onToggleTyping}
            disabled={!convId}
          >
            ⌨ Typing palsu: {typingOn ? "AKTIF" : "mati"}
          </button>
          <button
            type="button"
            className="flex h-8 items-center gap-1 rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={fakeRead}
            disabled={!convId}
          >
            ✓✓ Tandai dibaca (palsu)
          </button>
        </div>

        <div className="space-y-2">
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
                desc: "User melihat “Admin mengetik” saat dia mengetik",
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
          ).map((s) => (
            <div key={s.event} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">{s.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{s.desc}</p>
              </div>
              <Switch
                checked={s.checked}
                onCheckedChange={(v) => toggleSetting(s.event, v, `${s.label}: ${v ? "on" : "off"}`, s.set)}
                aria-label={s.label}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uc-lastseen" className="text-[11px] text-muted-foreground">
            “Terakhir dilihat” palsu (kosong = mati, maks 40 karakter)
          </Label>
          <div className="flex gap-2">
            <Input
              id="uc-lastseen"
              value={lastSeen}
              onChange={(e) => setLastSeen(e.target.value)}
              placeholder="mis. kemarin 21.00"
              className="h-9 text-xs"
              maxLength={40}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={applyLastSeen}
            >
              <Eraser className="size-4" aria-hidden="true" />
              Pasang
            </Button>
          </div>
        </div>
      </div>

      {/* C. Cheat lanjutan (v45) */}
      <div className="space-y-2.5 rounded-xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900/50 dark:bg-violet-950/20">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-400">
          <Wand2 className="size-3.5" aria-hidden="true" />
          Cheat lanjutan (v45) — ilusi & otomasi berat
        </p>

        {/* 1 — Shadowban */}
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <EyeOff className="size-3.5" aria-hidden="true" />
              Shadowban
            </p>
            <p className="text-[11px] text-muted-foreground">
              Pesan dia tampak terkirim di sisinya, tapi tak pernah sampai ke
              admin. Matikan → semua pesan bayangan terungkap.
            </p>
            {shadowCount > 0 ? (
              <Badge className="mt-1 bg-amber-600 text-white">
                {shadowCount} pesan bayangan tersembunyi
              </Badge>
            ) : null}
          </div>
          <Switch
            checked={shadowban}
            onCheckedChange={toggleShadowban}
            aria-label="Aktifkan shadowban"
          />
        </div>

        {/* 2 — Spoof suara (TTS) */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <AudioLines className="size-3.5" aria-hidden="true" />
            Suara palsu (TTS) sebagai {target.name}
          </p>
          <Textarea
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            placeholder="Teks yang akan diucapkan… (maks 500 karakter)"
            rows={2}
            className="min-h-14 text-sm"
            aria-label="Teks suara palsu"
            maxLength={500}
          />
          <Button
            size="sm"
            className="h-8 w-full bg-violet-600 text-white hover:bg-violet-600/90"
            onClick={sendVoice}
            disabled={!voiceText.trim() || voiceBusy || !convId}
          >
            <AudioLines className="size-4" aria-hidden="true" />
            {voiceBusy ? "Membuat suara…" : "Kirim pesan suara"}
          </Button>
        </div>

        {/* 3 — Gambar AI atas nama user */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ImageIcon className="size-3.5" aria-hidden="true" />
            Foto AI atas nama {target.name}
          </p>
          <div className="flex gap-2">
            <Input
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Prompt gambar… mis. kucing oranye pakai topi"
              className="h-9 text-xs"
              maxLength={200}
              aria-label="Prompt gambar AI"
            />
            <Button
              size="sm"
              className="h-9 shrink-0 bg-violet-600 text-white hover:bg-violet-600/90"
              onClick={sendImageAi}
              disabled={imagePrompt.trim().length < 3 || imageBusy || !convId}
            >
              <ImageIcon className="size-4" aria-hidden="true" />
              {imageBusy ? "…" : "Buat"}
            </Button>
          </div>
        </div>

        {/* 4 — Flood injector */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Zap className="size-3.5" aria-hidden="true" />
            Flood injector (simulasi spammer)
          </p>
          <Input
            value={floodText}
            onChange={(e) => setFloodText(e.target.value)}
            placeholder="Teks yang dibanjirkan…"
            className="h-9 text-xs"
            maxLength={200}
            aria-label="Teks flood"
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Jumlah (1–30)</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={floodCount}
                onChange={(e) => setFloodCount(e.target.value)}
                className="h-9 text-xs"
                aria-label="Jumlah pesan flood"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Jeda (ms, 250–5000)</Label>
              <Select value={floodInterval} onValueChange={setFloodInterval}>
                <SelectTrigger className="h-9 text-xs" aria-label="Jeda antar pesan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="250">250 ms</SelectItem>
                  <SelectItem value="500">500 ms</SelectItem>
                  <SelectItem value="1000">1 detik</SelectItem>
                  <SelectItem value="3000">3 detik</SelectItem>
                  <SelectItem value="5000">5 detik</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="h-9 shrink-0 bg-violet-600 text-white hover:bg-violet-600/90"
              onClick={startFlood}
              disabled={!floodText.trim() || !convId}
            >
              <Zap className="size-4" aria-hidden="true" />
              Mulai
            </Button>
            <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={stopFlood}>
              Stop
            </Button>
          </div>
        </div>

        {/* 5 — Time warp massal */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Hourglass className="size-3.5" aria-hidden="true" />
            Time warp — geser waktu SEMUA pesan dia (massal)
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              value={warpHours}
              onChange={(e) => setWarpHours(e.target.value)}
              placeholder="mis. -72 (mundur 3 hari) atau 24"
              className="h-9 text-xs"
              aria-label="Pergeseran jam"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={applyTimewarp}
              disabled={!convId}
            >
              <Hourglass className="size-4" aria-hidden="true" />
              Geser
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Satuan jam (−2160 sampai +2160). Negatif = mundur ke masa lalu.
          </p>
        </div>

        {/* 6 — Auto-reply atas nama user */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Reply className="size-3.5" aria-hidden="true" />
              Auto-reply atas nama {target.name}
            </p>
            <Switch
              checked={autoReplyOn}
              onCheckedChange={saveAutoReply}
              aria-label="Aktifkan auto-reply user"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Saat admin mengirim pesan, dia membalas otomatis (kebalikan bot v39).
          </p>
          <Textarea
            value={autoReplyText}
            onChange={(e) => setAutoReplyText(e.target.value)}
            placeholder="Teks balasan otomatis… (maks 300 karakter)"
            rows={2}
            className="min-h-14 text-sm"
            aria-label="Teks balasan otomatis user"
            maxLength={300}
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Jeda balasan</Label>
              <Select value={autoReplyDelay} onValueChange={setAutoReplyDelay}>
                <SelectTrigger className="h-9 text-xs" aria-label="Jeda balasan otomatis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Langsung</SelectItem>
                  <SelectItem value="3">3 detik</SelectItem>
                  <SelectItem value="10">10 detik</SelectItem>
                  <SelectItem value="30">30 detik</SelectItem>
                  <SelectItem value="60">1 menit</SelectItem>
                  <SelectItem value="120">2 menit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => saveAutoReply(autoReplyOn)}
            >
              Simpan teks
            </Button>
          </div>
        </div>

        {/* 7 — Throttle pesan */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Gauge className="size-3.5" aria-hidden="true" />
            Throttle pesan — tunda pengiriman ke admin
          </p>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Jeda sisi admin (0 = mati{throttleSec > 0 ? ` · aktif ${throttleSec} dtk` : ""})
              </Label>
              <Select value={throttlePick} onValueChange={setThrottlePick}>
                <SelectTrigger className="h-9 text-xs" aria-label="Jeda throttle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Mati (instan)</SelectItem>
                  <SelectItem value="5">5 detik</SelectItem>
                  <SelectItem value="15">15 detik</SelectItem>
                  <SelectItem value="30">30 detik</SelectItem>
                  <SelectItem value="60">1 menit</SelectItem>
                  <SelectItem value="300">5 menit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={applyThrottle}
              disabled={!convId}
            >
              <Gauge className="size-4" aria-hidden="true" />
              Terapkan
            </Button>
          </div>
        </div>

        {/* 8 — Clone percakapan */}
        <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Copy className="size-3.5" aria-hidden="true" />
            Salin/pindahkan percakapan ke user lain
          </p>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Target user</Label>
              <Select value={cloneTarget} onValueChange={setCloneTarget}>
                <SelectTrigger className="h-9 text-xs" aria-label="Target kloning">
                  <SelectValue placeholder="Pilih user…" />
                </SelectTrigger>
                <SelectContent>
                  {partners
                    .filter((p) => p.id !== target.id)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={applyClone}
              disabled={!cloneTarget || !convId}
            >
              <Copy className="size-4" aria-hidden="true" />
              {cloneMove ? "Pindah" : "Salin"}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={cloneMove}
              onChange={(e) => setCloneMove(e.target.checked)}
              className="size-3.5 accent-violet-600"
            />
            Mode pindah (pesan asal dihapus setelah disalin)
          </label>
        </div>
      </div>

      {/* Log aksi lokal */}
      {log.length > 0 ? (
        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Log aksi (lokal)</p>
          <ul className="space-y-0.5">
            {log.slice(0, 8).map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-[11px]">
                <span className="shrink-0 font-mono text-muted-foreground">{e.at}</span>
                <span className={cn("min-w-0", e.ok ? "" : "text-red-600 dark:text-red-400")}>
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
