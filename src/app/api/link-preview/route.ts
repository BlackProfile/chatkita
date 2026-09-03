import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/link-preview?url=<encoded> — Task 19 (in-app link preview).
 *
 * Mengambil halaman http(s) publik, mem-parse Open Graph/Twitter meta +
 * <title> dengan regex (TANPA dependensi), dan mendeteksi provider
 * (YouTube/TikTok/Instagram/Facebook/generic) dari URL final.
 *
 * Keamanan (SSRF):
 *  - Hanya http/https; hostname dilarang: localhost/.local/.internal,
 *    IP literal privat/loopback/link-local/CGNAT (127.x, 10.x, 172.16-31.x,
 *    192.168.x, 169.254.x, 100.64-127.x, 0.x), ::1/[::1], integer/hex host.
 *  - Fetch timeout 5 s (AbortController), redirect diikuti, body dibaca
 *    maksimal 512 KB lalu stream dibatalkan, hanya text/html diparse.
 *
 * Cache: in-memory Map url → {data, at}, TTL 30 menit, maks 300 entri
 * (tertua dibuang saat penuh). Field `undefined` otomatis tak ikut di-JSON.
 *
 * v33 — ENRICHMENT PROVIDER: YouTube memblokir og:image/og:title untuk fetch
 * bot (halaman persetujuan), sehingga kartu pratinjau tampil kosong hitam.
 * Kini thumbnail diambil dari CDN statis i.ytimg.com (selalu ada utk video
 * valid) + judul asli dari oEmbed YouTube; bila fetch halaman gagal total,
 * kartu minimal tetap diberikan (providerFallback). TikTok di-enrich via
 * oEmbed TikTok (best-effort).
 *
 * Kontrak respons:
 *  - 400 {ok:false, error:"invalid-url"|"missing-url"} — input buruk.
 *  - 200 {ok:false, error:"timeout"|"not-html"|"fetch-failed"|...} — gagal diam.
 *  - 200 {ok:true, url, title?, description?, image?, siteName?, provider,
 *         videoId?, tiktokId?} — url = URL FINAL setelah redirect.
 */

export const runtime = "nodejs";

interface LinkPreviewSuccess {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  provider: "youtube" | "tiktok" | "instagram" | "facebook" | "generic";
  videoId?: string;
  tiktokId?: string;
}

const MAX_BODY_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX_ENTRIES = 300;
const TITLE_MAX = 120;
const DESC_MAX = 200;
const USER_AGENT = "Mozilla/5.0 (compatible; ChatKitaLinkPreview/1.0)";

const cache = new Map<string, { data: LinkPreviewSuccess; at: number }>();

function cacheSet(key: string, data: LinkPreviewSuccess): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, at: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Host guard                                                          */
/* ------------------------------------------------------------------ */

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

/** True bila hostname tidak boleh di-fetch (privat/loopback/tersembunyi). */
function isForbiddenHost(hostnameRaw: string): boolean {
  let host = hostnameRaw.trim().toLowerCase();
  // WHATWG URL membungkus host IPv6 dengan tanda kurung.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return true;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // Loopback IPv6 + all-zeros.
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
  // Bentuk integer/hex tanpa titik (http://2130706433/, http://0x7f000001/).
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true;
    const [a, b] = o;
    if (a === 0 || a === 10 || a === 127) return true; // 0.x, 10.x, 127.x
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16-31.x
    if (a === 192 && b === 168) return true; // 192.168.x
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Provider detection                                                  */
/* ------------------------------------------------------------------ */

function detectProvider(
  rawUrl: string
): Pick<LinkPreviewSuccess, "provider" | "videoId" | "tiktokId"> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { provider: "generic" };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const isYoutube =
    /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host) || host === "youtu.be";
  if (isYoutube) {
    let videoId: string | undefined;
    if (host === "youtu.be") {
      videoId = u.pathname.split("/").filter(Boolean)[0];
    } else {
      const shorts = /\/(?:shorts|embed)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
      videoId = shorts?.[1] ?? u.searchParams.get("v") ?? undefined;
    }
    return { provider: "youtube", videoId: videoId || undefined };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    const m = /\/video\/(\d+)/.exec(u.pathname);
    return { provider: "tiktok", tiktokId: m?.[1] };
  }
  if (/(^|\.)instagram\.com$/.test(host)) return { provider: "instagram" };
  if (/(^|\.)facebook\.com$/.test(host) || /(^|\.)fb\.watch$/.test(host)) {
    return { provider: "facebook" };
  }
  return { provider: "generic" };
}

/* ------------------------------------------------------------------ */
/* HTML parsing (regex, tanpa dependensi)                              */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode entity HTML dasar: bernama + numerik desimal/heksadesimal. */
function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (raw, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return raw;
      try {
        return String.fromCodePoint(code);
      } catch {
        return raw;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? raw;
  });
}

/** Rapatkan whitespace berlebih + trim. */
function clean(input: string): string {
  return decodeEntities(input).replace(/\s+/g, " ").trim();
}

/** Kumpulkan atribut content dari semua tag meta (urutan atribut bebas). */
function collectMeta(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    attrRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(tag))) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    const content = attrs.content;
    if (key && content !== undefined && content !== "" && !map.has(key)) {
      map.set(key, content);
    }
  }
  return map;
}

