"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Gauge,
  MoreVertical,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pub-sub kecil: hanya SATU audio boleh berputar di seluruh aplikasi.  */
/* ------------------------------------------------------------------ */

type StopFn = () => void;

const stopListeners = new Set<StopFn>();

/**
 * Panggil SEBELUM audio.play(): menghentikan semua pemutar lain
 * (file audio maupun pesan suara) sehingga tidak bunyi bersamaan.
 * Mem-pause pemutar yang belum berputar adalah no-op — aman dipanggil
 * tanpa pengecualian diri sendiri.
 */
export function claimAudioPlayback(): void {
  for (const fn of stopListeners) fn();
}

/** Daftarkan fungsi pause pemutar ini; kembalikan fungsi unregister. */
export function registerAudioStop(pause: StopFn): () => void {
  stopListeners.add(pause);
  return () => {
    stopListeners.delete(pause);
  };
}

/* ------------------------------------------------------------------ */
/* Format waktu m:ss / h:mm:ss                                          */
/* ------------------------------------------------------------------ */

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* AudioPlayer — pemutar aplikasi (bukan kontrol bawaan browser).       */
/* Bar gelap pill ala pesan suara Telegram: play/pause, waktu "0:13 /   */
/* 4:46", seek bar yang bisa digeser, volume, menu kecepatan + unduh.   */
/* ------------------------------------------------------------------ */

const SPEEDS = [0.5, 1, 1.5, 2] as const;

export function AudioPlayer({
  src,
  downloadUrl,
  dataSaver = false,
  className,
}: {
  src: string;
  /** Tautan unduhan (bila ada); tanpa ini menu tanpa item unduh. */
  downloadUrl?: string;
  /** Hemat data: jangan preload metadata sampai diputar. */
  dataSaver?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  /** "0" sambil drag — posisi tampil mengikuti pointer, bukan elemen audio. */
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const speed = SPEEDS[speedIdx];
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  /* Sinkronkan volume/mute/kecepatan ke elemen audio. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = speed;
  }, [volume, muted, speed, playing]);

  const pauseSelf = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  /* Daftarkan ke pub-sub sejak mount; saat unmount: pause + unregister. */
  useEffect(() => {
    const unregister = registerAudioStop(pauseSelf);
    return () => {
      pauseSelf();
      unregister();
    };
  }, [pauseSelf]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    claimAudioPlayback();
    void audio.play().catch(() => setPlaying(false));
  }, [playing, pauseSelf]);

  /* Seek: klik + drag (pointer capture) — area sentuh tinggi (h-8). */
  const seekTo = (clientX: number) => {
    const el = seekRef.current;
    const audio = audioRef.current;
    if (!el || !audio || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const next = fraction * duration;
    audio.currentTime = next;
    setPosition(next);
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={cn(
        "flex w-64 max-w-full items-center gap-1.5 rounded-full bg-neutral-900/90 p-1.5 pl-1.5 text-white shadow-sm backdrop-blur dark:bg-neutral-950/90",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload={dataSaver ? "none" : "metadata"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          if (audioRef.current && duration > 0) audioRef.current.currentTime = 0;
          setPosition(0);
        }}
        onTimeUpdate={(e) => {
          if (!draggingRef.current) setPosition(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onRateChange={(e) => {
          /* Bisa jadi rate berubah dari luar (submenu) — jaga konsisten. */
          const a = e.currentTarget;
          if (a.playbackRate !== speed) a.playbackRate = speed;
        }}
      />

      {/* Play / pause */}
      <button
        type="button"
        aria-label={playing ? "Jeda audio" : "Putar audio"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        onClick={toggle}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4 -ml-0.5" aria-hidden="true" />
        )}
      </button>

      {/* Waktu posisi / total */}
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/90">
        {formatTime(position)} / {duration > 0 ? formatTime(duration) : "--:--"}
      </span>

      {/* Seek bar */}
      <div
        ref={seekRef}
        role="slider"
        aria-label="Posisi audio"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        className="group/seek relative flex h-8 min-w-8 flex-1 cursor-pointer touch-none items-center"
        onPointerDown={(e) => {
          /* Pointer sintetis/ghost bisa melempar DOMException — jangan biarkan
           * crash; seek tetap jalan tanpa capture. */
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* abaikan — drag tanpa capture masih berfungsi */
          }
          draggingRef.current = true;
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekTo(e.clientX);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* pointer sudah lepas — tidak masalah */
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <span className="block h-1 w-full overflow-hidden rounded-full bg-white/25">
          <span
            className="block h-full rounded-full bg-white transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </span>
        {/* Gagang kecil muncul saat hover/drag (desktop) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-2.5 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/seek:opacity-100"
          style={{ left: `calc(${progress * 100}% - 5px)` }}
        />
      </div>

      {/* Volume: tombol mute + slider muncul saat hover (desktop) */}
      <div className="group/vol flex shrink-0 items-center">
        <button
          type="button"
          aria-label={muted ? "Bunyikan audio" : "Bisukan audio"}
          className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          onClick={() => setMuted((m) => !m)}
        >
          <VolumeIcon className="size-4 text-white/90" aria-hidden="true" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume audio"
          className="w-0 cursor-pointer opacity-0 transition-all duration-200 accent-white group-hover/vol:mr-1 group-hover/vol:w-12 group-hover/vol:opacity-100"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            setMuted(v === 0);
          }}
        />
      </div>

      {/* Titik 3: kecepatan, volume, unduh */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Opsi audio"
            className="size-8 shrink-0 rounded-full text-white/90 hover:bg-white/10 hover:text-white"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Gauge className="size-4" aria-hidden="true" />
              Kecepatan ({speed.toLocaleString("id-ID")}×)
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {SPEEDS.map((s, i) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => setSpeedIdx(i)}
                  className={cn(speedIdx === i && "bg-accent")}
                >
                  {s.toLocaleString("id-ID")}×
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <VolumeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Atur volume"
              className="h-1 flex-1 cursor-pointer accent-emerald-600"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(v === 0);
              }}
            />
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {Math.round((muted ? 0 : volume) * 100)}%
            </span>
          </div>
          {downloadUrl ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={downloadUrl} download className="gap-2">
                  <Download className="size-4" aria-hidden="true" />
                  Unduh audio
                </a>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
