/**
 * Shared contract between the Next.js frontend and the chat-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 *
 * Model (v3 — "Telegram-style, private 1-on-1 with Admin"):
 *   Every human user chats with exactly ONE partner: the Admin.
 *   - A user NEVER sees other users, their presence, or their messages
 *     (enforced server-side via participant checks).
 *   - The Admin sees ALL users' conversations in one list.
 */

/** Fixed id of the admin account (seeded by the server on boot). */
export const ADMIN_ID = "admin";
export const ADMIN_NAME = "Admin";

/** Persisted user login ({ userId, name }) — Telegram-style, no password. */
export const CHAT_SESSION_KEY = "chatkita:user";

/**
 * Last account name that logged in from this browser. Unlike the session
 * key it SURVIVES logout, so the login card can prefill it and offer a
 * one-tap "continue previous conversation" entry.
 */
export const CHAT_LAST_NAME_KEY = "chatkita:last-name";

/** Demo hint rendered on the admin login form (server default password). */
export const ADMIN_PASSWORD_HINT = "admin123";

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export interface ChatUser {
  id: string;
  name: string;
}

/** A chat partner including live presence info. */
export type PartnerInfo = ChatUser & {
  online: boolean;
  /** ISO timestamp of the last time this user was online (null if unknown). */
  lastSeenAt: string | null;
};

export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  content: string;
  /** ISO 8601 timestamp string */
  createdAt: string;
}

/**
 * One conversation as seen by the requesting side.
 * For the admin: `partner` is the human user. For a user: `partner` is Admin.
 */
export interface ConversationOverview {
  id: string;
  partner: PartnerInfo;
  lastMessage: {
    id: number;
    senderId: string;
    content: string;
    createdAt: string;
  } | null;
  lastMessageAt: string;
  /** Unread messages sent by the partner. */
  unread: number;
}

/* ------------------------------------------------------------------ */
/* Ack payloads                                                        */
/* ------------------------------------------------------------------ */

/** Ack payload returned by `user:auth`. */
export interface UserAuthAck {
  ok: true;
  user: ChatUser;
  /** The user's single conversation (with Admin). */
  conversationId: string;
  /** Always the Admin in this model. */
  partner: PartnerInfo;
  /** Full history of the conversation (already marked as read). */
  messages: ChatMessage[];
}

/** Ack payload returned by `admin:auth`. */
export interface AdminAuthAck {
  ok: true;
  conversations: ConversationOverview[];
}

/** Ack payload returned by `messages:history` (both roles, participant-only). */
export interface HistoryAck {
  ok: true;
  messages: ChatMessage[];
  partner: PartnerInfo;
}

/** Ack payload returned by `messages:send`. */
export interface MessageAck {
  ok: true;
  message: ChatMessage;
}

/** Generic error ack: `{ ok: false, error: ErrorCode }` */
export type ChatErrorCode =
  | "INVALID_NAME"
  | "NAME_RESERVED"
  | "INVALID_MESSAGE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "SERVER_ERROR";

export interface ChatErrorAck {
  ok: false;
  error: ChatErrorCode;
}

/* ------------------------------------------------------------------ */
/* Client → Server events (ack via callback where listed)              */
/* ------------------------------------------------------------------ */
//
// user:auth         { name: string; userId?: string }
//                     → UserAuthAck | ChatErrorAck
//                     Login (userId) or find-or-create by (case-insensitive)
//                     name. Ensures the 1-on-1 conversation with Admin,
//                     marks it read, returns the full history. Joins the
//                     personal `user:<id>` room.
//
// admin:auth        { password: string }
//                     → AdminAuthAck | ChatErrorAck
//                     Password login (ADMIN_PASSWORD env or "admin123").
//                     Joins the `admins` room; returns ALL conversations.
//
// messages:history  { conversationId: string }
//                     → HistoryAck | ChatErrorAck
//                     Both roles; participant-gated; marks the
//                     conversation read for the caller.
//
// messages:send     { conversationId: string; content: string }
//                     → MessageAck | ChatErrorAck
//                     Both roles; participant-gated. Sender auto-reads.
//
// messages:read     { conversationId: string }                 (no ack)
//
// typing            { conversationId: string; isTyping: boolean } (no ack)

/* ------------------------------------------------------------------ */
/* Server → Client events                                              */
/* ------------------------------------------------------------------ */
//
// message:new          ChatMessage
//                        Fan-out to the two participants: the human
//                        user's `user:<id>` room AND the `admins` room.
//                        (Clients append ONLY from this event; ignore
//                        message payloads inside success acks.)
//
// conversations:update ConversationOverview[]
//                        Personalized: full list to the `admins` room;
//                        the caller's own list to a `user:<id>` room.
//
// partner:typing       { conversationId: string; isTyping: boolean }
//                        Relayed to the OTHER participant (admins room
//                        when the typer is a user, user room when the
//                        typer is admin).
//
// presence:update      { userId: string; online: boolean;
//                        lastSeenAt: string | null }
//                        User online/offline → `admins` room ONLY
//                        (users must never learn about other users).
//                        Admin online/offline → all `user:<id>` rooms.

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Mini service port — always reach it through the gateway query param */
export const CHAT_SERVICE_PORT = 3003;

export const SOCKET_URL = `/?XTransformPort=${CHAT_SERVICE_PORT}`;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 40;