function slice(input: string | undefined, max: number): string | undefined {
  if (!input) return undefined;
  const cleaned = clean(input);
  if (!cleaned) return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Resolve og:image relatif/protocol-relative terhadap URL halaman. */
function resolveImage(src: string | undefined, baseUrl: string): string | undefined {
  if (!src) return undefined;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseHtml(html: string, finalUrl: string): LinkPreviewSuccess {
  const meta = collectMeta(html);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);

  const title =
    slice(meta.get("og:title"), TITLE_MAX) ??
    slice(meta.get("twitter:title"), TITLE_MAX) ??
    slice(titleMatch?.[1], TITLE_MAX);
  const description = slice(
    meta.get("og:description") ?? meta.get("twitter:description"),
    DESC_MAX
  );
  const image = resolveImage(
    meta.get("og:image") ?? meta.get("og:image:secure_url") ?? meta.get("twitter:image"),
    finalUrl
  );
  const siteName = slice(meta.get("og:site_name"), TITLE_MAX);

  return {
    url: finalUrl,
    title,
    description,
    image,
    siteName,
    ...detectProvider(finalUrl),
  };
}

/* ------------------------------------------------------------------ */
/* Body reader (batas 512 KB)                                          */
/* ------------------------------------------------------------------ */

async function readBodyCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return "";
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received > MAX_BODY_BYTES) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Enrichment khusus provider (v33)                                    */
/* ------------------------------------------------------------------ */

const OEMBED_TIMEOUT_MS = 4000;

/** fetch JSON kecil dengan timeout pendek; gagal/tidak-JSON → null (diam). */
async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT },
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return json && typeof json === "object" ? json : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * v33 — lengkapi data pratinjau untuk provider yang memblokir OG bot.
 * YouTube: thumbnail = CDN statis i.ytimg.com (hqdefault, selalu ada untuk
 * video valid); judul/penulis dari oEmbed YouTube bila OG tak memberinya.
 * TikTok: judul + thumbnail via oEmbed TikTok (best-effort).
 * Semua gagal = diam — field tetap seperti hasil parse halaman.
 */
async function enrichProviderMedia(data: LinkPreviewSuccess): Promise<LinkPreviewSuccess> {
  if (data.provider === "youtube" && data.videoId) {
    if (!data.image) {
      data.image = `https://i.ytimg.com/vi/${encodeURIComponent(data.videoId)}/hqdefault.jpg`;
    }
    if (!data.title) {
      const oe = await fetchJson(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${data.videoId}`
        )}&format=json`
      );
      const title = slice(typeof oe?.title === "string" ? oe.title : undefined, TITLE_MAX);
      if (title) data.title = title;
      const author = slice(typeof oe?.author_name === "string" ? oe.author_name : undefined, TITLE_MAX);
      if (author) data.siteName = data.siteName ?? author;
    }
  }
  if (data.provider === "tiktok" && data.tiktokId && (!data.image || !data.title)) {
    const oe = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(data.url)}`);
    const title = slice(typeof oe?.title === "string" ? oe.title : undefined, TITLE_MAX);
    if (title && !data.title) data.title = title;
    if (!data.image && typeof oe?.thumbnail_url === "string") {
      data.image = safeAbsolute(oe.thumbnail_url) ?? undefined;
    }
    if (!data.siteName && typeof oe?.author_name === "string") {
      data.siteName = slice(oe.author_name, TITLE_MAX);
    }
  }
  return data;
}

/**
 * v33 — jalur saat fetch halaman GAGAL (diblokir/timeout/bukan-html):
 * untuk YouTube kita tetap tahu videoId dari URL → beri kartu minimal
 * (thumbnail statis + judul oEmbed) alih-alih menghilang sama sekali.
 */
async function providerFallback(
  key: string,
  providerInfo: Pick<LinkPreviewSuccess, "provider" | "videoId" | "tiktokId">,
  error: string
): Promise<NextResponse> {
  if (providerInfo.provider === "youtube" && providerInfo.videoId) {
    const data = await enrichProviderMedia({ url: key, ...providerInfo });
    if (data.image) {
      cacheSet(key, data);
      return NextResponse.json({ ok: true, ...data });
    }
  }
  return fail(error);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

function fail(error: string, status = 200): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeAbsolute(candidate: string | null): string | null {
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const input = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!input) return fail("missing-url", 400);

  let target: URL;
  try {
    target = new URL(input);
  } catch {
    return fail("invalid-url", 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return fail("invalid-url", 400);
  }
  if (target.username || target.password || isForbiddenHost(target.hostname)) {
    return fail("invalid-url", 400);
  }

  const key = target.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, ...cached.data });
  }

  /* v33 — deteksi provider SEBELUM fetch: dipakai fallback kartu minimal. */
  const providerInfo = detectProvider(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "id,en;q=0.8",
      },
    });
    if (!res.ok) return providerFallback(key, providerInfo, `upstream-${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return providerFallback(key, providerInfo, "not-html");
    }
    const html = await readBodyCapped(res);
    if (!html) return providerFallback(key, providerInfo, "empty-body");

    const finalUrl = safeAbsolute(res.url) || key;
    let data = parseHtml(html, finalUrl);
    /* v33 — isi thumbnail/judul provider yang memblokir OG (YouTube dkk.). */
    data = await enrichProviderMedia(data);
    cacheSet(key, data);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return providerFallback(key, providerInfo, aborted ? "timeout" : "fetch-failed");
  } finally {
    clearTimeout(timer);
  }
}
