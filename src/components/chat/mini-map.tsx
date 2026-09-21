"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * v61 (Task 77) — pratinjau peta statis untuk pesan lokasi.
 * Dirakit langsung di klien dari tile resmi OpenStreetMap (zoom 15, 256 px)
 * — tanpa API key. Titik lokasi selalu tepat di tengah kontainer (anchor
 * pusat), sehingga pin menunjuk koordinat yang persis. Bila tile gagal
 * dimuat (offline / CSP / koordinat di luar jangkauan), onError
 * menyembunyikan peta dan kartu lokasi jatuh kembali ke tata letak lama:
 * koordinat + tombol "Buka di Google Maps".
 */

const TILE = 256;
const ZOOM = 15;
/** Rentang math (px) — menutup kontainer hingga 240×128 (kartu lokasi w-60). */
const RANGE_W = 240;
const RANGE_H = 128;

function worldPixelOf(lat: number, lng: number): { x: number; y: number } {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n * TILE,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE,
  };
}

export function MiniMap({
  lat,
  lng,
  href,
  className,
}: {
  lat: number;
  lng: number;
  href: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const world = worldPixelOf(lat, lng);

  const x0 = Math.floor((world.x - RANGE_W / 2) / TILE);
  const x1 = Math.floor((world.x + RANGE_W / 2) / TILE);
  const y0 = Math.floor((world.y - RANGE_H / 2) / TILE);
  const y1 = Math.floor((world.y + RANGE_H / 2) / TILE);

  const tiles: Array<{ tx: number; ty: number }> = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      tiles.push({ tx, ty });
    }
  }

  if (failed) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Pratinjau peta di ${lat.toFixed(5)}, ${lng.toFixed(5)} — buka di Google Maps`}
      className={cn(
        "relative block h-32 w-full touch-manipulation overflow-hidden rounded-lg bg-muted ring-1 ring-black/10 transition-opacity hover:opacity-90",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {tiles.map(({ tx, ty }) => (
        <img
          key={`${tx}-${ty}`}
          src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
          alt=""
          width={TILE}
          height={TILE}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="pointer-events-none absolute select-none"
          style={{
            left: `calc(50% + ${Math.round(tx * TILE - world.x)}px)`,
            top: `calc(50% + ${Math.round(ty * TILE - world.y)}px)`,
          }}
        />
      ))}
      <MapPin
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-full fill-red-500 text-red-700 drop-shadow-md"
      />
      <span className="absolute bottom-0 right-0 rounded-tl-md bg-background/80 px-1 py-px text-[8px] leading-none text-muted-foreground">
        © OpenStreetMap
      </span>
    </a>
  );
}
