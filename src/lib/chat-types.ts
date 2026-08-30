/**
 * Shared contract between the Next.js frontend and the chat-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 *
 * Model (v4 — "Telegram-style, private 1-on-1 with Admin"):
 *   Every human user chats with exactly ONE partner: the Admin.
 *   - A user NEVER sees other users, their presence, or their messages
 *     (enforced server-side via participant checks).
 *   - The Admin sees ALL users' conversations in one list.
 *   - Messages: text | image | voice | system (+ replies, delete-for-
 *     everyone, live ✓✓ read receipts, AI transcript on voice notes).
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

/** Persisted per-browser mute for the new-message blip. */
export const CHAT_SOUND_KEY = "chatkita:sound";

/** Persisted per-browser chat font size ("sm" | "md" | "lg"). */
export const CHAT_FONT_KEY = "chatkita:font-size";

/** Draft of an unsent message (per role/conversation), survives reloads. */
export const draftKey = (scope: string, id: string) => `chatkita:draft:${scope}:${id}`;

/** Demo hint rendered on the admin login form (server default password). */
export const ADMIN_PASSWORD_HINT = "admin123";

/** Which mini service port — always reach it through the gateway query param. */
export const CHAT_SERVICE_PORT = 3003;

export const SOCKET_URL = `/?XTransformPort=${CHAT_SERVICE_PORT}`;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 40;

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export interface ChatUser {
  id: string;
  name: string;
  /** Present on user auth: whether this account is PIN-protected. */
  hasPin?: boolean;
}

export type MessageContentType =
  | "text"
  | "image"
  | "voice"
  | "system"
  | "broadcast";

/** Grouped emoji reactions on one message. */
export interface MessageReaction {
  emoji: string;
  /** User ids who reacted with this emoji. */
  userIds: string[];
}

/** Snapshot of the original message a reply points at. */
export interface ReplyPreview {
  id: number;
  senderId: string;
  snippet: string;
  type: string;
}

/** A chat message. Media content = data URL; deleted → content "". */
export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  content: string;
  /** ISO 8601 timestamp string */
  createdAt: string;
  type: MessageContentType;
  replyToId?: number;
  replyTo?: ReplyPreview;
  /** Voice notes: recording length in ms. */
  durationMs?: number;
  /** Voice notes: AI transcription (may arrive later via message:updated). */
  transcript?: string;
  /** Soft delete marker (content is redacted server-side). */
  deletedAt?: string;
  /** v5 — set when the sender edited their text message. */
  editedAt?: string;
  /** v5 — Indonesian translation fetched on demand. */
  translation?: string;
  /** v5 — emoji reactions (may arrive later via message:updated). */
  reactions?: MessageReaction[];
  /** v5 — special system card marker (rating_request / rating_thanks). */
  kind?: string;
}

/** A chat partner including live presence info. */
export type PartnerInfo = ChatUser & {
  online: boolean;
  /** ISO timestamp of the last time this user was online (null if unknown). */
  lastSeenAt: string | null;
  /** Admin-set CRM label (admin side of the overview list). */
  label?: string | null;
  /** v5 — topic chosen on the pre-chat form (admin side). */
  topic?: string | null;
};

export type UserLabel = "new" | "priority" | "vip";

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
    type: string;
    deleted: boolean;
  } | null;
  lastMessageAt: string;
  /** Unread messages sent by the partner. */
  unread: number;
  /** How far the PARTNER has read → ✓✓ on my own bubbles. */
  partnerLastReadId: number;
  /** v5 — archived conversations live in their own admin tab. */
  archived?: boolean;
  /** v5 — pinned message banner (both sides). */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
}

/** Admin-configurable service settings (operating hours / AI / templates). */
export interface ServiceSettings {
  hours: { enabled: boolean; start: string; end: string; days: number[] };
  aiEnabled: boolean;
  aiKb: string;
  outsideMsg: string;
  quickReplies: { label: string; text: string }[];
  /** v5 — admin alert when a user message waits longer than this. */
  slaMinutes: number;
  /** v5 — chatbot menu on the user side (instant mapped answers). */
  chatMenuEnabled: boolean;
  chatMenuItems: { label: string; answer: string }[];
  /** v5 — comma-separated pre-chat topic options ("" = form off). */
  preChatTopics: string;
}

