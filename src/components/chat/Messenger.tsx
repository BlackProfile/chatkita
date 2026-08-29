"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  MessageCircleMore,
  MessagesSquare,
  Search,
  SendHorizonal,
  UserRound,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { NewChatDialog } from "@/components/chat/NewChatDialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { createChatSocket } from "@/lib/chat-socket";
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MESSENGER_STORAGE_KEY,
  type ChatErrorAck,
  type ChatMessage,
  type ConversationOverview,
  type HistoryAck,
  type MessageAck,
  type UserAuthAck,
} from "@/lib/chat-types";
import { avatarColorClass, formatChatTime, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface StoredUser {
  userId: string;
  name: string;
}

/** Read (and validate) the persisted login. Client-side only. */
function readStoredUser(): StoredUser | null {
  try {
    const raw = window.localStorage.getItem(MESSENGER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUser> | null;
    if (
      parsed &&
      typeof parsed.userId === "string" &&
      typeof parsed.name === "string" &&
      parsed.userId.length > 0 &&
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
 * ChatKita Messenger — Telegram-style 1-on-1 chat:
 * login by name, conversation list, user search, real-time messaging,
 * typing indicators, unread counts, and online presence.
 * Owns its own socket connection, always disconnected on unmount.
 */
export function Messenger() {
  const isMobile = useIsMobile();

  const [me, setMe] = useState<StoredUser | null>(null);
  const [conversations, setConversations] = useState<ConversationOverview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<StoredUser | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------------------------------------------- */
  /* Socket lifecycle (recreated on logout via `epoch`)                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    // Restore persisted login (ref only) so the first `connect` can
    // re-auth immediately. State is set inside the connect ack.
    meRef.current = readStoredUser();

    const socket = createChatSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocket(socket);
      const current = meRef.current;
      if (!current) return;
      // Re-auth on EVERY connect to (re)join the personal room.
      socket.emit(
        "user:auth",
        { name: current.name, userId: current.userId },
        (res: UserAuthAck | ChatErrorAck) => {
          if (res.ok) {
            const next = { userId: res.user.id, name: res.user.name };
            meRef.current = next;
            setMe(next);
            setConversations(res.conversations);
          } else {
            // Stored user no longer valid — drop it, back to login form.
            window.localStorage.removeItem(MESSENGER_STORAGE_KEY);
            meRef.current = null;
            setMe(null);
            setConversations([]);
            activeIdRef.current = null;
            setActiveId(null);
            setAuthError("Sesi berakhir. Silakan masuk kembali.");
          }
        }
      );
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setSocket(null);
    });

    socket.on("conversations:update", (list: ConversationOverview[]) => {
      setConversations(list);
    });

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs broadcast race).
    socket.on("message:new", (msg: ChatMessage) => {
      setMessagesMap((prev) => {
        const list = prev[msg.conversationId];
        if (!list || list.length === 0) {
          return { ...prev, [msg.conversationId]: [msg] };
        }
        const last = list[list.length - 1];
        if (last.id === msg.id) return prev;
        return { ...prev, [msg.conversationId]: [...list, msg] };
      });
      if (msg.conversationId === activeIdRef.current) {
        socketRef.current?.emit("messages:read", { conversationId: msg.conversationId });
      }
    });

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
          // Auto-clear after 4s in case a stop event is missed.
          timers[conversationId] = setTimeout(() => {
            delete partnerTypingTimersRef.current[conversationId];
            setTypingMap((prev) => {
              if (!prev[conversationId]) return prev;
              const next = { ...prev };
              delete next[conversationId];
              return next;
            });
          }, 4000);
        }
      }
    );

    socket.on("presence:update", ({ userId, online }: { userId: string; online: boolean }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.partner.id === userId ? { ...c, partner: { ...c.partner, online } } : c
        )
      );
    });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      Object.values(partnerTypingTimersRef.current).forEach((t) => clearTimeout(t));
      partnerTypingTimersRef.current = {};
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch]);

  /* ---------------------------------------------------------------- */
  /* Derived values                                                    */
  /* ---------------------------------------------------------------- */
  const filteredConversations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.partner.name.toLowerCase().includes(q));
  }, [conversations, filter]);

  const activeConversation: ConversationOverview | null = activeId
    ? conversations.find((c) => c.id === activeId) ?? null
    : null;
  const activeMessages = activeId ? messagesMap[activeId] ?? [] : [];
  const activeTyping = activeId ? typingMap[activeId] === true : false;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  /* ---------------------------------------------------------------- */
  /* Auto-scroll to latest message (scroll the viewport, never the page) */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]"
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [activeId, activeMessages, activeTyping]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  const handleAuth = () => {
    const socket = socketRef.current;
    const trimmed = name.trim();
    if (!socket || !connected || !trimmed) return;
    setAuthError(null);
    socket.emit("user:auth", { name: trimmed }, (res: UserAuthAck | ChatErrorAck) => {
      if (res.ok) {
        const next = { userId: res.user.id, name: res.user.name };
        window.localStorage.setItem(MESSENGER_STORAGE_KEY, JSON.stringify(next));
        meRef.current = next;
        setMe(next);
        setConversations(res.conversations);
      } else {
        setAuthError(
          res.error === "INVALID_NAME"
            ? "Nama tidak valid (1–40 karakter)."
            : "Terjadi kesalahan, coba lagi."
        );
      }
    });
  };

  const handleLogout = () => {
    window.localStorage.removeItem(MESSENGER_STORAGE_KEY);
    meRef.current = null;
    activeIdRef.current = null;
    setMe(null);
    setConversations([]);
    setMessagesMap({});
    setTypingMap({});
    setActiveId(null);
    setFilter("");
    setAuthError(null);
    setInput("");
    setSendError(false);
    setNewChatOpen(false);
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const handleSelectConversation = (id: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    activeIdRef.current = id;
    setActiveId(id);
    setSendError(false);
    socket.emit("messages:history", { conversationId: id }, (res: HistoryAck | ChatErrorAck) => {
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

  const handleSend = () => {
    const socket = socketRef.current;
    const id = activeIdRef.current;
    const content = input.trim();
    if (!socket || !id || !connected || !content) return;
    setInput("");
    setSendError(false);
    socket.emit(
      "messages:send",
      { conversationId: id, content },
      (res: MessageAck | ChatErrorAck) => {
        if (!res.ok) {
          setInput(content); // restore the failed text
          setSendError(true);
        }
      }
    );
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

  /* ---------------------------------------------------------------- */
  /* Render: login                                                     */
  /* ---------------------------------------------------------------- */
  if (!me) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 pb-6">
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
              Masukkan nama Anda untuk melihat percakapan dan chat dengan teman
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
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!connected || !name.trim()}
              >
                {connected ? "Masuk" : "Menghubungkan…"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Nama yang sama = akun yang sama, jadi Anda bisa lanjut chat kapan saja
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: messenger (full screen)                                   */
  /* ---------------------------------------------------------------- */
  const showSidebar = !isMobile || !activeId;
  const showChatPane = !isMobile || activeId !== null;

  const partnerStatus = activeTyping
    ? "sedang mengetik…"
    : activeConversation?.partner.online
      ? "Online"
      : "Offline";

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
                      avatarColorClass(me.name)
                    )}
                  >
                    {initials(me.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">{me.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-block size-1.5 shrink-0 rounded-full",
                        connected ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )}
                    />
                    {connected ? "Online" : "Menghubungkan…"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Keluar"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 p-3">
                <Button
                  className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                  onClick={() => setNewChatOpen(true)}
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  Chat Baru
                  {totalUnread > 0 ? (
                    <Badge className="ml-1 bg-white px-1.5 text-[10px] text-emerald-700 hover:bg-white">
                      {totalUnread}
                    </Badge>
                  ) : null}
                </Button>
              </div>

              {/* Filter */}
              <div className="px-3 pb-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={filter}
                    placeholder="Cari percakapan…"
                    aria-label="Cari percakapan"
                    className="h-10 pl-9"
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
              </div>

              {/* Conversation list */}
              <div className="chat-scroll min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-1 p-2">
                    {filteredConversations.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {conversations.length === 0
                          ? "Belum ada percakapan. Ketuk “Chat Baru” untuk mulai!"
                          : "Tidak ada hasil."}
                      </p>
                    ) : (
                      filteredConversations.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectConversation(c.id)}
                          aria-current={activeId === c.id ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent",
                            activeId === c.id && "bg-accent"
                          )}
                        >
                          <span className="relative mt-0.5 shrink-0">
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
                              aria-label={c.partner.online ? "Online" : "Offline"}
                              className={cn(
                                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
                                c.partner.online ? "bg-emerald-500" : "bg-muted-foreground/40"
                              )}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {c.partner.name}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {formatChatTime(c.lastMessageAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center justify-between gap-2">
                              <span className="truncate text-xs text-muted-foreground">
                                {c.lastMessage
                                  ? `${c.lastMessage.senderId === me.userId ? "Anda: " : ""}${c.lastMessage.content}`
                                  : "Belum ada pesan"}
                              </span>
                              {c.unread > 0 ? (
                                <Badge className="shrink-0 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">
                                  {c.unread}
                                </Badge>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
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
                    <p className="truncate font-semibold leading-tight">
                      {activeConversation.partner.name}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        activeTyping
                          ? "text-emerald-600"
                          : activeConversation.partner.online
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                      )}
                    >
                      {partnerStatus}
                    </p>
                  </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="chat-scroll min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 md:p-6">
                      {activeMessages.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                          Belum ada pesan. Sapa {activeConversation.partner.name}!
                        </p>
                      ) : (
                        activeMessages.map((m) => (
                          <ChatBubble
                            key={m.id}
                            content={m.content}
                            createdAt={m.createdAt}
                            side={m.senderId === me.userId ? "right" : "left"}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Typing indicator */}
                {activeTyping ? (
                  <div className="px-4 pb-1">
                    <TypingDots label="sedang mengetik…" />
                  </div>
                ) : null}

                {/* Send error */}
                {sendError ? (
                  <p className="px-4 pb-1 text-xs text-destructive">
                    Pesan gagal terkirim, coba lagi.
                  </p>
                ) : null}

                {/* Input row */}
                <div className="flex items-center gap-2 border-t p-3">
                  <Input
                    value={input}
                    maxLength={MAX_MESSAGE_LENGTH}
                    placeholder="Tulis pesan…"
                    aria-label="Tulis pesan"
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
                    size="icon"
                    className="size-11 shrink-0 bg-emerald-600 text-white hover:bg-emerald-600/90"
                    aria-label="Kirim"
                    disabled={!connected || !input.trim()}
                    onClick={handleSend}
                  >
                    <SendHorizonal className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </section>
            ) : (
              <section className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center">
                <MessagesSquare
                  className="size-10 text-muted-foreground/40"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  Pilih percakapan untuk mulai mengobrol
                </p>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setNewChatOpen(true)}
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  Chat Baru
                </Button>
              </section>
            )
          ) : null}
        </div>
      </div>

      {/* New chat dialog */}
      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        socket={socket}
        onStarted={handleSelectConversation}
      />
    </div>
  );
}
