"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, MessageCircleMore, SendHorizonal } from "lucide-react";
import type { Socket } from "socket.io-client";

import { ChatBubble } from "@/components/chat/ChatBubble";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChatSocket } from "@/lib/chat-socket";
import {
  ADMIN_ID,
  CHAT_LAST_NAME_KEY,
  CHAT_SESSION_KEY,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  type ChatErrorAck,
  type ChatMessage,
  type ConversationOverview,
  type HistoryAck,
  type MessageAck,
  type PartnerInfo,
  type UserAuthAck,
} from "@/lib/chat-types";
import { avatarColorClass, initials } from "@/lib/chat-utils";
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

/**
 * ChatKita Messenger (sisi user) — chat 1-on-1 dengan Admin, seperti
 * aplikasi pesan biasa: cukup nama untuk masuk, langsung terhubung.
 * User lain tidak pernah terlihat di sini (isolasi dijamin server).
 * Owns its own socket connection, always disconnected on unmount.
 */
export function Messenger() {
  const [me, setMe] = useState<StoredUser | null>(null);
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(false);
  /** Bumped on logout to tear down + recreate the socket (fresh rooms). */
  const [epoch, setEpoch] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<StoredUser | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
        (res: HistoryAck | ChatErrorAck) => {
          if (res.ok) {
            setPartner(res.partner);
            setMessages(res.messages);
            socketRef.current?.emit("messages:read", { conversationId: id });
          }
        }
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      const current = meRef.current;
      if (!current) return;
      // Re-auth on EVERY connect to (re)join the personal room and get
      // the freshest history (also closes reconnect gaps).
      socket.emit(
        "user:auth",
        { name: current.name, userId: current.userId },
        (res: UserAuthAck | ChatErrorAck) => {
          if (res.ok) {
            const next = { userId: res.user.id, name: res.user.name };
            window.localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(next));
            saveLastName(res.user.name);
            setLastName(res.user.name);
            meRef.current = next;
            conversationIdRef.current = res.conversationId;
            setMe(next);
            setConversationId(res.conversationId);
            setPartner(res.partner);
            setMessages(res.messages);
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

    // Append messages ONLY here; skip if the last stored message already
    // has the same id (history-replacement vs broadcast race).
    socket.on("message:new", (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].id === msg.id) return prev;
        return [...prev, msg];
      });
      // The user's single conversation is always the visible one.
      socketRef.current?.emit("messages:read", {
        conversationId: msg.conversationId,
      });
    });

    socket.on(
      "partner:typing",
      ({ isTyping }: { conversationId: string; isTyping: boolean }) => {
        if (partnerTypingTimerRef.current) {
          clearTimeout(partnerTypingTimerRef.current);
          partnerTypingTimerRef.current = null;
        }
        setPartnerTyping(isTyping);
        if (isTyping) {
          // Auto-clear after 4s in case a stop event is missed.
          partnerTypingTimerRef.current = setTimeout(() => {
            partnerTypingTimerRef.current = null;
            setPartnerTyping(false);
          }, 4000);
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

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (partnerTypingTimerRef.current)
        clearTimeout(partnerTypingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [epoch]);

  /* ---------------------------------------------------------------- */
  /* Auto-scroll to latest message (the container itself scrolls)      */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, messages, partnerTyping]);

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
        window.localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(next));
        saveLastName(res.user.name);
        setLastName(res.user.name);
        meRef.current = next;
        conversationIdRef.current = res.conversationId;
        setMe(next);
        setConversationId(res.conversationId);
        setPartner(res.partner);
        setMessages(res.messages);
      } else {
        setAuthError(
          res.error === "INVALID_NAME"
            ? "Nama tidak valid (1–40 karakter)."
            : res.error === "NAME_RESERVED"
              ? "Nama “Admin” tidak tersedia — coba nama lain."
              : "Terjadi kesalahan, coba lagi."
        );
      }
    });
  };

  const handleLogout = () => {
    window.localStorage.removeItem(CHAT_SESSION_KEY);
    meRef.current = null;
    conversationIdRef.current = null;
    setMe(null);
    setConversationId(null);
    setPartner(null);
    setMessages([]);
    setPartnerTyping(false);
    setAuthError(null);
    setInput("");
    setSendError(false);
    // Login card comes back prefilled with the last used name — one tap
    // on "Lanjut Chat" resumes the previous conversation (server matches
    // the account by case-insensitive name and returns the full history).
    setName(readLastName());
    // Fresh socket ⇒ server cleanly forgets this client's rooms.
    setEpoch((e) => e + 1);
  };

  const handleSend = () => {
    const socket = socketRef.current;
    const id = conversationIdRef.current;
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
              {authError ? <p className="text-sm text-destructive">{authError}</p> : null}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                disabled={!connected || !name.trim()}
              >
                {connected
                  ? lastName &&
                    name.trim().toLowerCase() === lastName.toLowerCase()
                    ? "Lanjut Chat"
                    : "Masuk"
                  : "Menghubungkan…"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {lastName
                  ? `Lanjutkan chat sebelumnya sebagai “${lastName}” — riwayat pesan Anda tetap ada`
                  : "Nama yang sama = akun yang sama, jadi Anda bisa lanjut chat kapan saja"}
              </p>
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

        {/* Chat header */}
        <div className="flex shrink-0 items-center gap-3 border-b p-3">
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
                "text-xs",
                partnerTyping || partner?.online
                  ? "text-emerald-600"
                  : "text-muted-foreground"
              )}
            >
              {partnerStatus}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
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
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="flex w-full flex-col gap-2 p-3 sm:p-4 md:p-6">
              {messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada pesan. Sapa {partner?.name ?? "Admin"}!
                </p>
              ) : (
                messages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    content={m.content}
                    createdAt={m.createdAt}
                    side={m.senderId === me.userId ? "right" : "left"}
                  />
                ))
              )}
          </div>
        </div>

        {/* Typing indicator */}
        {partnerTyping ? (
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
        <div className="flex shrink-0 items-center gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
