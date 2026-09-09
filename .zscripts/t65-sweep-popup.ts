// v49 (Task 65) — sweep popup: hapus kelas ukuran (lebar/tinggi) dari semua
// <DialogContent> dan <AlertDialogContent> supaya SEMUA popup memakai ukuran
// tetap seragam "normal" yang ditetapkan komponen dasar ui/dialog.tsx &
// ui/alert-dialog.tsx (isi sedikit tetap besar, isi banyak di-scroll di dalam).
// Pemakaian: bun .zscripts/t65-sweep-popup.ts <file...>
import { readFileSync, writeFileSync } from "fs";

const drop: RegExp[] = [
  /^max-w-\[calc\(100vw-2rem\)\]$/,
  /^max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl)$/,
  /^sm:max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl)$/,
  /^max-h-\[\d+vh\]$/,
  /^max-h-\[calc\(\d+vh-\d+px\)\]$/,
  /^w-\[calc\(100vw-[12]rem\)\]$/,
  /^w-full$/,
  /^overflow-y-auto$/,
];

let total = 0;
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, "utf8");
  const out = src.replace(
    /(<(?:DialogContent|AlertDialogContent)[^>]*?className=")([^"]*)(")/gs,
    (m: string, pre: string, cls: string, post: string) => {
      const kept = cls
        .split(/\s+/)
        .filter((t) => t && !drop.some((r) => r.test(t)));
      const next = kept.join(" ");
      if (next === cls) return m;
      total++;
      console.log(`${f}\n   - "${cls}"\n   + "${next}"`);
      return pre + next + post;
    }
  );
  if (out !== src) writeFileSync(f, out);
}
console.log(`TOTAL tag diubah: ${total}`);