/** Settings exposed to logged-in users (public side, v5). */
export interface PublicSettings {
  chatMenuEnabled: boolean;
  chatMenuItems: { label: string; answer: string }[];
  preChatTopics: string[];
  pushPublicKey: string;
}

export interface ChatStats {
  totalUsers: number;
  totalMessages: number;
  messagesToday: number;
  activeToday: number;
  /** Average admin response time in minutes (last 7 days), null if no data. */
  avgResponseMin: number | null;
  /** v5 — messages per day over the last 7 days (two-way). */
  daily: { date: string; user: number; admin: number }[];
  /** v5 — average star rating + number of ratings. */
  avgRating: number | null;
  ratingCount: number;
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
  /** How far the admin has read → ✓✓ on my sent messages. */
  partnerLastReadId: number;
  /** v5 — public config (menu chips, pre-chat topics, VAPID key). */
  publicSettings: PublicSettings;
  /** v5 — pinned banner state. */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
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
  partnerLastReadId: number;
  /** v5 — my read cursor BEFORE this call → "new messages" divider. */
  lastReadBefore: number;
  /** v5 — pinned banner state. */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
}

/** Ack payload returned by `messages:send`. */
export interface MessageAck {
  ok: true;
  message: ChatMessage;
}

export interface SetPinAck {
  ok: true;
  hasPin: boolean;
}

export interface UpdateUserAck {
  ok: true;
  userId: string;
  label: string | null;
  note: string | null;
}

export interface NoteAck {
  ok: true;
  userId: string;
  label: string | null;
  note: string | null;
}

export interface SettingsAck {
  ok: true;
  settings: ServiceSettings;
}

export interface StatsAck {
  ok: true;
  stats: ChatStats;
}

export interface SuggestAck {
  ok: true;
  suggestions: string[];
}

export interface SummaryAck {
  ok: true;
  summary: string;
}

/* v5 acks */

export interface TranslateAck {
  ok: true;
  translation: string | null;
}

export interface ExportAck {
  ok: true;
  conversationId: string;
  partnerName: string;
  messages: ChatMessage[];
}

export interface BroadcastAck {
  ok: true;
  sent: number;
}

export interface RatingAck {
  ok: true;
  stars: number;
}

export interface PinUpdatePayload {
  conversationId: string;
  pinnedMessageId: number | null;
  pinned: { id: number; senderId: string; snippet: string; type: string } | null;
}

export interface ArchiveUpdatePayload {
  conversationId: string;
  archived: boolean;
}

/** Shape of the message:updated merge payload (superset of all versions). */
export interface MessageUpdatePayload {
  id: number;
  conversationId: string;
  deletedAt?: string;
  transcript?: string;
  content?: string;
  editedAt?: string;
  translation?: string;
  reactions?: MessageReaction[];
}

/** Generic error ack: `{ ok: false, error: ErrorCode }` */
export type ChatErrorCode =
  | "INVALID_NAME"
  | "NAME_RESERVED"
  | "INVALID_MESSAGE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "PIN_REQUIRED"
  | "INVALID_PIN"
  | "INVALID_LABEL"
  | "INVALID_NOTE"
  | "AI_UNAVAILABLE"
  | "SERVER_ERROR";

export interface ChatErrorAck {
  ok: false;
  error: ChatErrorCode;
  hasPin?: boolean;
}

export type AckOf<T> = T | ChatErrorAck;

