"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useTheme } from "next-themes";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  Bell,
  ChevronUp,
  Clock,
  DatabaseBackup,
  EyeOff,
  Film,
  FileDown,
  FileJson,
  FileText,
  Flag,
  Forward,
  Hourglass,
  Image as ImageIcon,
  GaugeCircle,
  Leaf,
  ListChecks,
  Loader2,
  Lock,
  LockKeyhole,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Megaphone,
  Mic,
  MoreVertical,
  Moon,
  Music,
  Paperclip,
  Phone,
  Pin,
  Plus,
  QrCode,
  Radio,
  Repeat,
  ScrollText,
  Search,
  SendHorizonal,
  ShieldAlert,
  ShieldCheck,
  Smile,
  Star,
  Sun,
  Type,
  Users,
  Video,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { AdminDashboard, type DashboardTab } from "@/components/chat/admin-dashboard";
import {
  AuditLogDialog,
  ConfirmDialog,
  EditHistoryDialog,
  FakeLastSeenDialog,
  ForensicsDialog,
  KeywordsDialog,
  QuickRepliesDialog,
  SearchMessagesDialog,
  downloadTextFile,
} from "@/components/chat/admin-tools";
import { DaySeparator, dayKey } from "@/components/chat/day-separator";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import {
  MediaViewer,
  FileKindIcon,
  buildMediaGallery,
  viewerStateForMessage,
  type ViewerState,
} from "@/components/chat/media-viewer";
import { LinkViewerDialog } from "@/components/chat/link-viewer";
import {
  MediaMetaDialog,
  type MediaMetaTarget,
} from "@/components/chat/media-meta-dialog";
import { TypingDots } from "@/components/chat/TypingDots";
import { UserManager } from "@/components/chat/user-manager";
import {
  UserCheatDialog,
  type UserCheatTarget,
} from "@/components/chat/user-cheat-dialog";
import {
  UserMediaDialog,
  type UserMediaTarget,
} from "@/components/chat/user-media-dialog";
import { UserInsightDialog } from "@/components/chat/user-insight-dialog";
import {
  AdminAIDialog,
  AISuggestChips,
  type AdminAIMediaHit,
} from "@/components/chat/admin-ai";
import { PollCreateDialog } from "@/components/chat/poll-create-dialog";
import {
  CallOverlay,
  formatCallDuration,
  useWebRTC,
  type CallState,
} from "@/components/chat/call-overlay"; // v44 — call suara/video WebRTC
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { createChatSocket } from "@/lib/chat-socket";
import { playBlip, setTitleUnread } from "@/lib/chat-notify";
import { subscribeToPush } from "@/lib/chat-push";
import {
  ADMIN_ID,
  ADMIN_NAME,
  ADMIN_PASSWORD_HINT,
  MAX_MESSAGE_LENGTH,
  draftKey,
  type AckOf,
  type AdminAuthAck,
  type AdminAIFlagPayload,
  type AdminAITranscribeAck,
  type AdminAITtsAck,
  type AdminAutoBackupPayload,
  type AdminFlaggedPayload,
  type AdminModerateAck,
  type AdminNewLoginPayload,
  type AdminQuotaWarnPayload,
  type AdminUnlockAck,
  type AdminPeekAck,
  type AdminPinAck,
  type AdminUserMediaItem,
  type AlwaysOnlineAck,
  type AppSettings,
  type AppSettingsAck,
  type AppSettingsUpdatePayload,
  type ArchiveUpdatePayload,
  type BackupAck,
  type BroadcastAck,
  type CallAnswerAck,
  type CallAnsweredPayload,
  type CallEndedPayload,
  type CallIncomingPayload,
  type CallMedia,
  type CallMissedPayload,
  type CallRejectedPayload,
  type CallRingAck,
  type ChatErrorAck,
  type ChatMessage,
  type ConversationOverview,
  type ConversationPinnedPayload,
  type ConversationResetPayload,
  type DashboardUserRow,
  type ExportAck,
  type FakeReceiptsAck,
  type FakeTypingAck,
  type GhostAck,
  type HistoryAck,
  type MessageAck,
  type MessageUpdatePayload,
  type MirrorAck,
  type OlderMessagesAck,
  type PinUpdatePayload,
  type PollUpdatePayload,
  type PollVoteAck,
  type PublicSettingsAck,
  type QuickRepliesAck,
  type ReminderDuePayload,
  type RemindAck,
  type ResetConversationAck,
  type TranslateAck,
  type TtlGetAck,
  type TtlSetAck,
  type TtlUpdatePayload,
  type UserStatusUpdatePayload,
  type VacuumAck,
} from "@/lib/chat-types";
import {
  applyAccentColor,
  appLogoUrl,
  applySlashCommand,
  avatarColorClass,
  canEditMessage,
  compressImageToBlobs,
  exportChatPdf,
  FONT_SCALES,
  formatChatTime,
  formatFileSize,
  formatLastSeen,
  initials,
  messagePreview,
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

type FilterTab = "all" | "unread" | "online" | "archive";

/** Ukuran maksimum lampiran dokumen (mirror POST /api/upload + chat-service). */
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB

/**
 * v22 — ack events bintang/teruskan/terjadwal (kontrak chat-service v22;
 * tipe belum ada di chat-types, didefinisikan lokal untuk panel admin).
 */
type StarAck = { ok: true; starred: boolean };
type StarredListAck = { ok: true; messages: ChatMessage[] };
type ForwardAck = { ok: true; message: ChatMessage };
type ScheduleCancelAck = { ok: true };
/** messages:send + scheduledAt bisa membalas INVALID_SCHEDULE (belum ada di ChatErrorCode). */
type SendAckV22 = { ok: true; message: ChatMessage } | { ok: false; error: string };

/**
 * fileName pesan terakhir untuk pratinjau daftar percakapan. Dibaca secara
 * opportunistic — server v7+ mengirim fileName/mediaExpired di lastMessage.
 */
function lastFileName(lm: ConversationOverview["lastMessage"]): string | undefined {
  if (!lm) return undefined;
  const v = (lm as { fileName?: unknown }).fileName;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** mediaExpired pesan terakhir (pratinjau "⏳ Media kedaluwarsa"). */
function lastMediaExpired(lm: ConversationOverview["lastMessage"]): boolean {
  return !!(lm as { mediaExpired?: unknown } | null)?.mediaExpired;
}

const fmtTimer = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** v22 — epoch ms → "YYYY-MM-DDTHH:mm" untuk input datetime-local (zona lokal). */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FONT_SCALE_LABELS: { key: FontScale; label: string }[] = [
  { key: "sm", label: "Kecil" },
  { key: "md", label: "Sedang" },
  { key: "lg", label: "Besar" },
];

/** v42 — pilihan pesan menghilang per percakapan (jam; 0 = mati). */
const TTL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 0, label: "Mati" },
  { hours: 1, label: "1 jam" },
  { hours: 24, label: "24 jam" },
  { hours: 168, label: "7 hari" },
];

/** v42 — label pendek TTL untuk pill toolbar. */
const ttlLabel = (hours: number) =>
  hours <= 0 ? "Mati" : hours === 1 ? "1 jam" : hours === 24 ? "24 jam" : "7 hari";

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

const ADMIN_LOCK_KEY = "chatkita:admin-locked";

/** v44 — tipe objek yang dikembalikan hook useWebRTC (call-overlay). */
type WebRTCHook = ReturnType<typeof useWebRTC>;

/**
 * ChatKita AdminPanel — satu tempat untuk membaca & membalas pesan
 * SEMUA user (masing-masing 1-on-1 dengan Admin). User tidak bisa
 * melihat percakapan user lain; isolasi dijamin di sisi server.
 * Password hanya disimpan di memori (ref), tidak pernah di localStorage.
 */
