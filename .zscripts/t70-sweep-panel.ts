// t70-sweep-panel.ts — v54 (Task 70): hapus rounded-2xl dari className Dialog/AlertDialogContent
// agar bentuk dikendalikan komponen dasar (panel kanan / halaman penuh / sheet bawah).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const dir = "src/components/chat";
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
let touched = 0;
for (const f of files) {
  const p = `${dir}/${f}`;
  let src = readFileSync(p, "utf8");
  const before = src;
  // Kasus khusus: dialog wajib-password Messenger (ukuran kecil lama) -> panel standar
  src = src.replace(
    'className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm [&>button]:hidden"',
    'className="[&>button]:hidden"'
  );
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/<(Dialog|AlertDialog)Content/.test(lines[i]) && lines[i].includes("className=")) {
      lines[i] = lines[i].replace(/ ?rounded-2xl/g, "");
    }
  }
  src = lines.join("\n");
  if (src !== before) {
    writeFileSync(p, src);
    touched++;
    console.log("sweep:", p);
  }
}
console.log("selesai, file berubah:", touched);
