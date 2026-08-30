"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCheck,
  Copy,
  Languages,
  Pause,
  Pencil,
  Pin,
  Play,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";

import type { MessageReaction, ReplyPreview } from "@/lib/chat-types";
import { formatChatTime } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/** Fixed reaction palette (mirrors the server). */
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface ChatBubbleProps {
  content: string;
  createdAt: string;
  /** left = received (admin/customer partner), right = sent by current user */
  side: "left" | "right";
  type?: "text" | "image" | "voice" | "system" | "broadcast";
  /** Partner has read up to this message → ✓✓ on own bubbles. */
  read?: boolean;
  replyTo?: ReplyPreview;
  /** Label for the quoted author ("Anda" / partner name). */
  replyAuthor?: string;
  durationMs?: number;
  transcript?: string;
  deleted?: boolean;
  /** v5 — message id (jump-to-message anchor + aria). */
  messageId?: number;
  /** v5 — grouped emoji reactions. */
  reactions?: MessageReaction[];
  /** v5 — current user id (highlights own reactions). */
  myUserId?: string;
  /** v5 — the message was edited (shows "diedit"). */
  edited?: boolean;
  /** v5 — Indonesian translation (on demand). */
  translation?: string;
  /** v5 — translation request in flight. */
  translating?: boolean;
  /** v5 — this message is pinned in the conversation. */
  pinned?: boolean;
  /** v5 — can the user edit this message now (own text < window). */
  canEdit?: boolean;
  /** v5 — show the "Sematkan" action (admin only). */
  canPin?: boolean;
  onReply?: () => void;
  onDelete?: () => void;
  onImageOpen?: (src: string) => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onTranslate?: () => void;
  onPin?: () => void;
}

