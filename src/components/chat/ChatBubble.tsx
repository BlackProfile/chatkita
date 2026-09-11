"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  History,
  Hourglass,
  Image as ImageIcon,
  Info,
  Languages,
  Music,
  EyeOff,
  Pause,
  Pencil,
  Pin,
  Play,
  Reply,
  SmilePlus,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type { MessageReaction, ReplyPreview } from "@/lib/chat-types";
import { formatChatTime, formatFileSize, resolveFileKind } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { FileKindIcon } from "@/components/chat/media-viewer";
import { firstUrlInText, LinkifiedText, LinkPreviewCard } from "@/components/chat/link-preview";
import { StickerSvg } from "@/lib/stickers";
import { VoicePlayer } from "@/components/chat/voice-player";
import { Eye, Flame, FolderPlus, BarChart3, MapPin, UserRound } from "lucide-react";

/** Fixed reaction palette (mirrors the server). */
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** Media yang dibuka di viewer full-screen (foto/PDF; URL + metadata). */
export interface BubbleMedia {
  url: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

interface ChatBubbleProps {
  content: string;
  createdAt: string;
  /** left = received (partner), right = sent by current user */
  side: "left" | "right";
  type?: "text" | "image" | "voice" | "file" | "system" | "sticker" | "poll" | "game" | "location" | "contact";
  /** file messages: metadata tampilan (ikon, ukuran, nama). */
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  /** v8 — thumbnail kecil (<30 KB) untuk foto/video; bubble memuat ini. */
  thumbUrl?: string;
  /** v20 — caption teks opsional yang ikut dikirim bersama media (foto/file). */
  caption?: string;
  /** v8 — media sudah dihapus pembersih retensi (tombstone). */
  mediaExpired?: boolean;
  /** v8 — mode hemat data: media berat tanpa thumbnail tidak dimuat otomatis. */
  dataSaver?: boolean;
  /** Partner has read up to this message → ✓✓ on own bubbles. */
  read?: boolean;
  replyTo?: ReplyPreview;
  /** Label for the quoted author ("Anda" / partner name). */
  replyAuthor?: string;
  durationMs?: number;
  transcript?: string;
  /** Soft delete marker (content is redacted server-side). */
  deleted?: boolean;
  /** v47 — isi asli ditampilkan walau dihapus (cheat antiDelete). */
  ghosted?: boolean;
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
  /** v22 — pesan berbintang oleh pengguna saat ini. */
  starred?: boolean;
  /** v22 — label "Diteruskan dari …" (pesan hasil forward admin). */
  forwardedFrom?: string;
  /** v22 — pesan terjadwal: ISO waktu kirim otomatis (belum terkirim). */
  scheduledAt?: string;
  /** v48 — media sensitif: blur sampai diketuk penerima. */
  sensitive?: boolean;
  /** v48 — nama album media (label kecil di bubble). */
  album?: string;
  /** v48 — media hancur setelah dilihat penerima (chip peringatan). */
  burn?: boolean;
  /** v48 — jebakan tautan (cheat admin): semua URL pesan ini dibuka ke sini. */
  trapUrl?: string;
  /** v48 — laporkan klik jebakan tautan (cheat admin) ke server. */
  onTrapClick?: () => void;
  /* v52 — kartu polling: data opsi + hasil live + pilihan saya. */
  pollData?: { question: string; options: string[] } | null;
  pollResults?: { counts: number[]; total: number } | null;
  myPollChoice?: number | null;
  /** v52 — beri/ganti suara pada opsi polling. */
  onPollVote?: (optionIndex: number) => void;
  /* v52 — kartu game (dadu/koin/RPS) & lokasi/kontak di-parse dari content. */
  gameData?: { game: string; pick: string | number | null; server: string | number; outcome: "menang" | "kalah" | "seri" | null } | null;
  locationData?: { lat: number; lng: number; label: string } | null;
  contactData?: { name: string; phone: string; note: string } | null;
  /** v48 — teruskan pesan ini ke percakapan lain (pemilih di induk). */
  onForward?: () => void;
  /** v13 — kartu pratinjau tautan diaktifkan (setting aplikasi linkPreview). */
  linkPreviewEnabled?: boolean;
  /** v11 — moderasi admin: hapus pesan pengguna lain (dengan konfirmasi di induk). */
  onModerate?: () => void;
  /** v11 — admin: lihat riwayat revisi pesan yang pernah diedit. */
  onEditHistory?: () => void;
  /** v35 — admin: buka dialog metadata media (EXIF/GPS/dll). */
  onShowMeta?: () => void;
  onReply?: () => void;
  onDelete?: () => void;
  /** Buka media (foto/PDF) di viewer full-screen; jenis lain unduh langsung. */
  onMediaOpen?: (media: BubbleMedia) => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onTranslate?: () => void;
  onPin?: () => void;
  /** v22 — toggle bintang pesan ini. */
  onToggleStar?: () => void;
  /** v22 — batalkan pesan terjadwal milik sendiri (belum terkirim). */
  onCancelScheduled?: () => void;
}

/* ------------------------------------------------------------------ */
/* Bubble                                                              */
/* ------------------------------------------------------------------ */

/**
 * A single chat message bubble. Message text is rendered as safe text
 * (never dangerouslySetInnerHTML) with `whitespace-pre-wrap break-words`
 * so multi-line messages and long unbroken strings behave — URL di dalam
 * teks/caption otomatis jadi tautan yang bisa diklik langsung (v32,
 * LinkifiedText). The text size is INHERITED so the per-device font-size
 * setting works. Clicking a bubble toggles the action row.
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
  deleted: deletedRaw = false,
  ghosted = false,
  messageId,
  fileName,
  fileSize,
  mimeType,
  thumbUrl,
  caption,
  mediaExpired = false,
  dataSaver = false,
  reactions,
  myUserId,
  edited = false,
  translation,
  translating = false,
  pinned = false,
  canEdit = false,
  canPin = false,
  starred = false,
  forwardedFrom,
  scheduledAt,
  sensitive = false,
  album,
  burn = false,
  trapUrl,
  onTrapClick,
  onForward,
  pollData,
  pollResults,
  myPollChoice,
  onPollVote,
  gameData,
  locationData,
  contactData,
  linkPreviewEnabled = true,
  onModerate,
  onEditHistory,
  onShowMeta,
  onReply,
  onDelete,
  onMediaOpen,
  onReact,
  onEdit,
  onTranslate,
  onPin,
  onToggleStar,
  onCancelScheduled,
}: ChatBubbleProps) {
  // v47 — pesan hantu (kebal hapus) dirender seperti pesan hidup + badge;
  // hanya tombstone sungguhan yang mematikan aksi/media.
  const deleted = deletedRaw && !ghosted;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mediaRevealed, setMediaRevealed] = useState(false);
  /* v48 — blur sensitif: sembunyi lagi tiap pesan diperbarui (remount). */
  const [sensitiveRevealed, setSensitiveRevealed] = useState(false);
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

