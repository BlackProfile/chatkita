"use client";

/**
 * v48 — stiker bawaan ChatKita: 16 karakter SVG inline (tanpa aset jaringan).
 * Kunci HARUS sama dengan STICKER_KEYS di chat-service (validasi server).
 */

import type { ReactElement } from "react";

export const STICKER_KEYS = [
  "smile-love", "laugh-tears", "heart-pulse", "thumbs-up", "party-pop", "fire-hot",
  "star-spin", "clap-hands", "cool-shades", "cry-river", "ghost-boo", "rocket-fly",
  "coffee-cup", "sleep-zzz", "ok-check", "broken-heart",
] as const;

export type StickerKey = (typeof STICKER_KEYS)[number];

export const STICKER_LABELS: Record<StickerKey, string> = {
  "smile-love": "Senyum Cinta",
  "laugh-tears": "Tawa Lepas",
  "heart-pulse": "Hati Berdenyut",
  "thumbs-up": "Jempol",
  "party-pop": "Pesta",
  "fire-hot": "Api",
  "star-spin": "Bintang",
  "clap-hands": "Tepuk Tangan",
  "cool-shades": "Keren",
  "cry-river": "Nangis",
  "ghost-boo": "Hantu",
  "rocket-fly": "Roket",
  "coffee-cup": "Kopi",
  "sleep-zzz": "Tidur",
  "ok-check": "Oke!",
  "broken-heart": "Patah Hati",
};

/** GIF animasi lokal (public/gifs) untuk tab "Animasi". */
export const GIF_PACK: { id: string; label: string; src: string }[] = [
  { id: "bola", label: "Bola", src: "/gifs/bola.gif" },
  { id: "hati", label: "Hati", src: "/gifs/hati.gif" },
  { id: "bintang", label: "Bintang", src: "/gifs/bintang.gif" },
  { id: "api", label: "Api", src: "/gifs/api.gif" },
  { id: "confetti", label: "Confetti", src: "/gifs/confetti.gif" },
  { id: "roket", label: "Roket", src: "/gifs/roket.gif" },
  { id: "kopi", label: "Kopi", src: "/gifs/kopi.gif" },
  { id: "zzz", label: "Zzz", src: "/gifs/zzz.gif" },
];

const FACE_BASE = "circle cx='32' cy='32' r='26' fill='#FFD54F' stroke='#5D4037' stroke-width='3'";

function svg(inner: string): string {
  return `<svg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg' role='img' aria-hidden='true'>${inner}</svg>`;
}

/** Render satu stiker sebagai SVG inline (aman — markup internal statis). */
export function StickerSvg({ id, className }: { id: string; className?: string }): ReactElement {
  const art = STICKER_ART[id] ?? STICKER_ART["smile-love"];
  return (
    <span
      className={className}
      // Markup 100% statis internal — tidak ada input pengguna di dalamnya.
      dangerouslySetInnerHTML={{ __html: art }}
    />
  );
}

