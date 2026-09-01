"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
 * - Klik kartu → Dialog pratinjau in-app: YouTube/TikTok pakai iframe embed,
 *   lainnya menampilkan gambar OG + judul + deskripsi + tombol "Buka di
 *   browser". Footer SELALU punya "Buka di browser" (semua provider) + Tutup.
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

const PROVIDER_META: Record<PreviewProvider, { icon: string; label: string }> = {
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function openInBrowser(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
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
/* Kartu + dialog                                                      */
/* ------------------------------------------------------------------ */

export function LinkPreviewCard({ url, dark = false }: { url: string; dark?: boolean }) {
  const preview = useLinkPreview(url);
  const [skeletonGone, setSkeletonGone] = useState(false);
  const [open, setOpen] = useState(false);

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

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Buka pratinjau ${site}`}
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
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 gap-1 border-b px-4 py-3 text-left">
            <DialogTitle className="truncate text-base">
              {data.title ?? site}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-xs">
              <span aria-hidden="true">{meta.icon}</span>
              <span className="truncate">{data.url}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {data.provider === "youtube" && data.videoId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(data.videoId)}`}
                title={data.title ?? "Video YouTube"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                className="aspect-video w-full bg-black"
              />
            ) : data.provider === "tiktok" && data.tiktokId ? (
              <iframe
                src={`https://www.tiktok.com/embed/v2/${encodeURIComponent(data.tiktokId)}`}
                title={data.title ?? "Video TikTok"}
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="mx-auto aspect-[325/580] max-h-[72vh] w-full bg-black"
              />
            ) : (
              <div className="flex flex-col">
                {data.image ? (
                  <div className="flex max-h-[40vh] items-center justify-center overflow-hidden bg-black/5 dark:bg-black/30">
                    <PreviewThumb
                      key={data.image}
                      src={data.image}
                      provider={data.provider}
                      large
                      className="max-h-[40vh] w-full rounded-none border-0 object-contain"
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 p-4">
                  {!data.image ? (
                    <p className={cn("text-sm font-semibold", dark && "text-white")}>
                      {data.title ?? site}
                    </p>
                  ) : null}
                  {data.description ? (
                    <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                      {data.description}
                    </p>
                  ) : null}
                  <Button
                    className="mt-1 h-10 bg-emerald-600 text-white hover:bg-emerald-600/90 sm:self-start"
                    onClick={() => openInBrowser(data.url)}
                  >
                    Buka di browser
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-muted/30 p-3">
            <Button
              variant="outline"
              className="h-9"
              onClick={() => openInBrowser(data.url)}
            >
              Buka di browser
            </Button>
            <Button className="h-9" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


