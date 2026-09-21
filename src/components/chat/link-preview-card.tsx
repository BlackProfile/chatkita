"use client";

/**
 * v9 — Open-graph link preview card rendered under text bubbles.
 * Data is fetched server-side (chat-service, best effort); the card is
 * purely presentational and degrades to title-less / image-less states.
 */

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import type { LinkPreviewData } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPreviewCard({
  preview,
  mine,
  onOpen,
}: {
  preview: LinkPreviewData;
  mine: boolean;
  /** v11 — bila ada, klik membuka penampil dalam aplikasi (bukan tab baru). */
  onOpen?: (url: string) => void;
}) {
  const [imageOk, setImageOk] = useState(true);
  const host = hostOf(preview.url);

  const inner = (
    <>
      {preview.image && imageOk ? (
        <img
          src={preview.image}
          alt=""
          className="max-h-40 w-full object-cover"
          loading="lazy"
          onError={() => setImageOk(false)}
        />
      ) : null}
      <div className="space-y-0.5 px-2.5 py-1.5">
        <p
          className={cn(
            "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
            mine ? "text-white/70" : "text-muted-foreground"
          )}
        >
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{preview.siteName ?? host}</span>
        </p>
        {preview.title ? (
          <p
            className={cn(
              "line-clamp-2 break-words text-xs font-semibold leading-snug",
              mine ? "text-white" : "text-foreground"
            )}
          >
            {preview.title}
          </p>
        ) : null}
        {preview.description ? (
          <p
            className={cn(
              "line-clamp-2 break-words text-[11px] leading-snug",
              mine ? "text-white/75" : "text-muted-foreground"
            )}
          >
            {preview.description}
          </p>
        ) : null}
      </div>
    </>
  );

  const classes = cn(
    "block overflow-hidden rounded-xl text-left transition-colors",
    mine ? "bg-white/12 hover:bg-white/20" : "border bg-muted/60 hover:bg-muted"
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className={classes}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(preview.url);
        }}
        aria-label={`Buka tautan di aplikasi: ${preview.title ?? host}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={classes}
      aria-label={`Buka tautan: ${preview.title ?? host}`}
    >
      {inner}
    </a>
  );
}
