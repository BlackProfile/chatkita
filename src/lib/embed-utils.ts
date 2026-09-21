/**
 * v11 — Resolver tautan → embed dalam aplikasi.
 *
 * Mengenali tautan platform populer (YouTube, TikTok, Instagram, Facebook,
 * X/Twitter, Vimeo, Dailymotion, SoundCloud, Spotify, Streamable, Twitch)
 * dan mengubahnya menjadi URL iframe yang bisa ditonton langsung di dalam
 * aplikasi. Tautan yang tidak dikenali → `embedUrl: null` (pemanggil
 * menampilkan tombol "Buka di browser").
 */

export type EmbedKind =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "vimeo"
  | "dailymotion"
  | "soundcloud"
  | "spotify"
  | "streamable"
  | "twitch"
  | "generic";

export interface EmbedInfo {
  kind: EmbedKind;
  /** Nama platform yang ramah pengguna ("YouTube", "TikTok", …). */
  label: string;
  /** URL iframe bila platform dikenali; null = tidak bisa disematkan. */
  embedUrl: string | null;
  /** ID konten yang diekstrak (untuk pengujian/analitik; boleh kosong). */
  contentId?: string;
}

/** Hostname tanpa "www." (m.youtube.com tetap "m.youtube.com"). */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** ID YouTube: 11 karakter umumnya, tapi longgar agar tidak pecah. */
const YT_ID = /^[A-Za-z0-9_-]{5,}$/;

function youtubeEmbed(url: URL): EmbedInfo | null {
  const host = bareHost(url.hostname);
  const isYt =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYt) return null;

  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v") ?? "";
  } else {
    const segs = url.pathname.split("/").filter(Boolean);
    // /shorts/ID · /embed/ID · /live/ID · /v/ID
    if (segs.length >= 2 && ["shorts", "embed", "live", "v"].includes(segs[0])) {
      id = segs[1];
    }
  }
  if (!YT_ID.test(id)) return null;
  return {
    kind: "youtube",
    label: "YouTube",
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    contentId: id,
  };
}

function tiktokEmbed(url: URL): EmbedInfo | null {
  const host = bareHost(url.hostname);
  if (host !== "tiktok.com" && host !== "m.tiktok.com") return null;
  // Format kanonik: /@pengguna/video/1234567890123456789
  const match = /\/video\/(\d+)/.exec(url.pathname);
  if (!match) return null;
  return {
    kind: "tiktok",
    label: "TikTok",
    embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
    contentId: match[1],
  };
}

function instagramEmbed(url: URL): EmbedInfo | null {
  if (bareHost(url.hostname) !== "instagram.com") return null;
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  // /p/{code} · /reel/{code} · /reels/{code} · /tv/{code}
  const kindSeg = segs[0] === "reels" ? "reel" : segs[0];
  if (!["p", "reel", "tv"].includes(kindSeg)) return null;
  const code = segs[1];
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  return {
    kind: "instagram",
    label: "Instagram",
    embedUrl: `https://www.instagram.com/${kindSeg}/${code}/embed`,
    contentId: code,
  };
}

function facebookEmbed(url: URL): EmbedInfo | null {
  const host = bareHost(url.hostname);
  const isFb = host === "facebook.com" || host === "m.facebook.com" || host === "fb.watch" || host === "web.facebook.com";
  if (!isFb) return null;
  const href = encodeURIComponent(url.toString());
  const path = url.pathname + url.search;
  const isVideo =
    host === "fb.watch" ||
    /\/watch\/?v=\d+/.test(path) ||
    /^\/[^/]+\/videos\//.test(path) ||
    /^\/reel\//.test(path);
  return {
    kind: "facebook",
    label: "Facebook",
    embedUrl: isVideo
      ? `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false`
      : `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true`,
  };
}

function xEmbed(url: URL): EmbedInfo | null {
  const host = bareHost(url.hostname);
  if (host !== "twitter.com" && host !== "x.com") return null;
  const match = /\/status\/(\d+)/.exec(url.pathname);
  if (!match) return null;
  return {
    kind: "x",
    label: "X",
    embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}`,
    contentId: match[1],
  };
}

function vimeoEmbed(url: URL): EmbedInfo | null {
  if (bareHost(url.hostname) !== "vimeo.com") return null;
  const match = /(\d{6,})/.exec(url.pathname);
  if (!match) return null;
  return {
    kind: "vimeo",
    label: "Vimeo",
    embedUrl: `https://player.vimeo.com/video/${match[1]}`,
    contentId: match[1],
  };
}

