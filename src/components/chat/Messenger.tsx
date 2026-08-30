"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ImagePlus,
  LogOut,
  MessageCircleMore,
  Mic,
  Pin,
  Search,
  SendHorizonal,
  ShieldCheck,
  Smile,
  Star,
  Type,
  X,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { TypingDots } from "@/components/chat/TypingDots";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { createChatSocket } from "@/lib/chat-socket";
import { playBlip, setTitleUnread } from "@/lib/chat-notify";
import { onInstallAvailability, promptInstall, subscribeToPush } from "@/lib/chat-push";
import {
  ADMIN_ID,
  CHAT_LAST_NAME_KEY,
  CHAT_SESSION_KEY,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  draftKey,
  type AckOf,
  type ChatErrorAck,
  type ChatMessage,
  type ConversationOverview,
  type HistoryAck,
  type MessageAck,
  type MessageUpdatePayload,
  type PartnerInfo,
  type PinUpdatePayload,
  type PublicSettings,
  type RatingAck,
  type SetPinAck,
  type TranslateAck,
  type UserAuthAck,
} from "@/lib/chat-types";
import {
  avatarColorClass,
  canEditMessage,
  FONT_SCALES,
  formatLastSeen,
  initials,
  readFontScale,
  saveFontScale,
  type FontScale,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface StoredUser {
  userId: string;
  name: string;
}

/** Read (and validate) the persisted login. Client-side only. */
function readStoredUser(): StoredUser | null {
  try {
    const raw = window.localStorage.getItem(CHAT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUser> | null;
    if (
      parsed &&
      typeof parsed.userId === "string" &&
      parsed.userId.length > 0 &&
      typeof parsed.name === "string" &&
      parsed.name.length > 0
    ) {
      return { userId: parsed.userId, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Name this browser previously logged in with. Unlike the session it
 * survives logout, so returning users can continue their conversation
 * without retyping (or mistyping) their name.
 */
function readLastName(): string {
  try {
    return window.localStorage.getItem(CHAT_LAST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastName(name: string): void {
  try {
    window.localStorage.setItem(CHAT_LAST_NAME_KEY, name);
  } catch {
    /* storage unavailable — the hint simply stays empty */
  }
}

const FONT_SCALE_LABELS: { key: FontScale; label: string }[] = [
  { key: "sm", label: "Kecil" },
  { key: "md", label: "Sedang" },
  { key: "lg", label: "Besar" },
];

function readDraft(scope: string, id: string): string {
  try {
    return window.localStorage.getItem(draftKey(scope, id)) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(scope: string, id: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(draftKey(scope, id), value);
    else window.localStorage.removeItem(draftKey(scope, id));
  } catch {
    /* ignore */
  }
}

/** Downscale + compress an image file to a JPEG data URL the server accepts. */
async function fileToDataUrl(file: File): Promise<string> {
  if (file.size > 6 * 1024 * 1024) throw new Error("too-large");
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const fmtTimer = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* Star rating card (v5 — rendered for rating_request system notices)  */
/* ------------------------------------------------------------------ */

function RatingCard({
  socketRef,
  conversationId,
}: {
  socketRef: React.RefObject<Socket | null>;
  conversationId: string;
}) {
  const [hover, setHover] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-emerald-600/10 px-4 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          ⭐ Terima kasih, penilaian Anda tercatat!
        </p>
      </div>
    );
  }

  const submit = (stars: number) => {
    const socket = socketRef.current;
    if (!socket || sending) return;
    setSending(true);
    socket.emit(
      "rating:submit",
      { conversationId, stars },
      (res: AckOf<RatingAck>) => {
        setSending(false);
        if (res.ok) setDone(true);
      }
    );
  };

  return (
    <div className="flex justify-center">
      <div className="rounded-xl border bg-card px-4 py-3 text-center shadow-sm">
        <p className="text-sm font-medium">Bagaimana layanan kami?</p>
        <p className="mb-2 text-xs text-muted-foreground">Ketuk bintang untuk menilai</p>
        <div className="flex justify-center gap-1" role="group" aria-label="Beri penilaian bintang">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={sending}
              aria-label={`Beri ${n} bintang`}
              className="rounded-full p-1 transition-transform hover:scale-110 disabled:opacity-50"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => submit(n)}
            >
              <Star
                className={cn(
                  "size-7",
                  (hover || 5) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                )}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PIN dialog (protect this account with a 4–8 digit code)             */
/* ------------------------------------------------------------------ */

function PinDialog({
  open,
  onOpenChange,
  socketRef,
  hasPin,
  onHasPin,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socketRef: React.RefObject<Socket | null>;
  hasPin: boolean;
  onHasPin: (v: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Mounted only while open (see render below) — state resets on remount.

  const submit = () => {
    const socket = socketRef.current;
    if (!socket || !/^\d{4,8}$/.test(pin)) {
      setError("PIN harus 4–8 angka.");
      return;
    }
    socket.emit(
      "user:setpin",
      { pin },
      (res: AckOf<SetPinAck>) => {
        if (res.ok) {
          onHasPin(res.hasPin);
          setSaved(true);
          setError(null);
          setTimeout(() => onOpenChange(false), 700);
        } else {
          setError(res.error === "INVALID_PIN" ? "PIN harus 4–8 angka." : "Gagal, coba lagi.");
        }
      }
    );
  };

  const clear = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("user:setpin", { pin: null }, (res: AckOf<SetPinAck>) => {
      if (res.ok) {
        onHasPin(false);
        onOpenChange(false);
      } else setError("Gagal menghapus PIN.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
            Kunci Akun dengan PIN
          </DialogTitle>
          <DialogDescription>
            {hasPin
              ? "Akun Anda terlindungi PIN. Ganti atau hapus PIN di sini."
              : "Tanpa PIN, siapa pun yang tahu nama Anda bisa membuka chat ini. Pasang PIN 4–8 angka agar lebih aman."}
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <p className="text-sm font-medium text-emerald-600">PIN tersimpan ✓</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pin-entry">PIN baru (4–8 angka)</Label>
              <Input
                id="pin-entry"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                placeholder="••••"
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ""));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
            <div className="flex gap-2">
              <Button
                className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                onClick={submit}
              >
                Simpan PIN
              </Button>
              {hasPin ? (
                <Button variant="outline" className="h-10" onClick={clear}>
                  Hapus PIN
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Messenger                                                           */
/* ------------------------------------------------------------------ */

/**
 * ChatKita Messenger (sisi user) — chat 1-on-1 dengan Admin, seperti
 * aplikasi pesan biasa: cukup nama untuk masuk, langsung terhubung.
 * User lain tidak pernah terlihat di sini (isolasi dijamin server).
 * Owns its own socket connection, always disconnected on unmount.
 */
export function Messenger() {
  const [me, setMe] = useState<StoredUser | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  // Prefilled with the last used name so a returning user only taps Masuk.
  // Messenger mounts client-only (the page gates it behind hydration),
  // so reading localStorage in the initializer is safe.
  const [name, setName] = useState(() => readLastName());
  const [lastName, setLastName] = useState(() => readLastName());
  const [pinEntry, setPinEntry] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  // v5 — pre-login public config (pre-chat topics come from the server).
  const [loginTopics, setLoginTopics] = useState<string[]>([]);

  const [adminReadId, setAdminReadId] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // v5 — menu chips / pre-chat topic / pinned banner / edit / font / push
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [menuChipsOpen, setMenuChipsOpen] = useState(true);
  const [pinnedMsg, setPinnedMsg] = useState<{ id: number; snippet: string } | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [topic, setTopic] = useState("");
  const [installAvailable, setInstallAvailable] = useState(false);
  const [translatingId, setTranslatingId] = useState<number | null>(null);

  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<StoredUser | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const hiddenUnreadRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const translatingIdRef = useRef<number | null>(null);

  const recorder = useVoiceRecorder();

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Socket lifecycle (recreated on logout via `epoch`)                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    // Restore persisted login (ref only) so the first `connect` re-auths
    // immediately. State is set inside the connect ack.
    meRef.current = readStoredUser();

    const socket = createChatSocket();
    socketRef.current = socket;

    const loadHistory = (id: string) => {
      socket.emit(
        "messages:history",
        { conversationId: id },
        (res: AckOf<HistoryAck>) => {
          if (res.ok) {
            setPartner(res.partner);
            setMessages(res.messages);
            setAdminReadId(res.partnerLastReadId);
            setPinnedMsg(res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null);
            socketRef.current?.emit("messages:read", { conversationId: id });
          }
        }
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      // v5 — pre-login config (pre-chat topics for the login card).
      if (!meRef.current) {
        socket.emit("public:settings", {}, (res: { ok: boolean; publicSettings?: PublicSettings }) => {
          if (res.ok && res.publicSettings) setLoginTopics(res.publicSettings.preChatTopics);
        });
      }
      const current = meRef.current;
      if (!current) return;
      // Re-auth on EVERY connect to (re)join the personal room and get
      // the freshest history (also closes reconnect gaps).
      socket.emit(
        "user:auth",
        { name: current.name, userId: current.userId },
        (res: AckOf<UserAuthAck>) => {
          if (res.ok) {
            const next = { userId: res.user.id, name: res.user.name };
            window.localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(next));
            saveLastName(res.user.name);
            setLastName(res.user.name);
            meRef.current = next;
            conversationIdRef.current = res.conversationId;
            setMe(next);
            setHasPin(res.user.hasPin ?? false);
            setNeedsPin(false);
            setPinEntry("");
            setConversationId(res.conversationId);
            setPartner(res.partner);
            setMessages(res.messages);
            setAdminReadId(res.partnerLastReadId);
            // v5 — public config, pinned banner, draft, push opt-in.
            setPublicSettings(res.publicSettings);
            setPinnedMsg(
              res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null
            );
            setInput(readDraft("user", res.user.id));
            setMenuChipsOpen(true);
            void subscribeToPush(socket, res.publicSettings.pushPublicKey);
          } else {
            // Stored login no longer valid — drop it, back to the form.
            window.localStorage.removeItem(CHAT_SESSION_KEY);
            meRef.current = null;
            conversationIdRef.current = null;
            setMe(null);
            setConversationId(null);
            setPartner(null);
            setMessages([]);
            setAuthError(
              res.error === "NAME_RESERVED"
                ? "Nama “Admin” tidak tersedia — coba nama lain."
                : "Sesi berakhir. Silakan masuk kembali."
            );
          }
        }
      );
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // Recovery: if the current conversation disappears server-side
    // (e.g. database reset), hop to the one conversation we do have.
    socket.on("conversations:update", (list: ConversationOverview[]) => {
      const current = conversationIdRef.current;
      if (current && !list.some((c) => c.id === current) && list.length > 0) {
        const next = list[0];
        conversationIdRef.current = next.id;
        setConversationId(next.id);
        loadHistory(next.id);
      }
    });

    // v5 — pinned-message banner updates (admin pins/unpins).
    socket.on("conversation:update", (p: PinUpdatePayload) => {
      if (p.conversationId !== conversationIdRef.current) return;
      setPinnedMsg(p.pinned ? { id: p.pinned.id, snippet: p.pinned.snippet } : null);
    });

    // v5 — live public config (admin enabled the chatbot menu etc.).
    socket.on("public:settings:update", (s: PublicSettings) => {
      setPublicSettings(s);
      setLoginTopics(s.preChatTopics);
    });

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs broadcast race).
    socket.on("message:new", (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // The user's single conversation is always the visible one.
      socketRef.current?.emit("messages:read", {
        conversationId: msg.conversationId,
      });
      if (atBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else if (msg.senderId !== meRef.current?.userId) {
        setNewCount((c) => c + 1);
      }
      if (document.hidden) {
        hiddenUnreadRef.current += 1;
        playBlip();
        setTitleUnread(hiddenUnreadRef.current);
      }
    });

    // Delete tombstones + late voice transcripts + edits/translations/reactions.
    socket.on("message:updated", (u: MessageUpdatePayload) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === u.id
            ? {
                ...m,
                content: u.content ?? m.content,
                deletedAt: u.deletedAt ?? m.deletedAt,
                transcript: u.transcript ?? m.transcript,
                editedAt: u.editedAt ?? m.editedAt,
                translation: u.translation ?? m.translation,
                reactions: u.reactions ?? m.reactions,
              }
            : m
        )
      );
      if (u.translation && u.id === translatingIdRef.current) {
        translatingIdRef.current = null;
        setTranslatingId(null);
      }
    });

    // Live ✓✓: the admin read up to `lastReadMessageId`.
    socket.on(
      "read:update",
      (r: { conversationId: string; userId: string; lastReadMessageId: number }) => {
        if (r.userId === ADMIN_ID) setAdminReadId(r.lastReadMessageId);
      }
    );

    socket.on(
      "partner:typing",
      ({ isTyping }: { conversationId: string; isTyping: boolean }) => {
        if (partnerTypingTimerRef.current) {
          clearTimeout(partnerTypingTimerRef.current);
          partnerTypingTimerRef.current = null;
        }
        setPartnerTyping(isTyping);
        if (isTyping) {
          // Auto-clear after 8s in case a stop event is missed (AI path).
          partnerTypingTimerRef.current = setTimeout(() => {
            partnerTypingTimerRef.current = null;
            setPartnerTyping(false);
          }, 8000);
        }
      }
    );

    // Users only ever receive presence for the admin (server-enforced).
    socket.on(
      "presence:update",
      ({
        userId,
        online,
        lastSeenAt,
      }: {
        userId: string;
        online: boolean;
        lastSeenAt: string | null;
      }) => {
        if (userId !== ADMIN_ID) return;
        setPartner((prev) =>
          prev
            ? { ...prev, online, lastSeenAt: online ? null : lastSeenAt }
            : prev
        );
      }
    );

    // Leaving the tab clears the unread title badge.
    const onVisible = () => {
      if (!document.hidden) {
        hiddenUnreadRef.current = 0;
        setTitleUnread(0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // v5 — PWA install prompt availability.
    const offInstall = onInstallAvailability(setInstallAvailable);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      offInstall();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (partnerTypingTimerRef.current)
        clearTimeout(partnerTypingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch, scrollToBottom]);

  /* Jump to latest whenever the conversation switches. */
  useEffect(() => {
    atBottomRef.current = true;
    requestAnimationFrame(() => {
      setNewCount(0);
      scrollToBottom();
    });
  }, [conversationId, scrollToBottom]);

  /* Clear the tab badge when the user reads while visible. */
  useEffect(() => {
    if (!document.hidden) setTitleUnread(0);
  }, [messages]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleAuth = () => {
    const socket = socketRef.current;
    const trimmed = name.trim();
    if (!socket || !connected || !trimmed) return;
    setAuthError(null);
    socket.emit(
      "user:auth",
      {
        name: trimmed,
        pin: needsPin && pinEntry ? pinEntry : undefined,
        // v5 — optional pre-chat topic (first login only).
        topic: topic || undefined,
      },
      (res: AckOf<UserAuthAck>) => {
        if (res.ok) {
          const next = { userId: res.user.id, name: res.user.name };
          window.localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(next));
          saveLastName(res.user.name);
          setLastName(res.user.name);
          meRef.current = next;
          conversationIdRef.current = res.conversationId;
          setMe(next);
          setHasPin(res.user.hasPin ?? false);
          setNeedsPin(false);
          setPinEntry("");
          setConversationId(res.conversationId);
          setPartner(res.partner);
          setMessages(res.messages);
          setAdminReadId(res.partnerLastReadId);
          setPublicSettings(res.publicSettings);
          setPinnedMsg(res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null);
          setInput(readDraft("user", res.user.id));
          setMenuChipsOpen(true);
          setTopic("");
          void subscribeToPush(socket, res.publicSettings.pushPublicKey);
        } else {
          if (res.error === "PIN_REQUIRED" || res.error === "INVALID_PIN") {
            setNeedsPin(true);
            setAuthError(
              res.error === "PIN_REQUIRED"
                ? "Akun ini dilindungi PIN — masukkan PIN Anda."
                : "PIN salah, coba lagi."
            );
            return;
          }
          setAuthError(
            res.error === "INVALID_NAME"
              ? "Nama tidak valid (1–40 karakter)."
              : res.error === "NAME_RESERVED"
                ? "Nama “Admin” tidak tersedia — coba nama lain."
                : "Terjadi kesalahan, coba lagi."
          );
        }
      }
    );
  };

  const handleLogout = () => {
    // Keep the typed draft so it survives logout → login.
    if (meRef.current) saveDraft("user", meRef.current.userId, input);
    window.localStorage.removeItem(CHAT_SESSION_KEY);
    meRef.current = null;
    conversationIdRef.current = null;
    setMe(null);
    setHasPin(false);
    setConversationId(null);
    setPartner(null);
    setMessages([]);
    setPartnerTyping(false);
    setAuthError(null);
    setInput("");
    setSendError(false);
    setReplyTo(null);
    setEditing(null);
    setPinnedMsg(null);
    setPublicSettings(null);
    setPendingImage(null);
    setSearchOpen(false);
    setSearchQuery("");
    setTitleUnread(0);
    hiddenUnreadRef.current = 0;
    // Login card comes back prefilled with the last used name — one tap
    // on "Lanjut Chat" resumes the previous conversation (server matches
    // the account by case-insensitive name and returns the full history).
    setName(readLastName());
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const emitMessage = (
    content: string,
    type: "text" | "image" | "voice",
    extra: { durationMs?: number } = {}
  ) => {
    const socket = socketRef.current;
    const id = conversationIdRef.current;
    if (!socket || !id || !connected) return false;
    socket.emit(
      "messages:send",
      {
        conversationId: id,
        content,
        type,
        replyToId: replyTo?.id,
        ...extra,
      },
      (res: AckOf<MessageAck>) => {
        if (!res.ok) setSendError(true);
      }
    );
    setReplyTo(null);
    if (meRef.current) saveDraft("user", meRef.current.userId, "");
    return true;
  };

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    // v5 — edit mode: Enter saves the edited message instead of sending.
    if (editing) {
      const target = editing;
      socketRef.current?.emit(
        "message:edit",
        { messageId: target.id, content },
        (res: AckOf<{ ok: true }>) => {
          if (!res.ok) setSendError(true);
        }
      );
      setEditing(null);
      setInput("");
      return;
    }
    setInput("");
    setSendError(false);
    if (!emitMessage(content, "text")) setInput(content);
  };

  /* v5 — reactions / edit / translate on bubbles. */
  const handleReact = (msg: ChatMessage, emoji: string) => {
    socketRef.current?.emit("message:react", { messageId: msg.id, emoji });
  };

  const handleEditStart = (msg: ChatMessage) => {
    setReplyTo(null);
    setEditing(msg);
    setInput(msg.content);
  };

  const handleEditCancel = () => {
    setEditing(null);
    setInput("");
  };

  const handleTranslate = (msg: ChatMessage) => {
    if (translatingIdRef.current) return;
    if (msg.translation) return;
    translatingIdRef.current = msg.id;
    setTranslatingId(msg.id);
    socketRef.current?.emit(
      "message:translate",
      { messageId: msg.id },
      (res: AckOf<TranslateAck>) => {
        if (!res.ok) {
          translatingIdRef.current = null;
          setTranslatingId(null);
        }
      }
    );
  };

  const scrollToMessage = (id: number) => {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleImagePick = async (file: File | undefined | null) => {
    if (!file) return;
    setImageError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setPendingImage(dataUrl);
    } catch (err) {
      setImageError(
        err instanceof Error && err.message === "too-large"
          ? "Foto terlalu besar (maks 6MB)."
          : "Foto tidak bisa dibaca."
      );
    }
  };

  const sendImage = () => {
    if (!pendingImage) return;
    if (emitMessage(pendingImage, "image")) setPendingImage(null);
  };

  const sendVoice = async () => {
    const result = await recorder.stop();
    if (result) emitMessage(result.dataUrl, "voice", { durationMs: result.durationMs });
  };

  const handleDelete = (msg: ChatMessage) => {
    socketRef.current?.emit("messages:delete", { messageId: msg.id });
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setSendError(false);
    if (meRef.current) saveDraft("user", meRef.current.userId, value);
    const socket = socketRef.current;
    const id = conversationIdRef.current;
    if (!socket || !id || !connected) return;
    socket.emit("typing", { conversationId: id, isTyping: true });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit("typing", { conversationId: id, isTyping: false });
    }, 1500);
  };

  /* ---------------------------------------------------------------- */
  /* Render: login                                                     */
  /* ---------------------------------------------------------------- */
  if (!me) {
    return (
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center px-4 pb-6">
        {/* Toggle tema mengambang — layar login tidak punya header */}
        <div className="absolute right-2 top-2">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md rounded-2xl">
          <CardHeader>
            <span
              className="w-fit rounded-lg bg-emerald-600/10 p-3 text-emerald-600"
              aria-hidden="true"
            >
              <MessageCircleMore className="size-6" />
            </span>
            <CardTitle className="text-xl">Masuk Chat</CardTitle>
            <CardDescription>
              Cukup nama Anda untuk langsung terhubung & chat dengan Admin
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleAuth();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="messenger-name">Nama Anda</Label>
                <Input
                  id="messenger-name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="cth. Budi Santoso"
                  autoComplete="name"
                  className="h-11"
                  onChange={(e) => {
                    setName(e.target.value);
                    setAuthError(null);
                  }}
                />
              </div>
              {needsPin ? (
                <div className="space-y-2">
                  <Label htmlFor="messenger-pin">PIN akun</Label>
                  <Input
                    id="messenger-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={pinEntry}
                    placeholder="••••"
                    className="h-11"
                    onChange={(e) => {
                      setPinEntry(e.target.value.replace(/\D/g, ""));
                      setAuthError(null);
                    }}
                  />
                </div>
              ) : null}
              {!lastName && loginTopics.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="messenger-topic">Topik (opsional)</Label>
                  <Select value={topic} onValueChange={setTopic}>
                    <SelectTrigger id="messenger-topic" className="h-11 w-full">
                      <SelectValue placeholder="Pilih kebutuhan Anda…" />
                    </SelectTrigger>
                    <SelectContent>
                      {loginTopics.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!connected || !name.trim() || (needsPin && !pinEntry)}
              >
                {connected
                  ? lastName && name.trim().toLowerCase() === lastName.toLowerCase()
                    ? "Lanjut Chat"
                    : "Masuk"
                  : "Menghubungkan…"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {lastName
                  ? `Lanjutkan chat sebelumnya sebagai “${lastName}” — riwayat pesan Anda tetap ada`
                  : "Nama yang sama = akun yang sama, jadi Anda bisa lanjut chat kapan saja"}
              </p>
              {installAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full"
                  onClick={() => promptInstall()}
                >
                  📲 Install aplikasi di perangkat ini
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: full-screen 1-on-1 chat with Admin                        */
  /* ---------------------------------------------------------------- */
  const partnerStatus = partnerTyping
    ? "sedang mengetik…"
    : partner?.online
      ? "Online"
      : formatLastSeen(partner?.lastSeenAt);

  const query = searchQuery.trim().toLowerCase();
  const visibleMessages = query
    ? messages.filter((m) =>
        (m.type === "text" ? m.content : (m.transcript ?? "")).toLowerCase().includes(query)
      )
    : messages;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Reconnecting strip */}
        {!connected ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Koneksi terputus — mencoba menyambung ulang…
          </p>
        ) : null}

        {/* Chat header */}
        <div className="flex shrink-0 items-center gap-2 border-b p-3">
          <span className="relative shrink-0">
            <Avatar className="size-10">
              <AvatarFallback
                className={cn(
                  "text-sm font-semibold text-white",
                  avatarColorClass(partner?.name ?? "Admin")
                )}
              >
                {initials(partner?.name ?? "Admin")}
              </AvatarFallback>
            </Avatar>
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
                partner?.online ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">
              {partner?.name ?? "Admin"}
            </p>
            <p
              className={cn(
                "truncate text-xs",
                partnerTyping || partner?.online
                  ? "text-emerald-600"
                  : "text-muted-foreground"
              )}
            >
              {partnerStatus}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label={searchOpen ? "Tutup pencarian" : "Cari pesan"}
              onClick={() => {
                setSearchOpen((v) => !v);
                setSearchQuery("");
              }}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-foreground"
                  aria-label="Ukuran huruf"
                >
                  <Type className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Ukuran huruf</DropdownMenuLabel>
                {(
                  FONT_SCALE_LABELS
                ).map((o) => (
                  <DropdownMenuItem
                    key={o.key}
                    onClick={() => {
                      setFontScale(o.key);
                      saveFontScale(o.key);
                    }}
                    className={cn(fontScale === o.key && "bg-accent")}
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-9",
                hasPin ? "text-emerald-600" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Kunci akun dengan PIN"
              onClick={() => setPinOpen(true)}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
            </Button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Keluar"
              onClick={handleLogout}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Search bar */}
        {searchOpen ? (
          <div className="shrink-0 border-b bg-muted/40 p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={searchQuery}
                placeholder="Cari isi pesan…"
                aria-label="Cari pesan"
                className="h-9 pl-9 pr-8"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  aria-label="Bersihkan pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            {query ? (
              <p className="px-1 pt-1 text-xs text-muted-foreground">
                {visibleMessages.length} pesan cocok
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Pinned message banner (v5) */}
        {pinnedMsg ? (
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 border-b bg-amber-500/5 px-3 py-1.5 text-left text-xs"
            onClick={() => scrollToMessage(pinnedMsg.id)}
          >
            <Pin className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {pinnedMsg.snippet}
            </span>
          </button>
        ) : null}

        {/* Messages */}
        <div
          ref={scrollRef}
          className="chat-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            atBottomRef.current = atBottom;
            setShowJump(!atBottom);
            if (atBottom) setNewCount(0);
          }}
        >
          <div
            className="flex w-full flex-col gap-2 p-3 sm:p-4 md:p-6"
            style={{ fontSize: FONT_SCALES[fontScale] }}
          >
            {visibleMessages.length === 0 ? (
              query ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Tidak ada pesan yang cocok dengan “{searchQuery}”.
                </p>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada pesan. Sapa {partner?.name ?? "Admin"}!
                </p>
              )
            ) : (
              visibleMessages.map((m) =>
                m.type === "system" && m.kind === "rating_request" ? (
                  <RatingCard key={m.id} socketRef={socketRef} conversationId={m.conversationId} />
                ) : (
                  <ChatBubble
                    key={m.id}
                    messageId={m.id}
                    content={m.content}
                    createdAt={m.createdAt}
                    side={m.senderId === me.userId ? "right" : "left"}
                    type={m.type}
                    deleted={!!m.deletedAt}
                    read={m.senderId === me.userId && m.id <= adminReadId}
                    replyTo={m.replyTo}
                    replyAuthor={m.replyTo?.senderId === me.userId ? "Anda" : partner?.name}
                    durationMs={m.durationMs}
                    transcript={m.transcript}
                    reactions={m.reactions}
                    myUserId={me.userId}
                    edited={!!m.editedAt}
                    translation={m.translation}
                    translating={translatingId === m.id}
                    pinned={pinnedMsg?.id === m.id}
                    canEdit={canEditMessage(m, me.userId)}
                    onReply={() => setReplyTo(m)}
                    onDelete={() => handleDelete(m)}
                    onImageOpen={setLightbox}
                    onReact={(emoji) => handleReact(m, emoji)}
                    onEdit={() => handleEditStart(m)}
                    onTranslate={
                      m.senderId !== me.userId && m.type === "text" && !m.deletedAt
                        ? () => handleTranslate(m)
                        : undefined
                    }
                  />
                )
              )
            )}
          </div>

          {/* Jump to latest */}
          {showJump ? (
            <Button
              size="icon"
              aria-label={newCount > 0 ? `${newCount} pesan baru` : "Ke pesan terbaru"}
              className="absolute bottom-24 right-4 z-10 size-10 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-600/90"
              onClick={() => {
                setNewCount(0);
                scrollToBottom(true);
              }}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
              {newCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-semibold">
                  {newCount > 9 ? "9+" : newCount}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>

        {/* Typing indicator */}
        {partnerTyping ? (
          <div className="px-4 pb-1">
            <TypingDots label="sedang mengetik…" />
          </div>
        ) : null}

        {/* Send / image errors */}
        {sendError || imageError ? (
          <p className="px-4 pb-1 text-xs text-destructive">
            {imageError ?? "Pesan gagal terkirim, coba lagi."}
          </p>
        ) : null}

        {/* Chatbot menu chips (v5) — instant self-service answers */}
        {!editing && menuChipsOpen &&
        publicSettings?.chatMenuEnabled &&
        (publicSettings.chatMenuItems?.length ?? 0) > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-1.5 chat-scroll">
            <span className="shrink-0 text-xs text-muted-foreground">📋 Menu:</span>
            {publicSettings.chatMenuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="shrink-0 rounded-full border border-emerald-600/40 bg-emerald-600/5 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
                onClick={() => {
                  if (emitMessage(item.label, "text")) setInput("");
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Sembunyikan menu"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setMenuChipsOpen(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {/* Reply chip */}
        {replyTo ? (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border-l-2 border-emerald-500 bg-muted/60 px-2 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-emerald-600">
                Balas ke {replyTo.senderId === me.userId ? "diri sendiri" : (partner?.name ?? "Admin")}
              </p>
              <p className="truncate text-muted-foreground">
                {replyTo.deletedAt
                  ? "Pesan ini dihapus"
                  : replyTo.type === "image"
                    ? "📷 Foto"
                    : replyTo.type === "voice"
                      ? "🎤 Pesan suara"
                      : replyTo.content}
              </p>
            </div>
            <button
              type="button"
              aria-label="Batal membalas"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setReplyTo(null)}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {/* Edit chip (v5) */}
        {editing ? (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border-l-2 border-amber-500 bg-amber-500/10 px-2 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-amber-600">Mengedit pesan</p>
              <p className="truncate text-muted-foreground">{editing.content}</p>
            </div>
            <button
              type="button"
              aria-label="Batal mengedit"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleEditCancel}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {/* Pending image chip */}
        {pendingImage ? (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border bg-muted/60 px-2 py-1.5">
            <img
              src={pendingImage}
              alt="Pratinjau foto"
              className="size-10 rounded-md object-cover"
            />
            <p className="flex-1 text-xs text-muted-foreground">Foto siap dikirim</p>
            <button
              type="button"
              aria-label="Batal kirim foto"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setPendingImage(null)}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {/* Input row (or recording bar) */}
        <div className="relative shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {emojiOpen ? (
            <EmojiPicker
              onPick={(emoji) => {
                setInput((v) => (v + emoji).slice(0, MAX_MESSAGE_LENGTH));
                setEmojiOpen(false);
              }}
              onClose={() => setEmojiOpen(false)}
              className="left-2"
            />
          ) : null}

          {recorder.recording ? (
            <div className="flex items-center gap-3 rounded-full border border-rose-500/40 bg-rose-500/5 px-4 py-2">
              <span className="relative flex size-3 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute inline-flex size-3 animate-ping rounded-full bg-rose-500 opacity-60"
                />
                <span aria-hidden="true" className="relative inline-flex size-3 rounded-full bg-rose-500" />
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {fmtTimer(recorder.elapsedMs)}
              </span>
              <span className="flex-1 text-xs text-muted-foreground">Merekam suara…</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-full text-muted-foreground hover:text-destructive"
                aria-label="Batal rekam"
                onClick={() => recorder.cancel()}
              >
                <X className="size-4" />
              </Button>
              <Button
                size="icon"
                className="size-9 rounded-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                aria-label="Kirim pesan suara"
                onClick={() => void sendVoice()}
              >
                <SendHorizonal className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Pilih foto"
                onChange={(e) => {
                  void handleImagePick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Pilih emoji"
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <Smile className="size-5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Kirim foto"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="size-5" aria-hidden="true" />
              </Button>
              <Input
                value={input}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={editing ? "Simpan hasil edit…" : "Tulis pesan…"}
                aria-label={editing ? "Edit pesan" : "Tulis pesan"}
                autoComplete="off"
                disabled={!connected}
                className="h-11 flex-1"
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                  if (e.key === "Escape" && editing) {
                    e.preventDefault();
                    handleEditCancel();
                  }
                }}
              />
              {input.trim() || pendingImage ? (
                <Button
                  size="icon"
                  className="size-11 shrink-0 bg-emerald-600 text-white hover:bg-emerald-600/90"
                  aria-label="Kirim"
                  disabled={!connected || (!input.trim() && !pendingImage)}
                  onClick={() => (pendingImage ? sendImage() : handleSend())}
                >
                  <SendHorizonal className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Rekam pesan suara"
                  disabled={!connected}
                  onClick={() => void recorder.start()}
                >
                  <Mic className="size-5" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}

          {/* Mic errors */}
          {recorder.error ? (
            <div className="mt-1 flex items-center justify-between px-1">
              <p className="text-xs text-destructive">{recorder.error}</p>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={recorder.clearError}
              >
                tutup
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* PIN dialog — mounted only while open so its state resets */}
      {pinOpen ? (
        <PinDialog
          open
          onOpenChange={setPinOpen}
          socketRef={socketRef}
          hasPin={hasPin}
          onHasPin={setHasPin}
        />
      ) : null}

      {/* Image lightbox */}
      {lightbox ? (
        <div
          role="dialog"
          aria-label="Lihat foto"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Foto diperbesar"
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-4 top-4"
            aria-label="Tutup foto"
            onClick={() => setLightbox(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
