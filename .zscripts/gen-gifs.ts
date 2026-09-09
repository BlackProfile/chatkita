/**
 * v48 — generator GIF animasi lokal untuk picker "Animasi" ChatKita.
 * Dijalankan sekali dengan `bun .zscripts/gen-gifs.ts` → tulis ke public/gifs/.
 * GIF89a + trik "uncompressed LZW" (clear code sebelum tiap piksel) —
 * tanpa dependensi, hasil kecil (64×64, 8 frame, 120 ms/frame).
 */

const W = 64
const H = 64
const FRAMES = 8

/* Palet 8 warna: 0 = transparan. */
const PALETTE: [number, number, number][] = [
  [0, 0, 0], // 0 transparan
  [255, 255, 255], // 1 putih
  [30, 30, 30], // 2 hitam
  [229, 57, 53], // 3 merah
  [255, 202, 40], // 4 kuning
  [67, 160, 71], // 5 hijau
  [240, 98, 146], // 6 pink
  [251, 140, 0], // 7 oranye
]

type Frame = Uint8Array // W*H indeks palet

const blank = (): Frame => new Uint8Array(W * H)

const circle = (f: Frame, cx: number, cy: number, r: number, c: number) => {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r * r) f[y * W + x] = c
    }
  }
}

const rect = (f: Frame, x0: number, y0: number, w: number, h: number, c: number) => {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) f[y * W + x] = c
  }
}

/** Isi poligon konveks sederhana via scanline. */
const poly = (f: Frame, pts: [number, number][], c: number) => {
  let minY = H
  let maxY = 0
  for (const [, y] of pts) {
    minY = Math.min(minY, Math.floor(y))
    maxY = Math.max(maxY, Math.ceil(y))
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      if (y1 === y2) continue
      if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.round(xs[i])); x <= Math.min(W - 1, Math.round(xs[i + 1])); x++) {
        f[y * W + x] = c
      }
    }
  }
}

/* ------------------------- animasi ------------------------- */

const anims: Record<string, (t: number) => Frame> = {
  // Bola merah memantul + bayangan.
  bola: (t) => {
    const f = blank()
    const bounce = Math.abs(Math.sin((Math.PI * t) / FRAMES))
    const cy = 46 - 28 * bounce
    ellipseShadow(f, 32, 55, 12 - 5 * bounce, 3 - bounce, 2)
    circle(f, 32, cy, 11, 3)
    circle(f, 28, cy - 4, 3, 1)
    return f
  },
  // Hati pink berdenyut.
  hati: (t) => {
    const f = blank()
    const s = 1 + 0.14 * Math.sin((2 * Math.PI * t) / FRAMES)
    const cx = 32
    const cy = 34
    circle(f, cx - 9 * s, cy - 6 * s, 10 * s, 6)
    circle(f, cx + 9 * s, cy - 6 * s, 10 * s, 6)
    poly(f, [
      [cx - 18 * s, cy - 1],
      [cx + 18 * s, cy - 1],
      [cx, cy + 20 * s],
    ], 6)
    circle(f, cx - 9, cy - 9, 3, 1)
    return f
  },
  // Bintang kuning berputar.
  bintang: (t) => {
    const f = blank()
    const a = (Math.PI * 2 * t) / FRAMES
    const pts: [number, number][] = []
    for (let i = 0; i < 10; i++) {
      const ang = a + (i * Math.PI) / 5 - Math.PI / 2
      const r = i % 2 === 0 ? 22 : 9
      pts.push([32 + r * Math.cos(ang), 32 + r * Math.sin(ang)])
    }
    poly(f, pts, 4)
    return f
  },
  // Api berkelip.
  api: (t) => {
    const f = blank()
    const w = Math.sin((2 * Math.PI * t) / FRAMES)
    circle(f, 32, 48, 13, 7)
    circle(f, 32, 40 + 2 * w, 10, 7)
    circle(f, 32 + 3 * w, 38, 6, 4)
    circle(f, 32 - 4 * w, 34 - 2 * w, 3, 4)
    circle(f, 32, 46, 5, 4)
    return f
  },
  // Confetti jatuh.
  confetti: (t) => {
    const f = blank()
    for (let i = 0; i < 14; i++) {
      const x = (i * 37) % 60
      const y = (((i * 23) % 64) + t * 8) % (H + 8)
      const c = 3 + (i % 5)
      rect(f, x, y, 4, 4, c)
      rect(f, ((i * 53) % 60), (((i * 41) % 64) + t * 5) % (H + 8), 3, 3, 1 + (i % 6))
    }
    return f
  },
  // Roket terbang + lidah api.
  roket: (t) => {
    const f = blank()
    const dy = ((FRAMES - t) % FRAMES) * 2
    const y = 24 + dy
    rect(f, 27, y, 10, 18, 1)
    poly(f, [
      [27, y],
      [32, y - 10],
      [37, y],
    ], 3)
    poly(f, [
      [27, y + 12],
      [22, y + 18],
      [27, y + 18],
    ], 2)
    poly(f, [
      [37, y + 12],
      [42, y + 18],
      [37, y + 18],
    ], 2)
    circle(f, 32, y + 6, 3, 4)
    circle(f, 32, y + 20 + 2 * (t % 2), 4, 7)
    circle(f, 32, y + 23, 2, 4)
    return f
  },
  // Kopi mengepul.
  kopi: (t) => {
    const f = blank()
    rect(f, 18, 36, 26, 16, 1)
    rect(f, 18, 36, 26, 3, 2)
    rect(f, 44, 40, 3, 8, 1)
    circle(f, 47, 42, 4, 1)
    circle(f, 47, 42, 2, 2)
    for (let i = 0; i < 3; i++) {
      const y = 30 - (((t * 2 + i * 3) % 12) + 12) % 12
      circle(f, 24 + i * 7, y, 2, 2)
    }
    return f
  },
  // Tidur: wajah + Z melayang.
  zzz: (t) => {
    const f = blank()
    circle(f, 30, 38, 16, 6)
    rect(f, 22, 34, 7, 2, 2)
    rect(f, 33, 34, 7, 2, 2)
    poly(f, [
      [26, 44],
      [36, 44],
      [26, 48],
      [36, 48],
    ], 2)
    const zx = 44 + t
    const zy = 14 - t
    poly(f, [
      [zx, zy],
      [zx + 9, zy],
      [zx, zy + 8],
      [zx + 9, zy + 8],
    ], 1)
    return f
  },
}

