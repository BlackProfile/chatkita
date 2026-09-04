"use client";

import { useState } from "react";
import { create } from "zustand";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  PROVIDER_META,
  hostnameOf,
  useLinkPreview,
  type LinkPreviewData,
} from "@/components/chat/link-preview";

/**
 * Task 53 (v34) — LinkViewer: popup pratinjau/pemutar tautan DI DALAM
 * aplikasi. Permintaan user: "linknya ga bisa dibuka di aplikasi langsung?
 * kayak popup tanpa buka aplikasi streamnya?"
 *
 * - Ketukan pada kartu pratinjau maupun tautan di teks TIDAK lagi langsung
 *   melompat ke browser/aplikasi stream — ia membuka dialog in-app ini.
 * - YouTube  → player embed resmi (youtube-nocookie.com/embed) 16:9, autoplay
 *   karena ketukan = gesture pengguna. TikTok → embed v2 (potret).
 * - Situs lain / tanpa data embed → tampilan info (thumbnail besar + judul +
 *   deskripsi + situs). Tombol "Buka di browser" SELALU tersedia sebagai
 *   jalan keluar (target _blank + rel noopener noreferrer).
 * - Dialog ditutup → iframe DI-UNMOUNT (video benar-benar berhenti).
 * - Store zustand level modul: satu dialog per root aplikasi (Messenger +
 *   AdminPanel), dibuka dari komponen mana pun via openLinkViewer().
 */

interface LinkViewerState {
  open: boolean;
  url: string | null;
  data: LinkPreviewData | null;
  openViewer: (url: string, data?: LinkPreviewData | null) => void;
  closeViewer: () => void;
}

export const useLinkViewerStore = create<LinkViewerState>((set) => ({
  open: false,
  url: null,
  data: null,
  openViewer: (url, data = null) => set({ open: true, url, data }),
  // url sengaja dipertahankan saat tutup — body dirender hanya saat `open`,
  // jadi iframe langsung lepas-mount dan pemutaran berhenti.
  closeViewer: () => set({ open: false }),
}));

/** Buka penampil in-app dari mana pun (dipakai kartu & tautan teks). */
export function openLinkViewer(url: string, data?: LinkPreviewData | null): void {
  useLinkViewerStore.getState().openViewer(url, data);
}

/* ------------------------------------------------------------------ */
/* Embed URL per provider                                              */
/* ------------------------------------------------------------------ */

function embedUrlFor(data: LinkPreviewData): string | null {
  if (data.provider === "youtube" && data.videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
      data.videoId
    )}?autoplay=1&rel=0`;
  }
  if (data.provider === "tiktok" && data.tiktokId) {
    return `https://www.tiktok.com/embed/v2/${encodeURIComponent(data.tiktokId)}`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Isi viewer                                                          */
/* ------------------------------------------------------------------ */

/** Thumbnail besar untuk tampilan info; gagal muat → tile gradien ikon. */
function BigThumb({ data }: { data: LinkPreviewData }) {
  const [failed, setFailed] = useState(false);
  const meta = PROVIDER_META[data.provider];
  if (!data.image || failed) {
    return (
      <div
        aria-hidden="true"
        className="flex h-44 w-full shrink-0 items-center justify-center bg-gradient-to-br from-emerald-500/25 via-teal-500/15 to-transparent text-5xl"
      >
        {meta.icon}
      </div>
    );
  }
  return (
    <img
      src={data.image}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="max-h-72 w-full shrink-0 bg-muted object-cover"
    />
  );
}

function ViewerSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3 p-4">
      <div className="h-44 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  );
}

function ViewerContent({ data }: { data: LinkPreviewData }) {
  const meta = PROVIDER_META[data.provider];
  const site = data.siteName ?? hostnameOf(data.url);
  const embed = embedUrlFor(data);

  const copyLink = () => {
    const done = () => toast.success("Tautan disalin");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(data.url).then(done).catch(done);
    } else {
      done();
    }
  };

  return (
    <>
      {/* Badan: embed video ATAU tampilan info */}
      {embed ? (
        data.provider === "tiktok" ? (
          <div className="flex justify-center bg-black">
            <div className="w-full max-w-[350px]">
              <iframe
                src={embed}
                title={data.title ?? site}
                referrerPolicy="strict-origin-when-cross-origin"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="h-[68vh] max-h-[600px] w-full border-0"
              />
            </div>
          </div>
        ) : (
          <div className="aspect-video w-full bg-black">
            <iframe
              src={embed}
              title={data.title ?? site}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="size-full border-0"
            />
          </div>
        )
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <BigThumb data={data} />
          <div className="space-y-1.5 p-3.5">
            {data.title ? (
              <p className="text-sm font-semibold leading-snug">{data.title}</p>
            ) : null}
            {data.description ? (
              <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
                {data.description}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Kaki: pil provider + salin + buka di browser */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t bg-muted/40 p-2.5",
          !embed && "border-t-0"
        )}
      >
        <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-full border bg-background px-2 text-xs text-muted-foreground">
          <span aria-hidden="true">{meta.icon}</span>
          <span className="truncate">{site}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={copyLink}>
            <Copy className="size-4" aria-hidden="true" />
            Salin
          </Button>
          <Button asChild size="sm" className="h-9">
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buka ${site} di browser`}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Buka di browser
            </a>
          </Button>
        </span>
      </div>
    </>
  );
}

/** Body dengan fetch via hook (dipakai saat kartu tidak menyertakan data). */
function ViewerFetch({ url }: { url: string }) {
  const preview = useLinkPreview(url);
  if (preview === "loading") return <ViewerSkeleton />;
  if (preview === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
        <Link2 className="size-7" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{hostnameOf(url)}</p>
        <p className="text-xs">Pratinjau tidak tersedia untuk tautan ini.</p>
      </div>
    );
  }
  return <ViewerContent data={preview} />;
}

function ViewerBody({ url, initialData }: { url: string; initialData: LinkPreviewData | null }) {
  // Pemisahan komponen agar pemanggilan hook selalu konsisten (rules-of-hooks):
  // dengan data awal → langsung render; tanpa data → fetch via hook (cache hangat).
  if (initialData) return <ViewerContent data={initialData} />;
  return <ViewerFetch url={url} />;
}

/* ------------------------------------------------------------------ */
/* Dialog — di-mount SEKALI di root tiap sisi (Messenger & AdminPanel) */
/* ------------------------------------------------------------------ */

export function LinkViewerDialog() {
  const open = useLinkViewerStore((s) => s.open);
  const url = useLinkViewerStore((s) => s.url);
  const data = useLinkViewerStore((s) => s.data);
  const closeViewer = useLinkViewerStore((s) => s.closeViewer);

  const site = data?.siteName ?? (url ? hostnameOf(url) : "Tautan");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeViewer()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="space-y-0 border-b p-3 pr-12">
          <DialogTitle className="line-clamp-1 text-sm font-semibold">
            {data?.title ?? site}
          </DialogTitle>
          <DialogDescription className="line-clamp-1 text-xs text-muted-foreground">
            {site}
          </DialogDescription>
        </DialogHeader>
        {/* `open &&` memastikan iframe benar-benar dilepas saat dialog tutup
            (pemutaran video berhenti), `key={url}` mereset state per URL. */}
        {open && url ? <ViewerBody key={url} url={url} initialData={data} /> : null}
      </DialogContent>
    </Dialog>
  );
}