const STICKER_ART: Record<string, string> = {
  "smile-love": svg(
    `<${FACE_BASE}/><circle cx='23' cy='27' r='3' fill='#5D4037'/><circle cx='41' cy='27' r='3' fill='#5D4037'/><path d='M20 38 Q32 50 44 38' stroke='#5D4037' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M32 10 c-4-6-14-4-14 3 0 6 8 9 14 13 6-4 14-7 14-13 0-7-10-9-14-3z' fill='#E53935'/>`
  ),
  "laugh-tears": svg(
    `<${FACE_BASE}/><path d='M20 34 Q32 48 44 34 Z' fill='#5D4037'/><circle cx='20' cy='24' r='4' fill='#5D4037'/><circle cx='44' cy='24' r='4' fill='#5D4037'/><path d='M12 28 q-4 6 0 10 q4-4 0-10z' fill='#4FC3F7'/><path d='M52 28 q4 6 0 10 q-4-4 0-10z' fill='#4FC3F7'/>`
  ),
  "heart-pulse": svg(
    `<path d='M32 54 C10 38 8 22 20 16 c7-3 12 1 12 6 0-5 5-9 12-6 12 6 10 22-12 38z' fill='#E53935'/><polyline points='12,34 24,34 29,24 35,44 40,34 52,34' stroke='#FFF' stroke-width='3.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>`
  ),
  "thumbs-up": svg(
    `<rect x='10' y='30' width='12' height='24' rx='3' fill='#8D6E63'/><path d='M26 54 V30 c8-2 10-10 10-18 0-4 8-4 8 4 0 5-1 9-3 12 h10 c4 0 6 4 5 8 l-4 14 c-1 3-3 4-6 4 H30 c-2 0-4-2-4-4z' fill='#FFB74D' stroke='#8D6E63' stroke-width='2'/>`
  ),
  "party-pop": svg(
    `<rect x='8' y='34' width='26' height='14' rx='2' transform='rotate(-30 21 41)' fill='#7E57C2'/><path d='M30 34 L48 16' stroke='#FFB300' stroke-width='3' stroke-linecap='round'/><circle cx='50' cy='12' r='4' fill='#E53935'/><circle cx='56' cy='22' r='3' fill='#43A047'/><circle cx='44' cy='8' r='3' fill='#1E88E5'/><rect x='52' y='30' width='5' height='5' transform='rotate(25 54 32)' fill='#F06292'/><rect x='38' y='4' width='5' height='5' transform='rotate(-15 40 6)' fill='#4DD0E1'/>`
  ),
  "fire-hot": svg(
    `<path d='M32 6 C40 16 48 24 48 38 c0 10-7 18-16 18 s-16-8-16-18 c0-8 4-12 8-18 1 5 3 7 6 9 0-8-2-14 2-23z' fill='#FB8C00'/><path d='M32 26 c4 6 9 10 9 17 0 6-4 10-9 10 s-9-4-9-10 c0-7 5-11 9-17z' fill='#FFCA28'/>`
  ),
  "star-spin": svg(
    `<path d='M32 6 l7.6 15.9 17.4 2.3-12.8 12 3.3 17.2L32 45l-15.5 8.4 3.3-17.2-12.8-12 17.4-2.3z' fill='#FFCA28' stroke='#F57F17' stroke-width='2'/>`
  ),
  "clap-hands": svg(
    `<path d='M18 36 c-3-3 2-8 5-5 l10 9 -2-16 c-1-4 5-5 6-1 l3 12 4-13 c1-4 7-3 6 1 l-4 14 6-8 c2-3 7 0 5 4 l-8 16 c-2 5-7 8-12 6 l-12-6 c-3-2-5-7-3-11z' fill='#FFB74D' stroke='#8D6E63' stroke-width='2'/><path d='M46 14 l2 5 5 2-5 2-2 5-2-5-5-2 5-2z' fill='#FFCA28'/>`
  ),
  "cool-shades": svg(
    `<${FACE_BASE}/><path d='M10 24 h44 l-2 4 h-6 l-2 8 c-1 4-4 6-8 6 h-4 c-4 0-7-2-8-6 l-2-8 h-4z' fill='#263238'/><rect x='14' y='26' width='16' height='10' rx='3' fill='#263238'/><rect x='34' y='26' width='16' height='10' rx='3' fill='#263238'/><path d='M24 40 Q32 48 40 40' stroke='#5D4037' stroke-width='3' fill='none' stroke-linecap='round'/>`
  ),
  "cry-river": svg(
    `<${FACE_BASE}/><path d='M20 42 Q26 36 32 42 Q38 48 44 42' stroke='#5D4037' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M22 22 q-3 5 0 8 q3-3 0-8z' fill='#4FC3F7'/><path d='M42 22 q-3 5 0 8 q3-3 0-8z' fill='#4FC3F7'/><path d='M27 30 q-4 18 0 26 q4-8 0-26z' fill='#4FC3F7'/><path d='M37 30 q-4 18 0 26 q4-8 0-26z' fill='#4FC3F7'/>`
  ),
  "ghost-boo": svg(
    `<path d='M14 56 V28 c0-10 8-18 18-18 s18 8 18 18 v28 l-6-5-6 5-6-5-6 5-6-5z' fill='#ECEFF1' stroke='#90A4AE' stroke-width='2'/><circle cx='25' cy='28' r='4' fill='#263238'/><circle cx='39' cy='28' r='4' fill='#263238'/><ellipse cx='32' cy='40' rx='5' ry='7' fill='#263238'/>`
  ),
  "rocket-fly": svg(
    `<path d='M32 4 c8 8 12 18 12 28 l-4 10 H24 l-4-10 c0-10 4-20 12-28z' fill='#ECEFF1' stroke='#90A4AE' stroke-width='2'/><circle cx='32' cy='26' r='6' fill='#4FC3F7' stroke='#0277BD' stroke-width='2'/><path d='M20 40 l-8 12 10-3z' fill='#E53935'/><path d='M44 40 l8 12-10-3z' fill='#E53935'/><path d='M28 46 q4 8 4 14 q0-6 4-14z' fill='#FB8C00'/>`
  ),
  "coffee-cup": svg(
    `<rect x='12' y='26' width='32' height='26' rx='4' fill='#8D6E63'/><rect x='12' y='26' width='32' height='6' fill='#6D4C41'/><path d='M44 32 h6 c5 0 5 12 0 12 h-6' stroke='#6D4C41' stroke-width='4' fill='none'/><path d='M20 20 q2-5 0-9 M30 20 q2-5 0-9 M40 20 q2-5 0-9' stroke='#90A4AE' stroke-width='3' fill='none' stroke-linecap='round'/>`
  ),
  "sleep-zzz": svg(
    `<${FACE_BASE}/><path d='M22 30 h8 l-8 6 h8' stroke='#5D4037' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M34 30 h8 l-8 6 h8' stroke='#5D4037' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M46 12 h10 l-10 9 h10' stroke='#90A4AE' stroke-width='4' fill='none' stroke-linecap='round'/>`
  ),
  "ok-check": svg(
    `<circle cx='32' cy='32' r='27' fill='#43A047'/><path d='M18 33 l10 10 L46 22' stroke='#FFF' stroke-width='7' fill='none' stroke-linecap='round' stroke-linejoin='round'/>`
  ),
  "broken-heart": svg(
    `<path d='M32 56 C10 40 8 24 20 18 c7-3 12 1 12 6 0-5 5-9 12-6 12 6 10 22-12 38z' fill='#E53935'/><polyline points='32,20 26,32 36,38 30,52' stroke='#FFF' stroke-width='4' fill='none' stroke-linecap='round' stroke-linejoin='round'/>`
  ),
};