/** Ellipse "bayangan" (pakai rumus elips sederhana). */
function ellipseShadow(f: Frame, cx: number, cy: number, rx: number, ry: number, c: number) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / (rx || 1)
      const dy = (y - cy) / (ry || 1)
      if (dx * dx + dy * dy <= 1) f[y * W + x] = c
    }
  }
}

/* ------------------- penulis GIF89a ------------------- */

/** LZW "uncompressed": clear code sebelum tiap piksel, lebar kode tetap. */
function lzwUncompressed(indices: Uint8Array, mcs: number): number[] {
  const clear = 1 << mcs
  const codeSize = mcs + 1
  const out: number[] = []
  let buf = 0
  let cnt = 0
  const emit = (code: number) => {
    buf |= code << cnt
    cnt += codeSize
    while (cnt >= 8) {
      out.push(buf & 0xff)
      buf >>= 8
      cnt -= 8
    }
  }
  emit(clear)
  for (const ix of indices) {
    emit(clear)
    emit(ix)
  }
  if (cnt > 0) out.push(buf & 0xff)
  return out
}

function writeGif(frames: Frame[], delayMs: number): Uint8Array {
  const b: number[] = []
  const push = (...xs: number[] | string[]) => {
    for (const x of xs) b.push(typeof x === 'string' ? x.charCodeAt(0) : x)
  }
  const mcs = 3 // 8 warna
  // Header + LSD (GCT 8 warna).
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, W & 0xff, W >> 8, H & 0xff, H >> 8, 0xf2, 0, 0)
  for (const [r, g, bl] of PALETTE) push(r, g, bl)
  // NETSCAPE2.0 loop selamanya.
  push(0x21, 0xff, 0x0b, 'NETSCAPE2.0', 0x03, 0x01, 0, 0, 0x00)
  for (const frame of frames) {
    // GCE: disposal=1, transparan index 0.
    const delay = Math.max(2, Math.round(delayMs / 10))
    push(0x21, 0xf9, 0x04, 0x05, delay & 0xff, delay >> 8, 0x00, 0x00)
    // Image descriptor.
    push(0x2c, 0, 0, 0, 0, W & 0xff, W >> 8, H & 0xff, H >> 8, 0x00)
    // LZW min code size + data sub-blok.
    const data = lzwUncompressed(frame, mcs)
    push(mcs)
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255)
      push(chunk.length, ...chunk)
    }
    push(0x00)
  }
  push(0x3b)
  return Uint8Array.from(b)
}

/* ------------------------- main ------------------------- */

import { mkdirSync, writeFileSync } from 'node:fs'

const outDir = new URL('../public/gifs/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })
for (const [name, fn] of Object.entries(anims)) {
  const frames: Frame[] = []
  for (let t = 0; t < FRAMES; t++) frames.push(fn(t))
  const gif = writeGif(frames, 120)
  const path = `${outDir}${name}.gif`
  writeFileSync(path, gif)
  console.log(`ok ${path} (${gif.length} bytes)`)
}
console.log('selesai')
