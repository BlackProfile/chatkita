"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCheck,
  Copy,
  Pause,
  Play,
  Reply,
  Trash2,
} from "lucide-react";

import type { ReplyPreview } from "@/lib/chat-types";
import { formatChatTime } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  content: string;
  createdAt: string;
  /** left = received (admin/customer partner), right = sent by current user */
  side: "left" | "right";
  type?: "text" | "image" | "voice" | "system";
  /** Partner has read up to this message → ✓✓ on own bubbles. */
  read?: boolean;
  replyTo?: ReplyPreview;
  /** Label for the quoted author ("Anda" / partner name). */
  replyAuthor?: string;
  durationMs?: number;
  transcript?: string;
  deleted?: boolean;
  onReply?: () => void;
  onDelete?: () => void;
  onImageOpen?: (src: string) => void;
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
 * so multi-line messages and long unbroken strings behave.
 * Clicking a bubble toggles a small action row (reply/copy/delete).
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
  onReply,
  onDelete,
  onImageOpen,
}: ChatBubbleProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

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

  const isRight = side === "right";
  const canDelete = !deleted && isRight && !!onDelete;

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
            !deleted && "cursor-pointer"
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
            <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
          )}

          {/* Time + read receipts */}
          <span
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70",
              type !== "text" && !deleted && "pr-1.5"
            )}
          >
            {formatChatTime(createdAt)}
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

      {/* Action row */}
      {actionsOpen && !deleted ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className={cn(
            "mt-1 flex items-center gap-0.5 rounded-full border bg-popover px-1 py-0.5 shadow-sm",
            isRight ? "mr-1" : "ml-1"
          )}
        >
          {onReply ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                setActionsOpen(false);
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
                setActionsOpen(false);
              }}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              {copied ? "Tersalin!" : "Salin"}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                setActionsOpen(false);
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
