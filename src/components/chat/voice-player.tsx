"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * v10 — Pemutar pesan suara gaya WhatsApp: tombol putar/jeda, waveform
 * progres yang bisa diketuk untuk seek, durasi, dan tombol kecepatan
 * 1x → 1.5x → 2x. Dipakai bersama oleh bubble `voice` (Messenger +
 * AdminPanel) dan lampiran audio (type `file`, mime audio/*).
 *
 * Waveform adalah pola deterministik dari `seed` (id pesan) sehingga
 * stabil tanpa analisis audio sungguhan.
 */

const SPEEDS = [1, 1.5, 2] as const;

/** Satu-satunya audio yang bermain di seluruh halaman (WhatsApp-style). */
let activeAudio: HTMLAudioElement | null = null;

const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Tinggi bar deterministik per seed (0.2 – 1.0). */
function barHeights(seed: number, count: number): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const v = Math.abs(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453);
    bars.push(0.2 + (v - Math.floor(v)) * 0.8);
  }
  return bars;
}

export function VoicePlayer({
  src,
  durationMs,
  mine,
  seed = 1,
}: {
  src: string;
  /** Durasi rekaman (server) — fallback sebelum metadata termuat. */
  durationMs?: number;
  /** true = bubble kanan (hijau) → aksen putih; false → aksen emerald. */
  mine: boolean;
  /** Sumber pola waveform (umumnya id pesan). */
  seed?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [realDurationMs, setRealDurationMs] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const total = realDurationMs || durationMs || 0;
  const bars = useMemo(() => barHeights(seed, 26), [seed]);
  const fraction = total > 0 ? Math.min(1, positionMs / total) : 0;

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (activeAudio && activeAudio !== audio) activeAudio.pause();
    activeAudio = audio;
    audio.playbackRate = SPEEDS[speedIdx];
    void audio.play().catch(() => setPlaying(false));
  }, [playing, speedIdx]);

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    const audio = audioRef.current;
    if (audio) audio.playbackRate = SPEEDS[next];
  };

  const seekTo = (clientX: number, el: HTMLDivElement) => {
    const audio = audioRef.current;
    const rect = el.getBoundingClientRect();
    if (!audio || rect.width === 0 || total <= 0) return;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = (f * total) / 1000;
    setPositionMs(f * total);
  };

  // Bersihkan registri global saat unmount bila audio ini sedang aktif.
  useEffect(
    () => () => {
      if (activeAudio && activeAudio === audioRef.current) activeAudio = null;
    },
    []
  );

  return (
    <div className="flex min-w-52 items-center gap-2 sm:min-w-60">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
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

      {/* Putar / jeda */}
      <button
        type="button"
        aria-label={playing ? "Jeda pesan suara" : "Putar pesan suara"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
          mine ? "bg-white/20 text-white hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"
        )}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
      </button>

      {/* Waveform + seek */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Posisi pemutar suara"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(positionMs)}
        className={cn(
          "flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px] py-2",
          mine ? "text-white" : "text-emerald-600"
        )}
        onClick={(e) => {
          e.stopPropagation();
          seekTo(e.clientX, e.currentTarget);
        }}
        onKeyDown={(e) => {
          const audio = audioRef.current;
          if (!audio || total <= 0) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            audio.currentTime = Math.min(total / 1000, audio.currentTime + 3);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            audio.currentTime = Math.max(0, audio.currentTime - 3);
          }
        }}
      >
        {bars.map((h, i) => {
          const done = i / bars.length < fraction;
          return (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                "w-full min-w-[2px] max-w-[4px] rounded-full transition-colors",
                done
                  ? "bg-current"
                  : mine
                    ? "bg-white/40"
                    : "bg-foreground/20 dark:bg-white/25"
              )}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          );
        })}
      </div>

      {/* Durasi + kecepatan */}
      <div className="flex shrink-0 items-center gap-1">
        <Mic className={cn("size-3.5", mine ? "text-white/80" : "text-muted-foreground")} aria-hidden="true" />
        <span
          className={cn(
            "text-[10px] tabular-nums",
            mine ? "text-white/90" : "text-muted-foreground"
          )}
        >
          {formatClock(playing || positionMs > 0 ? positionMs : total)}
        </span>
        <button
          type="button"
          aria-label="Ubah kecepatan putar"
          className={cn(
            "flex h-5 min-w-9 items-center justify-center rounded-full px-1 text-[10px] font-semibold transition-colors",
            mine
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-muted text-muted-foreground hover:bg-accent"
          )}
          onClick={(e) => {
            e.stopPropagation();
            cycleSpeed();
          }}
        >
          {SPEEDS[speedIdx].toString().replace(".", ",")}x
        </button>
      </div>
    </div>
  );
}