/* ------------------------------------------------------------------ */
/* Client → Server events (ack via callback where listed)              */
/* ------------------------------------------------------------------ */
//
// user:auth         { name: string; userId?: string; pin?: string }
//                     → UserAuthAck | ChatErrorAck
//                     Login (session userId) or find-or-create by
//                     (case-insensitive) name. PIN-protected accounts must
//                     present `pin` on fresh logins (PIN_REQUIRED /
//                     INVALID_PIN). Ensures the 1-on-1 conversation with
//                     Admin, marks it read (broadcasts read:update),
//                     returns the full history + admin read cursor.
//
// admin:auth        { password: string }
//                     → AdminAuthAck | ChatErrorAck
//                     Password login (ADMIN_PASSWORD env or "admin123").
//                     Joins the `admins` room; returns ALL conversations.
//
// messages:history  { conversationId: string }
//                     → HistoryAck | ChatErrorAck
//                     Both roles; participant-gated; marks read.
//
// messages:send     { conversationId: string; content: string;
//                     type?: 'text'|'image'|'voice';
//                     replyToId?: number; durationMs?: number }
//                     → MessageAck | ChatErrorAck
//                     Both roles; participant-gated. Sender auto-reads.
//                     image/voice content = data URL (size-capped server-
//                     side). Voice notes are transcribed asynchronously
//                     (transcript arrives via message:updated).
//
// messages:delete   { messageId: number }
//                     → { ok: true } | ChatErrorAck
//                     Sender-only soft delete; content redacted for
//                     everyone; broadcast as message:updated.
//
// messages:read     { conversationId: string }                 (no ack)
//
// typing            { conversationId: string; isTyping: boolean } (no ack)
//
// user:setpin       { pin: string | null }        → SetPinAck | ChatErrorAck
//                     4–8 digits, or null/"" to remove. User role only.
//
// admin:updateuser  { userId: string; label?: string|null;
//                     note?: string|null }        → UpdateUserAck | …
//                     Admin only. label ∈ new|priority|vip.
//
// admin:getnote     { userId: string }            → NoteAck | ChatErrorAck
//
// admin:settings    { settings: Partial<ServiceSettings> }
//                     → SettingsAck | ChatErrorAck (admin only, merged)
// admin:getsettings {}                            → SettingsAck | …
// admin:stats       {}                            → StatsAck | ChatErrorAck
//
// ai:suggest        { conversationId: string }    → SuggestAck | …  (admin)
// ai:summary        { conversationId: string }    → SummaryAck | …  (admin)

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
// message:updated      { id, conversationId, deletedAt?, transcript?,
//                        content, type }
//                        Merge-by-id: delete tombstones + late voice
//                        transcripts.
//
// read:update          { conversationId, userId, lastReadMessageId }
//                        `userId` = who read. Own sent messages with
//                        id <= lastReadMessageId become ✓✓.
//
// conversations:update ConversationOverview[]
//                        Personalized: full list to the `admins` room;
//                        the caller's own list to a `user:<id>` room.
//
// partner:typing       { conversationId: string; isTyping: boolean }
//                        Relayed to the OTHER participant (admins room
//                        when the typer is a user, user room when the
//                        typer is admin). Also emitted by the AI
//                        assistant while it composes.
//
// presence:update      { userId: string; online: boolean;
//                        lastSeenAt: string | null }
//                        User online/offline → `admins` room ONLY
//                        (users must never learn about other users).
//                        Admin online/offline → all `user:<id>` rooms.
//
// — v5 additions —
//
// conversation:update  PinUpdatePayload
//                        Pinned-message banner changed (both roles).
// conversation:archive:update ArchiveUpdatePayload (admins room only).
// message:updated      MessageUpdatePayload — now also merges editedAt,
//                        translation, and reactions.
// user:auth ack now carries publicSettings (menu, pre-chat topics, VAPID).
// history ack now carries lastReadBefore (unread divider) + pinned state.
//
// New client → server events:
// message:react        { messageId, emoji }          → { ok: true }
// message:edit         { messageId, content }        → { ok: true }
// message:translate    { messageId }                 → TranslateAck | …
// conversation:pin     { conversationId, messageId|null } (admin)
// conversation:archive { conversationId, archived }  (admin)
// conversation:export  { conversationId }            → ExportAck (admin)
// broadcast:send       { content }                   → BroadcastAck (admin)
// rating:submit        { conversationId, stars }     → RatingAck (user)
// push:subscribe       { subscription }              (no ack, user/admin)
