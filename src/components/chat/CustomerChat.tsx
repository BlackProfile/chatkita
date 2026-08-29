"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Trash2 } from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
import { TypingDots } from "@/components/chat/TypingDots";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { createChatSocket } from "@/lib/chat-socket";
import {
  CUSTOMER_STORAGE_KEY,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  type ChatErrorAck,
  type ChatMessage,
  type MessageAck,
  type UserJoinAck,
} from "@/lib/chat-types";
import { avatarColorClass, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface StoredCustomerSession {
  sessionId: string;
  name: string;
}

/** Read (and validate) the persisted customer session. Client-side only. */
function readStoredSession(): StoredCustomerSession | null {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCustomerSession> | null;
    if (
      parsed &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.name === "string" &&
      parsed.sessionId.length > 0 &&
      parsed.name.length > 0
    ) {
      return { sessionId: parsed.sessionId, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Customer side of ChatKita: either a name form (no stored session) or a
 * private 1-on-1 chat. Owns its own socket connection, which is always
 * disconnected on unmount.
 */
export function CustomerChat() {
  const [session, setSession] = useState<StoredCustomerSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  const [adminTyping, setAdminTyping] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<StoredCustomerSession | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------------------------------------------- */
  /* Socket lifecycle (mount once)                                     */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    // Restore a previous session (ref only) so the very first `connect`
    // can rejoin the private room immediately. The session *state* is set
    // inside the connect ack (an async callback) — this keeps the effect
    // free of synchronous setState calls.
    const stored = readStoredSession();
    if (stored) {
      sessionRef.current = stored;
    }

    const socket = createChatSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const current = sessionRef.current;
      if (!current) return;
      // Re-join on EVERY connect (first connect + reconnects). The ack
      // replaces local history, which closes any reconnect gaps.
      socket.emit(
        "user:join",
        { sessionId: current.sessionId, name: current.name },
        (res: UserJoinAck | ChatErrorAck) => {
          if (res.ok) {
            const next = { sessionId: res.session.id, name: res.session.name };
            sessionRef.current = next;
            setSession(next);
            setMessages(res.messages);
          } else {
            // Stored session no longer valid — drop it, back to name form.
            window.localStorage.removeItem(CUSTOMER_STORAGE_KEY);
            sessionRef.current = null;
            setSession(null);
            setMessages([]);
            setJoinError("Sesi tidak ditemukan. Silakan mulai percakapan baru.");
          }
        }
      );
    });

    socket.on("disconnect", () => setConnected(false));

    // The ONLY place messages are appended (success acks are ignored to
    // avoid duplicates; acks are used for errors / initial history only).
    socket.on("chat:message", (msg: ChatMessage) => {
      const current = sessionRef.current;
      if (!current || msg.sessionId !== current.sessionId) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === msg.id) return prev;
        return [...prev, msg];
      });
    });

    socket.on("admin:typing", ({ isTyping }: { isTyping: boolean }) => {
      setAdminTyping(isTyping);
      if (adminTypingTimerRef.current) clearTimeout(adminTypingTimerRef.current);
      if (isTyping) {
        // Auto-clear after 4s in case a stop event is missed.
        adminTypingTimerRef.current = setTimeout(() => setAdminTyping(false), 4000);
      }
    });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (adminTypingTimerRef.current) clearTimeout(adminTypingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

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
  }, [messages, adminTyping]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  const handleJoin = () => {
    const socket = socketRef.current;
    const trimmed = name.trim();
    if (!socket || !connected || !trimmed) return;
    setJoinError(null);
    socket.emit("user:join", { name: trimmed }, (res: UserJoinAck | ChatErrorAck) => {
      if (res.ok) {
        const next = { sessionId: res.session.id, name: res.session.name };
        window.localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(next));
        sessionRef.current = next;
        setSession(next);
        setMessages(res.messages);
      } else {
        setJoinError(
          res.error === "INVALID_NAME"
            ? "Nama tidak valid (1–40 karakter)."
            : "Terjadi kesalahan, coba lagi."
        );
      }
    });
  };

  const handleDelete = () => {
    if (!window.confirm("Hapus percakapan dan mulai yang baru?")) return;
    window.localStorage.removeItem(CUSTOMER_STORAGE_KEY);
    sessionRef.current = null;
    setSession(null);
    setMessages([]);
    setInput("");
    setSendError(false);
    setAdminTyping(false);
    setJoinError(null);
  };

  const handleSend = () => {
    const socket = socketRef.current;
    const current = sessionRef.current;
    const content = input.trim();
    if (!socket || !current || !connected || !content) return;
    // Optimistic clear; the message itself arrives via `chat:message`.
    setInput("");
    setSendError(false);
    socket.emit(
      "user:message",
      { sessionId: current.sessionId, content },
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
    const current = sessionRef.current;
    if (!socket || !current || !connected) return;
    socket.emit("user:typing", { sessionId: current.sessionId, isTyping: true });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit("user:typing", {
        sessionId: current.sessionId,
        isTyping: false,
      });
    }, 1500);
  };

  /* ---------------------------------------------------------------- */
  /* Render: name form                                                 */
  /* ---------------------------------------------------------------- */
  if (!session) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 pb-6">
        <Card className="w-full max-w-md rounded-2xl">
          <CardHeader>
            <CardTitle className="text-xl">Mulai Percakapan</CardTitle>
            <CardDescription>Masukkan nama Anda untuk chat dengan admin</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleJoin();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="customer-name">Nama Anda</Label>
                <Input
                  id="customer-name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="cth. Budi Santoso"
                  autoComplete="name"
                  className="h-11"
                  onChange={(e) => {
                    setName(e.target.value);
                    setJoinError(null);
                  }}
                />
              </div>
              {joinError ? <p className="text-sm text-destructive">{joinError}</p> : null}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!connected || !name.trim()}
              >
                Mulai Chat
              </Button>
              {!connected ? (
                <p className="text-center text-xs text-muted-foreground">Menghubungkan…</p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: chat                                                      */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {/* Header */}
        <div className="flex items-center gap-3 border-b p-3">
          <Avatar className="size-10">
            <AvatarFallback
              className={cn("text-sm font-semibold text-white", avatarColorClass(session.name))}
            >
              {initials(session.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{session.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-1.5 shrink-0 rounded-full",
                  connected ? "bg-emerald-500" : "bg-muted-foreground/40"
                )}
              />
              {connected ? "Admin siap membantu" : "Menghubungkan…"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label="Hapus percakapan"
            onClick={handleDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Reconnecting strip */}
        {!connected ? (
          <p className="bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Koneksi terputus — mencoba menyambung ulang…
          </p>
        ) : null}

        {/* Messages */}
        <div ref={scrollRef} className="chat-scroll min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 md:p-6">
              {messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada pesan. Sapa admin kami!
                </p>
              ) : (
                messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    content={msg.content}
                    createdAt={msg.createdAt}
                    side={msg.sender === "user" ? "right" : "left"}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Typing indicator */}
        {adminTyping ? (
          <div className="px-4 pb-1">
            <TypingDots label="Admin sedang mengetik…" />
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
      </div>
    </div>
  );
}
