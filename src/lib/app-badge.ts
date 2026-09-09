/**
 * v47 — badge notifikasi pada ikon aplikasi (favicon) + Web App Badging API.
 *
 * Dipakai oleh Messenger (sisi user) dan AdminPanel (sisi admin): setiap
 * kali jumlah pesan belum dibaca berubah, favicon digambar ulang dengan
 * lingkaran merah berhitung (99+ maks) memakai canvas, dan bila browser
 * mendukung `navigator.setAppBadge` badge OS-level dipasang juga.
 */

const BASE_ICON = "/icon-192.png";
const LINK_ID = "ctk-favicon-badge";

let baseImage: HTMLImageElement | null = null;
let baseReady = false;
let baseFailed = false;

/** Pastikan ada <link rel="icon"> milik badge (ditambahkan terakhir → menang). */
const ensureLink = (): HTMLLinkElement => {
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
};

/** Muat sekali ikon dasar (public/icon-192.png) lalu gambar ulang. */
const ensureBase = (done: () => void) => {
  if (baseReady || baseFailed) {
    done();
    return;
  }
  if (!baseImage) {
    baseImage = new Image();
    baseImage.onload = () => {
      baseReady = true;
      done();
    };
    baseImage.onerror = () => {
      baseFailed = true;
      done();
    };
    baseImage.src = BASE_ICON;
  }
};

const paint = (count: number) => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  if (baseImage && baseReady && baseImage.naturalWidth > 0) {
    ctx.drawImage(baseImage, 0, 0, size, size);
  }
  if (count > 0) {
    const label = count > 99 ? "99+" : String(count);
    const cx = 47;
    const cy = 17;
    const r = 17;
    // Ring putih agar kontras di atas ikon hijau.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = label.length > 2 ? "bold 13px system-ui, sans-serif" : "bold 19px system-ui, sans-serif";
    ctx.fillText(label, cx, cy + 1);
  }
  ensureLink().href = canvas.toDataURL("image/png");
};

/**
 * Pasang/lepas badge ikon aplikasi. Aman dipanggil dari effect React.
 * count = jumlah pesan belum dibaca (0 = bersihkan badge).
 */
export const applyAppBadge = (count: number) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const safe = Math.max(0, Math.floor(count));
  ensureBase(() => paint(safe));
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (safe > 0) nav.setAppBadge?.(safe);
    else nav.clearAppBadge?.();
  } catch {
    /* browser tanpa Badging API — abaikan */
  }
};