/* ------------------------------------------------------------------ */
/* Voice player (play/pause + seek bar + duration)                     */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function VoicePlayer({
  src,
  durationMs,
  mine,
}: {
  src: string;
  durationMs?: number;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [realDurationMs, setRealDurationMs] = useState(0);

  const total = realDurationMs || durationMs || 0;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => setPlaying(false));
  };

  return (
    <div className="flex min-w-44 items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(total);
        }}
        onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setRealDurationMs(d * 1000);
        }}
      />
      <button
        type="button"
        aria-label={playing ? "Jeda pesan suara" : "Putar pesan suara"}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          mine ? "bg-white/20 text-white hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"
        )}
        onClick={toggle}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, total)}
        value={Math.min(positionMs, total)}
        aria-label="Posisi pemutar suara"
        className="h-1 w-24 cursor-pointer accent-current sm:w-32"
        onChange={(e) => {
          const audio = audioRef.current;
          const value = Number(e.target.value);
          setPositionMs(value);
          if (audio && total > 0) audio.currentTime = value / 1000;
        }}
      />
      <span className={cn("text-[10px] tabular-nums", mine ? "opacity-80" : "opacity-60")}>
        {formatDuration(playing || positionMs > 0 ? positionMs : total)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bubble                                                              */
/* ------------------------------------------------------------------ */

/**
 * A single chat message bubble. Message text is rendered as plain text
 * (never dangerouslySetInnerHTML) with `whitespace-pre-wrap break-words`
 * so multi-line messages and long unbroken strings behave. The text size
 * is INHERITED so the per-device font-size setting works.
 * Clicking a bubble toggles the action row (react/reply/edit/…).
 */
export function ChatBubble({
  content,
  createdAt,
  side,
  type = "text",
  read = false,
  replyTo,
  replyAuthor,
  durationMs,
  transcript,
  deleted = false,
  messageId,
  reactions,
  myUserId,
  edited = false,
  translation,
  translating = false,
  pinned = false,
  canEdit = false,
  canPin = false,
  onReply,
  onDelete,
  onImageOpen,
  onReact,
  onEdit,
  onTranslate,
  onPin,
}: ChatBubbleProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const closeActions = () => {
    setActionsOpen(false);
    setReactOpen(false);
  };

  /* System notices: centered pill, no side, no actions. */
  if (type === "system") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-center"
      >
        <p className="max-w-[85%] rounded-full bg-muted/70 px-3.5 py-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
          {content}
        </p>
      </motion.div>
    );
  }

  /* Broadcast: prominent centered card (📢 pengumuman admin ke semua user). */
  if (type === "broadcast") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-center"
      >
        <div className="max-w-[92%] rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 sm:max-w-[80%]">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            📢 Pengumuman
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {formatChatTime(createdAt)}
          </p>
        </div>
      </motion.div>
    );
  }

  const isRight = side === "right";
  const canDelete = !deleted && isRight && !!onDelete;
  const reactionList = reactions ?? [];

  const handleCopy = () => {
    if (type !== "text" || deleted) return;
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("flex w-full flex-col", isRight ? "items-end" : "items-start")}
      data-mid={messageId}
    >
      <div className="group relative max-w-[85%] sm:max-w-[75%] md:max-w-[65%]">
        <div
          role={actionsOpen ? "button" : undefined}
          tabIndex={actionsOpen ? 0 : undefined}
          className={cn(
            "rounded-2xl px-3.5 py-2",
            isRight
              ? "rounded-br-md bg-emerald-600 text-white"
              : "rounded-bl-md border bg-card text-foreground shadow-sm",
            type !== "text" && !deleted && "p-1.5",
            !deleted && "cursor-pointer",
            pinned && !deleted && "ring-1 ring-amber-400/70"
          )}
          onClick={() => setActionsOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActionsOpen((v) => !v);
            }
          }}
        >
          {/* Reply quote */}
          {replyTo ? (
            <div
              className={cn(
                "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs",
                isRight ? "border-white/60 bg-white/10" : "border-emerald-500 bg-muted/60"
              )}
            >
              <p className={cn("font-medium", isRight ? "text-white/90" : "text-emerald-600")}>
                {replyAuthor ?? "Balasan"}
              </p>
              <p className={cn("line-clamp-2", isRight ? "text-white/75" : "text-muted-foreground")}>
                {replyTo.snippet}
              </p>
            </div>
          ) : null}

          {/* Deleted tombstone */}
          {deleted ? (
            <p className="flex items-center gap-1.5 py-0.5 text-sm italic opacity-70">
              <Trash2 className="size-3.5" aria-hidden="true" />
              Pesan ini dihapus
            </p>
          ) : type === "image" ? (
            <img
              src={content}
              alt="Foto yang dikirim"
              className="max-h-64 w-auto cursor-zoom-in rounded-xl object-cover"
              loading="lazy"
              onClick={(e) => {
                e.stopPropagation();
                onImageOpen?.(content);
              }}
            />
          ) : type === "voice" ? (
            <div className="px-1.5 py-1">
              <VoicePlayer src={content} durationMs={durationMs} mine={isRight} />
              {transcript ? (
                <p
                  className={cn(
                    "mt-1.5 border-t pt-1.5 text-xs leading-relaxed",
                    isRight ? "border-white/20 text-white/85" : "border-border text-muted-foreground"
                  )}
                >
                  📝 {transcript}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{content}</p>
          )}

          {/* v5 — translation */}
          {!deleted && translation ? (
            <p
              className={cn(
                "mt-1.5 border-t pt-1.5 text-xs italic leading-relaxed",
                isRight ? "border-white/20 text-white/85" : "border-border text-muted-foreground"
              )}
            >
              🌐 {translation}
            </p>
          ) : null}
          {!deleted && translating ? (
            <p
              className={cn(
                "mt-1.5 border-t pt-1.5 text-xs italic",
                isRight ? "border-white/50" : "border-border text-muted-foreground"
              )}
            >
              🌐 Menerjemahkan…
            </p>
          ) : null}

          {/* Time + read receipts */}
          <span
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70",
              type !== "text" && !deleted && "pr-1.5"
            )}
          >
            {formatChatTime(createdAt)}
            {edited && !deleted ? <span aria-label="Pesan diedit">· diedit</span> : null}
            {pinned && !deleted ? <Pin className="size-3" aria-label="Disematkan" /> : null}
            {isRight ? (
              read ? (
                <CheckCheck className="size-3.5" aria-label="Dibaca" />
              ) : (
                <Check className="size-3.5" aria-label="Terkirim" />
              )
            ) : null}
          </span>
        </div>
      </div>

      {/* Reaction pills (v5) */}
      {reactionList.length > 0 ? (
        <div className={cn("mt-0.5 flex flex-wrap gap-1", isRight ? "mr-1" : "ml-1")}>
          {reactionList.map((r) => {
            const mine = !!myUserId && r.userIds.includes(myUserId);
            return (
              <button
                key={r.emoji}
                type="button"
                aria-label={`Reaksi ${r.emoji} (${r.userIds.length})`}
                onClick={() => onReact?.(r.emoji)}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition-colors",
                  mine
                    ? "border-emerald-500 bg-emerald-600/10"
                    : "border-border bg-card hover:bg-accent"
                )}
              >
                <span aria-hidden="true">{r.emoji}</span>
                {r.userIds.length > 1 ? (
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                    {r.userIds.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Action row */}
      {actionsOpen && !deleted ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className={cn(
            "mt-1 flex flex-wrap items-center gap-0.5 rounded-full border bg-popover px-1 py-0.5 shadow-sm",
            isRight ? "mr-1" : "ml-1"
          )}
        >
          {onReact ? (
            reactOpen ? (
              REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Reaksi ${emoji}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-base hover:bg-accent"
                  onClick={() => {
                    onReact(emoji);
                    closeActions();
                  }}
                >
                  {emoji}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
                onClick={() => setReactOpen(true)}
              >
                <SmilePlus className="size-3.5" aria-hidden="true" />
                Reaksi
              </button>
            )
          ) : null}
          {onReply ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onReply();
              }}
            >
              <Reply className="size-3.5" aria-hidden="true" />
              Balas
            </button>
          ) : null}
          {type === "text" ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                handleCopy();
                closeActions();
              }}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              {copied ? "Tersalin!" : "Salin"}
            </button>
          ) : null}
          {canEdit && onEdit ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onEdit();
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </button>
          ) : null}
          {type === "text" && !deleted && onTranslate ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onTranslate();
              }}
            >
              <Languages className="size-3.5" aria-hidden="true" />
              {translation ? "Terjemahan" : "Terjemahkan"}
            </button>
          ) : null}
          {canPin && onPin ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onPin();
              }}
            >
              <Pin className="size-3.5" aria-hidden="true" />
              {pinned ? "Lepas sematan" : "Sematkan"}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                closeActions();
                onDelete();
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Hapus
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </motion.div>
  );
}
