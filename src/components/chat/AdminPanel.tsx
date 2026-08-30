"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  BarChart3,
  Check,
  ImagePlus,
  Lock,
  LogOut,
  MessagesSquare,
  Mic,
  NotebookPen,
  Search,
  SendHorizonal,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  Tag,
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
import {
  ADMIN_ID,
  ADMIN_NAME,
  ADMIN_PASSWORD_HINT,
  MAX_MESSAGE_LENGTH,
  type AckOf,
  type AdminAuthAck,
  type ChatErrorAck,
  type ChatMessage,
  type ChatStats,
  type ConversationOverview,
  type HistoryAck,
  type MessageAck,
  type ServiceSettings,
  type SettingsAck,
  type SuggestAck,
  type SummaryAck,
  type UpdateUserAck,
  type UserLabel,
} from "@/lib/chat-types";
import {
  avatarColorClass,
  formatChatTime,
  formatLastSeen,
  initials,
  messagePreview,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

const LABEL_META: Record<UserLabel, { text: string; className: string }> = {
  new: { text: "Baru", className: "bg-emerald-600 text-white" },
  priority: { text: "Prioritas", className: "bg-orange-500 text-white" },
  vip: { text: "VIP", className: "bg-amber-500 text-white" },
};

type FilterTab = "all" | "unread" | "online";

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

    // Delete tombstones + late voice transcripts.
    socket.on(
      "message:updated",
      (u: {
        id: number;
        conversationId: string;
        deletedAt?: string;
        transcript?: string;
        content?: string;
      }) => {
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
                  }
                : m
            ),
          };
        });
      }
    );

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
    setTitleUnread(0);
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const handleSelectConversation = (id: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    activeIdRef.current = id;
    setActiveId(id);
    setSendError(false);
    socket.emit("messages:history", { conversationId: id }, (res: AckOf<HistoryAck>) => {
      if (res.ok) {
        setMessagesMap((prev) => ({ ...prev, [id]: res.messages }));
        socketRef.current?.emit("messages:read", { conversationId: id });
      }
    });
  };

  const handleBackToList = () => {
    activeIdRef.current = null;
    setActiveId(null);
    setSendError(false);
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
    return true;
  };

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    setSendError(false);
    if (!emitMessage(content, "text")) setInput(content);
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
    const socket = socketRef.current;
    const id = activeIdRef.current;
    if (!socket || !id || !connected) return;
    socket.emit("typing", { conversationId: id, isTyping: true });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit("typing", { conversationId: id, isTyping: false });
    }, 1500);
  };

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
                    value={filter}
                    placeholder="Cari user…"
                    aria-label="Cari user"
                    className="h-10 pl-9"
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <div className="mt-2 flex gap-1">
                  {(
                    [
                      { key: "all", label: "Semua" },
                      { key: "unread", label: `Belum dibaca${unreadCount ? ` (${unreadCount})` : ""}` },
                      { key: "online", label: "Online" },
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
                  <div className="flex w-full flex-col gap-2 p-3 sm:p-4 md:p-6">
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
                        <ChatBubble
                          key={m.id}
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
                          onReply={() => setReplyTo(m)}
                          onDelete={() => handleDelete(m)}
                          onImageOpen={setLightbox}
                        />
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
                        placeholder="Tulis balasan…"
                        aria-label="Tulis balasan"
                        autoComplete="off"
                        disabled={!connected}
                        className="h-11 flex-1"
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
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