function dailymotionEmbed(url: URL): EmbedInfo | null {
  const host = bareHost(url.hostname);
  if (host === "dai.ly") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!id) return null;
    return { kind: "dailymotion", label: "Dailymotion", embedUrl: `https://geo.dailymotion.com/player.html?video=${id}`, contentId: id };
  }
  if (host !== "dailymotion.com") return null;
  const match = /\/video\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (!match) return null;
  return { kind: "dailymotion", label: "Dailymotion", embedUrl: `https://geo.dailymotion.com/player.html?video=${match[1]}`, contentId: match[1] };
}

function soundcloudEmbed(url: URL): EmbedInfo | null {
  if (bareHost(url.hostname) !== "soundcloud.com") return null;
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  return {
    kind: "soundcloud",
    label: "SoundCloud",
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}&color=%2310b981`,
  };
}

function spotifyEmbed(url: URL): EmbedInfo | null {
  if (bareHost(url.hostname) !== "open.spotify.com") return null;
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  // /type/{id} atau /intl-code/type/{id}
  const type = ["track", "album", "playlist", "episode", "show"].includes(segs[0])
    ? segs[0]
    : segs.length >= 3
      ? segs[1]
      : "";
  const id = type === segs[0] ? segs[1] : segs[2];
  if (!type || !id || !/^[A-Za-z0-9]+$/.test(id)) return null;
  return { kind: "spotify", label: "Spotify", embedUrl: `https://open.spotify.com/embed/${type}/${id}`, contentId: id };
}

function streamableEmbed(url: URL): EmbedInfo | null {
  if (bareHost(url.hostname) !== "streamable.com") return null;
  const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[A-Za-z0-9]+$/.test(id)) return null;
  return { kind: "streamable", label: "Streamable", embedUrl: `https://streamable.com/e/${id}`, contentId: id };
}

function twitchEmbed(url: URL, parent: string): EmbedInfo | null {
  const host = bareHost(url.hostname);
  const isTwitch =
    host === "twitch.tv" || host === "m.twitch.tv" || host === "clips.twitch.tv";
  if (!isTwitch || !parent) return null;
  const p = `&parent=${encodeURIComponent(parent)}`;
  if (host === "clips.twitch.tv") {
    const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!slug) return null;
    return { kind: "twitch", label: "Twitch", embedUrl: `https://clips.twitch.tv/embed?clip=${slug}${p}`, contentId: slug };
  }
  const match = /\/videos\/(\d+)/.exec(url.pathname);
  if (match) {
    return { kind: "twitch", label: "Twitch", embedUrl: `https://player.twitch.tv/?video=${match[1]}${p}`, contentId: match[1] };
  }
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length === 1) {
    return { kind: "twitch", label: "Twitch", embedUrl: `https://player.twitch.tv/?channel=${segs[0]}${p}`, contentId: segs[0] };
  }
  return null;
}

/**
 * Resolve sebuah tautan menjadi info embed. `parent` hanya dipakai Twitch
 * (parameter wajib player.twitch.tv) — default hostname halaman ini.
 * Tautan non-HTTP(S) atau tidak dikenali → generic (tidak disematkan).
 */
export function resolveEmbedUrl(raw: string, parent?: string): EmbedInfo {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { kind: "generic", label: "Tautan", embedUrl: null };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "generic", label: "Tautan", embedUrl: null };
  }
  const host = bareHost(url.hostname);
  const parentHost =
    parent ??
    (typeof window !== "undefined" ? window.location.hostname : "localhost");

  return (
    youtubeEmbed(url) ??
    tiktokEmbed(url) ??
    instagramEmbed(url) ??
    facebookEmbed(url) ??
    xEmbed(url) ??
    vimeoEmbed(url) ??
    dailymotionEmbed(url) ??
    soundcloudEmbed(url) ??
    spotifyEmbed(url) ??
    streamableEmbed(url) ??
    twitchEmbed(url, parentHost) ??
    (() => ({ kind: "generic" as const, label: host || "Tautan", embedUrl: null }))()
  );
}

/**
 * Pecah teks menjadi segmen teks biasa dan URL agar URL bisa diklik.
 * Dipakai bubble teks untuk menandai tautan di dalam pesan.
 */
export function splitTextUrls(text: string): Array<{ type: "text" | "url"; value: string }> {
  const re = /https?:\/\/[^\s<>"'）)\]}]+/g;
  const out: Array<{ type: "text" | "url"; value: string }> = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    out.push({ type: "url", value: match[0] });
    last = idx + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
