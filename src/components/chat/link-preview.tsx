"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { openLinkViewer } from "@/components/chat/link-viewer";

/**
 * Task 19 — kartu pratinjau tautan (link preview) untuk pesan teks ChatKita.
 *
 * - ChatBubble mendeteksi URL pertama di teks (firstUrlInText) dan merender
 *   LinkPreviewCard di bawah teks, DI DALAM bubble yang sama.
 * - Data diambil SEKALI per URL via GET /api/link-preview?url=... (hook
 *   useLinkPreview); hasil (termasuk kegagalan) di-cache pada Map level
 *   modul + fetch in-flight dideduplikasi, jadi re-render tidak refetch.
 * - Loading = skeleton pulse maksimal ~2 detik; gagal → TIDAK merender apa
 *   pun (diam) — pesan teks tetap normal.
 * - v32 — SEMUA tautan bisa diklik (LinkifiedText) dan kartu pratinjau
 *   menjadi <a> semantik (href utk buka-di-tab / middle-click).
 * - v34 — ketukan pada tautan/kartu TIDAK lagi langsung melompat ke browser:
 *   ia membuka LinkViewerDialog (popup in-app, lihat link-viewer.tsx) —
 *   YouTube/TikTok diputar embed DI DALAM aplikasi; "Buka di browser" tetap
 *   tersedia di dialog. href/target _blank dipertahankan sebagai fallback
 *   tanpa-JS & untuk middle-click/long-press menu browser.
 */

export type PreviewProvider = "youtube" | "tiktok" | "instagram" | "facebook" | "generic";

/** Bentuk data sukses dari /api/link-preview (field opsional boleh absen). */
export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  provider: PreviewProvider;
  videoId?: string;
  tiktokId?: string;
}

type PreviewOutcome = { ok: true; data: LinkPreviewData } | { ok: false };

const PROVIDERS = new Set<PreviewProvider>([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "generic",
]);

export const PROVIDER_META: Record<PreviewProvider, { icon: string; label: string }> = {
  youtube: { icon: "▶", label: "YouTube" },
  tiktok: { icon: "♪", label: "TikTok" },
  instagram: { icon: "📷", label: "Instagram" },
  facebook: { icon: "f", label: "Facebook" },
  generic: { icon: "🔗", label: "Lainnya" },
};

/* ------------------------------------------------------------------ */
/* Deteksi URL + cache modul                                           */
/* ------------------------------------------------------------------ */

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
/** Trailing punctuation yang hampir selalu bukan bagian URL. */
const TRAILING_JUNK = /[)\]}>,.;:!?"']+$/;

/** URL http(s) PERTAMA dalam teks pesan (null bila tidak ada). */
export function firstUrlInText(text: string): string | null {
  const raw = text.match(URL_PATTERN)?.[0];
  if (!raw) return null;
  const trimmed = raw.replace(TRAILING_JUNK, "");
  return trimmed.length > 0 ? trimmed : null;
}

/* ------------------------------------------------------------------ */
/* LinkifiedText — teks pesan dengan SEMUA URL bisa diklik (v32)       */
/* ------------------------------------------------------------------ */

/** Satu segmen hasil pemecahan teks: potongan biasa atau URL. */
export interface TextSegment {
  kind: "text" | "url";
  text: string;
  url?: string;
}

/**
 * Pecah teks pesan menjadi segmen teks/URL. Trailing punctuation (titik,
 * koma, penutup kurung…) tidak ikut jadi bagian link — tetap teks biasa.
 * Instance regex baru per panggilan agar lastIndex /g tidak bocor antar-render.
 */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = new RegExp(URL_PATTERN.source, "gi");
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    const url = m[0].replace(TRAILING_JUNK, "");
    if (url.length > 0) {
      segments.push({ kind: "url", text: url, url });
      const junk = m[0].slice(url.length);
      if (junk.length > 0) segments.push({ kind: "text", text: junk });
    } else {
      segments.push({ kind: "text", text: m[0] });
    }
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/**
 * v32 — merender teks pesan/caption dengan SEMUA URL sebagai tautan yang
 * bisa diklik. stopPropagation pada klik agar mengetuk tautan tidak ikut
 * men-toggle baris aksi bubble.
 * v34 — inApp (default true): ketukan membuka LinkViewerDialog di dalam
 * aplikasi (preventDefault); href tetap ada utk middle-click/no-JS. Set
 * inApp=false untuk perilaku lama buka tab browser langsung.
 */
export function LinkifiedText({
  text,
  dark = false,
  inApp = true,
  className,
}: {
  text: string;
  dark?: boolean;
  inApp?: boolean;
  className?: string;
}) {
  const segments = segmentText(text);
  if (segments.length === 0) return null;
  return (
    <p className={className}>
      {segments.map((seg, i) =>
        seg.kind === "url" ? (
          <a
            key={i}
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              if (inApp) {
                e.preventDefault();
                openLinkViewer(seg.url);
              }
            }}
            className={cn(
              "break-all font-medium underline underline-offset-2",
              dark
                ? "text-white decoration-white/60 hover:decoration-white"
                : "text-emerald-700 decoration-emerald-500/50 hover:decoration-emerald-600"
            )}
          >
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </p>
  );
}

/** Cache level modul: URL → hasil (sukses/gagal) — hidup selama sesi halaman. */
const previewCache = new Map<string, PreviewOutcome>();
/** Fetch yang sedang berjalan per URL (dedup antar-mount/re-render). */
const inflight = new Map<string, Promise<PreviewOutcome>>();
const CLIENT_FETCH_TIMEOUT_MS = 8000;

function sanitize(raw: unknown): LinkPreviewData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.ok !== true || typeof r.url !== "string" || r.url.length === 0) return null;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const provider =
    typeof r.provider === "string" && PROVIDERS.has(r.provider as PreviewProvider)
      ? (r.provider as PreviewProvider)
      : "generic";
  return {
    url: r.url,
    title: str(r.title),
    description: str(r.description),
    image: str(r.image),
    siteName: str(r.siteName),
    provider,
    videoId: str(r.videoId),
    tiktokId: str(r.tiktokId),
  };
}

