/**
 * Shared contract between the Next.js frontend and the chat-service
 * mini service (socket.io, port 3003). DO NOT change event names or
 * payload shapes without updating BOTH sides.
 *
 * Model (v6 — pure private messenger, like WhatsApp/Telegram):
 *   Every person who opens the app logs in with a name and gets a
 *   private 1-on-1 chat with the Admin account (the app owner), just
 *   like messaging any contact.
 *   - A user NEVER sees other users, their presence, or their messages
 *     (enforced server-side via participant checks).
 *   - The Admin (owner) sees ALL conversations in one list, like
 *     WhatsApp Web.
 *   - Messages: text | image | voice | file | system (+ replies, edit,
 *     delete-for-everyone, emoji reactions, live ✓✓ read receipts, pinned
 *     messages, archive, voice-note transcription, on-demand translate,
 *     Web Push notifications, document/video/audio file sharing).
 *   - Images & voice notes travel in-band as data URLs (size-capped).
 *   - Files (docs, video, audio, archives, …) are uploaded out-of-band
 *     via the Next.js route POST /api/upload (stored under db/media/ on
 *     disk) and the message carries the public URL /api/media/<name>
 *     plus fileName/fileSize/mimeType metadata. GET /api/media/<name>
 *     streams the bytes back (inline preview; ?download=1 for download).
 *
 * NO customer-service tooling lives here anymore: no operating hours,
 * no quick-reply templates, no AI auto-reply/summary/suggestions, no
 * SLA alerts, no chatbot menu, no pre-chat form, no star ratings, no
 * broadcast, no CRM labels/notes, no stats, no CSV/PDF export.
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

export type MessageContentType = "text" | "image" | "voice" | "file" | "system";

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

/** A chat message. Media content = data URL or /api/media URL; deleted → content "". */
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
  /** Set when the sender edited their text message. */
  editedAt?: string;
  /** Indonesian translation fetched on demand. */
  translation?: string;
  /** Emoji reactions (may arrive later via message:updated). */
  reactions?: MessageReaction[];
  /** file messages: original file name (display only). */
  fileName?: string;
  /** file messages: size in bytes. */
  fileSize?: number;
  /** file messages: MIME type (e.g. application/pdf, video/mp4). */
  mimeType?: string;
}

/** A chat partner including live presence info. */
export type PartnerInfo = ChatUser & {
  online: boolean;
  /** ISO timestamp of the last time this user was online (null if unknown). */
  lastSeenAt: string | null;
};

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
    /** file messages: original file name (for "📎 <nama>" previews). */
    fileName?: string;
  } | null;
  lastMessageAt: string;
  /** Unread messages sent by the partner. */
  unread: number;
  /** How far the PARTNER has read → ✓✓ on my own bubbles. */
  partnerLastReadId: number;
  /** Archived conversations live in their own tab (WhatsApp-style). */
  archived?: boolean;
  /** Pinned message banner (both sides). */
  pinnedMessageId?: number | null;
  pinned?: { id: number; senderId: string; snippet: string; type: string } | null;
}

/* ------------------------------------------------------------------ */
/* Ack payloads                                                        */
/* ------------------------------------------------------------------ */

/** Ack payload returned by `public:settings` (pre-login push config). */
export interface PublicSettingsAck {
  ok: true;
  pushPublicKey: string;
}

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
  /** VAPID public key for Web Push ("" when push is unavailable). */
  pushPublicKey: string;
  /** Pinned banner state. */
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
  /** My read cursor BEFORE this call → "new messages" divider. */
  lastReadBefore: number;
  /** Pinned banner state. */
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

export interface TranslateAck {
  ok: true;
  translation: string | null;
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
// public:settings    {} → PublicSettingsAck | ChatErrorAck
//                      Pre-login fetch of the Web Push VAPID public key.
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
//                     type?: 'text'|'image'|'voice'|'file';
//                     replyToId?: number; durationMs?: number;
//                     fileName?: string; fileSize?: number; mimeType?: string }
//                     → MessageAck | ChatErrorAck
//                     Both roles; participant-gated. Sender auto-reads.
//                     image/voice content = data URL (size-capped server-
//                     side). Voice notes are transcribed asynchronously
//                     (transcript arrives via message:updated).
//                     file content = /api/media/<name> URL obtained from
//                     POST /api/upload; fileName (1–255 chars), mimeType
//                     (type/subtype) and fileSize (≤ 25 MiB) are required
//                     metadata validated server-side.
//
// messages:delete   { messageId: number }
//                     → { ok: true } | ChatErrorAck
//                     Sender-only soft delete; content redacted for
//                     everyone; broadcast as message:updated.
//
// messages:edit     { messageId: number; content: string }
//                     → { ok: true } | ChatErrorAck
//                     Sender-only, text messages, 15-minute window;
//                     broadcast as message:updated.
//
// message:react     { messageId: number; emoji: string }
//                     → { ok: true } | ChatErrorAck
//                     Toggle the caller's reaction on a message.
//                     Empty emoji removes the caller's reaction.
//
// message:translate { messageId: number } → TranslateAck | ChatErrorAck
//                     On-demand Indonesian translation (AI, best effort).
//
// messages:read     { conversationId: string }                 (no ack)
//
// typing            { conversationId: string; isTyping: boolean } (no ack)
//
// user:setpin       { pin: string | null }        → SetPinAck | ChatErrorAck
//                     4–8 digits, or null/"" to remove. User role only.
//
// conversation:pin     { conversationId, messageId|null } (admin)
// conversation:archive { conversationId, archived }  (admin)
//                     Plain archive/unarchive — no rating side effects.
// push:subscribe       { subscription }              (no ack, user/admin)

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
// message:updated      MessageUpdatePayload
//                        Merge-by-id: delete tombstones, edits, late
//                        voice transcripts, translations, reactions.
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
//                        typer is admin).
//
// presence:update      { userId: string; online: boolean;
//                        lastSeenAt: string | null }
//                        User online/offline → `admins` room ONLY
//                        (users must never learn about other users).
//                        Admin online/offline → all `user:<id>` rooms.
//
// conversation:update  PinUpdatePayload — pinned banner changed (both).
// conversation:archive:update ArchiveUpdatePayload (admins room only).
