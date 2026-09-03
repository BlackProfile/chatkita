"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  Clock,
  Image as ImageIcon,
  Leaf,
  Loader2,
  LogOut,
  MessageCircleMore,
  Mic,
  Moon,
  MoreVertical,
  Paperclip,
  Pin,
  Plus,
  Search,
  SendHorizonal,
  ShieldCheck,
  Smile,
  Star,
  Sun,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { DaySeparator, dayKey } from "@/components/chat/day-separator";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import {
  MediaViewer,
  FileKindIcon,
  buildMediaGallery,
  viewerStateForMessage,
  type ViewerState,
} from "@/components/chat/media-viewer";
import { TypingDots } from "@/components/chat/TypingDots";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { createChatSocket } from "@/lib/chat-socket";
import { playBlip } from "@/lib/chat-notify";
import { onInstallAvailability, promptInstall, subscribeToPush } from "@/lib/chat-push";
import {
  ADMIN_ID,
  CHAT_LAST_NAME_KEY,
  CHAT_SESSION_KEY,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  draftKey,
  type AckOf,
  type AppSettings,
  type AppSettingsUpdatePayload,
  type ChatErrorAck,
  type ChatErrorCode,
  type ChatMessage,
  type ConversationOverview,
  type ConversationPinnedPayload,
  type ConversationResetPayload,
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
  type UserRestrictedPayload,
} from "@/lib/chat-types";
import {
  avatarColorClass,
  canEditMessage,
  compressImageToBlobs,
  FONT_SCALES,
  formatChatTime,
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

/** Jam 24 jam HH.MM (gaya Indonesia) — banner bisukan + toast terjadwal. */
const fmtHM = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;

/** epoch ms → nilai untuk <input type="datetime-local"> (zona lokal). */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/** v22 — ack `messages:star`: starred = keadaan SETELAH toggle. */
interface MessageStarAck {
  ok: true;
  starred: boolean;
}

/** v22 — ack `messages:starred`: daftar pesan berbintang milik pemanggil. */
interface MessagesStarredAck {
  ok: true;
  messages: ChatMessage[];
}

/** v22 — ack `messages:send` dengan scheduledAt (tambah INVALID_SCHEDULE). */
type ScheduledSendAck =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: ChatErrorCode | "INVALID_SCHEDULE"; remainingSeconds?: number };

/** v22 — ikon per jenis pesan pada baris panel berbintang. */
const STARRED_TYPE_ICONS: Record<string, LucideIcon> = {
  text: MessageCircleMore,
  image: ImageIcon,
  voice: Mic,
  file: Paperclip,
};

