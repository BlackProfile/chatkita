/**
 * Shared contract between the Next.js frontend and the messenger-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 */

export interface ChatUser {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  content: string;
  /** ISO 8601 timestamp string */
  createdAt: string;
}

export interface ConversationOverview {
  id: string;
  /** The OTHER participant of this 1-on-1 conversation */
  partner: ChatUser & { online: boolean };
  lastMessage: {
    id: number;
    senderId: string;
    content: string;
    createdAt: string;
  } | null;
  lastMessageAt: string;
  /** Unread messages sent by the partner */
  unread: number;
}

export interface SearchUser {
  id: string;
  name: string;
  online: boolean;
}

/* ------------------------------------------------------------------ */
/* Ack payloads                                                        */
/* ------------------------------------------------------------------ */

/** Ack payload returned by `user:auth` */
export interface UserAuthAck {
  ok: true;
  user: ChatUser;
  conversations: ConversationOverview[];
}

/** Ack payload returned by `users:search` */
export interface SearchAck {
  ok: true;
  users: SearchUser[];
}

/** Ack payload returned by `conversations:start` */
export interface StartConversationAck {
  ok: true;
  conversation: ConversationOverview;
}

/** Ack payload returned by `messages:history` */
export interface HistoryAck {
  ok: true;
  messages: ChatMessage[];
  partner: ChatUser & { online: boolean };
}

/** Ack payload returned by `messages:send` */
export interface MessageAck {
  ok: true;
  message: ChatMessage;
}

/** Generic error ack: `{ ok: false, error: ErrorCode }` */
export type ChatErrorCode =
  | "INVALID_NAME"
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
// user:auth          { name: string; userId?: string }
//                      → UserAuthAck | ChatErrorAck
//                      Login (userId) or register/find-by-name. Joins the
//                      personal `user:<id>` room + global `users` room.
//
// users:search       { query?: string }
//                      → SearchAck | ChatErrorAck
//                      Find users by name (empty query = recent users),
//                      excluding self.
//
// conversations:start { userId: string }
//                      → StartConversationAck | ChatErrorAck
//                      Get-or-create a 1-on-1 conversation. Both sides get
//                      a fresh `conversations:update`.
//
// messages:history   { conversationId: string }
//                      → HistoryAck | ChatErrorAck
//                      Participant-only. Marks the conversation read.
//
// messages:send      { conversationId: string; content: string }
//                      → MessageAck | ChatErrorAck
//
// messages:read      { conversationId: string }            (no ack)
//
// typing             { conversationId: string; isTyping: boolean } (no ack)

/* ------------------------------------------------------------------ */
/* Server → Client events                                              */
/* ------------------------------------------------------------------ */
//
// message:new          ChatMessage
//                        To BOTH participants' personal rooms.
//
// conversations:update ConversationOverview[]
//                        Personalized list for ONE user (their own room).
//
// partner:typing       { conversationId: string; isTyping: boolean }
//
// presence:update      { userId: string; online: boolean }
//                        To the `users` room whenever someone goes
//                        online/offline.

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Mini service port — always reach it through the gateway query param */
export const CHAT_SERVICE_PORT = 3003;

export const SOCKET_URL = `/?XTransformPort=${CHAT_SERVICE_PORT}`;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 40;

/** Persisted login (Telegram-style: name + user id, no password). */
export const MESSENGER_STORAGE_KEY = "chatkita:messenger-user";
