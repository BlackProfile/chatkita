/**
 * v48 — perkakas tautan: ekstraksi URL, deteksi domain, heuristik
 * mencurigakan (shortener/phishing/punycode/IP), dan deteksi embed video
 * (YouTube/Vimeo). Murni fungsi — tanpa React/RegExp mahal per render.
 */

/** URL pertama dalam teks (http(s):// atau www.). */
export function firstUrlInText(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/i.exec(text)
  if (!m) return null
  const raw = m[0]
  return raw.startsWith("www.") ? `https://${raw}` : raw
}

/** Hostname lowercase tanpa www. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return url.split("/")[0]?.toLowerCase() ?? ""
  }
}

/** Hostname asli (punycode terlihat → user tahu sedang di-phish). */
export function rawHostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

/** Daftar penyector tautan populer. */
const SHORTENERS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rb.gy", "shorturl.at", "s.id", "tiny.cc", "rebrand.ly", "t.ly",
])

/** TLD berisiko tinggi (sering dipakai phishing). */
const RISKY_TLDS = [".zip", ".mov", ".top", ".xyz", ".click", ".loan", ".work", ".rest", ".fit"]

export interface SuspicionResult {
  suspicious: boolean
  reasons: string[]
}

/** Heuristik tautan mencurigakan — hanya peringatan, tidak memblokir. */
export function suspicionOf(url: string): SuspicionResult {
  const reasons: string[] = []
  const host = rawHostOf(url)
  const domain = domainOf(url)
  if (!host) return { suspicious: false, reasons }
  if (SHORTENERS.has(domain)) reasons.push("Penyector tautan (tujuan tersembunyi)")
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) reasons.push("Host berupa alamat IP, bukan nama domain")
  if (host.startsWith("xn--") || host.includes(".xn--")) reasons.push("Domain punycode (bisa menyamar alfabet asing)")
  if (domain.split(".").length >= 4) reasons.push("Domain bersarang dalam (bisa tiruan situs resmi)")
  if ((domain.match(/-/g)?.length ?? 0) >= 3) reasons.push("Banyak tanda hubung (ciri domain tiruan)")
  if (RISKY_TLDS.some((t) => domain.endsWith(t))) reasons.push("Ekstensi domain berisiko tinggi")
  const brand = ["login", "verify", "secure", "account", "update", "wallet", "bank"]
  if (brand.some((b) => domain.includes(b))) reasons.push("Kata kunci sensitif di domain (umum pada phishing)")
  return { suspicious: reasons.length > 0, reasons }
}

export interface VideoEmbed {
  provider: "youtube" | "vimeo"
  embedUrl: string
  /** Thumbnail resmi (YouTube) bila ada. */
  thumbUrl?: string
}

/** Deteksi tautan video yang bisa di-embed (klik-untuk-play). */
export function videoEmbedOf(url: string): VideoEmbed | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "")
  // YouTube: watch?v=, youtu.be/ID, /shorts/ID, /embed/ID
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id = ""
    if (host === "youtu.be") id = u.pathname.slice(1)
    else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2] ?? ""
    else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2] ?? ""
    else id = u.searchParams.get("v") ?? ""
    id = id.split("/")[0]
    if (/^[\w-]{6,20}$/.test(id)) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
        thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }
    }
    return null
  }
  // Vimeo: vimeo.com/123456789
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0] ?? ""
    if (/^\d{6,12}$/.test(id)) {
      return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1` }
    }
  }
  return null
}

/** Ekstensi file teks yang boleh dipratinjau isinya (dibatasi ukuran). */
export const TEXT_PREVIEW_EXTS = new Set([
  "txt", "md", "markdown", "json", "csv", "log", "ts", "tsx", "js", "jsx",
  "css", "html", "xml", "yml", "yaml", "py", "java", "c", "cpp", "h", "sh", "sql", "env",
])

export function isTextPreviewable(fileName: string, mime: string, size: number): boolean {
  if (size > 200 * 1024) return false
  if (mime.startsWith("text/")) return true
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : ""
  return TEXT_PREVIEW_EXTS.has(ext)
}
