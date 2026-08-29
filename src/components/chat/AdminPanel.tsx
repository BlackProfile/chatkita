"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  MessagesSquare,
  Search,
  SendHorizonal,
  ShieldCheck,
} from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
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
  ADMIN_PASSWORD_HINT,
  MAX_MESSAGE_LENGTH,
  type AdminAuthAck,
  type AdminHistoryAck,
  type ChatErrorAck,
  type ChatMessage,
  type MessageAck,
  type SessionOverview,
} from "@/lib/chat-types";
import { avatarColorClass, formatChatTime, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * Admin side of ChatKita: password login, customer inbox with search +
 * unread badges, and a chat pane. Owns its own socket connection, which is
 * always disconnected on unmount (and recreated on logout so the server
 * drops the socket from the `admins` room).
 */
export function AdminPanel() {
  const isMobile = useIsMobile();

  const [authed, setAuthed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionOverview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  /** Bumped on logout to tear down + recreate the socket (fresh auth state). */
  const [epoch, setEpoch] = useState(0);

  // The submitted password lives ONLY in a ref (never localStorage) so it
  // can be replayed to re-join the `admins` room after a reconnect.
  const socketRef = useRef<Socket | null>(null);
  const passwordRef = useRef("");
  const authedRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const adminTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------------------------------------------- */
  /* Socket lifecycle                                                  */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const socket = createChatSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      if (!authedRef.current) return;
      // Re-auth on EVERY connect to re-join the `admins` room, then
      // refresh the inbox and the open conversation.
      socket.emit(
        "admin:auth",
        { password: passwordRef.current },
        (res: AdminAuthAck | ChatErrorAck) => {
          if (res.ok) {
            setSessions(res.sessions);
            const current = activeIdRef.current;
            if (current) {
              socket.emit(
                "admin:history",
                { sessionId: current },
                (hres: AdminHistoryAck | ChatErrorAck) => {
                  if (hres.ok) {
                    setMessagesMap((prev) => ({ ...prev, [current]: hres.messages }));
                    socket.emit("admin:read", { sessionId: current });
                  }
                }
              );
            }
          } else {
            // Session expired / password changed — back to login.
            authedRef.current = false;
            passwordRef.current = "";
            setAuthed(false);
            activeIdRef.current = null;
            setActiveId(null);
            setAuthError("Sesi admin berakhir. Silakan masuk kembali.");
          }
        }
      );
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("sessions:update", (list: SessionOverview[]) => {
      setSessions(list);
    });

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs broadcast race).
    socket.on("chat:message", (msg: ChatMessage) => {
      setMessagesMap((prev) => {
        const list = prev[msg.sessionId];
        if (!list || list.length === 0) {
          return { ...prev, [msg.sessionId]: [msg] };
        }
        const last = list[list.length - 1];
        if (last.id === msg.id) return prev;
        return { ...prev, [msg.sessionId]: [...list, msg] };
      });
      if (msg.sessionId === activeIdRef.current) {
        socketRef.current?.emit("admin:read", { sessionId: msg.sessionId });
      }
    });

    socket.on(
      "user:typing",
      ({ sessionId, isTyping }: { sessionId: string; isTyping: boolean }) => {
        const timers = typingTimersRef.current;
        if (timers[sessionId]) {
          clearTimeout(timers[sessionId]);
          delete timers[sessionId];
        }
        setTypingMap((prev) => {
          const next = { ...prev };
          if (isTyping) next[sessionId] = true;
          else delete next[sessionId];
          return next;
        });
        if (isTyping) {
          // Auto-clear after 4s in case a stop event is missed.
          timers[sessionId] = setTimeout(() => {
            delete typingTimersRef.current[sessionId];
            setTypingMap((prev) => {
              if (!prev[sessionId]) return prev;
              const next = { ...prev };
              delete next[sessionId];
              return next;
            });
          }, 4000);
        }
      }
    );

    return () => {
      Object.values(typingTimersRef.current).forEach((t) => clearTimeout(t));
      typingTimersRef.current = {};
      if (adminTypingTimerRef.current) clearTimeout(adminTypingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch]);

  /* ---------------------------------------------------------------- */
  /* Derived values                                                    */
  /* ---------------------------------------------------------------- */
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.name.toLowerCase().includes(q));
  }, [sessions, search]);

  const activeSession: SessionOverview | null = activeId
    ? sessions.find((s) => s.id === activeId) ?? null
    : null;
  const activeMessages = activeId ? messagesMap[activeId] ?? [] : [];
  const activeTyping = activeId ? typingMap[activeId] === true : false;

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
  const handleLogin = () => {
    const socket = socketRef.current;
    const trimmed = password.trim();
    if (!socket || !trimmed) return;
    setAuthError(null);
    socket.emit("admin:auth", { password: trimmed }, (res: AdminAuthAck | ChatErrorAck) => {
      if (res.ok) {
        passwordRef.current = trimmed;
        authedRef.current = true;
        setPassword("");
        setAuthed(true);
        setSessions(res.sessions);
      } else {
        setAuthError(
          res.error === "UNAUTHORIZED"
            ? "Password salah."
            : "Terjadi kesalahan, coba lagi."
        );
      }
    });
  };

  const handleLogout = () => {
    authedRef.current = false;
    passwordRef.current = "";
    activeIdRef.current = null;
    setAuthed(false);
    setActiveId(null);
    setSessions([]);
    setMessagesMap({});
    setTypingMap({});
    setSearch("");
    setAuthError(null);
    setInput("");
    setSendError(false);
    // Fresh socket ⇒ server cleanly forgets this client's admin membership.
    setEpoch((e) => e + 1);
  };

  const handleSelectSession = (id: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    activeIdRef.current = id;
    setActiveId(id);
    setSendError(false);
    socket.emit("admin:history", { sessionId: id }, (res: AdminHistoryAck | ChatErrorAck) => {
      if (res.ok) {
        setMessagesMap((prev) => ({ ...prev, [id]: res.messages }));
        socketRef.current?.emit("admin:read", { sessionId: id });
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
      "admin:message",
      { sessionId: id, content },
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
    socket.emit("admin:typing", { sessionId: id, isTyping: true });
    if (adminTypingTimerRef.current) clearTimeout(adminTypingTimerRef.current);
    adminTypingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit("admin:typing", { sessionId: id, isTyping: false });
    }, 1500);
  };

  /* ---------------------------------------------------------------- */
  /* Render: login                                                     */
  /* ---------------------------------------------------------------- */
  if (!authed) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 pb-6">
        <Card className="w-full max-w-sm rounded-2xl">
          <CardHeader>
            <span
              className="w-fit rounded-lg bg-emerald-600/10 p-3 text-emerald-600"
              aria-hidden="true"
            >
              <ShieldCheck className="size-6" />
            </span>
            <CardTitle className="text-xl">Masuk Admin</CardTitle>
            <CardDescription>Masukkan password untuk membuka dasbor pesan</CardDescription>
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
                  placeholder="••••••••"
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
              <p className="text-center text-xs text-muted-foreground">
                Demo: password {ADMIN_PASSWORD_HINT}
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: dashboard                                                 */
  /* ---------------------------------------------------------------- */
  const showSidebar = !isMobile || !activeId;
  const showChatPane = !isMobile || activeId !== null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Reconnecting strip */}
        {!connected ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Koneksi terputus — mencoba menyambung ulang…
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
          {/* ------------------------- Sidebar ------------------------- */}
          {showSidebar ? (
            <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden md:border-r">
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Percakapan</h2>
                  <Badge variant="secondary">{filteredSessions.length}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 text-muted-foreground hover:text-destructive"
                  aria-label="Keluar"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="px-3 pt-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={search}
                    placeholder="Cari customer…"
                    aria-label="Cari percakapan"
                    className="h-10 pl-9"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="chat-scroll min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-1 p-2">
                    {filteredSessions.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {sessions.length === 0
                          ? "Belum ada percakapan masuk."
                          : "Tidak ada percakapan."}
                      </p>
                    ) : (
                      filteredSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectSession(s.id)}
                          aria-current={activeId === s.id ? "true" : undefined}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent",
                            activeId === s.id && "bg-accent"
                          )}
                        >
                          <Avatar className="mt-0.5 size-9">
                            <AvatarFallback
                              className={cn(
                                "text-xs font-semibold text-white",
                                avatarColorClass(s.name)
                              )}
                            >
                              {initials(s.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{s.name}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {formatChatTime(s.lastMessageAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span className="truncate text-xs text-muted-foreground">
                                {s.lastMessage
                                  ? `${s.lastMessage.sender === "admin" ? "Anda: " : ""}${s.lastMessage.content}`
                                  : "Belum ada pesan"}
                              </span>
                              {s.unread > 0 ? (
                                <Badge className="shrink-0 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">
                                  {s.unread}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
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
            activeId ? (
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
                  <Avatar className="size-10">
                    <AvatarFallback
                      className={cn(
                        "text-sm font-semibold text-white",
                        avatarColorClass(activeSession?.name ?? "Customer")
                      )}
                    >
                      {initials(activeSession?.name ?? "Customer")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">
                      {activeSession?.name ?? "Customer"}
                    </p>
                    <p className="text-xs text-muted-foreground">Customer</p>
                  </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="chat-scroll min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 md:p-6">
                      {activeMessages.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                          Belum ada pesan.
                        </p>
                      ) : (
                        activeMessages.map((m) => (
                          <ChatBubble
                            key={m.id}
                            content={m.content}
                            createdAt={m.createdAt}
                            side={m.sender === "user" ? "left" : "right"}
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
                  Pilih percakapan untuk mulai membalas
                </p>
              </section>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