export function AdminPanel() {
  const isMobile = useIsMobile();
  const { resolvedTheme, setTheme } = useTheme();

  const [authed, setAuthed] = useState(false);
  // v23 — true bila admin masih memakai password bawaan admin123 (belum custom).
  const [usingDefault, setUsingDefault] = useState(false);
  // v43 — role aktor sesi ini; 'moderator' = akses baca (tombol destruktif disembunyikan).
  const [actorRole, setActorRole] = useState<"admin" | "moderator">("admin");
  const [conversations, setConversations] = useState<ConversationOverview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  /* v43 — gate 2FA pada login admin (TOTP_REQUIRED/TOTP_INVALID). */
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  // v24 — autologin: password benar (via admin:peek) → titik input jadi hijau
  // → jeda singkat "menyinkronkan database" → masuk otomatis tanpa tombol.
  const [pwCorrect, setPwCorrect] = useState(false);
  const [filter, setFilter] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // v8 — foto menunggu kirim: blob full terkompresi + thumbnail + pratinjau.
  const [pendingImage, setPendingImage] = useState<{
    previewUrl: string;
    full: Blob;
    thumb: Blob;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // v31 — lampiran dokumen/video/audio: pratinjau INLINE ala foto chip (tanpa
  // popup); video mendapat cuplikan <video>, sisanya ikon jenis file.
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  // v20 — progres unggah (0–100); null = tidak sedang mengunggah.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // v8 — pagination riwayat per percakapan + mode hemat data.
  const [hasMoreMap, setHasMoreMap] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  // v8 — pesan kesalahan kirim yang lebih spesifik (rate limit / kuota).
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  // Viewer media full-screen — Task 19: bawa galeri media (foto+video)
  // percakapan aktif + index item yang dibuka (geser-gesir di viewer).
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  /* v41 — paket AI admin: dialog pusat + TTS + transkrip per-pesan. */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTranscribing, setAiTranscribing] = useState<number | null>(null);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  /* v42 — dialog buat polling. */
  const [pollOpen, setPollOpen] = useState(false);
  const mediaGallery = useMemo(
    () => buildMediaGallery(activeId ? messagesMap[activeId] ?? [] : []),
    [messagesMap, activeId]
  );

  /* v38 — buka MediaViewer dari dialog kontrol media per-user (galeri = item dialog). */
  const openUserMediaViewer = useCallback(
    (items: AdminUserMediaItem[], messageId: number) => {
      const item = items.find((i) => i.messageId === messageId);
      if (!item) return;
      const gallery = items.map((i) => ({
        id: i.messageId,
        type: i.type,
        content: i.url,
        fileName: i.fileName,
        fileSize: i.fileSize,
        mimeType: i.mimeType,
      }));
      setViewer(
        viewerStateForMessage(gallery, {
          id: item.messageId,
          type: item.type,
          content: item.url,
          fileName: item.fileName,
          fileSize: item.fileSize,
          mimeType: item.mimeType,
        })
      );
    },
    []
  );

  /* v41 — bacakan pesan teks dengan suara AI (TTS via chat-service). */
  const handleAiSpeak = (m: ChatMessage) => {
    const sock = socketRef.current;
    if (!sock || speakingId === m.id) return;
    if (speakAudioRef.current) {
      speakAudioRef.current.pause();
      speakAudioRef.current = null;
    }
    setSpeakingId(m.id);
    sock.emit("admin:ai_tts", { messageId: m.id }, (res: AdminAITtsAck) => {
      if (!res.ok || !res.audioBase64) {
        setSpeakingId(null);
        toast.error(
          res.error === "AI_UNAVAILABLE"
            ? "Layanan AI sedang tidak tersedia"
            : "Gagal membacakan pesan"
        );
        return;
      }
      const audio = new Audio(`data:audio/wav;base64,${res.audioBase64}`);
      speakAudioRef.current = audio;
      audio.onended = () => {
        setSpeakingId(null);
        speakAudioRef.current = null;
      };
      audio.onerror = () => {
        setSpeakingId(null);
        speakAudioRef.current = null;
      };
      void audio.play().catch(() => setSpeakingId(null));
    });
  };

  /* v41 — transkrip ulang pesan suara dengan AI (hasilnya masuk via
   * message:updated broadcast dari server, sama seperti transkrip otomatis). */
  const handleAiTranscribe = (m: ChatMessage) => {
    const sock = socketRef.current;
    if (!sock || aiTranscribing !== null) return;
    setAiTranscribing(m.id);
    sock.emit("admin:ai_transcribe", { messageId: m.id }, (res: AdminAITranscribeAck) => {
      setAiTranscribing(null);
      if (res.ok && res.transcript) toast.success("Transkrip AI siap");
      else toast.error("AI tidak bisa mendengarkan pesan ini");
    });
  };

  /* v41 — buka MediaViewer dari hasil pencarian media AI (galeri 1 item). */
  const openAiMediaViewer = (hit: AdminAIMediaHit) => {
    const galleryItem = {
      id: hit.messageId,
      type: "image" as const,
      content: hit.mediaUrl,
      fileName: hit.fileName,
      fileSize: undefined,
      mimeType: "image/jpeg",
    };
    setViewer(
      viewerStateForMessage([galleryItem], {
        id: hit.messageId,
        type: "image",
        content: hit.mediaUrl,
        fileName: hit.fileName,
        fileSize: undefined,
        mimeType: "image/jpeg",
      })
    );
  };

  /* v42 — buat polling di percakapan aktif. */
  const createPoll = async (question: string, options: string[]) => {
    const sock = socketRef.current;
    if (!sock || !activeConversation) return false;
    return await new Promise<boolean>((resolve) => {
      sock.emit(
        "messages:poll_create",
        { conversationId: activeConversation.id, question, options },
        (res: { ok: boolean }) => {
          if (res.ok) toast.success("Polling dibuat");
          resolve(!!res.ok);
        }
      );
    });
  };

  // v5 — font / pinned / edit / translate / archive / QR
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [pinnedMap, setPinnedMap] = useState<
    Record<string, { id: number; snippet: string; senderName?: string } | null>
  >({});
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  /** v5 — first unread message id → "Pesan baru" divider. */
  const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);

  // v10 — dashboard aplikasi, pengaturan global, mode hantu, kunci layar.
  const [dashOpen, setDashOpen] = useState(false);
  const [dashTab, setDashTab] = useState<DashboardTab>("ringkasan");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [ghost, setGhost] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockPin, setLockPin] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  /* v40 — dialog buka kunci percakapan ber-PIN. */
  const [pinPrompt, setPinPrompt] = useState<{ userId: string; conversationId: string } | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  // v11 — intelijen & moderasi + sinyal palsu
  const [umOpen, setUmOpen] = useState(false);
  const [umTarget, setUmTarget] = useState<string | null>(null);
  const [forensicsOpen, setForensicsOpen] = useState(false);
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [fakeLastSeenOpen, setFakeLastSeenOpen] = useState(false);
  const [alwaysOnline, setAlwaysOnline] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [fakeTypingMap, setFakeTypingMap] = useState<Record<string, boolean>>({});
  const [receiptsConfirm, setReceiptsConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [modTarget, setModTarget] = useState<ChatMessage | null>(null);
  const [editHistId, setEditHistId] = useState<number | null>(null);
  /* v35 — target dialog metadata media (EXIF/GPS) khusus admin. */
  const [metaTarget, setMetaTarget] = useState<MediaMetaTarget | null>(null);
  /* v38 — kontrol user lengkap: cheat per-user, media per-user, insight. */
  const [cheatTarget, setCheatTarget] = useState<UserCheatTarget | null>(null);
  const [mediaTarget, setMediaTarget] = useState<UserMediaTarget | null>(null);
  const [insightTarget, setInsightTarget] = useState<DashboardUserRow | null>(null);

  // v22 — bintang, teruskan, kirim terjadwal
  const [starredOpen, setStarredOpen] = useState(false);
  const [starredLoading, setStarredLoading] = useState(false);
  const [starredList, setStarredList] = useState<ChatMessage[]>([]);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardStep, setForwardStep] = useState<"message" | "target">("message");
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedValue, setSchedValue] = useState("");
  const [cancelSchedId, setCancelSchedId] = useState<number | null>(null);
  // v42 — TTL pesan menghilang per percakapan + pilihan pengulangan terjadwal.
  const [ttlMap, setTtlMap] = useState<Record<string, number>>({});
  const [schedRepeat, setSchedRepeat] = useState<"" | "daily" | "weekly">("");

  /* v44 — call suara/video WebRTC: satu state call + timer durasi mm:ss. */
  const [call, setCall] = useState<CallState | null>(null);
  const [callElapsed, setCallElapsed] = useState(0);
  const callRef = useRef<CallState | null>(null);
  const callDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Handler call terbaru utk listener socket (terdaftar sekali per epoch). */
  const callHandlersRef = useRef({
    startCall: (_media: CallMedia) => {},
    acceptCall: () => {},
    rejectCall: () => {},
    endCall: () => {},
    finishCall: () => {},
  });
  /** Instance hook WebRTC terbaru (dibaca listener socket & handler). */
  const webrtcRef = useRef<WebRTCHook | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const passwordRef = useRef<string | null>(null);
  // v24 — timer autologin (debounce peek + jeda sinkronisasi) & handleLogin terkini.
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLoginRef = useRef<() => void>(() => {});
  const ghostRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  // v29 — cermin daftar percakapan utk listener socket (users:changed) agar
  // tak membaca state basi dari closure mount.
  const conversationsRef = useRef<ConversationOverview[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const translatingIdRef = useRef<number | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const menuNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useVoiceRecorder();

  // v29 — jaga cermin daftar percakapan utk listener users:changed.
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // v44 — cermin state call + instance hook WebRTC utk listener socket.
  useEffect(() => {
    callRef.current = call;
  }, [call]);
  useEffect(() => {
    webrtcRef.current = webrtc;
  });

  /* v44 — hook WebRTC: fungsi kirim sinyal via socket (media P2P langsung). */
  const webrtc = useWebRTC({
    remoteVideoRef,
    localVideoRef,
    remoteAudioRef,
    sendOffer: (sdp) => {
      const c = callRef.current;
      if (c) socketRef.current?.emit("call:offer", { callId: c.callId, sdp });
    },
    sendAnswer: (sdp) => {
      const c = callRef.current;
      if (c) socketRef.current?.emit("call:answer_sdp", { callId: c.callId, sdp });
    },
    sendIce: (candidate) => {
      const c = callRef.current;
      if (c) socketRef.current?.emit("call:ice", { callId: c.callId, candidate });
    },
    onConnected: () => {
      // ICE tersambung → fase aktif (timer durasi jalan via effect call?.phase).
      setCall((c) =>
        c && c.phase !== "active" && c.phase !== "ended" ? { ...c, phase: "active" } : c
      );
    },
    onMediaError: (message) => {
      // Izin kamera/mikrofon ditolak dsb — akhiri call + beri tahu lawan.
      const c = callRef.current;
      toast.error(message);
      if (c) socketRef.current?.emit("call:end", { callId: c.callId });
      callHandlersRef.current.finishCall();
    },
  });

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

  /* ---------------------------------------------------------------- */
  /* v10 — menu aplikasi: dashboard / siaran / pemeliharaan / sesi      */
  /* ---------------------------------------------------------------- */
  const showMenuNotice = useCallback((text: string) => {
    setMenuNotice(text);
    if (menuNoticeTimer.current) clearTimeout(menuNoticeTimer.current);
    menuNoticeTimer.current = setTimeout(() => setMenuNotice(null), 2600);
  }, []);

  const openDashboard = useCallback((tab: DashboardTab) => {
    setDashTab(tab);
    setDashOpen(true);
  }, []);

  const toggleGhost = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("admin:ghost", { on: !ghostRef.current }, (res: AckOf<GhostAck>) => {
      if (res.ok) {
        ghostRef.current = res.ghost;
        setGhost(res.ghost);
        showMenuNotice(res.ghost ? "Mode hantu aktif — baca tanpa ✓✓" : "Mode hantu nonaktif");
      }
    });
  }, [showMenuNotice]);

  const toggleMaintenance = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const next = !(appSettings?.maintenanceMode ?? false);
    socket.emit(
      "admin:settings:set",
      { maintenanceMode: next },
      (res: AckOf<AppSettingsAck> | ChatErrorAck) => {
        if (res.ok) {
          setAppSettings(res.settings);
          showMenuNotice(res.settings.maintenanceMode ? "Mode pemeliharaan AKTIF" : "Mode pemeliharaan nonaktif");
        }
      }
    );
  }, [appSettings?.maintenanceMode, showMenuNotice]);

  const downloadBackup = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    showMenuNotice("Menyiapkan backup…");
    socket.emit("admin:backup", {}, (res: AckOf<BackupAck>) => {
      if (!res.ok) {
        showMenuNotice("Backup gagal");
        return;
      }
      try {
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chatkita-backup-${res.exportedAt.slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showMenuNotice("Backup JSON terunduh ✓");
      } catch {
        showMenuNotice("Backup gagal");
      }
    });
  }, [showMenuNotice]);

  const runVacuum = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    showMenuNotice("Mengompres database…");
    socket.emit("admin:vacuum", {}, (res: AckOf<VacuumAck>) => {
      if (!res.ok) {
        showMenuNotice("VACUUM gagal");
        return;
      }
      const saved = res.before.walBytes - res.after.walBytes;
      showMenuNotice(
        `VACUUM selesai — DB ${(res.after.dbBytes / 1024).toFixed(0)} KB${saved > 0 ? ` (hemat ${(saved / 1024).toFixed(0)} KB)` : ""}`
      );
    });
  }, [showMenuNotice]);

  /* v11 — sinyal palsu: selalu online / mode cermin */
  const toggleAlwaysOnline = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(
      "admin:always_online",
      { on: !alwaysOnline },
      (res: AckOf<AlwaysOnlineAck>) => {
        if (res.ok) {
          setAlwaysOnline(res.alwaysOnline);
          showMenuNotice(res.alwaysOnline ? "Selalu online AKTIF" : "Selalu online nonaktif");
        }
      }
    );
  }, [alwaysOnline, showMenuNotice]);

  const toggleMirror = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("admin:mirror", { on: !mirror }, (res: AckOf<MirrorAck>) => {
      if (res.ok) {
        setMirror(res.mirror);
        showMenuNotice(res.mirror ? "Mode cermin AKTIF — user melihat 'Admin sedang mengetik'" : "Mode cermin nonaktif");
      }
    });
  }, [mirror, showMenuNotice]);

  /* v11 — alat percakapan aktif: typing palsu / receipts / ekspor / reset */
  const toggleFakeTyping = useCallback((conversationId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    const on = !fakeTypingMap[conversationId];
    setFakeTypingMap((prev) => ({ ...prev, [conversationId]: on }));
    socket.emit(
      "admin:fake_typing",
      { conversationId, on },
      (res: AckOf<FakeTypingAck>) => {
        if (!res.ok) setFakeTypingMap((prev) => ({ ...prev, [conversationId]: !on }));
      }
    );
  }, [fakeTypingMap]);

  const sendFakeReceipts = useCallback(() => {
    const socket = socketRef.current;
    const id = activeIdRef.current;
    if (!socket || !id) return;
    socket.emit(
      "admin:fake_receipts",
      { conversationId: id },
      (res: AckOf<FakeReceiptsAck>) => {
        if (res.ok) showMenuNotice(`✓✓ palsu terkirim — ${res.count} pesan`);
        else showMenuNotice("Gagal mengirim ✓✓ palsu");
      }
    );
  }, [showMenuNotice]);

  const exportChat = useCallback(
    (format: "txt" | "json") => {
      const socket = socketRef.current;
      const id = activeIdRef.current;
      if (!socket || !id) return;
      showMenuNotice("Menyiapkan ekspor…");
      socket.emit(
        "admin:export_conversation",
        { conversationId: id, format },
        (res: AckOf<ExportAck>) => {
          if (!res.ok) {
            showMenuNotice("Ekspor gagal");
            return;
          }
          downloadTextFile(
            res.fileName,
            res.content,
            res.format === "json" ? "application/json" : "text/plain"
          );
          showMenuNotice(`Ekspor ${res.format.toUpperCase()} terunduh (${res.count} pesan) ✓`);
        }
      );
    },
    [showMenuNotice]
  );

  const resetActiveConversation = useCallback(() => {
    const socket = socketRef.current;
    const id = activeIdRef.current;
    if (!socket || !id) return;
    socket.emit(
      "admin:reset_conversation",
      { conversationId: id },
      (res: AckOf<ResetConversationAck>) => {
        if (res.ok) showMenuNotice(`Chat direset (${res.deleted} pesan dihapus)`);
        else showMenuNotice("Reset chat gagal");
      }
    );
  }, [showMenuNotice]);

  const unpinActive = useCallback(() => {
    const socket = socketRef.current;
    const id = activeIdRef.current;
    if (!socket || !id) return;
    socket.emit(
      "admin:unpin",
      { conversationId: id },
      (res: AckOf<AdminPinAck>) => {
        if (res.ok) setPinnedMap((prev) => ({ ...prev, [id]: null }));
      }
    );
  }, []);

  const confirmModerate = useCallback(() => {
    const target = modTarget;
    if (!target) return;
    setModTarget(null);
    socketRef.current?.emit("admin:delete_message", { messageId: target.id });
    showMenuNotice("Pesan dihapus (moderasi)");
  }, [modTarget, showMenuNotice]);

  const lockNow = useCallback(() => {
    try {
      window.sessionStorage.setItem(ADMIN_LOCK_KEY, "1");
    } catch {
      /* ignore */
    }
    setLockPin("");
    setLockError(null);
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !lockPin.trim()) return;
    socket.emit("admin:auth", { password: lockPin }, (res: AckOf<AdminAuthAck>) => {
      if (res.ok) {
        setActorRole(res.actorRole === "moderator" ? "moderator" : "admin"); // v43
        try {
          window.sessionStorage.removeItem(ADMIN_LOCK_KEY);
        } catch {
          /* ignore */
        }
        setLocked(false);
        setLockPin("");
        setLockError(null);
      } else if (res.error === "RATE_LIMITED") {
        setLockError("Terlalu banyak percobaan — tunggu 1 menit.");
      } else {
        setLockError("Password salah.");
      }
    });
  }, [lockPin]);

  // Pulihkan status kunci layar setelah reload (per tab/session).
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ADMIN_LOCK_KEY) === "1") setLocked(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(
    () => () => {
      if (menuNoticeTimer.current) clearTimeout(menuNoticeTimer.current);
    },
    []
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Socket lifecycle (recreated on logout via `epoch`)                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const socket = createChatSocket();
    socketRef.current = socket;

    const loadHistory = (id: string) => {
      socket.emit(
        "messages:history",
        { conversationId: id },
        (res: AckOf<HistoryAck>) => {
          if (res.ok) {
            setMessagesMap((prev) => ({ ...prev, [id]: res.messages }));
            setHasMoreMap((prev) => ({ ...prev, [id]: res.hasMore }));
            setPinnedMap((prev) => ({
              ...prev,
              [id]: res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null,
            }));
            socketRef.current?.emit("messages:read", { conversationId: id });
          }
        }
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      const currentPassword = passwordRef.current;
      if (!currentPassword) return;
      // Re-auth on EVERY connect (password kept in memory only), then
      // refresh the inbox and re-open the active conversation.
      socket.emit(
        "admin:auth",
        { password: currentPassword },
        (res: AckOf<AdminAuthAck>) => {
          if (res.ok) {
            setAuthed(true);
            setUsingDefault(!!res.usingDefault);
            setConversations(res.conversations);
            // Opt in to Web Push so messages reach us even when every
            // admin tab is closed (ack shape: { ok, pushPublicKey }).
            socket.emit("public:settings", {}, (pres: AckOf<PublicSettingsAck>) => {
              if (pres.ok && pres.pushPublicKey) {
                void subscribeToPush(socket, pres.pushPublicKey);
              }
            });
            // v11 — muat balasan cepat untuk chip di atas composer.
            socket.emit("admin:quick_replies:get", {}, (qres: AckOf<QuickRepliesAck>) => {
              if (qres.ok) setQuickReplies(qres.items);
            });
            if (activeIdRef.current) loadHistory(activeIdRef.current);
          } else {
            // No longer authorized — drop back to the login form.
            passwordRef.current = null;
            activeIdRef.current = null;
            setAuthed(false);
            setConversations([]);
            setActiveId(null);
            setMessagesMap({});
            setTypingMap({});
            setAuthError("Sesi berakhir. Silakan masuk kembali.");
            setTitleUnread(0);
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

    // v10 — pengaturan aplikasi live (mode pemeliharaan, nama aplikasi…).
    socket.on("app:settings:update", (s: AppSettingsUpdatePayload) => {
      setAppSettings(s);
    });

    socket.on("conversations:update", (list: ConversationOverview[]) => {
      setConversations(list);
      const current = activeIdRef.current;
      if (current && !list.some((c) => c.id === current)) {
        // Conversation vanished server-side — deselect gracefully.
        activeIdRef.current = null;
        setActiveId(null);
      }
      // v22 — badge tab kini dielola useEffect unreadCount (label "ChatKita Admin").
    });

    // v5 — pinned banner + archive state live updates.
    socket.on("conversation:update", (p: PinUpdatePayload) => {
      setPinnedMap((prev) => ({
        ...prev,
        [p.conversationId]: p.pinned ? { id: p.pinned.id, snippet: p.pinned.snippet } : null,
      }));
    });
    // v11 — pin berubah: snapshot kaya (termasuk nama pengirim).
    socket.on("conversation:pinned", (p: ConversationPinnedPayload) => {
      setPinnedMap((prev) => ({
        ...prev,
        [p.conversationId]: p.pinnedMessage
          ? {
              id: p.pinnedMessage.messageId,
              snippet: p.pinnedMessage.snippet,
              senderName: p.pinnedMessage.senderName,
            }
          : null,
      }));
    });
    // v11 — reset chat (admin / v29 user sendiri): kosongkan list + sisipkan catatan sistem.
    socket.on("conversation:reset", (p: ConversationResetPayload) => {
      // v29 — toast/catatan sadar-pembersih (user bisa membersihkan chatnya sendiri).
      const cleaner = p.by === "admin" ? "admin" : (p.byName ?? "pengguna");
      const note: ChatMessage = {
        id: -Date.now(),
        conversationId: p.conversationId,
        senderId: "system",
        content: `🧹 Riwayat chat dibersihkan oleh ${cleaner} (${p.deleted} pesan)`,
        createdAt: p.deletedAt,
        type: "system",
      };
      setMessagesMap((prev) => ({ ...prev, [p.conversationId]: [note] }));
      setHasMoreMap((prev) => ({ ...prev, [p.conversationId]: false }));
      setPinnedMap((prev) => ({ ...prev, [p.conversationId]: null }));
    });
    // v29 — akun user dihapus permanen (admin:user_delete): buang percakapannya
    // dari daftar; tutup bila sedang terbuka.
    socket.on("users:changed", (p: { userId: string; removed: boolean }) => {
      if (!p?.removed || !p.userId) return;
      const wasActive = conversationsRef.current.some(
        (c) => c.id === activeIdRef.current && c.partner.id === p.userId
      );
      setConversations((prev) => prev.filter((c) => c.partner.id !== p.userId));
      if (wasActive) {
        activeIdRef.current = null;
        setActiveId(null);
        setSendError(false);
        setEditing(null);
        setUnreadDividerId(null);
      }
    });
    // v11 — pesan cocok kata terlarang (diam-diam, hanya ke room admins).
    socket.on("admin:flagged", (p: AdminFlaggedPayload) => {
      showMenuNotice(`🚩 "${p.keyword}" dari ${p.senderName}: ${p.snippet.slice(0, 60)}`);
    });
    // v41 — intel moderasi otomatis AI (pesan disensor/diblokir).
    socket.on("admin:ai_flag", (p: AdminAIFlagPayload) => {
      showMenuNotice(
        p.action === "block"
          ? `🤖 Diblokir AI — ${p.senderName}: ${p.snippet.slice(0, 60)}`
          : `🤖 Disensor AI — ${p.senderName}: ${p.snippet.slice(0, 60)}`
      );
    });
    // v43 — perangkat baru terikat ke akun (login/pendaftaran dari perangkat lain).
    socket.on("admin:new_login", (p: AdminNewLoginPayload) => {
      showMenuNotice(`🔓 Login baru: ${p.userName} (perangkat baru)`);
    });
    // v43 — backup otomatis terjadwal selesai (hasil fire-and-forget server).
    socket.on("admin:auto_backup", (p: AdminAutoBackupPayload) => {
      showMenuNotice(p.ok ? "💾 Backup otomatis selesai" : "⚠️ Backup otomatis GAGAL — cek log server");
    });
    // v40 — peringatan kuota media per-user (ambang 80% / 95%).
    socket.on("admin:quota_warn", (p: AdminQuotaWarnPayload) => {
      showMenuNotice(
        `⚠️ Kuota media ${p.userName}: ${p.pct}% terpakai (${formatFileSize(p.usedBytes)}/${formatFileSize(p.quotaBytes)})`
      );
    });
    socket.on("conversation:archive:update", (p: ArchiveUpdatePayload) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === p.conversationId ? { ...c, archived: p.archived } : c))
      );
    });

    // Append + UPSERT by id: pesan terjadwal (v22) datang DUA KALI dengan ID
    // SAMA — chip ⏰ pertama hanya ke pengirim, lalu versi final saat jatuh
    // tempo. Bila id sudah ada GANTI isinya; selain itu append biasa.
    socket.on("message:new", (msg: ChatMessage) => {
      setMessagesMap((prev) => {
        const list = prev[msg.conversationId];
        if (!list || list.length === 0) {
          return { ...prev, [msg.conversationId]: [msg] };
        }
        const idx = list.findIndex((m) => m.id === msg.id);
        if (idx === -1) return { ...prev, [msg.conversationId]: [...list, msg] };
        const next = list.slice();
        next[idx] = msg;
        return { ...prev, [msg.conversationId]: next };
      });
      const isActive = msg.conversationId === activeIdRef.current;
      if (isActive) {
        socketRef.current?.emit("messages:read", { conversationId: msg.conversationId });
        if (atBottomRef.current) {
          requestAnimationFrame(() => scrollToBottom(true));
        } else if (msg.senderId !== ADMIN_ID) {
          setNewCount((c) => c + 1);
        }
      }
      // Blip for hidden tab OR background conversations (user messages only).
      if (msg.type !== "system" && (document.hidden || !isActive) && msg.senderId !== ADMIN_ID) {
        playBlip();
      }
    });

    // Delete tombstones + transcripts + edits/translations/reactions.
    socket.on("message:updated", (u: MessageUpdatePayload) => {
      setMessagesMap((prev) => {
        const list = prev[u.conversationId];
        if (!list) return prev;
        return {
          ...prev,
          [u.conversationId]: list.map((m) =>
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
                  /* v40 — pesan pending disetujui → hilangkan badge antrean. */
                  pending: u.pending ?? m.pending,
                }
              : m
          ),
        };
      });
      if (u.translation && u.id === translatingIdRef.current) {
        translatingIdRef.current = null;
        setTranslatingId(null);
      }
    });

    // v22 — pesan terjadwal dibatalkan pengirim: buang dari daftar percakapan.
    socket.on("message:scheduled_cancelled", (p: { id: number; conversationId: string }) => {
      setMessagesMap((prev) => {
        const list = prev[p.conversationId];
        if (!list) return prev;
        return { ...prev, [p.conversationId]: list.filter((m) => m.id !== p.id) };
      });
    });

    // v42 — hasil polling live: perbarui counts/total kartu poll.
    socket.on("poll:update", (p: PollUpdatePayload) => {
      setMessagesMap((prev) => {
        const list = prev[p.conversationId];
        if (!list) return prev;
        return {
          ...prev,
          [p.conversationId]: list.map((m) =>
            m.id === p.messageId && m.poll
              ? { ...m, poll: { ...m.poll, counts: p.counts, total: p.total } }
              : m
          ),
        };
      });
    });

    // v42 — pengingat pesan jatuh tempo (reminder yang dibuat admin).
    socket.on("reminder:due", (p: ReminderDuePayload) => {
      toast.info(`⏰ Pengingat: pesan #${p.messageId}`);
      if (p.conversationId === activeIdRef.current) {
        const el = scrollRef.current?.querySelector(`[data-mid="${p.messageId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // v42 — TTL pesan menghilang diubah → simpan utk label pill.
    socket.on("conversation:ttl:update", (p: TtlUpdatePayload) => {
      setTtlMap((prev) => ({ ...prev, [p.conversationId]: p.hours }));
      showMenuNotice(
        p.hours > 0
          ? `⏳ Pesan menghilang: ${ttlLabel(p.hours)} — pesan baru otomatis terhapus`
          : "⏳ Pesan menghilang dimatikan"
      );
    });

    // v42 — status custom user berubah → perbarui daftar percakapan.
    socket.on("user:status:update", (p: UserStatusUpdatePayload) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.partner.id === p.userId
            ? { ...c, partner: { ...c.partner, statusText: p.statusText || null } }
            : c
        )
      );
      showMenuNotice(
        p.statusText ? `🪪 Status diperbarui: "${p.statusText.slice(0, 50)}"` : "🪪 Status dihapus user"
      );
    });

    // Live ✓✓: a user read up to `lastReadMessageId` of the admin's bubbles.
    socket.on(
      "read:update",
      (r: { conversationId: string; userId: string; lastReadMessageId: number }) => {
        if (r.userId === ADMIN_ID) return;
        setConversations((prev) =>
          prev.map((c) => (c.id === r.conversationId ? { ...c, partnerLastReadId: r.lastReadMessageId } : c))
        );
      }
    );

    socket.on(
      "partner:typing",
      ({ conversationId, isTyping }: { conversationId: string; isTyping: boolean }) => {
        const timers = partnerTypingTimersRef.current;
        if (timers[conversationId]) {
          clearTimeout(timers[conversationId]);
          delete timers[conversationId];
        }
        setTypingMap((prev) => {
          const next = { ...prev };
          if (isTyping) next[conversationId] = true;
          else delete next[conversationId];
          return next;
        });
        if (isTyping) {
          // Auto-clear after 8s in case a stop event is missed.
          timers[conversationId] = setTimeout(() => {
            delete partnerTypingTimersRef.current[conversationId];
            setTypingMap((prev) => {
              if (!prev[conversationId]) return prev;
              const next = { ...prev };
              delete next[conversationId];
              return next;
            });
          }, 8000);
        }
      }
    );

    // The admins room receives presence for every user.
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
        setConversations((prev) =>
          prev.map((c) =>
            c.partner.id === userId
              ? {
                  ...c,
                  partner: {
                    ...c.partner,
                    online,
                    lastSeenAt: online ? null : lastSeenAt,
                  },
                }
              : c
          )
        );
      }
    );

    // v44 — signaling call WebRTC (handler di callHandlersRef/webrtcRef —
    // listener terdaftar sekali per epoch; media P2P tidak lewat socket).
    socket.on("call:incoming", (p: CallIncomingPayload) => {
      if (callRef.current) {
        // Sudah ada call aktif — tolak otomatis supaya tidak overlay dobel.
        socket.emit("call:answer", { callId: p.callId, accept: false });
        return;
      }
      setCall({
        callId: p.callId,
        role: "callee",
        peer: p.from,
        media: p.media,
        phase: "ringing",
      });
      setCallElapsed(0);
    });
    socket.on("call:answered", (p: CallAnsweredPayload) => {
      const c = callRef.current;
      if (!c || c.callId !== p.callId || c.role !== "caller") return;
      setCall((prev) => (prev ? { ...prev, phase: "connecting" } : prev));
      void webrtcRef.current?.beginCaller(p.media);
    });
    socket.on("call:offer", (p: { callId: string; sdp: string }) => {
      if (callRef.current?.callId !== p.callId) return;
      void webrtcRef.current?.handleOffer(p.sdp);
    });
    socket.on("call:answer_sdp", (p: { callId: string; sdp: string }) => {
      if (callRef.current?.callId !== p.callId) return;
      void webrtcRef.current?.handleAnswer(p.sdp);
    });
    socket.on("call:ice", (p: { callId: string; candidate: string }) => {
      if (callRef.current?.callId !== p.callId) return;
      void webrtcRef.current?.handleIce(p.candidate);
    });
    socket.on("call:ended", (p: CallEndedPayload) => {
      if (callRef.current?.callId !== p.callId) return;
      callHandlersRef.current.finishCall();
      toast.info("Panggilan berakhir");
    });
    socket.on("call:missed", (p: CallMissedPayload) => {
      if (callRef.current?.callId !== p.callId) return;
      callHandlersRef.current.finishCall();
      toast.info("Panggilan tidak dijawab");
    });
    socket.on("call:rejected", (p: CallRejectedPayload) => {
      if (callRef.current?.callId !== p.callId) return;
      callHandlersRef.current.finishCall();
      toast.info("Panggilan ditolak");
    });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      Object.values(partnerTypingTimersRef.current).forEach((t) => clearTimeout(t));
      partnerTypingTimersRef.current = {};
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch, scrollToBottom, showMenuNotice]);

  /* ---------------------------------------------------------------- */
  /* Derived values                                                    */
  /* ---------------------------------------------------------------- */
  const filteredConversations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = conversations;
    if (filterTab === "archive") list = list.filter((c) => c.archived);
    else list = list.filter((c) => !c.archived);
    if (filterTab === "unread") list = list.filter((c) => c.unread > 0);
    if (filterTab === "online") list = list.filter((c) => c.partner.online);
    if (!q) return list;
    return list.filter((c) => c.partner.name.toLowerCase().includes(q));
  }, [conversations, filter, filterTab]);

  const activeConversation: ConversationOverview | null = activeId
    ? conversations.find((c) => c.id === activeId) ?? null
    : null;
  const activeMessages = activeId ? messagesMap[activeId] ?? [] : [];
  const activeTyping = activeId ? typingMap[activeId] === true : false;

  /* ---------------------------------------------------------------- */
  /* v44 — aksi call suara/video (WebRTC)                              */
  /* ---------------------------------------------------------------- */
  /** Matikan timer durasi + tutup overlay call (tanpa emit). */
  const finishCall = () => {
    if (callDismissRef.current) clearTimeout(callDismissRef.current);
    callDismissRef.current = null;
    webrtcRef.current?.stop();
    setCallElapsed(0);
    setCall(null);
  };
  /** Mulai call ke partner percakapan aktif (penelepon). */
  const startCall = (media: CallMedia) => {
    const sock = socketRef.current;
    const partner = activeConversation?.partner;
    if (!sock || !partner) return;
    if (callRef.current) {
      toast.error("Masih ada panggilan aktif");
      return;
    }
    sock.emit(
      "call:ring",
      { toUserId: partner.id, media },
      (res: AckOf<CallRingAck>) => {
        if (res.ok && res.callId) {
          setCall({
            callId: res.callId,
            role: "caller",
            peer: { id: partner.id, name: partner.name },
            media,
            phase: "outgoing",
          });
        } else if (res.error === "BUSY") {
          toast.error("Lawan sedang dalam panggilan lain");
        } else {
          toast.error("Gagal memulai panggilan");
        }
      }
    );
  };
  /** Callee menerima: siapkan media dulu (dialog izin), lalu jawab ring. */
  const acceptCall = async () => {
    const c = callRef.current;
    const sock = socketRef.current;
    if (!c || !sock) return;
    const ok = (await webrtcRef.current?.beginCallee(c.media)) ?? false;
    if (!ok) return; // onMediaError sudah menutup call + toast
    sock.emit(
      "call:answer",
      { callId: c.callId, accept: true },
      (res: AckOf<CallAnswerAck>) => {
        if (!res.ok) {
          finishCall();
          toast.error("Panggilan tidak bisa diterima");
          return;
        }
        setCall((prev) => (prev ? { ...prev, phase: "connecting" } : prev));
      }
    );
  };
  /** Callee menolak call masuk. */
  const rejectCall = () => {
    const c = callRef.current;
    if (!c) return;
    socketRef.current?.emit("call:answer", { callId: c.callId, accept: false });
    finishCall();
  };
  /** Lokal mengakhiri: emit call:end → fase 'ended' singkat → tutup. */
  const endCall = () => {
    const c = callRef.current;
    if (!c || c.phase === "ended") return;
    socketRef.current?.emit("call:end", { callId: c.callId });
    webrtcRef.current?.stop();
    setCall((prev) => (prev ? { ...prev, phase: "ended" } : prev));
    if (callDismissRef.current) clearTimeout(callDismissRef.current);
    callDismissRef.current = setTimeout(() => {
      callDismissRef.current = null;
      finishCall();
    }, 1200);
  };
  // latest-ref: listener socket (terdaftar di effect epoch) memakai versi terbaru.
  useEffect(() => {
    callHandlersRef.current = { startCall, acceptCall, rejectCall, endCall, finishCall };
  });

  // v44 — timer durasi call (mm:ss) berjalan hanya saat fase aktif.
  useEffect(() => {
    if (call?.phase !== "active") return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      setCallElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [call?.phase]);

  // v44 — polish: logout/epoch berubah atau unmount → matikan media call
  // (track kamera/mikrofon tidak boleh tetap hidup setelah sesi berakhir).
  useEffect(() => {
    return () => {
      webrtcRef.current?.stop();
    };
  }, [epoch]);

  const query = searchQuery.trim().toLowerCase();
  const visibleMessages = query
    ? activeMessages.filter((m) =>
        (m.type === "text" ? m.content : (m.transcript ?? "")).toLowerCase().includes(query)
      )
    : activeMessages;

  const unreadCount = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread, 0),
    [conversations]
  );

  // v22 — badge unread di tab browser: total belum dibaca SEMUA percakapan.
  useEffect(() => {
    document.title =
      unreadCount > 0 ? `(${unreadCount}) ChatKita Admin` : "ChatKita — Chat Sederhana";
  }, [unreadCount]);

  // v43 — branding global: terapkan warna aksen dari settings (kosong = bawaan).
  useEffect(() => {
    applyAccentColor(appSettings?.accentColor);
  }, [appSettings?.accentColor]);

  /* Jump to latest when switching conversation. */
  useEffect(() => {
    atBottomRef.current = true;
    requestAnimationFrame(() => {
      setNewCount(0);
      setReplyTo(null);
      scrollToBottom();
    });
  }, [activeId, scrollToBottom]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  /* v43 — kirim admin:auth (password + kode 2FA opsional) dan tangani gate
   * TOTP_REQUIRED/TOTP_INVALID dengan tetap menyimpan password di memori. */
  const emitAdminAuth = (pw: string, totp?: string) => {
    const socket = socketRef.current;
    if (!socket || !connected || !pw) return;
    setAuthError(null);
    socket.emit(
      "admin:auth",
      totp ? { password: pw, totp } : { password: pw },
      (res: AckOf<AdminAuthAck>) => {
        if (res.ok) {
          passwordRef.current = pw;
          setAuthed(true);
          setUsingDefault(!!res.usingDefault);
          setActorRole(res.actorRole === "moderator" ? "moderator" : "admin");
          setConversations(res.conversations);
          setTotpRequired(false);
          setTotpCode("");
          // v43 — muat settings (logo/warna aksen/branding) langsung setelah login.
          socket.emit(
            "admin:settings:get",
            {},
            (sres: AckOf<AppSettingsAck> | ChatErrorAck) => {
              if (sres.ok) setAppSettings(sres.settings);
            }
          );
          // v43 — moderator: info mode terbatas.
          if (res.actorRole === "moderator") {
            toast("Mode moderator — akses terbatas (lihat saja)");
          }
        } else {
          setPwCorrect(false); // v24 — auth sungguhan gagal: hilangkan efek hijau
          if (res.error === "TOTP_REQUIRED") {
            passwordRef.current = pw;
            setTotpRequired(true);
            setAuthError("Kode 2FA diperlukan — buka aplikasi autentikator Anda.");
          } else if (res.error === "TOTP_INVALID") {
            setTotpRequired(true);
            setTotpCode("");
            setAuthError("Kode 2FA salah — coba lagi.");
          } else {
            setAuthError(
              res.error === "UNAUTHORIZED"
                ? "Password salah."
                : res.error === "RATE_LIMITED"
                  ? "Terlalu banyak percobaan — tunggu 1 menit."
                  : "Terjadi kesalahan, coba lagi."
            );
          }
        }
      }
    );
  };

  const handleLogin = () => {
    const socket = socketRef.current;
    const trimmed = password.trim();
    if (!socket || !connected || !trimmed) return;
    emitAdminAuth(trimmed);
  };

  // v24 — sinkronkan handleLogin terbaru untuk dipanggil timer autologin.
  useEffect(() => {
    handleLoginRef.current = handleLogin;
  });

  // v24 — autologin admin: setelah 350 ms berhenti mengetik, cek password via
  // admin:peek (tanpa sesi). Bila benar → titik input hijau → jeda 900 ms
  // "menyinkronkan database" → login sungguhan (admin:auth) dipanggil otomatis.
  // Password < 6 kar tidak dicek (batas minimum password custom).
  useEffect(() => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
    const pw = password.trim();
    setPwCorrect(false);
    if (!pw || !connected || pw.length < 6) return;
    peekTimerRef.current = setTimeout(() => {
      const socket = socketRef.current;
      if (!socket) return;
      socket.emit("admin:password_peek", { password: pw }, (res: AckOf<AdminPeekAck>) => {
        if (res.ok) {
          setPwCorrect(true);
          loginTimerRef.current = setTimeout(() => handleLoginRef.current(), 900);
        }
      });
    }, 350);
    return () => {
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    };
  }, [password, connected]);

  // v24 — bersihkan sisa timer autologin saat komponen dibongkar.
  useEffect(
    () => () => {
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
      if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
    },
    []
  );

  const handleLogout = () => {
    passwordRef.current = null;
    activeIdRef.current = null;
    // v24 — kosongkan form password supaya autologin tidak langsung masuk lagi.
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
    setPassword("");
    setPwCorrect(false);
    setAuthed(false);
    setConversations([]);
    setMessagesMap({});
    setHasMoreMap({});
    setLoadingOlder(false);
    setSendErrorDetail(null);
    setTypingMap({});
    setActiveId(null);
    setFilter("");
    setFilterTab("all");
    setAuthError(null);
    setInput("");
    setSendError(false);
    setEditing(null);
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    setUploading(false);
    setFileError(null);
    setViewer(null);
    setPinnedMap({});
    // v11 — reset state fitur admin saat logout
    setQuickReplies([]);
    setFakeTypingMap({});
    setAlwaysOnline(false);
    setMirror(false);
    setUmOpen(false);
    setUmTarget(null);
    setCheatTarget(null);
    setMediaTarget(null);
    setInsightTarget(null);
    setForensicsOpen(false);
    setMsgSearchOpen(false);
    setAuditOpen(false);
    setKeywordsOpen(false);
    setQuickRepliesOpen(false);
    setFakeLastSeenOpen(false);
    setReceiptsConfirm(false);
    setResetConfirm(false);
    setModTarget(null);
    setEditHistId(null);
    // v22 — reset state bintang / teruskan / terjadwal
    setStarredOpen(false);
    setStarredList([]);
    setStarredLoading(false);
    setForwardOpen(false);
    setForwardStep("message");
    setForwardMessage(null);
    setSchedOpen(false);
    setSchedValue("");
    setCancelSchedId(null);
    setTitleUnread(0);
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const handleSelectConversation = (id: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    // v5 — keep the typed draft per conversation.
    if (activeIdRef.current) saveDraft("admin", activeIdRef.current, input);
    activeIdRef.current = id;
    setActiveId(id);
    setSendError(false);
    setEditing(null);
    const overview = conversations.find((c) => c.id === id);
    setPinnedMap((prev) => ({
      ...prev,
      [id]: overview?.pinned
        ? { id: overview.pinned.id, snippet: overview.pinned.snippet }
        : null,
    }));
    setInput(readDraft("admin", id));
    // v42 — seed TTL pesan menghilang percakapan ini (utk label pill).
    socket.emit("conversation:ttl_get", { conversationId: id }, (res: AckOf<TtlGetAck>) => {
      if (res.ok) setTtlMap((prev) => ({ ...prev, [id]: res.hours }));
    });
    socket.emit("messages:history", { conversationId: id }, (res: AckOf<HistoryAck>) => {
      if (res.ok) {
        setMessagesMap((prev) => ({ ...prev, [id]: res.messages }));
        setHasMoreMap((prev) => ({ ...prev, [id]: res.hasMore }));
        setPinnedMap((prev) => ({
          ...prev,
          [id]: res.pinned ? { id: res.pinned.id, snippet: res.pinned.snippet } : null,
        }));
        // v5 — where the "new messages" divider goes (first unread partner msg).
        const firstUnread = res.messages.find(
          (m) =>
            m.id > res.lastReadBefore && m.senderId !== ADMIN_ID && m.type !== "system"
        );
        setUnreadDividerId(res.lastReadBefore > 0 && firstUnread ? firstUnread.id : null);
        socketRef.current?.emit("messages:read", { conversationId: id });
      } else if ((res as { error?: string }).error === "PIN_LOCKED") {
        // v40 — percakapan dikunci PIN: kembali ke daftar + minta PIN.
        setActiveId(null);
        activeIdRef.current = null;
        setPinPrompt({
          userId: (res as { userId?: string }).userId ?? "",
          conversationId: id,
        });
        setPinValue("");
        setPinError(null);
      }
    });
  };

  const handleBackToList = () => {
    if (activeIdRef.current) saveDraft("admin", activeIdRef.current, input);
    activeIdRef.current = null;
    setActiveId(null);
    setSendError(false);
    setEditing(null);
    setUnreadDividerId(null);
  };

  /** v40 — setujui/tolak pesan yang menunggu persetujuan (moderasi pra-kirim). */
  const handleModerate = (messageId: number, action: "approve" | "reject") => {
    socketRef.current?.emit(
      "admin:moderate",
      { messageId, action },
      (res: AckOf<AdminModerateAck>) => {
        if (res.ok) {
          showMenuNotice(action === "approve" ? "Pesan disetujui ✓" : "Pesan ditolak");
        } else showMenuNotice("Gagal memproses moderasi");
      }
    );
  };

  /** v40 — buka kunci percakapan ber-PIN (sekali per sesi socket). */
  const handleUnlock = () => {
    if (!pinPrompt || !pinValue.trim()) return;
    socketRef.current?.emit(
      "admin:unlock",
      { userId: pinPrompt.userId, pin: pinValue.trim() },
      (res: AckOf<AdminUnlockAck>) => {
        if (res.ok) {
          const convId = pinPrompt.conversationId;
          setPinPrompt(null);
          setPinValue("");
          setPinError(null);
          // v42 — fix: sebelumnya memanggil openConversation() yang tidak ada
          // (bug latent Task 59) → pakai handleSelectConversation.
          handleSelectConversation(convId);
        } else if ((res as { error?: string }).error === "INVALID_PIN") {
          setPinError("PIN salah — coba lagi.");
        } else setPinError("Gagal membuka kunci.");
      }
    );
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
    const id = activeIdRef.current;
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
    saveDraft("admin", id, "");
    return true;
  };

  const handleSend = () => {
    // v31 — lampiran yang menunggu dikirim duluan (teks composer ikut sebagai
    // caption di pesan media yang sama).
    if (pendingFile) {
      if (!uploading) void sendFile();
      return;
    }
    if (pendingImage) {
      if (!uploading) void sendImage();
      return;
    }
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
    // v42 — slash commands diparse di klien: /dadu /koin /me /shrug.
    const slash = applySlashCommand(content, ADMIN_NAME);
    if (slash.handled) {
      setInput("");
      setSendError(false);
      if (slash.text && !emitMessage(slash.text, "text")) setInput(content);
      return;
    }
    if (!emitMessage(content, "text")) setInput(content);
  };

  /* v5 — reactions / edit / translate / pin on bubbles. */
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

  /* v11 — pin via admin:pin/unpin (bisa pin pesan siapa pun) + ack memperbarui banner. */
  const togglePin = (msg: ChatMessage) => {
    const id = activeIdRef.current;
    const socket = socketRef.current;
    if (!id || !socket) return;
    if (pinnedMap[id]?.id === msg.id) {
      socket.emit("admin:unpin", { conversationId: id }, (res: AckOf<AdminPinAck>) => {
        if (res.ok) setPinnedMap((prev) => ({ ...prev, [id]: null }));
      });
    } else {
      socket.emit("admin:pin", { messageId: msg.id }, (res: AckOf<AdminPinAck>) => {
        if (res.ok) {
          setPinnedMap((prev) => ({
            ...prev,
            [res.conversationId]: res.pinnedMessage
              ? {
                  id: res.pinnedMessage.messageId,
                  snippet: res.pinnedMessage.snippet,
                  senderName: res.pinnedMessage.senderName,
                }
              : null,
          }));
        }
      });
    }
  };

  const quickSend = (text: string) => {
    if (!emitMessage(text, "text")) showMenuNotice("Gagal mengirim balasan cepat");
  };

  const scrollToMessage = (id: number) => {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ---------------------------------------------------------------- */
  /* v22 — bintang, teruskan, kirim terjadwal                           */
  /* ---------------------------------------------------------------- */

  /* Ikon jenis pesan untuk daftar ringkas (bintang & teruskan). */
  const messageKindIcon = (type: string) => {
    if (type === "image") return <ImageIcon className="size-4" aria-hidden="true" />;
    if (type === "voice") return <Mic className="size-4" aria-hidden="true" />;
    if (type === "file") return <FileText className="size-4" aria-hidden="true" />;
    return <MessageSquare className="size-4" aria-hidden="true" />;
  };

  /* Ringkasan satu baris pesan (caption menang utk foto/file). */
  const snippetOfMessage = (m: ChatMessage) =>
    messagePreview(m.type, m.content, !!m.deletedAt, m.fileName, !!m.mediaExpiredAt, m.caption);

  /* Toggle bintang: optimistis dulu (tambah/hapus "admin"), lalu koreksi
   * dari ack server — gagal → rollback + toast. */
  const toggleStar = useCallback((messageId: number) => {
    const socket = socketRef.current;
    const convId = activeIdRef.current;
    if (!socket || !convId) return;
    const flipStar = (m: ChatMessage): ChatMessage => {
      const cur = m.starredBy ?? [];
      const next = cur.includes(ADMIN_ID)
        ? cur.filter((x) => x !== ADMIN_ID)
        : [...cur, ADMIN_ID];
      return { ...m, starredBy: next.length > 0 ? next : undefined };
    };
    setMessagesMap((prev) => {
      const list = prev[convId];
      if (!list) return prev;
      return { ...prev, [convId]: list.map((m) => (m.id === messageId ? flipStar(m) : m)) };
    });
    socket.emit("messages:star", { messageId }, (res: AckOf<StarAck>) => {
      if (!res.ok) {
        // Server menolak & tidak ada broadcast koreksi → rollback optimistic.
        setMessagesMap((prev) => {
          const list = prev[convId];
          if (!list) return prev;
          return { ...prev, [convId]: list.map((m) => (m.id === messageId ? flipStar(m) : m)) };
        });
        toast.error("Gagal mengubah bintang pesan.");
      }
    });
  }, []);

  /* Panel pesan berbintang: ambil daftar (bintang milik admin) saat dibuka. */
  useEffect(() => {
    if (!starredOpen || !activeId) return;
    setStarredLoading(true);
    socketRef.current?.emit(
      "messages:starred",
      { conversationId: activeId },
      (res: AckOf<StarredListAck>) => {
        setStarredLoading(false);
        if (res.ok) setStarredList(res.messages);
        else {
          setStarredList([]);
          toast.error("Gagal memuat pesan berbintang.");
        }
      }
    );
  }, [starredOpen, activeId]);

  const jumpToStarred = (id: number) => {
    setStarredOpen(false);
    requestAnimationFrame(() => scrollToMessage(id));
  };

  /* Teruskan: pilih pesan → pilih percakapan tujuan → emit. */
  const openForwardDialog = () => {
    setForwardStep("message");
    setForwardMessage(null);
    setForwardOpen(true);
  };

  const resetForward = () => {
    setForwardOpen(false);
    setForwardStep("message");
    setForwardMessage(null);
  };

  const confirmForward = (target: ConversationOverview) => {
    const msg = forwardMessage;
    const socket = socketRef.current;
    if (!msg || !socket) return;
    socket.emit(
      "messages:forward",
      { messageId: msg.id, targetConversationId: target.id },
      (res: AckOf<ForwardAck>) => {
        if (res.ok) {
          toast.success(`Diteruskan ke ${target.partner.name}`);
          resetForward();
        } else if (res.error === "FORBIDDEN") {
          toast.error("Tidak diizinkan meneruskan pesan ini.");
        } else if (res.error === "NOT_FOUND") {
          toast.error("Pesan atau percakapan tujuan tidak ditemukan.");
        } else if (res.error === "INVALID_MESSAGE") {
          toast.error("Jenis pesan ini tidak bisa diteruskan.");
        } else {
          toast.error("Gagal meneruskan pesan.");
        }
      }
    );
  };

  /* Kirim terjadwal: default +1 jam tiap dialog dibuka. */
  const handleSchedOpenChange = (open: boolean) => {
    setSchedOpen(open);
    if (open) setSchedValue(toLocalInputValue(Date.now() + 3_600_000));
  };

  const scheduleSend = () => {
    const socket = socketRef.current;
    const convId = activeIdRef.current;
    const content = input.trim();
    const ms = schedValue ? new Date(schedValue).getTime() : NaN;
    if (!socket || !convId || !content || !Number.isFinite(ms)) return;
    socket.emit(
      "messages:send",
      {
        conversationId: convId,
        content,
        type: "text",
        replyToId: replyTo?.id,
        scheduledAt: ms,
        // v42 — pengulangan opsional: harian / mingguan.
        ...(schedRepeat ? { repeat: schedRepeat } : {}),
      },
      (res: SendAckV22) => {
        if (res.ok) {
          const jam = new Date(ms).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          });
          toast.success(
            schedRepeat === "daily"
              ? `Pesan dijadwalkan pukul ${jam} (berulang harian)`
              : schedRepeat === "weekly"
                ? `Pesan dijadwalkan pukul ${jam} (berulang mingguan)`
                : `Pesan dijadwalkan pukul ${jam}`
          );
          setReplyTo(null);
          setInput("");
          saveDraft("admin", convId, "");
          setSchedOpen(false);
          setSchedRepeat("");
        } else if (res.error === "INVALID_SCHEDULE") {
          toast.error("Jadwal tidak valid — pilih waktu antara 10 detik dan 30 hari dari sekarang.");
        } else if (res.error === "RATE_LIMITED") {
          toast.error("Terlalu sering mengirim — tunggu sebentar.");
        } else {
          toast.error("Gagal menjadwalkan pesan.");
        }
      }
    );
  };

  /* Batalkan pesan terjadwal (setelah konfirmasi AlertDialog). */
  const confirmCancelScheduled = () => {
    const id = cancelSchedId;
    setCancelSchedId(null);
    if (!id) return;
    socketRef.current?.emit(
      "messages:schedule_cancel",
      { messageId: id },
      (res: AckOf<ScheduleCancelAck>) => {
        if (res.ok) toast.success("Pesan terjadwal dibatalkan.");
        else toast.error("Gagal membatalkan pesan terjadwal.");
      }
    );
  };

  /* Kandidat forward: 50 pesan terbaru yang layak diteruskan. */
  const forwardCandidates = useMemo(() => {
    if (!activeId) return [];
    return (messagesMap[activeId] ?? [])
      .filter((m) => m.type !== "system" && !m.deletedAt && !!m.content && !m.scheduledAt)
      .slice(-50)
      .reverse();
  }, [messagesMap, activeId]);

  /* Target forward: percakapan LAIN dari inbox (admin peserta semua). */
  const forwardTargets = useMemo(
    () => conversations.filter((c) => c.id !== activeId),
    [conversations, activeId]
  );

  /* v5 — archive / restore the active conversation. */
  const toggleArchive = (conversationId: string, currentlyArchived: boolean) => {
    socketRef.current?.emit("conversation:archive", {
      conversationId,
      archived: !currentlyArchived,
    });
  };

  /* v42 — pasang pesan menghilang (TTL) utk percakapan (admin saja). */
  const setTtl = (conversationId: string, hours: number) => {
    socketRef.current?.emit(
      "conversation:ttl",
      { conversationId, hours },
      (res: AckOf<TtlSetAck>) => {
        if (res.ok) {
          setTtlMap((prev) => ({ ...prev, [conversationId]: res.hours }));
          toast.success(
            res.hours > 0
              ? `Pesan menghilang: ${ttlLabel(res.hours)} — pesan baru otomatis terhapus.`
              : "Pesan menghilang dimatikan."
          );
        } else toast.error("Gagal mengatur pesan menghilang.");
      }
    );
  };

  /* v42 — polling: admin memilih opsi (optimistis myVote; ack mengoreksi). */
  const handlePollVote = (conversationId: string, messageId: number, optionIdx: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    setMessagesMap((prev) => {
      const list = prev[conversationId];
      if (!list) return prev;
      return {
        ...prev,
        [conversationId]: list.map((m) =>
          m.id === messageId && m.poll ? { ...m, poll: { ...m.poll, myVote: optionIdx } } : m
        ),
      };
    });
    socket.emit(
      "messages:poll_vote",
      { messageId, optionIdx },
      (res: AckOf<PollVoteAck>) => {
        if (!res.ok) {
          toast.error("Gagal menyimpan suara.");
          return;
        }
        setMessagesMap((prev) => {
          const list = prev[conversationId];
          if (!list) return prev;
          return {
            ...prev,
            [conversationId]: list.map((m) =>
              m.id === messageId && m.poll
                ? {
                    ...m,
                    poll: {
                      ...m.poll,
                      counts: res.counts,
                      total: res.total,
                      myVote: res.myVote,
                    },
                  }
                : m
            ),
          };
        });
      }
    );
  };

  /* v42 — pengingat pesan: preset "1 jam" / "Besok 09.00" / "Pekan depan". */
  const remindAtFor = (preset: "1h" | "besok" | "pekan"): number => {
    if (preset === "1h") return Date.now() + 3_600_000;
    const d = new Date();
    d.setDate(d.getDate() + (preset === "besok" ? 1 : 7));
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };

  const handleRemind = (msg: ChatMessage, preset: "1h" | "besok" | "pekan") => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(
      "messages:remind",
      { messageId: msg.id, remindAtMs: remindAtFor(preset) },
      (res: AckOf<RemindAck>) => {
        if (res.ok) toast.success("⏰ Pengingat dipasang.");
        else toast.error("Gagal memasang pengingat (maks 50 aktif).");
      }
    );
  };

  /* v42 — unduh PDF percakapan aktif (murni klien via window.print). */
  const exportPdf = () => {
    const conv = conversations.find((c) => c.id === activeIdRef.current);
    const list = activeIdRef.current ? messagesMap[activeIdRef.current] ?? [] : [];
    const ok = exportChatPdf(list, {
      title: `Chat dengan ${conv?.partner.name ?? "Pengguna"}`,
      subtitle: `${list.length} pesan`,
      viewerId: ADMIN_ID,
      viewerName: "Admin",
      partnerName: conv?.partner.name ?? "Pengguna",
    });
    if (!ok) toast.error("Popup diblokir — izinkan popup untuk mengunduh PDF.");
  };

  /* v5 — QR / share dialog. */
  const openQr = () => {
    const u = new URL(window.location.href);
    u.search = "";
    u.hash = "";
    const url = u.toString();
    setQrUrl(url);
    setQrDataUrl(null);
    setQrOpen(true);
    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: "#065f46", light: "#ffffff" },
    })
      .then((dataUrl) => setQrDataUrl(dataUrl))
      .catch(() => setQrDataUrl(null));
  };

  const copyQrUrl = () => {
    void navigator.clipboard.writeText(qrUrl).catch(() => {});
  };

  /* v8 — pagination: muat satu halaman riwayat yang lebih lama untuk
   * percakapan aktif, lalu kembalikan posisi scroll tanpa lompat. */
  const loadOlder = () => {
    const id = activeIdRef.current;
    const list = id ? messagesMap[id] : undefined;
    const first = list?.[0];
    if (!id || !first || loadingOlder) return;
    setLoadingOlder(true);
    const container = scrollRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    socketRef.current?.emit(
      "messages:older",
      { conversationId: id, beforeId: first.id },
      (res: AckOf<OlderMessagesAck>) => {
        setLoadingOlder(false);
        if (!res.ok) return;
        setHasMoreMap((prev) => ({ ...prev, [id]: res.hasMore }));
        setMessagesMap((prev) => {
          const current = prev[id] ?? [];
          const seen = new Set(current.map((m) => m.id));
          const older = res.messages.filter((m) => !seen.has(m.id));
          return older.length > 0 ? { ...prev, [id]: [...older, ...current] } : prev;
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

  /* v31 — lampiran dipecah per jenis (foto/video/audio/file) dengan ikon &
   * filter sesuai; hasilnya TANPA popup — chip pratinjau inline ala foto. */
  const openFilePicker = (accept: string) => {
    const el = fileInputRef.current;
    if (!el) return;
    el.accept = accept;
    el.click();
  };

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
    setPendingFile({
      file,
      ...(file.type.startsWith("video/") ? { previewUrl: URL.createObjectURL(file) } : {}),
    });
  };

  /** v31 — buang lampiran menunggu + bebaskan URL pratinjau videonya. */
  const dismissPendingFile = () => {
    setPendingFile((p) => {
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return null;
    });
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
        dismissPendingFile();
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
    if (activeIdRef.current) saveDraft("admin", activeIdRef.current, value);
    const socket = socketRef.current;
    const id = activeIdRef.current;
    if (!socket || !id || !connected) return;
    socket.emit("typing", { conversationId: id, isTyping: true });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit("typing", { conversationId: id, isTyping: false });
    }, 1500);
  };

  /* v5 — keyboard shortcuts: Alt+↑/↓ switch conversations, / focuses search. */
  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        filterInputRef.current?.focus();
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const list = filteredConversations;
        if (list.length === 0) return;
        const idx = activeIdRef.current
          ? list.findIndex((c) => c.id === activeIdRef.current)
          : -1;
        let next: number;
        if (idx === -1) next = 0;
        else if (e.key === "ArrowDown") next = Math.min(list.length - 1, idx + 1);
        else next = Math.max(0, idx - 1);
        if (list[next]) handleSelectConversation(list[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed, filteredConversations, handleSelectConversation]);

  /* ---------------------------------------------------------------- */
  /* Render: login                                                     */
  /* ---------------------------------------------------------------- */
  if (!authed) {
    return (
      <div className="login-bg relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4 pb-10">
        {/* Toggle tema mengambang — layar login tidak punya header */}
        <div className="absolute right-2 top-2 z-10">
          <ThemeToggle />
        </div>
        {/* Blob dekoratif mengambang */}
        <div
          className="animate-float-slow pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-emerald-400/25 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="animate-float-slow pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full bg-teal-400/25 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative z-10 w-full max-w-md">
          {/* Brand di luar kartu — konsisten dengan login user */}
          <div className="mb-5 flex flex-col items-center gap-2.5 text-center">
            {appLogoUrl(appSettings) ? (
              <span
                className="flex size-16 items-center justify-center overflow-hidden rounded-[1.4rem] bg-white/70 shadow-lg ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10"
                aria-hidden="true"
              >
                <img src={appLogoUrl(appSettings) ?? ""} alt="" className="size-full object-contain" />
              </span>
            ) : (
              <span
                className="flex size-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30"
                aria-hidden="true"
              >
                <ShieldCheck className="size-8" />
              </span>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Panel Admin</h1>
              <p className="text-sm text-muted-foreground">
                Baca dan balas pesan dari semua user di satu tempat
              </p>
            </div>
          </div>
          <div className="glass-card rounded-3xl p-6">
            <form
              className="space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="admin-password">Password Admin</Label>
                <Input
                  id="admin-password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={cn(
                    "h-12 rounded-xl bg-white/70 dark:bg-white/5",
                    pwCorrect &&
                      "border-emerald-500/70 text-emerald-600 focus-visible:ring-emerald-500/30 dark:text-emerald-400"
                  )}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthError(null);
                  }}
                />
              </div>
              {totpRequired ? (
                <div className="space-y-2">
                  <Label htmlFor="admin-totp">Kode 2FA (6 digit)</Label>
                  <Input
                    id="admin-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    placeholder="123456"
                    className="h-12 rounded-xl text-center text-lg tracking-[0.4em]"
                    autoFocus
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setTotpCode(v);
                      setAuthError(null);
                      if (v.length === 6) {
                        const pw = passwordRef.current ?? password.trim();
                        if (pw) emitAdminAuth(pw, v);
                      }
                    }}
                  />
                </div>
              ) : null}
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              {/* v24 — tanpa tombol Masuk: password benar → hijau → jeda
                  sinkronisasi database → autologin. Enter tetap berfungsi. */}
              {pwCorrect ? (
                <p
                  className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Password benar — menyinkronkan database…
                </p>
              ) : !connected ? (
                <p className="text-xs text-muted-foreground">Menghubungkan…</p>
              ) : null}
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" />
                Demo: password default {ADMIN_PASSWORD_HINT}
              </p>
            </form>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: inbox (Telegram-style split view)                         */
  /* ---------------------------------------------------------------- */
  const showSidebar = !isMobile || !activeId;
  const showChatPane = !isMobile || activeId !== null;
  const maintenanceOn = appSettings?.maintenanceMode ?? false;

  const partnerStatus = activeTyping
    ? "sedang mengetik…"
    : activeConversation?.partner.statusText
      ? activeConversation.partner.statusText
      : activeConversation?.partner.online
        ? "Online"
        : formatLastSeen(activeConversation?.partner.lastSeenAt);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* v10 — kunci layar: overlay penuh, buka kunci dengan password admin */}
      {locked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur">
          <Card className="w-full max-w-sm rounded-2xl">
            <CardHeader className="items-center text-center">
              <span
                className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30"
                aria-hidden="true"
              >
                <LockKeyhole className="size-6" />
              </span>
              <CardTitle className="text-xl">Layar Terkunci</CardTitle>
              <CardDescription>
                Masukkan password admin untuk melanjutkan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  unlock();
                }}
              >
                <Input
                  autoFocus
                  type="password"
                  value={lockPin}
                  autoComplete="current-password"
                  aria-label="Password admin"
                  className="h-12 rounded-xl text-center bg-white/70 dark:bg-white/5"
                  onChange={(e) => {
                    setLockPin(e.target.value);
                    setLockError(null);
                  }}
                />
                {lockError ? <p className="text-center text-sm text-destructive">{lockError}</p> : null}
                <Button
                  type="submit"
                  className="btn-gradient h-12 w-full rounded-xl font-semibold text-white"
                  disabled={!lockPin.trim() || !connected}
                >
                  Buka kunci
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full text-muted-foreground hover:text-destructive"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Keluar dari admin
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Reconnecting strip */}
        {!connected ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Koneksi terputus — mencoba menyambung ulang…
          </p>
        ) : null}
        {/* v10 — banner mode pemeliharaan (live dari dashboard) */}
        {maintenanceOn ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            🛠 Mode pemeliharaan aktif{appSettings?.maintenanceNote ? ` — ${appSettings.maintenanceNote}` : ""}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr]">
          {/* ------------------------- Sidebar ------------------------- */}
          {showSidebar ? (
            <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden md:border-r">
              {/* Profile */}
              <div className="z-10 flex items-center gap-3 border-b bg-card/85 p-3 backdrop-blur-md">
                <Avatar className="size-10">
                  {appLogoUrl(appSettings) ? (
                    <AvatarImage src={appLogoUrl(appSettings) ?? ""} alt="Logo aplikasi" />
                  ) : null}
                  <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-semibold text-white">
                    {initials(ADMIN_NAME)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold leading-tight">
                    {ADMIN_NAME}
                    {actorRole === "moderator" ? (
                      <Badge className="bg-amber-500 px-1.5 py-0 text-[10px] text-white">
                        Moderator
                      </Badge>
                    ) : null}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-block size-1.5 shrink-0 rounded-full",
                        connected ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )}
                    />
                    Panel Admin · {connected ? "Online" : "Menghubungkan…"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* v10 — menu aplikasi (⋮ emerald): dashboard + pengelolaan */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        aria-label="Menu aplikasi"
                        title="Menu aplikasi"
                      >
                        <span className="relative">
                          <MoreVertical className="size-4 text-emerald-600" aria-hidden="true" />
                          {maintenanceOn ? (
                            <span
                              aria-hidden="true"
                              className="absolute -right-1 -top-1 size-1.5 rounded-full bg-amber-500"
                            />
                          ) : null}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Panel aplikasi</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => openDashboard("ringkasan")}>
                        <GaugeCircle className="mr-2 size-4" aria-hidden="true" />
                        Dashboard aplikasi
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openDashboard("siaran")}>
                        <Megaphone className="mr-2 size-4" aria-hidden="true" />
                        Siaran pesan
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openDashboard("siaran")}>
                        <Bell className="mr-2 size-4" aria-hidden="true" />
                        Pengumuman
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={toggleMaintenance}
                        className={cn(maintenanceOn && "bg-amber-500/10")}
                      >
                        <Wrench className="mr-2 size-4" aria-hidden="true" />
                        Mode pemeliharaan: {maintenanceOn ? "aktif" : "nonaktif"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openDashboard("sistem")}>
                        <ShieldCheck className="mr-2 size-4" aria-hidden="true" />
                        Info aplikasi
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={downloadBackup}>
                        <FileJson className="mr-2 size-4" aria-hidden="true" />
                        Unduh backup JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={runVacuum}>
                        <DatabaseBackup className="mr-2 size-4" aria-hidden="true" />
                        Kompres VACUUM
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Intelijen &amp; moderasi</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          setUmTarget(null);
                          setUmOpen(true);
                        }}
                      >
                        <Users className="mr-2 size-4" aria-hidden="true" />
                        Manajemen pengguna
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setForensicsOpen(true)}>
                        <ShieldAlert className="mr-2 size-4" aria-hidden="true" />
                        Forensik
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMsgSearchOpen(true)}>
                        <Search className="mr-2 size-4" aria-hidden="true" />
                        Pencarian pesan
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setAuditOpen(true)}>
                        <ScrollText className="mr-2 size-4" aria-hidden="true" />
                        Audit log
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setKeywordsOpen(true)}>
                        <Flag className="mr-2 size-4" aria-hidden="true" />
                        Kata terlarang
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQuickRepliesOpen(true)}>
                        <Zap className="mr-2 size-4" aria-hidden="true" />
                        Balasan cepat
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Sinyal palsu</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={toggleAlwaysOnline}
                        className={cn(alwaysOnline && "bg-accent")}
                      >
                        <Radio className="mr-2 size-4" aria-hidden="true" />
                        Selalu online: {alwaysOnline ? "aktif" : "nonaktif"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setFakeLastSeenOpen(true)}>
                        <Clock className="mr-2 size-4" aria-hidden="true" />
                        Last seen palsu…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={toggleMirror}
                        className={cn(mirror && "bg-accent")}
                      >
                        <Repeat className="mr-2 size-4" aria-hidden="true" />
                        Mode cermin: {mirror ? "aktif" : "nonaktif"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Sesi &amp; tampilan</DropdownMenuLabel>
                      <DropdownMenuItem onClick={openQr}>
                        <QrCode className="mr-2 size-4" aria-hidden="true" />
                        QR code undangan
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={toggleGhost}
                        className={cn(ghost && "bg-accent")}
                      >
                        <EyeOff className="mr-2 size-4" aria-hidden="true" />
                        Mode hantu: {ghost ? "aktif" : "nonaktif"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={lockNow}>
                        <LockKeyhole className="mr-2 size-4" aria-hidden="true" />
                        Kunci layar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                        {resolvedTheme === "dark" ? (
                          <Sun className="mr-2 size-4" aria-hidden="true" />
                        ) : (
                          <Moon className="mr-2 size-4" aria-hidden="true" />
                        )}
                        Tema {resolvedTheme === "dark" ? "terang" : "gelap"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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

              {/* Filter */}
              <div className="p-3 pb-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    ref={filterInputRef}
                    value={filter}
                    placeholder="Cari user… ( / )"
                    aria-label="Cari user"
                    className="h-10 pl-9"
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <div className="mt-2 flex gap-1">
                  {(
                    [
                      { key: "all", label: "Semua" },
                      {
                        key: "unread",
                        label: `Belum dibaca${unreadCount ? ` (${unreadCount})` : ""}`,
                      },
                      { key: "online", label: "Online" },
                      {
                        key: "archive",
                        label: `Arsip${conversations.some((c) => c.archived) ? "" : ""}`,
                      },
                    ] as { key: FilterTab; label: string }[]
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={filterTab === t.key}
                      className={cn(
                        "h-7 rounded-full px-2.5 text-xs",
                        filterTab === t.key
                          ? "bg-emerald-600 text-white"
                          : "bg-muted/60 text-muted-foreground hover:bg-accent"
                      )}
                      onClick={() => setFilterTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversation list — every user, newest activity first */}
              <div className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="flex flex-col gap-1 p-2">
                  {filteredConversations.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {conversations.length === 0
                        ? "Belum ada user yang chat."
                        : "Tidak ada hasil."}
                    </p>
                  ) : (
                    filteredConversations.map((c) => {
                      const isActive = c.id === activeId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent",
                            isActive && "bg-accent"
                          )}
                          onClick={() => handleSelectConversation(c.id)}
                        >
                          <span className="relative shrink-0">
                            <Avatar className="size-10">
                              <AvatarFallback
                                className={cn(
                                  "text-sm font-semibold text-white",
                                  avatarColorClass(c.partner.name)
                                )}
                              >
                                {initials(c.partner.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
                                c.partner.online ? "bg-emerald-500" : "bg-muted-foreground/40"
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold">
                                {c.partner.name}
                              </span>
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {typingMap[c.id]
                                ? "sedang mengetik…"
                                : c.lastMessage
                                  ? `${
                                      c.lastMessage.senderId === ADMIN_ID ? "Anda: " : ""
                                    }${messagePreview(
                                      c.lastMessage.type,
                                      c.lastMessage.content,
                                      c.lastMessage.deleted,
                                      lastFileName(c.lastMessage),
                                      lastMediaExpired(c.lastMessage),
                                      c.lastMessage.caption
                                    )}`
                                  : "Belum ada pesan"}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              {c.lastMessage
                                ? formatChatTime(c.lastMessage.createdAt)
                                : formatChatTime(c.lastMessageAt)}
                            </span>
                            {c.unread > 0 ? (
                              <Badge className="h-5 min-w-5 rounded-full bg-emerald-600 px-1 text-[10px] text-white">
                                {c.unread > 99 ? "99+" : c.unread}
                              </Badge>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </aside>
          ) : null}

          {/* ------------------------ Chat pane ------------------------ */}
          {showChatPane ? (
            activeId && activeConversation ? (
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="z-10 flex items-center gap-2 border-b bg-card/85 p-3 backdrop-blur-md">
                  {isMobile ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label="Kembali ke daftar"
                      onClick={handleBackToList}
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <span className="relative shrink-0">
                    <Avatar className="size-10">
                      <AvatarFallback
                        className={cn(
                          "text-sm font-semibold text-white",
                          avatarColorClass(activeConversation.partner.name)
                        )}
                      >
                        {initials(activeConversation.partner.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
                        activeConversation.partner.online
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/40"
                      )}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">
                      {activeConversation.partner.name}
                    </p>
                    <p
                      className={cn(
                        "truncate text-xs",
                        activeTyping || activeConversation.partner.online
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
                          aria-label="Menu lainnya"
                          title="Menu lainnya"
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        {/* v22+ — fitur bintang/teruskan digabung ke menu lainnya. */}
                        <DropdownMenuItem onClick={() => setStarredOpen(true)}>
                          <Star className="mr-2 size-4" aria-hidden="true" />
                          Pesan berbintang
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={openForwardDialog}>
                          <Forward className="mr-2 size-4" aria-hidden="true" />
                          Teruskan pesan
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            toggleArchive(activeConversation.id, !!activeConversation.archived)
                          }
                        >
                          {activeConversation.archived ? (
                            <ArchiveRestore className="mr-2 size-4" aria-hidden="true" />
                          ) : (
                            <Archive className="mr-2 size-4" aria-hidden="true" />
                          )}
                          {activeConversation.archived
                            ? "Buka dari arsip"
                            : "Arsipkan percakapan"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={toggleDataSaver}
                          className={cn(dataSaver && "bg-accent")}
                        >
                          <Leaf className="mr-2 size-3.5" aria-hidden="true" />
                          Hemat data: {dataSaver ? "aktif" : "nonaktif"}
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* v11 — bilah alat admin percakapan aktif */}
                <div
                  className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1"
                  role="toolbar"
                  aria-label="Alat moderasi admin"
                >
                  <button
                    type="button"
                    aria-pressed={!!fakeTypingMap[activeConversation.id]}
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                      fakeTypingMap[activeConversation.id]
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    onClick={() => toggleFakeTyping(activeConversation.id)}
                  >
                    ⌨ Typing palsu
                  </button>
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => setReceiptsConfirm(true)}
                  >
                    ✓✓ Palsu
                  </button>
                  {/* v38 — kontrol user lengkap: cheat, media, insight (per user) */}
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-600 hover:text-white dark:text-violet-300"
                    onClick={() =>
                      setCheatTarget({
                        id: activeConversation.partner.id,
                        name: activeConversation.partner.name,
                      })
                    }
                  >
                    🎭 Cheat
                  </button>
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      setMediaTarget({
                        id: activeConversation.partner.id,
                        name: activeConversation.partner.name,
                      })
                    }
                  >
                    🖼 Media
                  </button>
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500 hover:text-white dark:text-amber-300"
                    onClick={() =>
                      setInsightTarget({
                        id: activeConversation.partner.id,
                        name: activeConversation.partner.name,
                        messages: 0,
                        lastSeenAt:
                          activeConversation.partner.lastSeenAt ?? new Date().toISOString(),
                        online: activeConversation.partner.online,
                      })
                    }
                  >
                    💡 Insight
                  </button>
                  {/* v41 — pusat AI admin (ringkasan/asisten/media/gambar/moderasi) */}
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white dark:text-emerald-300"
                    onClick={() => setAiOpen(true)}
                  >
                    🤖 AI
                  </button>
                  {/* v44 — call suara/video WebRTC ke partner (moderator disembunyikan) */}
                  {actorRole !== "moderator" ? (
                    <>
                      <button
                        type="button"
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-600 hover:text-white dark:text-violet-300"
                        onClick={() => startCall("audio")}
                      >
                        📞 Call
                      </button>
                      <button
                        type="button"
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-600 hover:text-white dark:text-teal-300"
                        onClick={() => startCall("video")}
                      >
                        🎥 Video Call
                      </button>
                    </>
                  ) : null}
                  {/* v42 — pesan menghilang (TTL per percakapan) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                          (ttlMap[activeConversation.id] ?? 0) > 0
                            ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <Hourglass className="size-3" aria-hidden="true" />
                        Menghilang: {ttlLabel(ttlMap[activeConversation.id] ?? 0)}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel className="text-xs">
                        Pesan menghilang
                      </DropdownMenuLabel>
                      {TTL_OPTIONS.map((o) => (
                        <DropdownMenuItem
                          key={o.hours}
                          className={cn(
                            (ttlMap[activeConversation.id] ?? 0) === o.hours && "bg-accent"
                          )}
                          onClick={() => setTtl(activeConversation.id, o.hours)}
                        >
                          {o.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        Ekspor chat
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => exportChat("txt")}>
                        Ekspor TXT
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportChat("json")}>
                        Ekspor JSON
                      </DropdownMenuItem>
                      {/* v42 — unduh PDF via window.print (murni klien) */}
                      <DropdownMenuItem onClick={exportPdf}>
                        <FileDown className="mr-2 size-3.5" aria-hidden="true" />
                        Unduh PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {actorRole !== "moderator" ? (
                    <button
                      type="button"
                      className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                      onClick={() => setResetConfirm(true)}
                    >
                      Reset chat
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setUmTarget(activeConversation.partner.id);
                      setUmOpen(true);
                    }}
                  >
                    Info user
                  </button>
                </div>

                {/* Pinned message banner (v5 + senderName v11 + unpin admin) */}
                {pinnedMap[activeConversation.id] ? (
                  <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/5 px-3 py-1.5 text-xs">
                    <Pin className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => scrollToMessage(pinnedMap[activeConversation.id]!.id)}
                    >
                      {pinnedMap[activeConversation.id]!.senderName ? (
                        <span className="font-medium text-amber-600">
                          {pinnedMap[activeConversation.id]!.senderName}:{" "}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {pinnedMap[activeConversation.id]!.snippet}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Lepas pin"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={unpinActive}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}

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
                    {hasMoreMap[activeConversation.id] && visibleMessages.length > 0 ? (
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
                          Belum ada pesan dari {activeConversation.partner.name}.
                        </p>
                      )
                    ) : (
                      visibleMessages.map((m, idx) => (
                        <div key={m.id} className="contents">
                          {/* v10 — pemisah tanggal di pesan pertama tiap hari */}
                          {idx === 0 ||
                          dayKey(visibleMessages[idx - 1].createdAt) !==
                            dayKey(m.createdAt) ? (
                            <DaySeparator createdAt={m.createdAt} />
                          ) : null}
                          {m.id === unreadDividerId ? (
                            <div
                              className="my-1 flex items-center gap-2"
                              role="separator"
                              aria-label="Pesan baru"
                            >
                              <span className="h-px flex-1 bg-rose-500/40" aria-hidden="true" />
                              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                Pesan baru
                              </span>
                              <span className="h-px flex-1 bg-rose-500/40" aria-hidden="true" />
                            </div>
                          ) : null}
                          <ChatBubble
                            key={m.id}
                            messageId={m.id}
                          content={m.content}
                          createdAt={m.createdAt}
                          side={m.senderId === ADMIN_ID ? "right" : "left"}
                          type={m.type}
                          deleted={!!m.deletedAt}
                          fileName={m.fileName}
                          fileSize={m.fileSize}
                          mimeType={m.mimeType}
                          thumbUrl={m.thumbUrl}
                          caption={m.caption}
                          mediaExpired={!!m.mediaExpiredAt}
                          dataSaver={dataSaver}
                          read={m.senderId === ADMIN_ID && m.id <= activeConversation.partnerLastReadId}
                          replyTo={m.replyTo}
                          replyAuthor={m.replyTo?.senderId === ADMIN_ID ? "Anda" : activeConversation.partner.name}
                          durationMs={m.durationMs}
                          transcript={m.transcript}
                          onSpeak={
                            m.type === "text" && !m.deletedAt && !m.scheduledAt
                              ? () => handleAiSpeak(m)
                              : undefined
                          }
                          speaking={speakingId === m.id}
                          onTranscribe={
                            m.type === "voice" && !m.deletedAt && !m.mediaExpiredAt
                              ? () => handleAiTranscribe(m)
                              : undefined
                          }
                          transcribing={aiTranscribing === m.id}
                          reactions={m.reactions}
                          myUserId={ADMIN_ID}
                          edited={!!m.editedAt}
                          translation={m.translation}
                          translating={translatingId === m.id}
                          pinned={pinnedMap[activeConversation.id]?.id === m.id}
                          canEdit={canEditMessage(m, ADMIN_ID)}
                          canPin
                          onReply={() => setReplyTo(m)}
                          onDelete={() => handleDelete(m)}
                          onMediaOpen={() => setViewer(viewerStateForMessage(mediaGallery, m))}
                          onReact={(emoji) => handleReact(m, emoji)}
                          onEdit={() => handleEditStart(m)}
                          onTranslate={
                            m.senderId !== ADMIN_ID && m.type === "text" && !m.deletedAt
                              ? () => handleTranslate(m)
                              : undefined
                          }
                          onPin={() => togglePin(m)}
                          starred={!!m.starredBy?.includes(ADMIN_ID)}
                          onToggleStar={() => toggleStar(m.id)}
                          scheduledAt={m.scheduledAt}
                          poll={m.poll}
                          onPollVote={
                            !m.deletedAt && m.poll
                              ? (idx) => handlePollVote(activeConversation.id, m.id, idx)
                              : undefined
                          }
                          onRemind={
                            !m.deletedAt && m.type !== "system"
                              ? (preset) => handleRemind(m, preset)
                              : undefined
                          }
                          forwardedFrom={m.forwardedFrom}
                          onCancelScheduled={
                            m.senderId === ADMIN_ID && m.scheduledAt
                              ? () => setCancelSchedId(m.id)
                              : undefined
                          }
                          onModerate={
                            m.senderId !== ADMIN_ID && !m.deletedAt ? () => setModTarget(m) : undefined
                          }
                          onEditHistory={m.editedAt ? () => setEditHistId(m.id) : undefined}
                          onShowMeta={
                            !m.deletedAt &&
                            !m.mediaExpiredAt &&
                            (m.type === "image" || m.type === "file" || m.type === "voice")
                              ? () =>
                                  setMetaTarget({
                                    messageId: m.id,
                                    label: m.fileName ?? undefined,
                                  })
                              : undefined
                          }
                          />
                          {/* v40 — strip aksi moderasi utk pesan yang menunggu persetujuan. */}
                          {m.pending && !m.deletedAt ? (
                            <div className="mx-2 my-1 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5">
                              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                ⏳ Menunggu persetujuan
                              </span>
                              <Button
                                size="sm"
                                className="h-6 rounded-full px-2.5 text-[11px]"
                                onClick={() => handleModerate(m.id, "approve")}
                              >
                                Setujui
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 rounded-full px-2.5 text-[11px] text-destructive hover:text-destructive"
                                onClick={() => handleModerate(m.id, "reject")}
                              >
                                Tolak
                              </Button>
                            </div>
                          ) : null}
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
                {activeTyping ? (
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
                  <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border-l-2 border-emerald-500 bg-card/90 px-2 py-1.5 text-xs backdrop-blur">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-emerald-600">
                        Balas ke {replyTo.senderId === ADMIN_ID ? "diri sendiri" : activeConversation.partner.name}
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
                  <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border-l-2 border-amber-500 bg-amber-500/10 px-2 py-1.5 text-xs backdrop-blur">
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
                  <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl border bg-card/90 px-2 py-1.5 backdrop-blur">
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

                {/* v31 — chip pratinjau lampiran inline (tanpa popup): video
                 * pakai cuplikan <video>, audio/file pakai ikon jenisnya. */}
                {pendingFile ? (
                  <div className="mx-3 mb-1 flex items-center gap-2.5 rounded-xl border bg-card/90 px-2 py-1.5 backdrop-blur">
                    {pendingFile.previewUrl ? (
                      <video
                        src={pendingFile.previewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-14 w-20 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <FileKindIcon
                          mimeType={pendingFile.file.type}
                          fileName={pendingFile.file.name}
                          className="size-5"
                        />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{pendingFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {uploadProgress != null
                          ? `Mengunggah… ${uploadProgress}%`
                          : `${
                              pendingFile.file.type.startsWith("video/")
                                ? "Video"
                                : pendingFile.file.type.startsWith("audio/")
                                  ? "Audio"
                                  : "File"
                            } siap dikirim · ${formatFileSize(pendingFile.file.size)}`}
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
                      aria-label="Batal kirim lampiran"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={uploading}
                      onClick={dismissPendingFile}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : null}
                {fileError ? (
                  <p className="mx-3 mb-1 px-1 text-xs text-destructive">{fileError}</p>
                ) : null}

                {/* v11 — baris balasan cepat di atas composer */}
                {quickReplies.length > 0 && !recorder.recording ? (
                  <div
                    className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t px-3 py-1.5"
                    aria-label="Balasan cepat"
                  >
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Cepat
                    </span>
                    {quickReplies.slice(0, 8).map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="shrink-0 rounded-full border bg-muted/60 px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                        onClick={() => quickSend(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* v41 — saran balasan AI di atas composer */}
                <AISuggestChips
                  socket={socketRef.current}
                  conversationId={activeConversation?.id ?? null}
                  connected={connected}
                  onPick={(text) => setInput(text.slice(0, MAX_MESSAGE_LENGTH))}
                />

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
                            {/* v31 — lampiran dipecah per jenis: ikon & filter
                             * sesuai (foto→Image, video→Film, audio→Music). */}
                            <DropdownMenuItem onClick={() => openFilePicker("image/*")}>
                              <ImageIcon className="mr-2 size-4" aria-hidden="true" />
                              Foto
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openFilePicker("video/*")}>
                              <Film className="mr-2 size-4" aria-hidden="true" />
                              Video
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openFilePicker("audio/*")}>
                              <Music className="mr-2 size-4" aria-hidden="true" />
                              Audio
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openFilePicker("")}>
                              <Paperclip className="mr-2 size-4" aria-hidden="true" />
                              File
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {/* v42 — buat polling */}
                            <DropdownMenuItem
                              disabled={!connected || !!editing}
                              onClick={() => setPollOpen(true)}
                            >
                              <ListChecks className="mr-2 size-4" aria-hidden="true" />
                              Buat polling
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!connected || !!editing}
                              onClick={() => handleSchedOpenChange(true)}
                            >
                              <Clock className="mr-2 size-4" aria-hidden="true" />
                              Kirim terjadwal
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Input
                          value={input}
                          maxLength={MAX_MESSAGE_LENGTH}
                          placeholder={editing ? "Simpan hasil edit…" : "Tulis balasan…"}
                          aria-label={editing ? "Edit pesan" : "Tulis balasan"}
                          autoComplete="off"
                          disabled={!connected}
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
                      {input.trim() || pendingImage || pendingFile ? (
                        <Button
                          size="icon"
                          className="btn-gradient size-11 shrink-0 rounded-full text-white"
                          aria-label="Kirim"
                          disabled={!connected || uploading || (!input.trim() && !pendingImage && !pendingFile)}
                          onClick={() => {
                            // v31 — lampiran menunggu ikut dikirim bersama teks (caption).
                            if (pendingImage) void sendImage();
                            else if (pendingFile) void sendFile();
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
              </section>
            ) : (
              <section className="chat-wallpaper flex min-h-0 min-w-0 flex-col items-center justify-center gap-4 p-6 text-center">
                <span
                  className="flex size-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30"
                  aria-hidden="true"
                >
                  <MessagesSquare className="size-8" />
                </span>
                <div>
                  <p className="text-base font-semibold">Pilih percakapan</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Pilih chat di kiri untuk membaca dan membalas pesan user
                  </p>
                </div>
              </section>
            )
          ) : null}
        </div>
      </div>

      {/* QR / share dialog (v5) */}
      {qrOpen ? (
        <Dialog open onOpenChange={setQrOpen}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="size-4 text-emerald-600" aria-hidden="true" />
                Bagikan Chat
              </DialogTitle>
              <DialogDescription>
                Orang lain dapat memindai QR ini (atau membuka tautannya) untuk mulai chat dengan Anda.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code link chat"
                  className="h-56 w-56 rounded-xl border"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-xl border bg-muted/40 text-sm text-muted-foreground">
                  Membuat QR…
                </div>
              )}
              <p className="w-full truncate rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
                {qrUrl}
              </p>
              <Button
                variant="outline"
                className="h-10 w-full"
                onClick={copyQrUrl}
              >
                Salin tautan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Viewer media full-screen (foto/video/audio/PDF/dokumen) */}
      <MediaViewer state={viewer} onClose={() => setViewer(null)} />

      {/* v34 — popup pratinjau/pemutar tautan in-app (YouTube/TikTok embed) */}
      <LinkViewerDialog />

      {/* v35 — dialog metadata media (EXIF/GPS) khusus admin */}
      <MediaMetaDialog
        key={metaTarget?.messageId ?? "meta-idle"}
        socket={socketRef.current}
        target={metaTarget}
        onClose={() => setMetaTarget(null)}
      />

      {/* v10 — Dashboard aplikasi (analitik, pengaturan, siaran, sistem) */}
      <AdminDashboard
        open={dashOpen}
        onOpenChange={setDashOpen}
        socket={socketRef.current}
        tab={dashTab}
        onTabChange={setDashTab}
        usingDefaultPassword={usingDefault}
        actorRole={actorRole}
      />

      {/* v11 — Manajemen pengguna (daftar + X-Ray + aksi sesi) */}
      <UserManager
        open={umOpen}
        onOpenChange={setUmOpen}
        socket={socketRef.current}
        initialUserId={umTarget}
        onNotice={showMenuNotice}
      />

      {/* v42 — dialog buat polling */}
      <PollCreateDialog
        key={pollOpen ? "poll-open" : "poll-closed"}
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onConfirm={createPoll}
      />

      {/* v41 — dialog pusat AI admin */}
      <AdminAIDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        socket={socketRef.current}
        conversationId={activeConversation?.id ?? null}
        partnerName={activeConversation?.partner.name ?? ""}
        onOpenMedia={openAiMediaViewer}
      />

      {/* v38 — pusat cheat PER-USER dari toolbar percakapan */}
      <UserCheatDialog
        target={cheatTarget}
        onClose={() => setCheatTarget(null)}
        socket={socketRef.current}
        typingOn={!!(activeId && fakeTypingMap[activeId])}
        onToggleTyping={() => {
          if (activeId) toggleFakeTyping(activeId);
        }}
        /* v45 — daftar user utk fitur clone percakapan. */
        partners={conversations.map((c) => ({ id: c.partner.id, name: c.partner.name }))}
      />

      {/* v38 — kontrol media PER-USER dari toolbar percakapan */}
      <UserMediaDialog
        target={mediaTarget}
        onClose={() => setMediaTarget(null)}
        socket={socketRef.current}
        onOpenViewer={openUserMediaViewer}
      />

      {/* v38 — shortcut insight per-user dari toolbar */}
      <UserInsightDialog
        target={insightTarget}
        socket={socketRef.current}
        onClose={() => setInsightTarget(null)}
      />

      {/* v11 — Forensik (terhapus / ditandai / riwayat edit) */}
      {forensicsOpen ? (
        <ForensicsDialog
          open
          onOpenChange={setForensicsOpen}
          socket={socketRef.current}
          conversations={conversations}
          onNotice={showMenuNotice}
        />
      ) : null}

      {/* v11 — Pencarian pesan global */}
      {msgSearchOpen ? (
        <SearchMessagesDialog
          open
          onOpenChange={setMsgSearchOpen}
          socket={socketRef.current}
          onJump={(cid) => {
            setMsgSearchOpen(false);
            if (cid) handleSelectConversation(cid);
          }}
        />
      ) : null}

      {/* v11 — Audit log */}
      {auditOpen ? (
        <AuditLogDialog open onOpenChange={setAuditOpen} socket={socketRef.current} />
      ) : null}

      {/* v11 — Kata terlarang */}
      {keywordsOpen ? (
        <KeywordsDialog
          open
          onOpenChange={setKeywordsOpen}
          socket={socketRef.current}
          onNotice={showMenuNotice}
        />
      ) : null}

      {/* v11 — Balasan cepat */}
      {quickRepliesOpen ? (
        <QuickRepliesDialog
          open
          onOpenChange={setQuickRepliesOpen}
          socket={socketRef.current}
          onNotice={showMenuNotice}
          onSaved={setQuickReplies}
        />
      ) : null}

      {/* v11 — Last seen palsu */}
      {fakeLastSeenOpen ? (
        <FakeLastSeenDialog
          open
          onOpenChange={setFakeLastSeenOpen}
          socket={socketRef.current}
          onNotice={showMenuNotice}
        />
      ) : null}

      {/* v11 — Riwayat edit pesan (dari aksi bubble / forensik) */}
      {editHistId !== null ? (
        <EditHistoryDialog
          messageId={editHistId}
          socket={socketRef.current}
          onClose={() => setEditHistId(null)}
        />
      ) : null}

      {/* v11 — konfirmasi ✓✓ palsu */}
      <ConfirmDialog
        open={receiptsConfirm}
        onOpenChange={setReceiptsConfirm}
        title="Kirim ✓✓ palsu?"
        description="Semua pesan Anda di chat ini akan tampak SUDAH DIBACA di sisi user, tanpa mengubah data baca di server."
        confirmLabel="Kirim ✓✓ palsu"
        onConfirm={sendFakeReceipts}
      />

      {/* v11 — konfirmasi reset chat */}
      <ConfirmDialog
        open={resetConfirm}
        onOpenChange={setResetConfirm}
        title="Reset chat ini?"
        description="SEMUA pesan percakapan ini dihapus permanen untuk kedua sisi dan pin dibersihkan. Tindakan dicatat di audit log."
        confirmLabel="Ya, reset"
        destructive
        onConfirm={resetActiveConversation}
      />

      {/* v11 — konfirmasi hapus pesan (moderasi) */}
      <ConfirmDialog
        open={!!modTarget}
        onOpenChange={(v) => {
          if (!v) setModTarget(null);
        }}
        title="Hapus pesan (moderasi)?"
        description={
          modTarget
            ? `Pesan dari ${
                modTarget.senderId === ADMIN_ID ? "Anda" : activeConversation?.partner.name
              } dihapus untuk semua pihak (isi asli tersimpan di Forensik).`
            : undefined
        }
        confirmLabel="Hapus"
        destructive
        onConfirm={confirmModerate}
      />

      {/* v40 — dialog buka kunci percakapan ber-PIN */}
      {pinPrompt ? (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) {
              setPinPrompt(null);
              setPinValue("");
              setPinError(null);
            }
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-xs">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="size-4" aria-hidden="true" />
                Percakapan terkunci
              </DialogTitle>
              <DialogDescription>
                Anda memasang PIN untuk percakapan ini. Masukkan PIN untuk membuka.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                type="password"
                inputMode="numeric"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                placeholder="PIN 4–8 digit"
                maxLength={8}
                aria-label="PIN percakapan"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUnlock();
                }}
              />
              {pinError ? <p className="text-xs text-destructive">{pinError}</p> : null}
              <Button
                className="w-full"
                disabled={pinValue.trim().length < 4}
                onClick={handleUnlock}
              >
                Buka kunci
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* v10 — notifikasi singkat aksi menu (backup / vacuum / ghost / dll) */}
      {menuNotice ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg"
        >
          {menuNotice}
        </div>
      ) : null}

      {/* v22+ — dialog kirim terjadwal (dibuka dari menu lampiran composer) */}
      {schedOpen ? (
        <Dialog open onOpenChange={handleSchedOpenChange}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="size-4" aria-hidden="true" />
                Kirim terjadwal
              </DialogTitle>
              <DialogDescription>
                Pesan terkirim otomatis pada waktu yang dipilih.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-at" className="text-xs font-medium">
                  Kirim pada
                </Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={schedValue}
                  min={toLocalInputValue(Date.now() + 60_000)}
                  className="h-9"
                  onChange={(e) => setSchedValue(e.target.value)}
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Minimal 1 menit, maksimal 30 hari dari sekarang. Pesan tampil dengan chip jam
                  sampai waktunya tiba.
                </p>
                {/* v42 — pengulangan pesan terjadwal */}
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-repeat" className="text-xs font-medium">
                    Berulang
                  </Label>
                  <div className="flex gap-1.5" role="group" aria-label="Pengulangan pesan terjadwal">
                    {([
                      { key: "", label: "Tidak" },
                      { key: "daily", label: "Harian" },
                      { key: "weekly", label: "Mingguan" },
                    ] as const).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        aria-pressed={schedRepeat === o.key}
                        className={cn(
                          "flex h-8 flex-1 items-center justify-center rounded-lg border text-xs font-medium transition-colors",
                          schedRepeat === o.key
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                        onClick={() => setSchedRepeat(o.key)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                className="btn-gradient h-9 w-full rounded-lg text-sm font-semibold text-white"
                disabled={!connected || !!editing || !input.trim() || !schedValue}
                onClick={scheduleSend}
              >
                Jadwalkan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* v22 — dialog pesan berbintang (bintang milik admin di chat aktif) */}
      {starredOpen ? (
        <Dialog open onOpenChange={setStarredOpen}>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                Pesan berbintang
              </DialogTitle>
              <DialogDescription>
                Bintang Anda di chat {activeConversation?.partner.name ?? "ini"} — klik untuk
                melompat ke pesannya.
              </DialogDescription>
            </DialogHeader>
            {starredLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Memuat…
              </p>
            ) : starredList.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Belum ada pesan berbintang
              </p>
            ) : (
              <div className="chat-scroll max-h-96 min-h-0 overflow-y-auto overscroll-contain">
                <div className="flex flex-col gap-1">
                  {starredList.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-accent"
                      onClick={() => jumpToStarred(m.id)}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {messageKindIcon(m.type)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{snippetOfMessage(m)}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {formatChatTime(m.createdAt)}
                        </span>
                      </span>
                      <Star
                        className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* v22 — dialog teruskan pesan: pilih pesan → pilih percakapan tujuan */}
      {forwardOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) resetForward();
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
            {forwardStep === "message" ? (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Forward className="size-4 text-emerald-600" aria-hidden="true" />
                    Teruskan pesan
                  </DialogTitle>
                  <DialogDescription>
                    Pilih pesan dari chat {activeConversation?.partner.name ?? "ini"} yang akan
                    diteruskan (50 terbaru).
                  </DialogDescription>
                </DialogHeader>
                <div className="chat-scroll max-h-96 min-h-0 overflow-y-auto overscroll-contain">
                  <div className="flex flex-col gap-1">
                    {forwardCandidates.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Tidak ada pesan yang bisa diteruskan.
                      </p>
                    ) : (
                      forwardCandidates.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-accent"
                          onClick={() => {
                            setForwardMessage(m);
                            setForwardStep("target");
                          }}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            {messageKindIcon(m.type)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{snippetOfMessage(m)}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {formatChatTime(m.createdAt)}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Forward className="size-4 text-emerald-600" aria-hidden="true" />
                    Pilih tujuan
                  </DialogTitle>
                  <DialogDescription className="min-w-0">
                    <span className="block truncate">
                      “{forwardMessage ? snippetOfMessage(forwardMessage) : ""}” akan diteruskan ke
                      percakapan lain.
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <div className="chat-scroll max-h-96 min-h-0 overflow-y-auto overscroll-contain">
                  <div className="flex flex-col gap-1">
                    {forwardTargets.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Belum ada percakapan lain sebagai tujuan.
                      </p>
                    ) : (
                      forwardTargets.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-accent"
                          onClick={() => confirmForward(c)}
                        >
                          <Avatar className="size-8 shrink-0">
                            <AvatarFallback
                              className={cn(
                                "text-xs font-semibold text-white",
                                avatarColorClass(c.partner.name)
                              )}
                            >
                              {initials(c.partner.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {c.partner.name}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {c.lastMessage
                                ? messagePreview(
                                    c.lastMessage.type,
                                    c.lastMessage.content,
                                    c.lastMessage.deleted,
                                    lastFileName(c.lastMessage),
                                    lastMediaExpired(c.lastMessage),
                                    c.lastMessage.caption
                                  )
                                : "Belum ada pesan"}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatChatTime(c.lastMessageAt)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="h-9 w-full text-muted-foreground"
                  onClick={() => {
                    setForwardStep("message");
                    setForwardMessage(null);
                  }}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Kembali pilih pesan
                </Button>
              </>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* v22 — konfirmasi batalkan pesan terjadwal */}
      <AlertDialog
        open={cancelSchedId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelSchedId(null);
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesan terjadwal?</AlertDialogTitle>
            <AlertDialogDescription>
              Pesan tidak akan terkirim dan langsung dihapus dari percakapan ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Biarkan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmCancelScheduled}
            >
              Ya, batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v44 — overlay call suara/video full-screen (WebRTC P2P) */}
      {call ? (
        <CallOverlay
          state={call}
          remoteVideoRef={remoteVideoRef}
          localVideoRef={localVideoRef}
          remoteAudioRef={remoteAudioRef}
          muted={webrtc.muted}
          camOff={webrtc.camOff}
          elapsedLabel={formatCallDuration(callElapsed)}
          onAccept={() => void acceptCall()}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleMute={webrtc.toggleMute}
          onToggleCamera={webrtc.toggleCamera}
        />
      ) : null}

      {/* v22 — toast sonner (forward / terjadwal / bintang) */}
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
