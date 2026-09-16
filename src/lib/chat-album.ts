/**
 * v73 — Album media: deretan foto/video yang dikirim beruntun dari pengirim
 * yang sama dikelompokkan menjadi SATU gelembung album (gaya WhatsApp)
 * supaya chat tidak dibanjiri banyak gelembung saat mengirim media banyak.
 *
 * Pengelompokan murni saat RENDER — pesan tetap tersimpan & ditangani
 * server satu-per-satu (hapus, reaksi, burn, galeri, dll. tetap per pesan).
 */

import type { ChatMessage } from "@/lib/chat-types";

/** Jeda maksimum antar media berurutan agar masih dianggap satualbum. */
export const ALBUM_GAP_MS = 2 * 60 * 1000;

/** Batas tile yang dirender di dalam album (sisanya jadi overlay "+N"). */
export const ALBUM_MAX_TILES = 6;

/** Pesan media yang layak masuk album: foto, atau file video utuh. */
export function isAlbumMediaMessage(m: ChatMessage): boolean {
  if (m.deletedAt || m.mediaExpiredAt) return false;
  /* Pesan menunggu persetujuan moderasi butuh strip aksi sendiri → tidak
   * digabung ke album (AdminPanel merender strip di bawah bubble). */
  if ((m as { pending?: boolean }).pending) return false;
  if (m.type === "image") return true;
  return m.type === "file" && (m.mimeType ?? "").startsWith("video/");
}

/** Item render: satu pesan biasa, atau kumpulan pesan album (≥ 2). */
export type AlbumRenderItem =
  | { kind: "single"; msg: ChatMessage }
  | { kind: "album"; msgs: ChatMessage[] };

/** Pesan pertama sebuah item render (untuk pemisah hari dsb.). */
export function renderItemFirst(item: AlbumRenderItem): ChatMessage {
  return item.kind === "single" ? item.msg : item.msgs[0];
}

/** Pesan terakhir sebuah item render. */
export function renderItemLast(item: AlbumRenderItem): ChatMessage {
  return item.kind === "single" ? item.msg : item.msgs[item.msgs.length - 1];
}

/**
 * Kelompokkan daftar pesan berurutan (sudah terurut waktu naik) menjadi
 * item render. Aturan album:
 *  - hanya pesan `isAlbumMediaMessage`,
 *  - pengirim sama dengan media sebelumnya,
 *  - jeda waktu antar pesan ≤ ALBUM_GAP_MS,
 *  - tidak terputus oleh pesan jenis lain,
 *  - run ≥ 2 → album; run 1 → pesan tunggal biasa.
 */
export function groupAlbumRuns(messages: ChatMessage[]): AlbumRenderItem[] {
  const items: AlbumRenderItem[] = [];
  let run: ChatMessage[] = [];

  const flush = () => {
    if (run.length >= 2) items.push({ kind: "album", msgs: run });
    else if (run.length === 1) items.push({ kind: "single", msg: run[0] });
    run = [];
  };

  for (const m of messages) {
    if (!isAlbumMediaMessage(m)) {
      flush();
      items.push({ kind: "single", msg: m });
      continue;
    }
    const prev = run[run.length - 1];
    const sameSender = prev && prev.senderId === m.senderId;
    const withinGap =
      prev &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <=
        ALBUM_GAP_MS;
    if (prev && sameSender && withinGap) run.push(m);
    else {
      flush();
      run = [m];
    }
  }
  flush();
  return items;
}

/** Label jumlah media untuk baris waktu album, mis. "4 media". */
export function albumCountLabel(msgs: ChatMessage[]): string {
  const videos = msgs.filter(
    (m) => m.type === "file" && (m.mimeType ?? "").startsWith("video/")
  ).length;
  const photos = msgs.length - videos;
  if (videos === 0) return `${msgs.length} foto`;
  if (photos === 0) return `${msgs.length} video`;
  return `${photos} foto · ${videos} video`;
}
