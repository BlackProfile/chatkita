"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronUp,
  Leaf,
  Loader2,
  LogOut,
  MessageCircleMore,
  Mic,
  Paperclip,
  Pin,
  Search,
  SendHorizonal,
  ShieldCheck,
  Smile,
  Type,
  X,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { MediaViewer, FileKindIcon, type ViewerMedia } from "@/components/chat/media-viewer";
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
  type OlderMessagesAck,
  type PartnerInfo,
  type PinUpdatePayload,
  type PublicSettingsAck,
  type SetPinAck,
  type TranslateAck,
  type UserAuthAck,
} from "@/lib/chat-types";
import {
  avatarColorClass,
  canEditMessage,
  compressImageToBlobs,
  FONT_SCALES,
  formatFileSize,
  formatLastSeen,
  initials,
  readDataSaver,
  readFontScale,
  resolveFileKind,
  saveDataSaver,
  saveFontScale,
  uploadMedia,
  videoPosterBlob,
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

/** Ukuran maksimum lampiran dokumen (mirror POST /api/upload + chat-service). */
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB

const fmtTimer = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

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
  // Messenger mounts client-only (the page gates it behind hydration),
  // so reading localStorage in the initializer is safe.
  // The input is NEVER prefilled — a returning user gets a one-tap
  // "Lanjut chat sebagai …" button instead (clearer than a mystery value
  // sitting in the field).
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState(() => readLastName());
  const [pinEntry, setPinEntry] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);

  const [adminReadId, setAdminReadId] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // v8 — foto menunggu kirim: blob full terkompresi + thumbnail + pratinjau.
  const [pendingImage, setPendingImage] = useState<{
    previewUrl: string;
    full: Blob;
    thumb: Blob;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Lampiran dokumen/video/audio: file terpilih → dialog konfirmasi → upload.
  const [pendingFile, setPendingFile] = useState<{ file: File } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // v8 — pagination riwayat + mode hemat data.
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  // v8 — pesan kesalahan kirim yang lebih spesifik (rate limit / kuota).
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  // Viewer media full-screen (pengganti lightbox gambar saja).
  const [viewer, setViewer] = useState<ViewerMedia | null>(null);

  // Web Push VAPID public key (null = push unavailable).
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pinnedMsg, setPinnedMsg] = useState<{ id: number; snippet: string } | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
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

  // v8 — mode hemat data dibaca sekali saat mount (localStorage).
  useEffect(() => {
    setDataSaver(readDataSaver());
  }, []);

  const toggleDataSaver = () =>
    setDataSaver((v) => {
      const next = !v;
      saveDataSaver(next);
      return next;
    });

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
            setHasMore(res.hasMore);
            setAdminReadId(res.partnerLastReadId);
            setPinnedMsg(res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null);
            socketRef.current?.emit("messages:read", { conversationId: id });
          }
        }
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      // Pre-login: fetch the Web Push VAPID public key (v6 shape:
      // { ok, pushPublicKey }) so it is ready right after login.
      if (!meRef.current) {
        socket.emit("public:settings", {}, (res: AckOf<PublicSettingsAck>) => {
          if (res.ok && res.pushPublicKey) setPushPublicKey(res.pushPublicKey);
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
            setHasMore(res.hasMore);
            setAdminReadId(res.partnerLastReadId);
            // Push opt-in + pinned banner + draft (the ack carries the
            // VAPID key directly in the v6 contract).
            setPushPublicKey(res.pushPublicKey || null);
            setPinnedMsg(
              res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null
            );
            setInput(readDraft("user", res.user.id));
            void subscribeToPush(socket, res.pushPublicKey);
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

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs live-event race).
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
          // Auto-clear after 8s in case a stop event is missed.
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

  /**
   * Login. `override` lets the "Lanjut chat sebagai …" button authenticate
   * with the stored last name without putting it back into the input.
   */
  const handleAuth = (override?: string) => {
    const socket = socketRef.current;
    const trimmed = (override ?? name).trim();
    if (!socket || !connected || !trimmed) return;
    if (override && override !== name) setName(override);
    setAuthError(null);
    socket.emit(
      "user:auth",
      {
        name: trimmed,
        pin: needsPin && pinEntry ? pinEntry : undefined,
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
          setPushPublicKey(res.pushPublicKey || null);
          setPinnedMsg(res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null);
          setInput(readDraft("user", res.user.id));
          void subscribeToPush(socket, res.pushPublicKey || pushPublicKey || "");
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
    setHasMore(false);
    setLoadingOlder(false);
    setSendErrorDetail(null);
    setPartnerTyping(false);
    setAuthError(null);
    setInput("");
    setSendError(false);
    setReplyTo(null);
    setEditing(null);
    setPinnedMsg(null);
    setPushPublicKey(null);
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    setPendingFile(null);
    setUploading(false);
    setFileError(null);
    setViewer(null);
    setSearchOpen(false);
    setSearchQuery("");
    setTitleUnread(0);
    hiddenUnreadRef.current = 0;
    // Login card comes back EMPTY — a returning user simply taps the
    // "Lanjut chat sebagai …" button (server matches the account by
    // case-insensitive name and returns the full history).
    setName("");
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const emitMessage = (
    content: string,
    type: "text" | "image" | "voice" | "file",
    extra: {
      durationMs?: number;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      thumbUrl?: string;
    } = {}
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
        if (!res.ok) {
          setSendError(true);
          setSendErrorDetail(
            res.error === "RATE_LIMITED"
              ? "Terlalu sering mengirim — tunggu sebentar."
              : res.error === "QUOTA_EXCEEDED"
                ? "Kuota penyimpanan akun penuh (250 MB)."
                : null
          );
        }
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

  /* v8 — pagination: muat satu halaman riwayat yang lebih lama, lalu
   * kembalikan posisi scroll ke pesan yang sama (tanpa lompat). */
  const loadOlder = () => {
    const first = messages[0];
    const id = conversationIdRef.current;
    if (!first || !id || loadingOlder) return;
    setLoadingOlder(true);
    const container = scrollRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    socketRef.current?.emit(
      "messages:older",
      { conversationId: id, beforeId: first.id },
      (res: AckOf<OlderMessagesAck>) => {
        setLoadingOlder(false);
        if (!res.ok) return;
        setHasMore(res.hasMore);
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const older = res.messages.filter((m) => !seen.has(m.id));
          return older.length > 0 ? [...older, ...prev] : prev;
        });
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    );
  };

  /* v8 — foto: kompres di browser (full ≤1600px + thumb ≤320px), keduanya
   * diunggah ke disk; pesan hanya membawa URL + metadata (DB tetap ramping).
   * Gagal decode (mis. HEIC) → unggah file asli via jalur lampiran. */
  const handleImagePick = async (file: File | undefined | null) => {
    if (!file) return;
    setImageError(null);
    try {
      const blobs = await compressImageToBlobs(file);
      setPendingImage({ ...blobs, previewUrl: URL.createObjectURL(blobs.thumb) });
    } catch {
      if (file.size <= MAX_FILE_SIZE) {
        setPendingFile({ file });
      } else {
        setImageError("Foto terlalu besar (maks 25 MB).");
      }
    }
  };

  const sendImage = async () => {
    const target = pendingImage;
    if (!target || uploading) return;
    setUploading(true);
    setImageError(null);
    try {
      const stamp = Date.now();
      const [fullMeta, thumbMeta] = await Promise.all([
        uploadMedia(new File([target.full], `foto-${stamp}.jpg`, { type: "image/jpeg" })),
        uploadMedia(new File([target.thumb], `foto-${stamp}-thumb.jpg`, { type: "image/jpeg" })),
      ]);
      if (
        emitMessage(fullMeta.url, "image", {
          fileName: fullMeta.fileName,
          mimeType: fullMeta.mimeType,
          fileSize: fullMeta.size,
          thumbUrl: thumbMeta.url,
        })
      ) {
        URL.revokeObjectURL(target.previewUrl);
        setPendingImage(null);
      } else {
        setImageError(sendErrorDetail ?? "Pesan gagal terkirim, coba lagi.");
      }
    } catch {
      setImageError("Gagal mengunggah foto.");
    } finally {
      setUploading(false);
    }
  };

  /* Satu tombol lampiran: semua jenis file. Foto → alur kompres+thumbnail;
   * sisanya → dialog unggah (maks 25MB), video ikut dibuatkan poster. */
  const handleFilePick = (file: File | undefined | null) => {
    if (!file) return;
    setFileError(null);
    if (file.type.startsWith("image/")) {
      void handleImagePick(file);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File terlalu besar (maks 25 MB).");
      return;
    }
    setPendingFile({ file });
  };

  const sendFile = async () => {
    const target = pendingFile;
    if (!target || uploading) return;
    setUploading(true);
    setFileError(null);
    try {
      const meta = await uploadMedia(target.file);
      // Poster video (best-effort — kegagalan tidak memblokir pengiriman).
      let thumbUrl: string | undefined;
      if (resolveFileKind(meta.mimeType, meta.fileName) === "video") {
        try {
          const poster = await videoPosterBlob(target.file);
          if (poster) {
            const posterMeta = await uploadMedia(
              new File([poster], `${meta.fileName}-thumb.jpg`, { type: "image/jpeg" })
            );
            thumbUrl = posterMeta.url;
          }
        } catch {
          /* abaikan — pesan tetap terkirim tanpa poster */
        }
      }
      const sent = emitMessage(meta.url, "file", {
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        fileSize: meta.size,
        ...(thumbUrl ? { thumbUrl } : {}),
      });
      if (sent) setPendingFile(null);
      else setFileError(sendErrorDetail ?? "Pesan gagal terkirim, coba lagi.");
    } catch {
      setFileError("Gagal mengunggah file.");
    } finally {
      setUploading(false);
    }
  };

  /* v8 — pesan suara direkam 24 kbps mono lalu DIUNGGAH ke disk; server
   * membaca file dari db/media untuk transkripsi. */
  const sendVoice = async () => {
    const result = await recorder.stop();
    if (!result) return;
    try {
      const stamp = Date.now();
      const ext = result.mimeType.includes("mp4")
        ? "m4a"
        : result.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
      const meta = await uploadMedia(
        new File([result.blob], `pesan-suara-${stamp}.${ext}`, { type: result.mimeType })
      );
      emitMessage(meta.url, "voice", {
        durationMs: result.durationMs,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        fileSize: meta.size,
      });
    } catch {
      setSendError(true);
    }
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
              {lastName ? (
                <>
                  <Button
                    type="button"
                    className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                    disabled={!connected}
                    onClick={() => handleAuth(lastName)}
                  >
                    {connected
                      ? `Lanjut chat sebagai “${lastName}”`
                      : "Menghubungkan…"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Lanjutkan percakapan Anda sebelumnya — riwayat pesan tetap ada
                  </p>
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">
                      atau masuk sebagai nama lain
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="messenger-name">
                  {lastName ? "Nama baru" : "Nama Anda"}
                </Label>
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
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              <Button
                type="submit"
                variant={lastName ? "outline" : "default"}
                className={
                  lastName
                    ? "h-11 w-full"
                    : "h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                }
                disabled={!connected || !name.trim() || (needsPin && !pinEntry)}
              >
                {connected ? "Masuk" : "Menghubungkan…"}
              </Button>
              {!lastName ? (
                <p className="text-center text-xs text-muted-foreground">
                  Nama yang sama = akun yang sama, jadi Anda bisa lanjut chat kapan saja
                </p>
              ) : null}
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
                dataSaver ? "text-emerald-600" : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={dataSaver}
              aria-label={dataSaver ? "Matikan hemat data" : "Aktifkan hemat data"}
              title="Hemat data: media berat dimuat manual"
              onClick={toggleDataSaver}
            >
              <Leaf className="size-4" aria-hidden="true" />
            </Button>
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
            {/* v8 — pagination: muat pesan lebih lama saat ada halaman sebelumnya */}
            {hasMore && visibleMessages.length > 0 ? (
              <div className="flex justify-center pb-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full text-xs text-muted-foreground"
                  disabled={loadingOlder}
                  onClick={loadOlder}
                >
                  {loadingOlder ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ChevronUp className="size-4" aria-hidden="true" />
                  )}
                  Muat pesan lama
                </Button>
              </div>
            ) : null}
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
              visibleMessages.map((m) => (
                <ChatBubble
                  key={m.id}
                  messageId={m.id}
                  content={m.content}
                  createdAt={m.createdAt}
                  side={m.senderId === me.userId ? "right" : "left"}
                  type={m.type}
                  deleted={!!m.deletedAt}
                  fileName={m.fileName}
                  fileSize={m.fileSize}
                  mimeType={m.mimeType}
                  thumbUrl={m.thumbUrl}
                  mediaExpired={!!m.mediaExpiredAt}
                  dataSaver={dataSaver}
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
                  onMediaOpen={setViewer}
                  onReact={(emoji) => handleReact(m, emoji)}
                  onEdit={() => handleEditStart(m)}
                  onTranslate={
                    m.senderId !== me.userId && m.type === "text" && !m.deletedAt
                      ? () => handleTranslate(m)
                      : undefined
                  }
                />
              ))
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

        {/* Send / image / file errors */}
        {sendError || imageError || fileError ? (
          <p className="px-4 pb-1 text-xs text-destructive">
            {fileError ?? imageError ?? sendErrorDetail ?? "Pesan gagal terkirim, coba lagi."}
          </p>
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
                      : replyTo.type === "file"
                        ? `📎 ${replyTo.fileName ?? "File"}`
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
              src={pendingImage.previewUrl}
              alt="Pratinjau foto"
              className="size-10 rounded-md object-cover"
            />
            <p className="flex-1 text-xs text-muted-foreground">Foto siap dikirim</p>
            <button
              type="button"
              aria-label="Batal kirim foto"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                URL.revokeObjectURL(pendingImage.previewUrl);
                setPendingImage(null);
              }}
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
                className="hidden"
                aria-label="Pilih foto atau file"
                onChange={(e) => {
                  handleFilePick(e.target.files?.[0]);
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
                aria-label="Lampirkan foto atau file"
                title="Lampirkan foto atau file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-5" aria-hidden="true" />
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
                  disabled={!connected || uploading || (!input.trim() && !pendingImage)}
                  onClick={() => {
                    if (pendingImage) void sendImage();
                    else handleSend();
                  }}
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

      {/* Dialog konfirmasi lampiran file (unggah → kirim) */}
      {pendingFile ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !uploading) setPendingFile(null);
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileKindIcon
                  mimeType={pendingFile.file.type}
                  fileName={pendingFile.file.name}
                  className="size-5 text-emerald-600"
                />
                Kirim file
              </DialogTitle>
              <DialogDescription>
                File ini akan dikirim ke {partner?.name ?? "Admin"}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-3 rounded-xl border bg-muted/60 p-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                <FileKindIcon
                  mimeType={pendingFile.file.type}
                  fileName={pendingFile.file.name}
                  className="size-5"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium leading-snug">
                  {pendingFile.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(pendingFile.file.size)}
                </p>
              </div>
            </div>
            {uploading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Mengunggah…
              </p>
            ) : null}
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-11 sm:min-w-24"
                disabled={uploading}
                onClick={() => setPendingFile(null)}
              >
                Batal
              </Button>
              <Button
                className="h-11 bg-emerald-600 text-white hover:bg-emerald-600/90 sm:min-w-28"
                disabled={uploading}
                onClick={() => void sendFile()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Mengunggah…
                  </>
                ) : (
                  "Kirim"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Viewer media full-screen (foto/video/audio/PDF/dokumen) */}
      <MediaViewer media={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