async function fetchPreview(url: string): Promise<PreviewOutcome> {
  const running = inflight.get(url);
  if (running) return running;

  const job = (async (): Promise<PreviewOutcome> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      const raw = (await res.json().catch(() => null)) as unknown;
      const data = sanitize(raw);
      if (!res.ok || !data) return { ok: false };
      return { ok: true, data };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
      inflight.delete(url);
    }
  })();

  inflight.set(url, job);
  return job;
}

export type LinkPreviewState = LinkPreviewData | "loading" | "failed";

/**
 * Hook data pratinjau: cek cache modul dulu, kalau miss mulai fetch sekali
 * (dedup in-flight). Hasil "failed" di-cache juga agar tidak hammering.
 */
export function useLinkPreview(url: string): LinkPreviewState {
  const [state, setState] = useState<LinkPreviewState>(() => {
    const hit = previewCache.get(url);
    if (!hit) return "loading";
    return hit.ok ? hit.data : "failed";
  });

  useEffect(() => {
    const hit = previewCache.get(url);
    if (hit) {
      // Sudah terisi di cache (race antar-mount URL sama): sinkronkan lewat
      // microtask — tanpa setState sinkron di badan effect.
      if (state !== "loading") return;
      let subscribed = true;
      void Promise.resolve().then(() => {
        if (subscribed) setState(hit.ok ? hit.data : "failed");
      });
      return () => {
        subscribed = false;
      };
    }
    let alive = true;
    void fetchPreview(url).then((outcome) => {
      previewCache.set(url, outcome);
      if (alive) setState(outcome.ok ? outcome.data : "failed");
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Util tampilan                                                       */
/* ------------------------------------------------------------------ */

/** Hostname URL tanpa "www." — dipakai kartu & LinkViewer (v34). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Gambar dengan fallback: gagal muat / tidak ada → tile ikon provider. */
function PreviewThumb({
  src,
  provider,
  large = false,
  className,
}: {
  src?: string;
  provider: PreviewProvider;
  large?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const meta = PROVIDER_META[provider];
  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center border border-border/60 bg-background text-muted-foreground",
          large ? "size-24 rounded-xl text-3xl" : "size-14 rounded-lg text-xl",
          className
        )}
      >
        {meta.icon}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("shrink-0 bg-muted object-cover", className)}
    />
  );
}

function SkeletonCard({ dark }: { dark: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex w-full min-w-48 items-center gap-2.5 rounded-xl border p-2",
        dark ? "border-white/25 bg-white/10" : "border-border bg-muted/40"
      )}
    >
      <div
        className={cn(
          "size-14 shrink-0 animate-pulse rounded-lg",
          dark ? "bg-white/20" : "bg-muted"
        )}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div
          className={cn(
            "h-3 w-3/4 animate-pulse rounded",
            dark ? "bg-white/20" : "bg-muted"
          )}
        />
        <div
          className={cn(
            "h-2.5 w-1/2 animate-pulse rounded",
            dark ? "bg-white/15" : "bg-muted"
          )}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kartu pratinjau — langsung buka tautan (v32)                        */
/* ------------------------------------------------------------------ */

export function LinkPreviewCard({ url, dark = false }: { url: string; dark?: boolean }) {
  const preview = useLinkPreview(url);
  const [skeletonGone, setSkeletonGone] = useState(false);

  // Skeleton hanya tampil maksimal ~2 detik; setelah itu loading = senyap.
  // (Komponen diremount per URL via key di ChatBubble — tak perlu reset manual.)
  useEffect(() => {
    const t = setTimeout(() => setSkeletonGone(true), 2000);
    return () => clearTimeout(t);
  }, []);

  if (preview === "failed") return null;
  if (preview === "loading") {
    return skeletonGone ? null : <SkeletonCard dark={dark} />;
  }

  const data = preview;
  const meta = PROVIDER_META[data.provider];
  const site = data.siteName ?? hostnameOf(data.url);

  // v34 — satu ketukan pada kartu → LinkViewerDialog in-app (embed YouTube/
  // TikTok diputar di dalam aplikasi). preventDefault mencegah lompat browser;
  // href tetap utk middle-click/no-JS; stopPropagation menjaga baris aksi.
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Buka ${site} di browser`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openLinkViewer(data.url, data);
      }}
      className={cn(
        "flex w-full min-w-48 items-center gap-2.5 rounded-xl border p-2 text-left transition-opacity hover:opacity-90",
        dark ? "border-white/25 bg-white/10" : "border-border bg-muted/40"
      )}
    >
      <PreviewThumb
        key={data.image ?? "noimg"}
        src={data.image}
        provider={data.provider}
        className="size-14 rounded-lg"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("truncate text-sm font-semibold", dark && "text-white")}>
          {data.title ?? site}
        </span>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-xs",
            dark ? "text-white/70" : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium",
              dark ? "border-white/25 bg-white/15 text-white" : "border-border bg-background"
            )}
          >
            <span aria-hidden="true">{meta.icon}</span>
            {meta.label}
          </span>
          <span className="truncate">{site}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}


