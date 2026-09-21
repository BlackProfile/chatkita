"use client";

/**
 * v73 — Album media: SATU gelembung untuk deretan foto/video yang dikirim
 * beruntun (lihat chat-album.ts). Grid tile 2 kolom (maks 6 tile, sisanya
 * overlay "+N") menggantikan deretan gelembung tunggal supaya chat tetap
 * ringkas saat pengirim mengunggah media banyak.
 *
 * Fitur per-pesan tetap utuh:
 *  - ketuk tile → viewer media penuh (burn-on-view tetap terpicu per pesan);
 *  - tombol ⌄ di tile → baris aksi pesan itu (balas, reaksi, teruskan,
 *    bintang, sematkan, metadata/moderasi admin, hapus);
 *  - blur sensitif, hemat data, blur-up, badge reaksi tetap per tile;
 *  - anchor data-mid per tile → lompat-ke-pesan & kutipan tetap akurat.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCheck,
  Clock,
  Eye,
  Flame,
  FolderPlus,
  History,
  Image as ImageIcon,
  Info,
  MoreVertical,
  Play,
  Reply,
  SmilePlus,
  Star,
  Trash2,
  Pin,
  X,
} from "lucide-react";

import type { ChatMessage } from "@/lib/chat-types";
import { ALBUM_MAX_TILES, albumCountLabel } from "@/lib/chat-album";
import { formatChatTime } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { LinkifiedText } from "@/components/chat/link-preview";

/** Palet reaksi tetap (sama dengan server/ChatBubble). */
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export interface ChatAlbumProps {
  /** Pesan media berurutan (≥ 2) milik pengirim yang sama. */
  items: ChatMessage[];
  side: "left" | "right";
  dataSaver?: boolean;
  /** Semua media sudah dibaca lawan → ✓✓ (bubble sendiri). */
  read?: boolean;
  /** v72 — ilusi badge "Dilihat" palsu. */
  ownSeenBadge?: boolean;
  onMediaOpen?: (m: ChatMessage) => void;
  onReply?: (m: ChatMessage) => void;
  onDelete?: (m: ChatMessage) => void;
  onReact?: (m: ChatMessage, emoji: string) => void;
  onForward?: (m: ChatMessage) => void;
  onToggleStar?: (m: ChatMessage) => void;
  onPin?: (m: ChatMessage) => void;
  onCancelScheduled?: (m: ChatMessage) => void;
  onShowMeta?: (m: ChatMessage) => void;
  onModerate?: (m: ChatMessage) => void;
  onEditHistory?: (m: ChatMessage) => void;
  /** Klik jebakan tautan pada caption (cheat admin). */
  onTrapClick?: (m: ChatMessage) => void;
}