/** v22 — snippet satu baris utk panel berbintang: caption bila ada, else isi. */
function starredSnippet(m: ChatMessage): string {
  if (m.type === "image") return m.caption || "Foto";
  if (m.type === "file") return m.caption || m.fileName || "File";
  if (m.type === "voice") return m.transcript || "Pesan suara";
  return m.content;
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
  // Messenger mounts client-only (the page gates it behind hydration),
  // so reading localStorage in the initializer is safe.
  // The input is NEVER prefilled — a returning user gets a one-tap
  // "Lanjut chat sebagai …" button instead (clearer than a mystery value
  // sitting in the field).
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState(() => readLastName());
  // v12 — mode kartu login: lanjut sebagai nama terakhir (1 ketuk), atau isi nama lain
  const [loginMode, setLoginMode] = useState<"continue" | "other">(
    lastName ? "continue" : "other"
  );
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
  // v20 — progres unggah (0–100); null = tidak sedang mengunggah.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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
  // Task 19: membawa GALERI media percakapan (foto+video, urutan pesan)
  // + index item yang dibuka → navigasi geser/panah/chevron di viewer.
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const mediaGallery = useMemo(() => buildMediaGallery(messages), [messages]);

  // Web Push VAPID public key (null = push unavailable).
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pinnedMsg, setPinnedMsg] = useState<{
    id: number;
    snippet: string;
    senderName?: string;
  } | null>(null);
  // v11 — status pembatasan akun dari admin (user:restricted live).
  const [restricted, setRestricted] = useState<UserRestrictedPayload | null>(null);
  /** Tick detik untuk hitung mundur bisukan (hanya jalan saat aktif). */
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** Pin yang disembunyikan user (dismiss visual saja). */
  const [pinHiddenId, setPinHiddenId] = useState<number | null>(null);
  // v10 — pengaturan aplikasi (nama + mode pemeliharaan) dari server.
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [installAvailable, setInstallAvailable] = useState(false);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  // v22 — unread (pesan masuk saat tab tersembunyi) untuk badge judul tab.
  const [unread, setUnread] = useState(0);
  // v22 — panel pesan berbintang (fetch ulang tiap kali dibuka).
  const [starredOpen, setStarredOpen] = useState(false);
  const [starredList, setStarredList] = useState<ChatMessage[]>([]);
  const [starredLoading, setStarredLoading] = useState(false);
  // v22 — kirim terjadwal (dialog dari menu lampiran) + target pembatalan.
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedValue, setSchedValue] = useState("");
  const [cancelSchedId, setCancelSchedId] = useState<number | null>(null);
  const { resolvedTheme, setTheme } = useTheme();

  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<StoredUser | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
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
          if (res.ok) {
            if (res.pushPublicKey) setPushPublicKey(res.pushPublicKey);
            if (res.app) setAppSettings(res.app);
          }
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

    // v20 — Pusat: server me-siarkan reset/pemulihan backup → muat ulang app.
    socket.on("app:reset", () => {
      window.location.reload();
    });

    // v10 — pengaturan aplikasi live (nama + mode pemeliharaan).
    socket.on("app:settings:update", (s: AppSettingsUpdatePayload) => {
      setAppSettings(s);
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
    // v11 — snapshot pin kaya (termasuk nama pengirim) — dikirim setelah versi legacy.
    socket.on("conversation:pinned", (p: ConversationPinnedPayload) => {
      if (p.conversationId !== conversationIdRef.current) return;
      setPinnedMsg(
        p.pinnedMessage
          ? {
              id: p.pinnedMessage.messageId,
              snippet: p.pinnedMessage.snippet,
              senderName: p.pinnedMessage.senderName,
            }
          : null
      );
    });
    // v11 — reset chat oleh admin: kosongkan pesan + sisipkan catatan sistem.
    socket.on("conversation:reset", (p: ConversationResetPayload) => {
      if (p.conversationId !== conversationIdRef.current) return;
      const note: ChatMessage = {
        id: -Date.now(),
        conversationId: p.conversationId,
        senderId: "system",
        content: `🧹 Riwayat chat dihapus oleh admin (${p.deleted} pesan)`,
        createdAt: p.deletedAt,
        type: "system",
      };
      setMessages([note]);
      setHasMore(false);
      setPinnedMsg(null);
      setPinHiddenId(null);
    });
    // v11 — status pembatasan akun (live saat admin mengubah, + saat login bila aktif).
    socket.on("user:restricted", (r: UserRestrictedPayload) => {
      setRestricted(r);
    });

    // v22 — Upsert: umumnya append; pesan terjadwal yang jatuh tempo di-emit
    // ulang server dengan ID yang SAMA (chip ⏰ → pesan final) → ganti, bukan skip.
    socket.on("message:new", (msg: ChatMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        if (idx === -1) return [...prev, msg];
        const next = prev.slice();
        next[idx] = msg;
        return next;
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
      // Pesan sendiri (termasuk echo terjadwal yang dikirim) tidak dihitung unread.
      if (document.hidden && msg.senderId !== meRef.current?.userId) {
        setUnread((c) => c + 1);
        playBlip();
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
                starredBy: u.starredBy ?? m.starredBy,
                /* v25 — Pusat Cheat: waktu pesan diubah admin. */
                createdAt: u.createdAt ?? m.createdAt,
              }
            : m
        )
      );
      if (u.translation && u.id === translatingIdRef.current) {
        translatingIdRef.current = null;
        setTranslatingId(null);
      }
    });

    // v22 — pesan terjadwal dibatalkan (pengirim atau admin) → hapus dr daftar.
    socket.on("message:scheduled_cancelled", (p: { id: number; conversationId: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== p.id));
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

    // Returning to the tab clears the unread title badge.
    const onVisible = () => {
      if (!document.hidden) setUnread(0);
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

  /* v11 — hitung mundur bisukan (interval 1 dtk hanya saat bisukan aktif). */
  const mutedUntilMs = restricted?.mutedUntil ? Date.parse(restricted.mutedUntil) : 0;
  const mutedActive = mutedUntilMs > nowTick;
  useEffect(() => {
    if (!mutedActive) return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [mutedActive]);

  /* Clear the tab badge when the user reads while visible. */
  useEffect(() => {
    if (!document.hidden) setUnread(0);
  }, [messages]);

  /* v22 — badge unread di judul tab: "(n) ChatKita" selama ada backlog. */
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ChatKita` : "ChatKita — Chat Sederhana";
  }, [unread]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  // v24 — jeda singkat "sinkronisasi database" saat login user (per button):
  // klik → tampilkan status sync ±0,9 dtk → auth dikirim → masuk.
  const [loggingIn, setLoggingIn] = useState(false);
  const loginBusyRef = useRef(false);

  /**
   * Login. `override` lets the "Lanjut chat sebagai …" button authenticate
   * with the stored last name without putting it back into the input.
   */
  const handleAuth = (override?: string) => {
    const socket = socketRef.current;
    const trimmed = (override ?? name).trim();
    if (!socket || !connected || !trimmed) return;
    if (loginBusyRef.current) return; // v24 — cegah dobel kirim selama jeda sinkronisasi
    if (override && override !== name) setName(override);
    setAuthError(null);
    // v24 — tunda pengiriman auth sebentar: kesan "menyinkronkan database".
    loginBusyRef.current = true;
    setLoggingIn(true);
    window.setTimeout(() => {
      socket.emit(
        "user:auth",
        {
          name: trimmed,
          pin: needsPin && pinEntry ? pinEntry : undefined,
        },
        (res: AckOf<UserAuthAck>) => {
          loginBusyRef.current = false;
          setLoggingIn(false);
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
                  : res.error === "REGISTRATION_CLOSED"
                    ? "Pendaftaran sedang ditutup admin — masuk dengan akun yang sudah ada."
                    : "Terjadi kesalahan, coba lagi."
            );
          }
        }
      );
    }, 900);
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
    setPinHiddenId(null);
    setRestricted(null);
    setPushPublicKey(null);
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    setPendingFile(null);
    setUploading(false);
    setFileError(null);
    setViewer(null);
    setSearchOpen(false);
    setSearchQuery("");
    setUnread(0);
    // Login card comes back EMPTY — a returning user simply taps the
    // "Lanjut chat sebagai …" button (server matches the account by
    // case-insensitive name and returns the full history).
    setName("");
    // v12 — kartu kembali ke mode "lanjut" memakai lastName terbaru
    // (lastName state sudah diperbarui saat auth sukses).
    setLoginMode(lastName ? "continue" : "other");
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
      /** v20 — caption teks yang ikut media (foto/file). */
      caption?: string;
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
                : res.error === "FROZEN"
                  ? "Akun dibekukan admin."
                  : res.error === "MUTED"
                    ? `Dibisukan admin (tersisa ${res.remainingSeconds ?? 0}s).`
                    : res.error === "SLOW_MODE"
                      ? `Mode lambat: tunggu ${res.remainingSeconds ?? 0}s.`
                      : res.error === "MEDIA_BLOCKED"
                        ? "Media diblokir admin."
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

  /* v22 — toggle bintang: optimistic starredBy (tambah/hapus userId sendiri),
   * lalu dikoreksi dari ack; broadcast message:updated ikut menegaskan. */
  const toggleStar = (messageId: number) => {
    const socket = socketRef.current;
    const myId = meRef.current?.userId;
    if (!socket || !myId) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const list = m.starredBy ?? [];
        const next = list.includes(myId)
          ? list.filter((u) => u !== myId)
          : [...list, myId];
        return { ...m, starredBy: next };
      })
    );
    socket.emit("messages:star", { messageId }, (res: AckOf<MessageStarAck>) => {
      if (!res.ok) {
        toast.error("Gagal mengubah bintang pesan.");
        return;
      }
      // Koreksi dari ack (starred = keadaan setelah toggle di server).
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const others = (m.starredBy ?? []).filter((u) => u !== myId);
          return { ...m, starredBy: res.starred ? [...others, myId] : others };
        })
      );
    });
  };

  /* v22 — batalkan pesan terjadwal milik sendiri (usai konfirmasi ringan). */
  const cancelScheduled = (messageId: number) => {
    socketRef.current?.emit(
      "messages:schedule_cancel",
      { messageId },
      (res: AckOf<{ ok: true }>) => {
        setCancelSchedId(null);
        if (res.ok) {
          // Broadcast message:scheduled_cancelled ikut menghapus — hapus lokal
          // hanya fast-path agar bubble hilang seketika.
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
          toast.success("Pesan terjadwal dibatalkan.");
        } else {
          toast.error("Gagal membatalkan pesan terjadwal.");
        }
      }
    );
  };

  /* v22 — fetch daftar pesan berbintang percakapan ini (tiap panel dibuka). */
  const fetchStarred = () => {
    const id = conversationIdRef.current;
    if (!id) return;
    setStarredLoading(true);
    socketRef.current?.emit(
      "messages:starred",
      { conversationId: id },
      (res: AckOf<MessagesStarredAck>) => {
        setStarredLoading(false);
        if (res.ok) {
          setStarredList(res.messages);
        } else {
          setStarredList([]);
          toast.error("Gagal memuat pesan berbintang.");
        }
      }
    );
  };

  /* v22 — kirim terjadwal dari dialog menu lampiran (epoch ms; server memvalidasi
   * 10 dtk–30 hari). Sukses → toast + kosongkan input; gagal → toast error. */
  const sendScheduled = () => {
    const content = input.trim();
    if (!content) {
      toast.error("Tulis dulu pesan yang ingin dijadwalkan.");
      return;
    }
    const when = new Date(schedValue).getTime();
    const nowMs = Date.now();
    if (!Number.isFinite(when) || when < nowMs + 10_000 || when > nowMs + 30 * 86_400_000) {
      toast.error("Waktu terjadwal harus 10 detik–30 hari dari sekarang.");
      return;
    }
    const socket = socketRef.current;
    const convId = conversationIdRef.current;
    if (!socket || !convId || !connected) {
      toast.error("Koneksi terputus — coba lagi.");
      return;
    }
    socket.emit(
      "messages:send",
      { conversationId: convId, content, type: "text", scheduledAt: Math.round(when) },
      (res: ScheduledSendAck) => {
        if (res.ok) {
          toast.success(`Pesan dijadwalkan pukul ${fmtHM(new Date(when))}`);
          setSchedOpen(false);
          setInput("");
          setSendError(false);
          setSendErrorDetail(null);
          if (meRef.current) saveDraft("user", meRef.current.userId, "");
        } else if (res.error === "INVALID_SCHEDULE") {
          toast.error("Waktu terjadwal tidak valid (10 dtk–30 hari dari sekarang).");
        } else if (res.error === "RATE_LIMITED" || res.error === "SLOW_MODE") {
          toast.error("Terlalu sering mengirim — tunggu sebentar.");
        } else if (res.error === "MUTED") {
          toast.error(`Dibisukan admin (tersisa ${res.remainingSeconds ?? 0}s).`);
        } else if (res.error === "FROZEN") {
          toast.error("Akun dibekukan admin.");
        } else {
          toast.error("Gagal menjadwalkan pesan.");
        }
      }
    );
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
    setUploadProgress(0);
    setImageError(null);
    // v20 — teks yang ada di composer ikut sebagai caption media.
    const captionText = input.trim();
    try {
      const stamp = Date.now();
      const [fullMeta, thumbMeta] = await Promise.all([
        uploadMedia(new File([target.full], `foto-${stamp}.jpg`, { type: "image/jpeg" }), setUploadProgress),
        uploadMedia(new File([target.thumb], `foto-${stamp}-thumb.jpg`, { type: "image/jpeg" })),
      ]);
      if (
        emitMessage(fullMeta.url, "image", {
          fileName: fullMeta.fileName,
          mimeType: fullMeta.mimeType,
          fileSize: fullMeta.size,
          thumbUrl: thumbMeta.url,
          ...(captionText ? { caption: captionText } : {}),
        })
      ) {
        URL.revokeObjectURL(target.previewUrl);
        setPendingImage(null);
        if (captionText) setInput(""); // teks sudah terkirim sebagai caption
      } else {
        setImageError(sendErrorDetail ?? "Pesan gagal terkirim, coba lagi.");
      }
    } catch {
      setImageError("Gagal mengunggah foto.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
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
    setUploadProgress(0);
    setFileError(null);
    // v20 — teks yang ada di composer ikut sebagai caption file.
    const captionText = input.trim();
    try {
      const meta = await uploadMedia(target.file, setUploadProgress);
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
        ...(captionText ? { caption: captionText } : {}),
      });
      if (sent) {
        setPendingFile(null);
        if (captionText) setInput(""); // teks sudah terkirim sebagai caption
      } else {
        setFileError(sendErrorDetail ?? "Pesan gagal terkirim, coba lagi.");
      }
    } catch {
      setFileError("Gagal mengunggah file.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
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
      <div className="login-bg relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4 pb-10">
        {/* Dekorasi latar: blob emerald mengambang */}
        <span
          aria-hidden="true"
          className="animate-float-slow pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-emerald-400/25 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="animate-float-slow pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full bg-teal-400/25 blur-3xl"
          style={{ animationDelay: "-4.5s" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-28 size-40 -translate-x-1/2 rounded-full bg-emerald-300/15 blur-2xl"
        />

        {/* Toggle tema mengambang — layar login tidak punya header */}
        <div className="absolute right-3 top-3 z-10">
          <ThemeToggle />
        </div>

        <div className="relative z-[1] w-full max-w-md">
          {/* Brand */}
          <div className="mb-5 flex flex-col items-center text-center">
            <span
              className="mb-3 flex size-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-emerald-400 via-emerald-600 to-emerald-800 text-white shadow-xl shadow-emerald-600/30 ring-1 ring-white/50 dark:ring-white/10"
              aria-hidden="true"
            >
              <MessageCircleMore className="size-8" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-emerald-950 dark:text-emerald-50">
              {appSettings?.appName || "ChatKita"}
            </h1>
            <p className="mt-1.5 max-w-xs text-sm leading-snug text-emerald-900/65 dark:text-emerald-100/55">
              {appSettings?.welcomeMessage ||
                "Cukup nama Anda untuk langsung terhubung & chat dengan Admin"}
            </p>
          </div>

          {/* Kartu kaca */}
          <div className="glass-card rounded-3xl p-6">
            {appSettings?.maintenanceMode ? (
              <p className="mb-4 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                🛠 Mode pemeliharaan aktif
                {appSettings.maintenanceNote ? ` — ${appSettings.maintenanceNote}` : ""}
              </p>
            ) : null}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (lastName && loginMode === "continue") handleAuth(lastName);
                else handleAuth();
              }}
            >
              {lastName && loginMode === "continue" ? (
                <>
                  {!needsPin ? (
                    <button
                      type="button"
                      disabled={!connected || loggingIn}
                      onClick={() => handleAuth(lastName)}
                      className="group flex w-full items-center gap-3 rounded-2xl border border-emerald-900/10 bg-white/60 p-3 text-left transition-all hover:border-emerald-500/50 hover:bg-white/90 hover:shadow-lg hover:shadow-emerald-600/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:hover:border-emerald-400/40 dark:hover:bg-white/10"
                    >
                      <span
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-md ring-2 ring-white/60 dark:ring-white/10",
                          avatarColorClass(lastName)
                        )}
                        aria-hidden="true"
                      >
                        {initials(lastName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold text-emerald-950 dark:text-emerald-50">
                          {lastName}
                        </span>
                        <span className="block truncate text-xs text-emerald-900/55 dark:text-emerald-100/45">
                          {loggingIn
                            ? "Menyinkronkan database…"
                            : connected
                              ? "Ketuk untuk lanjut — riwayat pesan tetap ada"
                              : "Menghubungkan…"}
                        </span>
                      </span>
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600 transition-all group-hover:bg-emerald-600 group-hover:text-white dark:bg-emerald-400/10 dark:text-emerald-400 dark:group-hover:bg-emerald-400 dark:group-hover:text-emerald-950"
                        aria-hidden="true"
                      >
                        <ArrowRight className="size-4" />
                      </span>
                    </button>
                  ) : (
                    <p className="rounded-xl bg-emerald-900/5 px-3 py-2 text-center text-sm font-medium text-emerald-900/70 dark:bg-white/5 dark:text-emerald-100/70">
                      Melanjutkan sebagai “{lastName}”
                    </p>
                  )}
                  {needsPin ? (
                    <div className="space-y-2">
                      <Label
                        htmlFor="messenger-pin"
                        className="text-emerald-950/80 dark:text-emerald-100/70"
                      >
                        PIN akun
                      </Label>
                      <Input
                        id="messenger-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={pinEntry}
                        placeholder="••••"
                        autoFocus
                        className="h-12 rounded-xl border-emerald-900/10 bg-white/70 tracking-[0.3em] dark:border-white/10 dark:bg-white/5"
                        onChange={(e) => {
                          setPinEntry(e.target.value.replace(/\D/g, ""));
                          setAuthError(null);
                        }}
                      />
                    </div>
                  ) : null}
                  {authError ? (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {authError}
                    </p>
                  ) : null}
                  {needsPin ? (
                    <Button
                      type="submit"
                      className="btn-gradient h-12 w-full rounded-xl text-base font-semibold text-white"
                      disabled={!connected || !pinEntry || loggingIn}
                    >
                      {loggingIn ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Menyinkronkan database…
                        </>
                      ) : connected ? (
                        "Konfirmasi & lanjut chat"
                      ) : (
                        "Menghubungkan…"
                      )}
                    </Button>
                  ) : null}
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-emerald-900/10 dark:bg-white/10" />
                    <span className="text-[11px] uppercase tracking-wider text-emerald-900/45 dark:text-emerald-100/35">
                      atau
                    </span>
                    <span className="h-px flex-1 bg-emerald-900/10 dark:bg-white/10" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 w-full rounded-xl text-sm font-medium text-emerald-800/70 hover:bg-emerald-900/5 hover:text-emerald-950 dark:text-emerald-100/60 dark:hover:bg-white/5 dark:hover:text-emerald-50"
                    onClick={() => {
                      setLoginMode("other");
                      setName("");
                      setAuthError(null);
                    }}
                  >
                    Masuk dengan nama lain
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label
                      htmlFor="messenger-name"
                      className="text-emerald-950/80 dark:text-emerald-100/70"
                    >
                      {lastName ? "Nama baru" : "Nama Anda"}
                    </Label>
                    <Input
                      id="messenger-name"
                      value={name}
                      maxLength={MAX_NAME_LENGTH}
                      placeholder="cth. Budi Santoso"
                      autoComplete="name"
                      className="h-12 rounded-xl border-emerald-900/10 bg-white/70 text-base dark:border-white/10 dark:bg-white/5"
                      onChange={(e) => {
                        setName(e.target.value);
                        setAuthError(null);
                      }}
                    />
                  </div>
                  {needsPin ? (
                    <div className="space-y-2">
                      <Label
                        htmlFor="messenger-pin"
                        className="text-emerald-950/80 dark:text-emerald-100/70"
                      >
                        PIN akun
                      </Label>
                      <Input
                        id="messenger-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={pinEntry}
                        placeholder="••••"
                        className="h-12 rounded-xl border-emerald-900/10 bg-white/70 tracking-[0.3em] dark:border-white/10 dark:bg-white/5"
                        onChange={(e) => {
                          setPinEntry(e.target.value.replace(/\D/g, ""));
                          setAuthError(null);
                        }}
                      />
                    </div>
                  ) : null}
                  {authError ? (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {authError}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="btn-gradient h-12 w-full rounded-xl text-base font-semibold text-white"
                    disabled={!connected || !name.trim() || (needsPin && !pinEntry) || loggingIn}
                  >
                    {loggingIn ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Menyinkronkan database…
                      </>
                    ) : connected ? (
                      lastName ? (
                        "Mulai chat"
                      ) : (
                        "Masuk"
                      )
                    ) : (
                      "Menghubungkan…"
                    )}
                  </Button>
                  {!lastName ? (
                    <p className="text-center text-xs text-emerald-900/55 dark:text-emerald-100/45">
                      Nama yang sama = akun yang sama, jadi Anda bisa lanjut chat kapan saja
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 w-full rounded-xl text-sm font-medium text-emerald-800/70 hover:bg-emerald-900/5 hover:text-emerald-950 dark:text-emerald-100/60 dark:hover:bg-white/5 dark:hover:text-emerald-50"
                      onClick={() => {
                        setLoginMode("continue");
                        setName("");
                        setPinEntry("");
                        setAuthError(null);
                      }}
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" />
                      Kembali ke akun “{lastName}”
                    </Button>
                  )}
                </>
              )}
              {installAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full rounded-xl border-emerald-900/15 bg-white/40 hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                  onClick={() => promptInstall()}
                >
                  📲 Install aplikasi di perangkat ini
                </Button>
              ) : null}
            </form>
          </div>

          <p className="mt-5 text-center text-[11px] tracking-wide text-emerald-900/45 dark:text-emerald-100/35">
            Pesan real-time · Multi-perangkat · Gratis
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: full-screen 1-on-1 chat with Admin                        */
  /* ---------------------------------------------------------------- */

  const sendBlocked = !!restricted?.frozen || mutedActive;
  const mediaBlocked = !!restricted?.mediaBlocked;
  const mutedRemaining = mutedActive
    ? Math.max(0, Math.ceil((mutedUntilMs - nowTick) / 1000))
    : 0;
  const composerPlaceholder = restricted?.frozen
    ? "Akun dibekukan admin"
    : mutedActive
      ? "Akun dibisukan admin"
      : editing
        ? "Simpan hasil edit…"
        : "Tulis pesan…";

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
  // v22 — pesan berbintang yang layak tampil (server sudah menyingkirkan yang dihapus).
  const starredVisible = starredList.filter((m) => !m.deletedAt);

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
        <div className="z-10 flex shrink-0 items-center gap-2 border-b bg-card/85 px-3 py-2.5 backdrop-blur-md">
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
            {/* v22+ — fitur sekunder digabung dalam satu menu agar header ringkas. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-foreground"
                  aria-label="Menu lainnya"
                  title="Menu lainnya"
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  onClick={() => {
                    setStarredOpen(true);
                    fetchStarred();
                  }}
                >
                  <Star className="mr-2 size-4" aria-hidden="true" />
                  Pesan berbintang
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPinOpen(true)}>
                  <ShieldCheck className="mr-2 size-4" aria-hidden="true" />
                  Kunci akun dengan PIN
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={toggleDataSaver}
                  className={cn(dataSaver && "bg-accent")}
                >
                  <Leaf className="mr-2 size-3.5" aria-hidden="true" />
                  Hemat data: {dataSaver ? "aktif" : "nonaktif"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                >
                  <Sun className="mr-2 size-3.5 dark:hidden" aria-hidden="true" />
                  <Moon className="mr-2 size-3.5 hidden dark:block" aria-hidden="true" />
                  Ganti tema
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Ukuran huruf</DropdownMenuLabel>
                {FONT_SCALE_LABELS.map((o) => (
                  <DropdownMenuItem
                    key={o.key}
                    onClick={() => {
                      setFontScale(o.key);
                      saveFontScale(o.key);
                    }}
                    className={cn(fontScale === o.key && "bg-accent")}
                  >
                    <Type className="mr-2 size-3.5" aria-hidden="true" />
                    {o.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" aria-hidden="true" />
                  Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

        {/* v10 — banner mode pemeliharaan (live dari dashboard admin) */}
        {appSettings?.maintenanceMode ? (
          <p className="shrink-0 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            🛠 Mode pemeliharaan aktif
            {appSettings.maintenanceNote ? ` — ${appSettings.maintenanceNote}` : ""}
          </p>
        ) : null}

        {/* v11 — banner pembatasan akun (persisten selama aktif) */}
        {restricted && (restricted.frozen || mutedActive || restricted.slowMode > 0 || restricted.mediaBlocked) ? (
          <div className="shrink-0 space-y-0.5 border-b bg-muted/30 px-3 py-1.5 text-xs" role="alert">
            {restricted.frozen ? (
              <p className="font-medium text-rose-600 dark:text-rose-400">🚫 Akun dibekukan admin</p>
            ) : null}
            {mutedActive && restricted.mutedUntil ? (
              <p className="font-medium text-amber-600 dark:text-amber-400">
                🔇 Dibisukan s/{fmtHM(new Date(restricted.mutedUntil))} — {mutedRemaining}s lagi
              </p>
            ) : null}
            {restricted.mediaBlocked ? (
              <p className="text-muted-foreground">📎 Media diblokir (teks saja)</p>
            ) : null}
            {restricted.slowMode > 0 ? (
              <p className="text-muted-foreground">🐢 Mode lambat: {restricted.slowMode} pesan/menit</p>
            ) : null}
          </div>
        ) : null}

        {/* Pinned message banner (v5 + nama pengirim v11, dismiss visual untuk user) */}
        {pinnedMsg && pinnedMsg.id !== pinHiddenId ? (
          <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/5 px-3 py-1.5 text-xs">
            <Pin className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => scrollToMessage(pinnedMsg.id)}
            >
              {pinnedMsg.senderName ? (
                <span className="font-medium text-amber-600">{pinnedMsg.senderName}: </span>
              ) : null}
              <span className="text-muted-foreground">{pinnedMsg.snippet}</span>
            </button>
            <button
              type="button"
              aria-label="Sembunyikan pin"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setPinHiddenId(pinnedMsg.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {/* Messages — wrapper relative: tombol jump melayang tetap di viewport
            chat (absolute di dalam scroll container ikut ter-scroll). */}
        <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="chat-scroll chat-wallpaper relative h-full min-h-0 overflow-y-auto overscroll-contain"
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
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
                    <Search className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    Tidak ada pesan yang cocok dengan “{searchQuery}”.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <span
                    aria-hidden="true"
                    className="flex size-16 items-center justify-center rounded-[1.3rem] bg-gradient-to-br from-emerald-400 via-emerald-600 to-emerald-800 text-white shadow-lg shadow-emerald-600/25"
                  >
                    <MessageCircleMore className="size-8" />
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">
                      Sapa {partner?.name ?? "Admin"} 👋
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Kirim pesan pertama Anda — foto, file, dan pesan suara juga bisa.
                    </p>
                  </div>
                </div>
              )
            ) : (
              visibleMessages.map((m, idx) => (
                <div key={m.id} className="contents">
                  {/* v10 — pemisah tanggal di pesan pertama tiap hari */}
                  {idx === 0 ||
                  dayKey(visibleMessages[idx - 1].createdAt) !== dayKey(m.createdAt) ? (
                    <DaySeparator createdAt={m.createdAt} />
                  ) : null}
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
                  caption={m.caption}
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
                  starred={!!m.starredBy?.includes(me.userId)}
                  scheduledAt={m.scheduledAt}
                  onToggleStar={
                    !m.deletedAt && m.type !== "system" ? () => toggleStar(m.id) : undefined
                  }
                  onCancelScheduled={
                    m.senderId === me.userId && m.scheduledAt
                      ? () => setCancelSchedId(m.id)
                      : undefined
                  }
                  canEdit={canEditMessage(m, me.userId)}
                  linkPreviewEnabled={appSettings?.linkPreview !== false}
                  onReply={() => setReplyTo(m)}
                  onDelete={() => handleDelete(m)}
                  onMediaOpen={() => setViewer(viewerStateForMessage(mediaGallery, m))}
                  onReact={(emoji) => handleReact(m, emoji)}
                  onEdit={() => handleEditStart(m)}
                  onTranslate={
                    m.senderId !== me.userId && m.type === "text" && !m.deletedAt
                      ? () => handleTranslate(m)
                      : undefined
                  }
                  />
                </div>
              ))
            )}
          </div>
          </div>

          {/* Jump to latest — anak wrapper (bukan scroll container). */}
          {showJump ? (
            <Button
              size="icon"
              aria-label={newCount > 0 ? `${newCount} pesan baru` : "Ke pesan terbaru"}
              className="absolute bottom-4 right-4 z-10 size-10 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-600/90"
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
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border border-l-2 border-emerald-500/25 border-l-emerald-500 bg-card/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm">
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
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border border-l-2 border-amber-500/25 border-l-amber-500 bg-amber-500/10 px-2.5 py-1.5 text-xs backdrop-blur-sm">
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
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border bg-card/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
            <img
              src={pendingImage.previewUrl}
              alt="Pratinjau foto"
              className="size-10 rounded-md object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {uploadProgress != null
                  ? `Mengunggah… ${uploadProgress}%`
                  : "Foto siap dikirim"}
              </p>
              {uploadProgress != null ? (
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Batal kirim foto"
              className="text-muted-foreground hover:text-foreground"
              disabled={uploading}
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
        <div className="relative shrink-0 border-t bg-card/85 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
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
            <div className="flex items-center gap-1.5">
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
              <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full border bg-card px-1.5 shadow-sm">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Pilih emoji"
                  onClick={() => setEmojiOpen((v) => !v)}
                >
                  <Smile className="size-5" aria-hidden="true" />
                </Button>
                {/* v22+ — lampiran & kirim terjadwal digabung dalam satu tombol +. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                      aria-label="Menu lampiran"
                      title="Lampiran & kirim terjadwal"
                    >
                      <Plus className="size-5" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuItem
                      disabled={!connected || mediaBlocked || sendBlocked}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="mr-2 size-4" aria-hidden="true" />
                      Lampirkan foto atau file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!connected || sendBlocked || !!editing}
                      onClick={() => {
                        setSchedValue(toLocalInputValue(Date.now() + 3_600_000));
                        setSchedOpen(true);
                      }}
                    >
                      <Clock className="mr-2 size-4" aria-hidden="true" />
                      Kirim terjadwal
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input
                  value={input}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder={composerPlaceholder}
                  aria-label={editing ? "Edit pesan" : "Tulis pesan"}
                  autoComplete="off"
                  disabled={!connected || sendBlocked}
                  className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
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
              </div>
              {input.trim() || pendingImage ? (
                <Button
                  size="icon"
                  className="btn-gradient size-11 shrink-0 rounded-full text-white"
                  aria-label="Kirim"
                  disabled={!connected || uploading || sendBlocked || (!input.trim() && !pendingImage)}
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
                  className="size-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Rekam pesan suara"
                  disabled={!connected || mediaBlocked || sendBlocked}
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
              <div className="space-y-1.5">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Mengunggah… {uploadProgress != null ? `${uploadProgress}%` : ""}
                </p>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={uploadProgress ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${uploadProgress ?? 0}%` }}
                  />
                </div>
              </div>
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

      {/* v22+ — dialog kirim terjadwal (dibuka dari menu lampiran composer) */}
      <Dialog open={schedOpen} onOpenChange={setSchedOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              Kirim terjadwal
            </DialogTitle>
            <DialogDescription>
              Pesan terkirim otomatis pada waktu yang dipilih (10 detik–30 hari).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <Input
              type="datetime-local"
              min={toLocalInputValue(Date.now() + 60_000)}
              value={schedValue}
              aria-label="Waktu kirim"
              className="h-9 text-xs"
              onChange={(e) => setSchedValue(e.target.value)}
            />
            <Button
              className="h-10 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-600/90"
              disabled={!connected || sendBlocked || !!editing}
              onClick={sendScheduled}
            >
              Jadwalkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* v22 — panel pesan berbintang (fetch ulang tiap kali dibuka) */}
      <Dialog
        open={starredOpen}
        onOpenChange={(o) => {
          setStarredOpen(o);
          if (o) fetchStarred();
        }}
      >
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="size-5 fill-amber-400 text-amber-400" aria-hidden="true" />
              Pesan berbintang
            </DialogTitle>
            <DialogDescription>
              Pesan yang Anda bintangi di percakapan ini.
            </DialogDescription>
          </DialogHeader>
          <div className="chat-scroll max-h-96 space-y-1.5 overflow-y-auto">
            {starredLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Memuat…
              </p>
            ) : starredVisible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Belum ada pesan berbintang
              </p>
            ) : (
              starredVisible.map((m) => {
                const Icon = STARRED_TYPE_ICONS[m.type] ?? MessageCircleMore;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/60"
                    onClick={() => {
                      setStarredOpen(false);
                      scrollToMessage(m.id);
                    }}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{starredSnippet(m)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.senderId === me.userId ? "Anda" : (partner?.name ?? "Admin")} ·{" "}
                        {formatChatTime(m.createdAt)}
                      </span>
                    </span>
                    <Star
                      className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                      aria-hidden="true"
                    />
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* v22 — konfirmasi ringan pembatalan pesan terjadwal */}
      <AlertDialog
        open={cancelSchedId != null}
        onOpenChange={(o) => {
          if (!o) setCancelSchedId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesan terjadwal?</AlertDialogTitle>
            <AlertDialogDescription>
              Pesan tidak akan dikirim pada waktu yang ditentukan. Tindakan ini tidak dapat
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Jangan batalkan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-600/90"
              onClick={() => {
                if (cancelSchedId != null) cancelScheduled(cancelSchedId);
              }}
            >
              Ya, batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Viewer media full-screen + galeri geser (Task 19) */}
      <MediaViewer state={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
