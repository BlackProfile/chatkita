/**
 * Shared contract between the Next.js frontend and the chat-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 */

export type ChatSender = "user" | "admin";

export interface ChatMessage {
  id: number;
  sessionId: string;
  sender: ChatSender;
  content: string;
  /** ISO 8601 timestamp string */
  createdAt: string;
}

export interface SessionOverview {
  id: string;
  name: string;
  createdAt: string;
  lastMessageAt: string;
  lastMessage: {
    content: string;
    sender: ChatSender;
    createdAt: string;
  } | null;
  /** Unread messages sent by the customer, for the admin inbox */
  unread: number;
}

/** Ack payload returned by `user:join` */
export interface UserJoinAck {
  ok: true;
  session: { id: string; name: string };
  messages: ChatMessage[];
}

/** Ack payload returned by `user:message` / `admin:message` */
export interface MessageAck {
  ok: true;
  message: ChatMessage;
}

/** Ack payload returned by `admin:auth` */
export interface AdminAuthAck {
  ok: true;
  sessions: SessionOverview[];
}

/** Ack payload returned by `admin:sessions` */
export interface AdminSessionsAck {
  ok: true;
  sessions: SessionOverview[];
}

/** Ack payload returned by `admin:history` */
export interface AdminHistoryAck {
  ok: true;
  messages: ChatMessage[];
}

/** Generic error ack: `{ ok: false, error: ErrorCode }` */
export type ChatErrorCode =
  | "INVALID_NAME"
  | "INVALID_MESSAGE"
  | "SESSION_NOT_FOUND"
  | "UNAUTHORIZED"
  | "SERVER_ERROR";

export interface ChatErrorAck {
  ok: false;
  error: ChatErrorCode;
}

/* ------------------------------------------------------------------ */
/* Client → Server events (all use an acknowledgement callback where   */
/* an ack type is listed above; typing events have no ack)             */
/* ------------------------------------------------------------------ */
//
// user:join     { sessionId?: string; name: string }
//                 → UserJoinAck | ChatErrorAck
//                 Joins (or creates) a private 1-on-1 session room and
//                 returns the full history of that session.
//
// user:message  { sessionId: string; content: string }
//                 → MessageAck | ChatErrorAck
//
// user:typing   { sessionId: string; isTyping: boolean }   (no ack)
//
// admin:auth    { password: string }
//                 → AdminAuthAck | ChatErrorAck
//                 Joins the global "admins" room on success.
//
// admin:sessions  (no payload) → AdminSessionsAck | ChatErrorAck
//
// admin:history { sessionId: string }
//                 → AdminHistoryAck | ChatErrorAck
//                 Also marks the session as read for admins.
//
// admin:message { sessionId: string; content: string }
//                 → MessageAck | ChatErrorAck
//
// admin:read    { sessionId: string }                      (no ack)
//                 Marks the session read + broadcasts sessions:update.
//
// admin:typing  { sessionId: string; isTyping: boolean }   (no ack)

/* ------------------------------------------------------------------ */
/* Server → Client events                                              */
/* ------------------------------------------------------------------ */
//
// chat:message    ChatMessage
//                   Sent to the private session room AND to the "admins"
//                   room, for both user and admin messages.
//
// sessions:update SessionOverview[]
//                   Sent to the "admins" room whenever the inbox changes
//                   (new session, new message, read state change).
//
// user:typing     { sessionId: string; isTyping: boolean }  (to admins)
//
// admin:typing    { isTyping: boolean }  (to the private session room)

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Mini service port — always reach it through the gateway query param */
export const CHAT_SERVICE_PORT = 3003;

export const SOCKET_URL = `/?XTransformPort=${CHAT_SERVICE_PORT}`;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 40;

/** Default admin password (demo). Server may override via ADMIN_PASSWORD env. */
export const ADMIN_PASSWORD_HINT = "admin123";

export const CUSTOMER_STORAGE_KEY = "chatkita:customer-session";