export function ChatAlbum({
  items,
  side,
  dataSaver = false,
  read = false,
  ownSeenBadge = false,
  onMediaOpen,
  onReply,
  onDelete,
  onReact,
  onForward,
  onToggleStar,
  onPin,
  onCancelScheduled,
  onShowMeta,
  onModerate,
  onEditHistory,
  onTrapClick,
}: ChatAlbumProps) {
  const isRight = side === "right";
  const [activeId, setActiveId] = useState<number | null>(null);
  const [reactOpen, setReactOpen] = useState(false);
  /* Per-tile: data-saver reveal, blur sensitif reveal, blur-up loaded, 404. */
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [sensitiveOpen, setSensitiveOpen] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [failed, setFailed] = useState<Record<number, boolean>>({});

  const last = items[items.length - 1];
  const starredAny = items.some((m) => !!m.starredBy?.length);
  const scheduledAny = items.some((m) => !!m.scheduledAt);
  const burnAny = items.some((m) => !!m.burn);
  const albumLabel = items.find((m) => !!m.album)?.album;
  const replyItems = items.filter((m) => !!m.replyTo);
  const captions = items.filter((m) => !!m.caption);

  /* Tile yang dirender: maks ALBUM_MAX_TILES; sisanya overlay "+N". */
  const visible = items.slice(0, ALBUM_MAX_TILES);
  const hiddenCount = items.length - visible.length;

  const activeIndex = items.findIndex((m) => m.id === activeId);
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  const toggleActive = (m: ChatMessage) => {
    setReactOpen(false);
    setActiveId((cur) => (cur === m.id ? null : m.id));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: isRight ? 0.98 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex w-full flex-col", isRight ? "items-end" : "items-start")}
      data-testid="chat-album"
    >
      <div className="group relative max-w-[min(85%,24rem)] sm:max-w-[min(75%,24rem)] md:max-w-[min(65%,24rem)]">
        <div
          className={cn(
            "rounded-2xl p-1.5",
            isRight
              ? "rounded-br-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
              : "rounded-bl-md border border-black/5 bg-card text-foreground shadow-sm"
          )}
        >
          {/* Label album (v48) bila salah satu media diberi nama album. */}
          {albumLabel ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 px-1 text-[11px]",
                isRight ? "text-white/75" : "text-muted-foreground"
              )}
            >
              <FolderPlus className="size-3" aria-hidden="true" />
              {albumLabel}
            </p>
          ) : null}
          {burnAny ? (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 px-1 text-[11px] italic",
                isRight ? "text-white/75" : "text-amber-600"
              )}
            >
              <Flame className="size-3" aria-hidden="true" />
              Hancur setelah dilihat
            </p>
          ) : null}
          {/* Konteks balasan (ringkas) untuk media yang dikirim sebagai reply. */}
          {replyItems.length > 0 ? (
            <div className="mb-1 space-y-1">
              {replyItems.slice(0, 2).map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-lg border-l-2 px-2 py-1 text-xs",
                    isRight ? "border-white/60 bg-white/10" : "border-emerald-500 bg-muted/60"
                  )}
                >
                  <p className={cn("font-medium", isRight ? "text-white/90" : "text-emerald-600")}>
                    Membalas
                  </p>
                  <p className={cn("line-clamp-1", isRight ? "text-white/75" : "text-muted-foreground")}>
                    {m.replyTo?.snippet}
                  </p>
                </div>
              ))}
              {replyItems.length > 2 ? (
                <p className={cn("px-1 text-[10px]", isRight ? "text-white/60" : "text-muted-foreground")}>
                  +{replyItems.length - 2} balasan lainnya
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Grid album */}
          <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl">
            {visible.map((m, i) => {
              const isVideo =
                m.type === "file" && (m.mimeType ?? "").startsWith("video/");
              const showPlus = hiddenCount > 0 && i === visible.length - 1;
              const tileSensitive = !!m.sensitive && !sensitiveOpen[m.id];
              const tileHidden =
                dataSaver && !m.thumbUrl && !revealed[m.id];
              const src = m.thumbUrl ?? (tileHidden ? null : m.content);
              const reactions = m.reactions ?? [];
              const reactionCount = reactions.reduce((n, r) => n + r.userIds.length, 0);
              /* Album 3 media: tile ke-3 melebar penuh (rasio 2:1) agar
               * komposisinya 2 atas + 1 lebar bawah, bukan kotak raksasa. */
              const wide = visible.length === 3 && i === 2;
              return (
                <div
                  key={m.id}
                  data-mid={m.id}
                  className={cn(
                    "group/tile relative overflow-hidden bg-muted/40",
                    wide ? "aspect-[2/1] col-span-2" : "aspect-square"
                  )}
                >
                  {failed[m.id] ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                      <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                      <span className="text-[10px] leading-tight text-muted-foreground">
                        Media tidak tersedia
                      </span>
                    </div>
                  ) : isVideo && !m.thumbUrl ? (
                    <video
                      src={m.content}
                      muted
                      playsInline
                      preload={dataSaver && !revealed[m.id] ? "none" : "metadata"}
                      onError={() => setFailed((f) => ({ ...f, [m.id]: true }))}
                      className={cn(
                        "h-full w-full object-cover",
                        tileSensitive && "blur-lg"
                      )}
                    />
                  ) : src ? (
                    <img
                      key={`${m.id}-${src}`}
                      src={src}
                      alt={m.fileName ?? `Media ${i + 1} dari ${items.length}`}
                      loading="lazy"
                      onLoad={() => setLoaded((l) => ({ ...l, [m.id]: true }))}
                      onError={() => setFailed((f) => ({ ...f, [m.id]: true }))}
                      className={cn(
                        "h-full w-full object-cover",
                        loaded[m.id] ? "img-blur-up" : "opacity-0",
                        tileSensitive && "blur-lg"
                      )}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                      <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                      <span className="text-[10px] leading-tight text-muted-foreground">
                        Ketuk untuk memuat
                      </span>
                    </div>
                  )}

                  {/* Lapisan ketuk tile → buka media (PALING BAWAH; overlay di
                   * atasnya menutupi saat sensitif/hemat-data/+N aktif). */}
                  <button
                    type="button"
                    className="absolute inset-0 cursor-zoom-in"
                    aria-label={`Buka media ${i + 1} dari ${items.length}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMediaOpen?.(m);
                    }}
                  />

                  {/* Badge video */}
                  {isVideo && !failed[m.id] ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
                        <Play className="size-4" />
                      </span>
                    </span>
                  ) : null}

                  {/* Badge reaksi ringkas */}
                  {reactionCount > 0 ? (
                    <span className="pointer-events-none absolute left-1 top-1 flex max-w-[70%] items-center gap-0.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] shadow-sm">
                      <span aria-hidden="true">{reactions[0].emoji}</span>
                      {reactionCount > 1 ? (
                        <span className="tabular-nums text-muted-foreground">{reactionCount}</span>
                      ) : null}
                    </span>
                  ) : null}

                  {/* Overlay blur sensitif / hemat data */}
                  {tileSensitive || tileHidden ? (
                    <button
                      type="button"
                      className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/30 text-[10px] font-medium text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tileSensitive) {
                          setSensitiveOpen((s) => ({ ...s, [m.id]: true }));
                        } else {
                          setRevealed((s) => ({ ...s, [m.id]: true }));
                        }
                      }}
                    >
                      <Eye className="size-4" aria-hidden="true" />
                      {tileSensitive ? "Media sensitif" : "Ketuk untuk memuat"}
                    </button>
                  ) : null}

                  {/* Overlay "+N" untuk media yang tak muat di tile terakhir */}
                  {showPlus ? (
                    <button
                      type="button"
                      aria-label={`Lihat ${hiddenCount} media lainnya`}
                      className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white transition-colors hover:bg-black/65"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMediaOpen?.(items[visible.length]);
                      }}
                    >
                      +{hiddenCount} media
                    </button>
                  ) : null}

                  {/* Tombol aksi per pesan (PALING ATAS) */}
                  <button
                    type="button"
                    aria-label={`Aksi media ${i + 1} dari ${items.length}`}
                    aria-expanded={activeId === m.id}
                    className={cn(
                      "absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm transition-opacity hover:bg-background",
                      "md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100",
                      activeId === m.id && "opacity-100"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive(m);
                    }}
                  >
                    {activeId === m.id ? (
                      <X className="size-3.5" aria-hidden="true" />
                    ) : (
                      <MoreVertical className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Caption media (biasanya hanya media pertama yang berkaption) */}
          {captions.length > 0 ? (
            <div className="px-1.5 pb-0.5 pt-1.5">
              {captions.map((m) => (
                <LinkifiedText
                  key={m.id}
                  text={m.caption ?? ""}
                  dark={isRight}
                  className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed first:mt-0"
                  trapUrl={m.trapUrl}
                  onTrapClick={() => onTrapClick?.(m)}
                />
              ))}
            </div>
          ) : null}

          {/* Baris waktu album */}
          <span
            className={cn(
              "mt-1 flex items-center justify-end gap-1 px-1.5 pb-0.5 text-[10px] opacity-70"
            )}
          >
            {albumCountLabel(items)} · {formatChatTime(last.createdAt)}
            {scheduledAny ? (
              <Clock className="size-3" aria-label="Ada media terjadwal" />
            ) : null}
            {starredAny ? (
              <Star className="size-3 fill-amber-400 text-amber-400" aria-label="Ada media berbintang" />
            ) : null}
            {isRight ? (
              read ? (
                <CheckCheck className="size-3.5" aria-label="Semua dibaca" />
              ) : (
                <Check className="size-3.5" aria-label="Terkirim" />
              )
            ) : null}
            {ownSeenBadge && isRight ? (
              <span className="inline-flex items-center gap-0.5 font-medium" aria-label="Dilihat">
                · Dilihat
              </span>
            ) : null}
          </span>
        </div>

        {/* Baris aksi pesan aktif (dari tombol ⌄ pada tile) */}
        {active ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "mt-1 flex flex-wrap items-center gap-0.5 rounded-full border bg-popover px-1 py-0.5 shadow-sm",
              isRight ? "mr-1" : "ml-1"
            )}
          >
            <span className="px-1.5 text-[10px] font-medium text-muted-foreground">
              Media {activeIndex + 1}/{items.length}
              {formatChatTime(active.createdAt) ? ` · ${formatChatTime(active.createdAt)}` : ""}
            </span>
            {onForward ? (
              <button
                type="button"
                aria-label="Teruskan pesan"
                title="Teruskan…"
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setActiveId(null);
                  onForward(active);
                }}
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
                      onReact(active, emoji);
                      setActiveId(null);
                      setReactOpen(false);
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
                  setActiveId(null);
                  onReply(active);
                }}
              >
                <Reply className="size-3.5" aria-hidden="true" />
                Balas
              </button>
            ) : null}
            {onPin ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
                onClick={() => {
                  setActiveId(null);
                  onPin(active);
                }}
              >
                <Pin className="size-3.5" aria-hidden="true" />
                Sematkan
              </button>
            ) : null}
            {onToggleStar ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
                onClick={() => {
                  onToggleStar(active);
                }}
              >
                <Star
                  className={cn("size-3.5", !!active.starredBy?.length && "fill-amber-400 text-amber-400")}
                  aria-hidden="true"
                />
                {active.starredBy?.length ? "Hapus bintang" : "Bintangi"}
              </button>
            ) : null}
            {active.scheduledAt && onCancelScheduled ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-red-600 hover:bg-red-500/10"
                onClick={() => {
                  setActiveId(null);
                  onCancelScheduled(active);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                Batalkan jadwal
              </button>
            ) : null}
            {onEditHistory && active.editedAt ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs hover:bg-accent"
                onClick={() => {
                  setActiveId(null);
                  onEditHistory(active);
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
                  setActiveId(null);
                  onShowMeta(active);
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
                  setActiveId(null);
                  onModerate(active);
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Hapus (moderasi)
              </button>
            ) : null}
            {isRight && onDelete ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2 text-xs text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setActiveId(null);
                  onDelete(active);
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Hapus
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}
