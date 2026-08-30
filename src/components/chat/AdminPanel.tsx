"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  BarChart3,
  Check,
  Download,
  ImagePlus,
  Lock,
  LogOut,
  Megaphone,
  MessagesSquare,
  Mic,
  MoreVertical,
  NotebookPen,
  Pin,
  Printer,
  QrCode,
  Search,
  SendHorizonal,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  Tag,
  Type,
  X,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { AdminSettingsDialog } from "@/components/chat/admin-settings-dialog";
import { AdminStatsDialog } from "@/components/chat/admin-stats-dialog";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { TypingDots } from "@/components/chat/TypingDots";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
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
  type ArchiveUpdatePayload,
  type BroadcastAck,
  type ChatErrorAck,
  type ChatMessage,
  type ChatStats,
  type ConversationOverview,
  type ExportAck,
  type HistoryAck,
  type MessageAck,
  type MessageUpdatePayload,
  type PinUpdatePayload,
  type ServiceSettings,
  type SettingsAck,
  type SuggestAck,
  type SummaryAck,
  type TranslateAck,
  type UpdateUserAck,
  type UserLabel,
} from "@/lib/chat-types";
import {
  avatarColorClass,
  canEditMessage,
  FONT_SCALES,
  formatChatTime,
  formatLastSeen,
  initials,
  messagePreview,
  readFontScale,
  saveFontScale,
  waitingMinutes,
  type FontScale,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

const LABEL_META: Record<UserLabel, { text: string; className: string }> = {
  new: { text: "Baru", className: "bg-emerald-600 text-white" },
  priority: { text: "Prioritas", className: "bg-orange-500 text-white" },
  vip: { text: "VIP", className: "bg-amber-500 text-white" },
};

type FilterTab = "all" | "unread" | "online" | "archive";

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

/**
 * ChatKita AdminPanel — satu tempat untuk membaca & membalas pesan
 * SEMUA user (masing-masing 1-on-1 dengan Admin). User tidak bisa
 * melihat percakapan user lain; isolasi dijamin di sisi server.
 * Password hanya disimpan di memori (ref), tidak pernah di localStorage.
 */
export function AdminPanel() {
  const isMobile = useIsMobile();

  const [authed, setAuthed] = useState(false);
  const [conversations, setConversations] = useState<ConversationOverview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  // v2 admin tooling
  const [settings, setSettings] = useState<ServiceSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // v5 — font / pinned / edit / translate / SLA / archive / broadcast / QR
  const [fontScale, setFontScale] = useState<FontScale>(() => readFontScale());
  const [pinnedMap, setPinnedMap] = useState<
    Record<string, { id: number; snippet: string } | null>
  >({});
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [tick, setTick] = useState(0);
  /** v5 — first unread message id → "Pesan baru" divider. */
  const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const passwordRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const translatingIdRef = useRef<number | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const alertedRef = useRef<Set<string>>(new Set());

  const recorder = useVoiceRecorder();

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
            setConversations(res.conversations);
            // Pull the service settings (quick replies need them immediately).
            socketRef.current?.emit("admin:getsettings", {}, (sres: AckOf<SettingsAck>) => {
              if (sres.ok) setSettings(sres.settings);
            });
            // v5 — opt in to Web Push so customer messages reach us even
            // when every admin tab is closed.
            socket.emit(
              "public:settings",
              {},
              (pres: { ok: boolean; publicSettings?: { pushPublicKey: string } }) => {
                if (pres.ok && pres.publicSettings?.pushPublicKey) {
                  void subscribeToPush(socket, pres.publicSettings.pushPublicKey);
                }
              }
            );
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

    socket.on("conversations:update", (list: ConversationOverview[]) => {
      setConversations(list);
      const current = activeIdRef.current;
      if (current && !list.some((c) => c.id === current)) {
        // Conversation vanished server-side — deselect gracefully.
        activeIdRef.current = null;
        setActiveId(null);
      }
      // Tab title mirrors the total unread count.
      const total = list.reduce((sum, c) => sum + c.unread, 0);
      setTitleUnread(total);
    });

    // v5 — pinned banner + archive state live updates.
    socket.on("conversation:update", (p: PinUpdatePayload) => {
      setPinnedMap((prev) => ({
        ...prev,
        [p.conversationId]: p.pinned ? { id: p.pinned.id, snippet: p.pinned.snippet } : null,
      }));
    });
    socket.on("conversation:archive:update", (p: ArchiveUpdatePayload) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === p.conversationId ? { ...c, archived: p.archived } : c))
      );
    });

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs broadcast race).
    socket.on("message:new", (msg: ChatMessage) => {
      setMessagesMap((prev) => {
        const list = prev[msg.conversationId];
        if (!list || list.length === 0) {
          return { ...prev, [msg.conversationId]: [msg] };
        }
        if (list.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.conversationId]: [...list, msg] };
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
          // Auto-clear after 8s in case a stop event is missed (AI path).
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

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      Object.values(partnerTypingTimersRef.current).forEach((t) => clearTimeout(t));
      partnerTypingTimersRef.current = {};
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch, scrollToBottom]);

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

  /* v5 — SLA: user messages waiting longer than the configured minutes. */
  const slaMinutes = settings?.slaMinutes ?? 10;
  const waitingMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations) {
      if (c.archived || c.unread === 0) continue;
      const mins = waitingMinutes(c.lastMessage, ADMIN_ID);
      if (mins != null && mins >= slaMinutes) map.set(c.id, mins);
    }
    return map;
  }, [conversations, slaMinutes, tick]);

  /* One blip per conversation when it first crosses the SLA threshold. */
  useEffect(() => {
    for (const id of waitingMap.keys()) {
      if (!alertedRef.current.has(id)) {
        alertedRef.current.add(id);
        playBlip();
      }
    }
    for (const id of [...alertedRef.current]) {
      if (!waitingMap.has(id)) alertedRef.current.delete(id);
    }
  }, [waitingMap]);

  /* SLA clock — recompute every 30s. */
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, [authed]);

  const activeConversation: ConversationOverview | null = activeId
    ? conversations.find((c) => c.id === activeId) ?? null
    : null;
  const activeMessages = activeId ? messagesMap[activeId] ?? [] : [];
  const activeTyping = activeId ? typingMap[activeId] === true : false;

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

  /* Jump to latest when switching conversation. */
  useEffect(() => {
    atBottomRef.current = true;
    requestAnimationFrame(() => {
      setNewCount(0);
      setSuggestions([]);
      setReplyTo(null);
      scrollToBottom();
    });
  }, [activeId, scrollToBottom]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  const handleLogin = () => {
    const socket = socketRef.current;
    const trimmed = password.trim();
    if (!socket || !connected || !trimmed) return;
    setAuthError(null);
    socket.emit(
      "admin:auth",
      { password: trimmed },
      (res: AckOf<AdminAuthAck>) => {
        if (res.ok) {
          passwordRef.current = trimmed;
          setAuthed(true);
          setConversations(res.conversations);
          // Pull the service settings (quick replies need them immediately).
          socketRef.current?.emit("admin:getsettings", {}, (sres: AckOf<SettingsAck>) => {
            if (sres.ok) setSettings(sres.settings);
          });
        } else {
          setAuthError(
            res.error === "UNAUTHORIZED"
              ? "Password salah."
              : "Terjadi kesalahan, coba lagi."
          );
        }
      }
    );
  };

  const handleLogout = () => {
    passwordRef.current = null;
    activeIdRef.current = null;
    setAuthed(false);
    setConversations([]);
    setMessagesMap({});
    setTypingMap({});
    setActiveId(null);
    setFilter("");
    setFilterTab("all");
    setAuthError(null);
    setInput("");
    setSendError(false);
    setSettings(null);
    setEditing(null);
    setPinnedMap({});
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
    socket.emit("messages:history", { conversationId: id }, (res: AckOf<HistoryAck>) => {
      if (res.ok) {
        setMessagesMap((prev) => ({ ...prev, [id]: res.messages }));
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

  const emitMessage = (
    content: string,
    type: "text" | "image" | "voice",
    extra: { durationMs?: number } = {}
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
        if (!res.ok) setSendError(true);
      }
    );
    setReplyTo(null);
    saveDraft("admin", id, "");
    alertedRef.current.delete(id);
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

  const togglePin = (msg: ChatMessage) => {
    const id = activeIdRef.current;
    if (!id) return;
    const isPinned = pinnedMap[id]?.id === msg.id;
    socketRef.current?.emit("conversation:pin", {
      conversationId: id,
      messageId: isPinned ? null : msg.id,
    });
  };

  const scrollToMessage = (id: number) => {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* v5 — archive / restore the active conversation. */
  const toggleArchive = (conversationId: string, currentlyArchived: boolean) => {
    socketRef.current?.emit("conversation:archive", {
      conversationId,
      archived: !currentlyArchived,
    });
  };

  /* v5 — export helpers (CSV + print-to-PDF transcript). */
  const exportCsv = () => {
    const id = activeIdRef.current;
    const socket = socketRef.current;
    if (!socket || !id) return;
    socket.emit(
      "conversation:export",
      { conversationId: id },
      (res: AckOf<ExportAck>) => {
        if (!res.ok) return;
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const rows = res.messages.map((m) => {
          const time = new Date(m.createdAt).toLocaleString("id-ID");
          const who = m.senderId === ADMIN_ID ? "Admin" : res.partnerName;
          const isi = m.deletedAt
            ? "[dihapus]"
            : m.type === "image"
              ? "[Foto]"
              : m.type === "voice"
                ? `[Pesan suara${m.transcript ? `: ${m.transcript}` : ""}]`
                : m.type === "system"
                  ? `[Sistem] ${m.content}`
                  : m.type === "broadcast"
                    ? `[Pengumuman] ${m.content}`
                    : m.content;
          return [time, who, isi].map(esc).join(";");
        });
        const csv = "\ufeffWaktu;Pengirim;Isi\n" + rows.join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chat-${res.partnerName.replace(/\s+/g, "_")}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    );
  };

  const printTranscript = () => {
    const id = activeIdRef.current;
    const socket = socketRef.current;
    if (!socket || !id) return;
    socket.emit(
      "conversation:export",
      { conversationId: id },
      (res: AckOf<ExportAck>) => {
        if (!res.ok) return;
        const esc = (v: string) =>
          v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const body = res.messages
          .map((m) => {
            const who = m.senderId === ADMIN_ID ? "Admin" : res.partnerName;
            const isi = m.deletedAt
              ? "<i>[pesan dihapus]</i>"
              : m.type === "image"
                ? "[Foto]"
                : m.type === "voice"
                  ? `[Pesan suara${m.transcript ? `: ${esc(m.transcript)}` : ""}]`
                  : esc(m.content);
            return `<div class="row ${m.senderId === ADMIN_ID ? "admin" : "user"}"><span class="when">${new Date(
              m.createdAt
            ).toLocaleString("id-ID")}</span><span class="who">${who}</span><span class="what">${isi}</span></div>`;
          })
          .join("");
        const w = window.open("", "_blank", "width=800,height=900");
        if (!w) return;
        w.document.write(
          `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Chat — ${esc(
            res.partnerName
          )}</title><style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:18px}.row{margin:6px 0;padding:6px 10px;border-radius:8px;background:#f5f5f5;break-inside:avoid}.row.admin{background:#e8f7ef}.who{font-weight:600;margin-right:8px}.when{float:right;color:#777;font-size:11px}.what{white-space:pre-wrap}</style></head><body><h1>Riwayat Chat — ${esc(
            res.partnerName
          )}</h1><p>${new Date().toLocaleString(
            "id-ID"
          )}</p>${body}<script>window.onload=()=>window.print()</script></body></html>`
        );
        w.document.close();
      }
    );
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

  const sendBroadcast = () => {
    const socket = socketRef.current;
    const content = broadcastText.trim();
    if (!socket || !content || broadcastSending) return;
    setBroadcastSending(true);
    setBroadcastResult(null);
    socket.emit("broadcast:send", { content }, (res: AckOf<BroadcastAck>) => {
      setBroadcastSending(false);
      if (res.ok) {
        setBroadcastResult(`✅ Terkirim ke ${res.sent} percakapan`);
        setBroadcastText("");
        setTimeout(() => {
          setBroadcastOpen(false);
          setBroadcastResult(null);
        }, 1200);
      } else {
        setBroadcastResult("Gagal mengirim, coba lagi.");
      }
    });
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

  const setLabel = (userId: string, label: UserLabel | null) => {
    socketRef.current?.emit(
      "admin:updateuser",
      { userId, label },
      (res: AckOf<UpdateUserAck>) => {
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) =>
              c.partner.id === userId
                ? { ...c, partner: { ...c.partner, label: res.label } }
                : c
            )
          );
        }
      }
    );
  };

  const openNote = () => {
    if (!activeConversation) return;
    setNoteDraft(activeConversation.partner.note ?? "");
    setNoteOpen(true);
    // Fetch the freshest note server-side (the overview doesn't carry it).
    socketRef.current?.emit(
      "admin:getnote",
      { userId: activeConversation.partner.id },
      (res: { ok: true; userId: string; label: string | null; note: string | null }) => {
        if (res.ok) setNoteDraft(res.note ?? "");
      }
    );
  };

  const saveNote = () => {
    const userId = activeConversation?.partner.id;
    if (!userId) return;
    socketRef.current?.emit(
      "admin:updateuser",
      { userId, note: noteDraft },
      (res: AckOf<UpdateUserAck>) => {
        if (res.ok) setNoteOpen(false);
      }
    );
  };

  const loadSuggestions = () => {
    const id = activeIdRef.current;
    const socket = socketRef.current;
    if (!socket || !id || suggestLoading) return;
    setSuggestLoading(true);
    socket.emit("ai:suggest", { conversationId: id }, (res: AckOf<SuggestAck>) => {
      setSuggestLoading(false);
      if (res.ok) setSuggestions(res.suggestions);
    });
  };

  const loadSummary = () => {
    const id = activeIdRef.current;
    const socket = socketRef.current;
    if (!socket || !id || summaryLoading) return;
    setSummaryLoading(true);
    socket.emit("ai:summary", { conversationId: id }, (res: AckOf<SummaryAck>) => {
      setSummaryLoading(false);
      if (res.ok) {
        // lightweight inline toast via title badge area — use alert-free UI:
        setSummaryText(res.summary);
      }
    });
  };

  const [summaryText, setSummaryText] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /* Render: login                                                     */
  /* ---------------------------------------------------------------- */
  if (!authed) {
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
              <ShieldCheck className="size-6" />
            </span>
            <CardTitle className="text-xl">Masuk Admin</CardTitle>
            <CardDescription>
              Baca dan balas pesan dari semua user di satu tempat
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
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
                  className="h-11"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthError(null);
                  }}
                />
              </div>
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!connected || !password.trim()}
              >
                {connected ? "Masuk" : "Menghubungkan…"}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" />
                Demo: password default {ADMIN_PASSWORD_HINT}
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: inbox (Telegram-style split view)                         */
  /* ---------------------------------------------------------------- */
  const showSidebar = !isMobile || !activeId;
  const showChatPane = !isMobile || activeId !== null;

  const partnerStatus = activeTyping
    ? "sedang mengetik…"
    : activeConversation?.partner.online
      ? "Online"
      : formatLastSeen(activeConversation?.partner.lastSeenAt);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Reconnecting strip */}
        {!connected ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Koneksi terputus — mencoba menyambung ulang…
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr]">
          {/* ------------------------- Sidebar ------------------------- */}
          {showSidebar ? (
            <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden md:border-r">
              {/* Profile */}
              <div className="flex items-center gap-3 border-b p-3">
                <Avatar className="size-10">
                  <AvatarFallback
                    className={cn(
                      "text-sm font-semibold text-white",
                      avatarColorClass(ADMIN_NAME)
                    )}
                  >
                    {initials(ADMIN_NAME)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">{ADMIN_NAME}</p>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-foreground"
                    aria-label="Broadcast pengumuman"
                    title="Kirim pengumuman ke semua pelanggan"
                    onClick={() => {
                      setBroadcastText("");
                      setBroadcastResult(null);
                      setBroadcastOpen(true);
                    }}
                  >
                    <Megaphone className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-foreground"
                    aria-label="Bagikan lewat QR"
                    title="QR code untuk membuka chat"
                    onClick={openQr}
                  >
                    <QrCode className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-foreground"
                    aria-label="Pengaturan layanan"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-foreground"
                    aria-label="Statistik layanan"
                    onClick={() => setStatsOpen(true)}
                  >
                    <BarChart3 className="size-4" aria-hidden="true" />
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
                      const waiting = waitingMap.get(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent",
                            isActive && "bg-accent",
                            waiting && "bg-rose-500/5"
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
                              {c.partner.label && LABEL_META[c.partner.label as UserLabel] ? (
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                                    LABEL_META[c.partner.label as UserLabel].className
                                  )}
                                >
                                  {LABEL_META[c.partner.label as UserLabel].text}
                                </span>
                              ) : null}
                              {c.partner.topic ? (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                  {c.partner.topic.length > 14
                                    ? `${c.partner.topic.slice(0, 14)}…`
                                    : c.partner.topic}
                                </span>
                              ) : null}
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
                                      c.lastMessage.deleted
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
                            {waiting ? (
                              <span
                                className="flex h-5 items-center gap-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white"
                                title={`Menunggu balasan ${waiting} menit (SLA ${slaMinutes} mnt)`}
                              >
                                ⏰ {waiting >= 60 ? `${Math.floor(waiting / 60)}j` : `${waiting}m`}
                              </span>
                            ) : c.unread > 0 ? (
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
                <div className="flex items-center gap-2 border-b p-3">
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
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-semibold leading-tight">
                        {activeConversation.partner.name}
                      </p>
                      {activeConversation.partner.label &&
                      LABEL_META[activeConversation.partner.label as UserLabel] ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                            LABEL_META[activeConversation.partner.label as UserLabel].className
                          )}
                        >
                          {LABEL_META[activeConversation.partner.label as UserLabel].text}
                        </span>
                      ) : null}
                    </div>
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
                      aria-label="Ringkas dengan AI"
                      disabled={summaryLoading}
                      onClick={loadSummary}
                    >
                      <Sparkles className={cn("size-4", summaryLoading && "animate-pulse")} aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground hover:text-foreground"
                          aria-label="Atur label pelanggan"
                        >
                          <Tag className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Label pelanggan</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setLabel(activeConversation.partner.id, null)}>
                          <Check
                            className={cn("mr-2 size-3.5", !activeConversation.partner.label && "opacity-100", activeConversation.partner.label && "opacity-0")}
                            aria-hidden="true"
                          />
                          Tanpa label
                        </DropdownMenuItem>
                        {(Object.keys(LABEL_META) as UserLabel[]).map((l) => (
                          <DropdownMenuItem key={l} onClick={() => setLabel(activeConversation.partner.id, l)}>
                            <Check
                              className={cn("mr-2 size-3.5", activeConversation.partner.label === l ? "opacity-100" : "opacity-0")}
                              aria-hidden="true"
                            />
                            {LABEL_META[l].text}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground hover:text-foreground"
                      aria-label="Catatan pelanggan"
                      onClick={openNote}
                    >
                      <NotebookPen className="size-4" aria-hidden="true" />
                    </Button>
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
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
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
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={exportCsv}>
                          <Download className="mr-2 size-4" aria-hidden="true" />
                          Ekspor CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={printTranscript}>
                          <Printer className="mr-2 size-4" aria-hidden="true" />
                          Cetak / simpan PDF
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

                {/* AI summary strip */}
                {summaryText ? (
                  <div className="flex items-start gap-2 border-b bg-emerald-600/5 px-3 py-2 text-xs">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <p className="flex-1 leading-relaxed">{summaryText}</p>
                    <button
                      type="button"
                      aria-label="Tutup ringkasan"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setSummaryText(null)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}

                {/* Pinned message banner (v5) */}
                {pinnedMap[activeConversation.id] ? (
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-2 border-b bg-amber-500/5 px-3 py-1.5 text-left text-xs"
                    onClick={() => scrollToMessage(pinnedMap[activeConversation.id]!.id)}
                  >
                    <Pin className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {pinnedMap[activeConversation.id]!.snippet}
                    </span>
                    <X
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
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
                          Belum ada pesan dari {activeConversation.partner.name}.
                        </p>
                      )
                    ) : (
                      visibleMessages.map((m) => (
                        <div key={m.id} className="contents">
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
                          read={m.senderId === ADMIN_ID && m.id <= activeConversation.partnerLastReadId}
                          replyTo={m.replyTo}
                          replyAuthor={m.replyTo?.senderId === ADMIN_ID ? "Anda" : activeConversation.partner.name}
                          durationMs={m.durationMs}
                          transcript={m.transcript}
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
                          onImageOpen={setLightbox}
                          onReact={(emoji) => handleReact(m, emoji)}
                          onEdit={() => handleEditStart(m)}
                          onTranslate={
                            m.senderId !== ADMIN_ID && m.type === "text" && !m.deletedAt
                              ? () => handleTranslate(m)
                              : undefined
                          }
                          onPin={() => togglePin(m)}
                          />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Jump to latest */}
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

                {/* Send / image errors */}
                {sendError || imageError ? (
                  <p className="px-4 pb-1 text-xs text-destructive">
                    {imageError ?? "Pesan gagal terkirim, coba lagi."}
                  </p>
                ) : null}

                {/* Quick replies + AI suggestions */}
                {activeId && (settings?.quickReplies?.length || suggestions.length || suggestLoading) ? (
                  <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-1.5 chat-scroll">
                    {suggestions.map((s, i) => (
                      <button
                        key={`ai-${i}`}
                        type="button"
                        className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-600/5 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
                        onClick={() => {
                          setInput(s.slice(0, MAX_MESSAGE_LENGTH));
                          setSuggestions([]);
                        }}
                      >
                        <Sparkles className="size-3" aria-hidden="true" />
                        {s.length > 42 ? `${s.slice(0, 42)}…` : s}
                      </button>
                    ))}
                    {suggestLoading ? (
                      <span className="shrink-0 text-xs text-muted-foreground">AI menyusun saran…</span>
                    ) : null}
                    {settings?.quickReplies?.map((qr, i) => (
                      <button
                        key={`qr-${i}`}
                        type="button"
                        className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs hover:bg-accent"
                        onClick={() => setInput(qr.text.slice(0, MAX_MESSAGE_LENGTH))}
                      >
                        {qr.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Reply chip */}
                {replyTo ? (
                  <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg border-l-2 border-emerald-500 bg-muted/60 px-2 py-1.5 text-xs">
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
                <div className="relative shrink-0 border-t p-3">
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
                        placeholder={editing ? "Simpan hasil edit…" : "Tulis balasan…"}
                        aria-label={editing ? "Edit pesan" : "Tulis balasan"}
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Saran balasan AI"
                        disabled={suggestLoading}
                        onClick={loadSuggestions}
                      >
                        <Sparkles className={cn("size-5", suggestLoading && "animate-pulse")} aria-hidden="true" />
                      </Button>
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
              </section>
            ) : (
              <section className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center">
                <MessagesSquare
                  className="size-10 text-muted-foreground/40"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  Pilih percakapan untuk membaca dan membalas pesan
                </p>
              </section>
            )
          ) : null}
        </div>
      </div>

      {/* Note dialog */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotebookPen className="size-4 text-emerald-600" aria-hidden="true" />
              Catatan: {activeConversation?.partner.name}
            </DialogTitle>
            <DialogDescription>
              Catatan internal — tidak pernah terlihat oleh pelanggan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={4}
              value={noteDraft}
              maxLength={500}
              placeholder="cth. pelanggan langganan bulanan, suka dihubungi sore…"
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <Button
              className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
              onClick={saveNote}
            >
              Simpan catatan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings + stats dialogs — mounted only while open */}
      {settingsOpen ? (
        <AdminSettingsDialog
          open
          onOpenChange={setSettingsOpen}
          socketRef={socketRef}
          onSaved={setSettings}
        />
      ) : null}
      {statsOpen ? (
        <AdminStatsDialog open onOpenChange={setStatsOpen} socketRef={socketRef} />
      ) : null}

      {/* Broadcast dialog (v5) — mounted only while open */}
      {broadcastOpen ? (
        <Dialog
          open
          onOpenChange={(v) => {
            setBroadcastOpen(v);
            if (!v) setBroadcastResult(null);
          }}
        >
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Megaphone className="size-4 text-emerald-600" aria-hidden="true" />
                Broadcast Pengumuman
              </DialogTitle>
              <DialogDescription>
                Pesan ini masuk ke chat SEMUA pelanggan sebagai pengumuman (📢).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                rows={4}
                value={broadcastText}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="cth. 🎉 Promo akhir pekan! Diskon 20% untuk semua produk Sabtu–Minggu ini."
                onChange={(e) => {
                  setBroadcastText(e.target.value);
                  setBroadcastResult(null);
                }}
              />
              {broadcastResult ? (
                <p className="text-sm font-medium text-emerald-600">{broadcastResult}</p>
              ) : null}
              <Button
                className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={broadcastSending || !broadcastText.trim()}
                onClick={sendBroadcast}
              >
                {broadcastSending
                  ? "Mengirim…"
                  : `Kirim ke ${conversations.length} percakapan`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

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
                Pelanggan memindai QR ini (atau buka tautannya) untuk mulai chat dengan Anda.
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