  const isRight = side === "right";
  const canDelete = !deleted && isRight && !!onDelete;
  const reactionList = reactions ?? [];
  /* Task 19 — URL pertama di pesan teks (kartu pratinjau di bawah teks). */
  const textLinkUrl = type === "text" && !deleted ? firstUrlInText(content) : null;
  /* file messages: kategori dari mimeType (+ fallback ekstensi nama). */
  const fileKind = type === "file" ? resolveFileKind(mimeType, fileName) : null;
  const isFileImage = type === "image" || (type === "file" && fileKind === "image");
  /* v8 — sumber gambar di bubble: thumbnail bila ada (ringan); tanpa
   * thumbnail, mode hemat data menunda pemuatan full sampai diketuk. */
  const imageSrc = mediaExpired
    ? null
    : (thumbUrl ?? (!dataSaver || mediaRevealed ? content : null));
  const fileDownloadUrl =
    type === "file" && content.startsWith("/api/media/")
      ? `${content}?download=1${fileName ? `&name=${encodeURIComponent(fileName)}` : ""}`
      : content;

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
              ? "rounded-br-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
              : "rounded-bl-md border border-black/5 bg-card text-foreground shadow-sm",
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

          {/* v22 — label pesan hasil forward */}
          {forwardedFrom ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-xs italic",
                isRight ? "text-white/80" : "text-muted-foreground"
              )}
            >
              <Reply className="size-3 -scale-x-100" aria-hidden="true" />
              Diteruskan dari {forwardedFrom}
            </p>
          ) : null}

          {/* v48 — label album + chip burn-on-view. */}
          {album && !deleted ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-[11px]",
                isRight ? "text-white/75" : "text-muted-foreground"
              )}
            >
              <FolderPlus className="size-3" aria-hidden="true" />
              {album}
            </p>
          ) : null}
          {burn && !deleted && !mediaExpired ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-[11px] italic",
                isRight ? "text-white/75" : "text-amber-600"
              )}
            >
              <Flame className="size-3" aria-hidden="true" />
              Hancur setelah dilihat
            </p>
          ) : null}

          {/* v47 — badge pesan hantu (cheat antiDelete) */}
          {ghosted ? (
            <p className="flex items-center gap-1.5 py-0.5 text-[11px] italic opacity-80">
              <EyeOff className="size-3" aria-hidden="true" />
              Dihapus pengirim — terlihat khusus
            </p>
          ) : null}

          {/* Deleted tombstone */}
          {deleted ? (
            <p className="flex items-center gap-1.5 py-0.5 text-sm italic opacity-70">
              <Trash2 className="size-3.5" aria-hidden="true" />
              Pesan ini dihapus
            </p>
          ) : mediaExpired ? (
            /* v8 — media dibersihkan pembersih retensi (teks/transkrip tetap). */
            <p className="flex items-center gap-1.5 py-0.5 text-sm italic opacity-70">
              <Hourglass className="size-3.5" aria-hidden="true" />
              Media kedaluwarsa
            </p>
          ) : type === "sticker" ? (
            /* v48 — stiker: karakter SVG besar tanpa background bubble. */
            <StickerSvg id={content} className="block size-28" />
          ) : isFileImage && !imageSrc ? (
            /* v8 — hemat data: foto tanpa thumbnail menunggu ketukan. */
            <button
              type="button"
              className={cn(
                "flex min-w-44 items-center gap-2 rounded-xl p-2.5 text-sm font-medium transition-colors",
                isRight ? "bg-white/15 hover:bg-white/25" : "bg-muted/70 hover:bg-muted"
              )}
              onClick={(e) => {
                e.stopPropagation();
                setMediaRevealed(true);
              }}
            >
              <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 break-words text-left leading-snug">
                {fileName ?? "Foto"} · ketuk untuk memuat
              </span>
            </button>
          ) : isFileImage && imageSrc ? (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <img
                src={imageSrc}
                alt={fileName ?? "Foto yang dikirim"}
                className={cn(
                  "max-h-64 w-auto cursor-zoom-in rounded-xl object-cover",
                  sensitive && !sensitiveRevealed && "blur-lg"
                )}
                loading="lazy"
                onClick={(e) => {
                  e.stopPropagation();
                  if (sensitive && !sensitiveRevealed) {
                    setSensitiveRevealed(true);
                    return;
                  }
                  onMediaOpen?.({ url: content, mimeType, fileName, fileSize });
                }}
              />
              {sensitive && !sensitiveRevealed ? (
                <button
                  type="button"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/30 text-xs font-medium text-white"
                  onClick={() => setSensitiveRevealed(true)}
                >
                  <Eye className="size-5" aria-hidden="true" />
                  Media sensitif — ketuk untuk lihat
                </button>
              ) : null}
            </div>
          ) : type === "poll" && pollData ? (
            /* v52 — polling/kuis: pertanyaan + opsi dengan bar hasil live. */
            <div
              className="w-64 min-w-56 max-w-72 px-1.5 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
                <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="break-words">{pollData.question}</span>
              </p>
              <div className="mt-2 space-y-1.5">
                {pollData.options.map((opt, i) => {
                  const votes = pollResults?.counts?.[i] ?? 0;
                  const total = pollResults?.total ?? 0;
                  const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                  const mine = myPollChoice === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={cn(
                        "relative block w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                        isRight
                          ? "border-white/25 hover:bg-white/20"
                          : "border-border hover:bg-muted",
                        mine && (isRight ? "ring-1 ring-white/70" : "ring-1 ring-emerald-500/70")
                      )}
                      onClick={() => onPollVote?.(i)}
                    >
                      {total > 0 ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute inset-y-0 left-0 transition-all",
                            isRight ? "bg-white/15" : "bg-emerald-500/15"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      ) : null}
                      <span className="relative flex items-center justify-between gap-2">
                        <span className="break-words">
                          {mine ? "● " : "○ "}
                          {opt}
                        </span>
                        {total > 0 ? <span className="shrink-0 tabular-nums opacity-80">{pct}%</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] leading-snug opacity-70">
                {pollResults?.total ?? 0} suara · ketuk opsi untuk memilih / mengganti
              </p>
            </div>
          ) : type === "game" && gameData ? (
            /* v52 — mini-game: kartu hasil dadu/koin/batu-gunting-kertas. */
            <div
              className="w-56 min-w-48 px-1.5 py-1 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
                {gameData.game === "dice"
                  ? "🎲 Dadu"
                  : gameData.game === "coin"
                    ? "🪙 Koin"
                    : "✊✋✌️ Batu-Gunting-Kertas"}
              </p>
              <p className="my-2 text-4xl leading-none">
                {gameData.game === "dice"
                  ? (["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][Number(gameData.server) - 1] ?? "🎲")
                  : gameData.game === "coin"
                    ? gameData.server === "kepala"
                      ? "🪙"
                      : "💰"
                    : gameData.server === "batu"
                      ? "✊"
                      : gameData.server === "gunting"
                        ? "✌️"
                        : "✋"}
              </p>
              <p className="text-xs font-medium leading-snug">
                {gameData.game === "dice"
                  ? `Hasil: angka ${gameData.server}`
                  : gameData.game === "coin"
                    ? `Hasil: sisi ${gameData.server}`
                    : `Kamu ${gameData.pick ?? "?"} vs server ${gameData.server} — ${gameData.outcome ?? "?"}`}
              </p>
            </div>
          ) : type === "location" && locationData ? (
            /* v52 — kartu lokasi: koordinat + buka di peta. */
            <div
              className="w-60 min-w-52 px-1.5 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="break-words">{locationData.label || "Lokasi"}</span>
              </p>
              <p className="mt-0.5 text-xs tabular-nums opacity-80">
                {locationData.lat.toFixed(5)}, {locationData.lng.toFixed(5)}
              </p>
              <a
                href={`https://maps.google.com/?q=${locationData.lat},${locationData.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-2 block rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition-colors",
                  isRight ? "bg-white/20 hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"
                )}
              >
                Buka di Google Maps ↗
              </a>
            </div>
          ) : type === "contact" && contactData ? (
            /* v52 — kartu kontak: nama + nomor + salin/hubungi. */
            <div
              className="w-60 min-w-52 px-1.5 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
                <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="break-words">{contactData.name}</span>
              </p>
              {contactData.note ? (
                <p className="mt-0.5 break-words text-xs leading-snug opacity-80">{contactData.note}</p>
              ) : null}
              <p className="mt-0.5 break-words font-mono text-xs tabular-nums opacity-90">
                {contactData.phone}
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
                    isRight ? "bg-white/20 hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"
                  )}
                  onClick={() => {
                    void navigator.clipboard.writeText(contactData.phone).catch(() => {});
                  }}
                >
                  Salin nomor
                </button>
                <a
                  href={`https://wa.me/${contactData.phone.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-semibold transition-colors",
                    isRight ? "bg-white/20 hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"
                  )}
                >
                  Hubungi ↗
                </a>
              </div>
            </div>
          ) : type === "voice" ? (
            <div className="px-1.5 py-1">
              <VoicePlayer
                src={content}
                durationMs={durationMs}
                mine={isRight}
                seed={messageId ?? 1}
              />
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
          ) : type === "file" && fileKind === "video" ? (
            /* Permukaan video tidak men-toggle baris aksi (stopPropagation).
             * v8 — poster thumbnail + preload hemat (none saat data saver).
             * v48 — blur sensitif menyelimuti video sampai diketuk. */
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <video
                src={content}
                poster={thumbUrl}
                controls
                preload={dataSaver ? "none" : "metadata"}
                className={cn(
                  "max-h-64 w-auto rounded-xl",
                  sensitive && !sensitiveRevealed && "pointer-events-none blur-lg"
                )}
                onClick={(e) => e.stopPropagation()}
              />
              {sensitive && !sensitiveRevealed ? (
                <button
                  type="button"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/30 text-xs font-medium text-white"
                  onClick={() => setSensitiveRevealed(true)}
                >
                  <Eye className="size-5" aria-hidden="true" />
                  Media sensitif — ketuk untuk lihat
                </button>
              ) : null}
            </div>
          ) : type === "file" && fileKind === "audio" ? (
            /* v31 — file audio BUKAN voice note: kartu berbeda (ikon musik + nama
             * + ukuran) dengan pemutar <audio> standar bawaan browser — voice
             * note yang direkam tetap memakai VoicePlayer gelombang di atas. */
            <div
              className="min-w-56 max-w-72"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={cn(
                  "flex items-center gap-2.5 rounded-t-xl p-2",
                  isRight ? "bg-white/15" : "bg-muted/70"
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg",
                    isRight ? "bg-white/20 text-white" : "bg-background text-muted-foreground"
                  )}
                >
                  <Music className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 break-words text-sm font-medium leading-snug">
                    {fileName ?? "Audio"}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      isRight ? "text-white/70" : "text-muted-foreground"
                    )}
                  >
                    File audio{fileSize ? ` · ${formatFileSize(fileSize)}` : ""}
                  </p>
                </div>
              </div>
              <audio
                src={content}
                controls
                preload={dataSaver ? "none" : "metadata"}
                className={cn(
                  "h-9 w-full rounded-b-xl bg-background/60",
                  isRight ? "text-white" : ""
                )}
              />
            </div>
          ) : type === "file" ? (
            /* Kartu dokumen (pdf/zip/xlsx/…): ikon + nama + ukuran + Buka/Unduh */
            <div
              className={cn(
                "flex min-w-56 max-w-72 items-center gap-2.5 rounded-xl p-2",
                isRight ? "bg-white/15" : "bg-muted/70"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  isRight ? "bg-white/20 text-white" : "bg-background text-muted-foreground"
                )}
              >
                <FileKindIcon mimeType={mimeType} fileName={fileName} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-medium leading-snug">
                  {fileName ?? "File"}
                </p>
                <p
                  className={cn(
                    "text-[10px] tabular-nums",
                    isRight ? "text-white/70" : "text-muted-foreground"
                  )}
                >
                  {formatFileSize(fileSize)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className={cn(
                    "flex h-9 items-center rounded-full px-2.5 text-xs font-medium transition-colors",
                    isRight
                      ? "bg-white/20 text-white hover:bg-white/30"
                      : "bg-primary/10 text-foreground hover:bg-primary/20"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (fileKind === "pdf") {
                      onMediaOpen?.({ url: content, mimeType, fileName, fileSize });
                    } else {
                      window.open(fileDownloadUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  Buka
                </button>
                <a
                  href={fileDownloadUrl}
                  download={fileName ?? ""}
                  aria-label="Unduh file"
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full transition-colors",
                    isRight
                      ? "text-white/80 hover:bg-white/20"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          ) : (
            /* v32/v34 — teks pesan dirender via LinkifiedText: SEMUA URL di
             * dalam teks bisa diklik → membuka LinkViewer in-app (v34). */
            <LinkifiedText
              text={content}
              dark={isRight}
              className="whitespace-pre-wrap break-words"
              trapUrl={trapUrl}
              onTrapClick={onTrapClick}
            />
          )}

          {/* v20 — caption teks yang menyertai pesan media, tampil di bawah
              media di dalam bubble (gaya WhatsApp). v32/v34 — URL di caption
              bisa diklik → pembuka LinkViewer in-app. */}
          {!deleted && caption && (type === "image" || type === "file") ? (
            <LinkifiedText
              text={caption}
              dark={isRight}
              className={cn(
                "mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed",
                isRight ? "text-white" : "text-foreground"
              )}
              trapUrl={trapUrl}
              onTrapClick={onTrapClick}
            />
          ) : null}

          {/* Task 19 — kartu pratinjau tautan (pesan teks ber-URL), di bawah
              teks, selebar bubble. v34 — diklik membuka LinkViewerDialog
              in-app (embed YouTube/TikTok diputar di dalam aplikasi). */}
          {!deleted && type === "text" && textLinkUrl && linkPreviewEnabled ? (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              {/* key: remount per URL agar state hook/skeleton selalu segar */}
              <LinkPreviewCard
                key={textLinkUrl}
                url={textLinkUrl}
                dark={isRight}
                trapUrl={trapUrl}
                onTrapClick={onTrapClick}
              />
            </div>
          ) : null}

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
            {scheduledAt ? (
              <span
                className="flex items-center gap-0.5 font-medium"
                aria-label={`Terjadwal ${new Date(scheduledAt).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`}
              >
                <Clock className="size-3" aria-hidden="true" />
                {new Date(scheduledAt).toLocaleString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ) : null}
            {edited && !deleted ? <span aria-label="Pesan diedit">· diedit</span> : null}
            {starred && !deleted ? <Star className="size-3 fill-amber-400 text-amber-400" aria-label="Berbintang" /> : null}
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
          {onForward ? (
            <button
              type="button"
              aria-label="Teruskan pesan"
              title="Teruskan…"
              onClick={(e) => {
                e.stopPropagation();
                onForward();
              }}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Reply className="size-4 -scale-x-100" aria-hidden="true" />
            </button>
          ) : null}
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
          {onToggleStar ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onToggleStar();
              }}
            >
              <Star
                className={cn(
                  "size-3.5",
                  starred && "fill-amber-400 text-amber-400"
                )}
                aria-hidden="true"
              />
              {starred ? "Hapus bintang" : "Bintangi"}
            </button>
          ) : null}
          {scheduledAt && onCancelScheduled ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-red-600 hover:bg-red-500/10"
              onClick={() => {
                closeActions();
                onCancelScheduled();
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
              Batalkan jadwal
            </button>
          ) : null}
          {onEditHistory ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onEditHistory();
              }}
            >
              <History className="size-3.5" aria-hidden="true" />
              Riwayat edit
            </button>
          ) : null}
          {onShowMeta ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
              onClick={() => {
                closeActions();
                onShowMeta();
              }}
            >
              <Info className="size-3.5" aria-hidden="true" />
              Metadata
            </button>
          ) : null}
          {onModerate ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                closeActions();
                onModerate();
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Hapus (moderasi)
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
