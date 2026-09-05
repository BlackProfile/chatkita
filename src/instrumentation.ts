/**
 * Next.js instrumentation — dipanggil sekali saat server (dev/prod) boot
 * dan saat instrumentation di-reload di dev.
 *
 * Tugas: (1) SELF-HEAL — pulihkan file kritis yang hilang akibat checkpoint
 * rollback sandbox (commit UUID) dari git tag rescue; (2) pastikan mini-service
 * chat-service (:3003) hidup. Proses ini di-spawn sebagai CHILD dari server
 * Next, sehingga ikut bertahan selama server Next hidup dan otomatis ada lagi
 * setiap kali sandbox/servis boot.
 * Kalau port sudah terbuka (service lama masih jalan), tidak ada spawn baru.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // turbopackIgnore: jangan ikutkan modul node ini ke bundle edge runtime —
  // register() hanya pernah berjalan di runtime Node.
  const { spawn } = await import(/* turbopackIgnore: true */ "node:child_process");
  const fs = await import(/* turbopackIgnore: true */ "node:fs");
  const net = await import(/* turbopackIgnore: true */ "node:net");

  const PORT = 3003;
  void 0; // v42 — bump agar register() dijalankan ulang oleh dev server (Task 60-b).

  /* v21 Task 37 — SELF-HEAL anti-rollback: checkpoint sandbox pernah menghapus
   * file lewat "commit UUID" (contoh df40cd2 menghapus /api/upload/route.ts).
   * Saat boot, jika file kritis hilang tapi git tag rescue masih ada,
   * pulihkan otomatis dan catat di dev.log. */
  const RESCUE_TAG = "rescue-v42";
  const CRITICAL_FILES = ["src/app/api/upload/route.ts"];
  try {
    const { execFileSync } = await import(/* turbopackIgnore: true */ "node:child_process");
    for (const rel of CRITICAL_FILES) {
      const abs = `${process.cwd()}/${rel}`;
      if (!fs.existsSync(abs)) {
        try {
          const content = execFileSync("git", ["show", `${RESCUE_TAG}:${rel}`], {
            cwd: process.cwd(),
          });
          fs.mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
          fs.writeFileSync(abs, content);
          console.warn(
            `[instrumentation] SELF-HEAL ✅ ${rel} dipulihkan otomatis dari tag ${RESCUE_TAG}`
          );
        } catch {
          console.error(
            `[instrumentation] SELF-HEAL ❌ ${rel} hilang & tak bisa dipulihkan dari ${RESCUE_TAG} — jalankan: bash scripts/verify-integrity.sh (lihat FEATURES.md §6)`
          );
        }
      }
    }
  } catch {
    /* self-heal bersifat best-effort — jangan pernah blok boot server */
  }

  const alive = await new Promise<boolean>((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(1200);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(PORT, "127.0.0.1");
  });
  if (alive) {
    console.log("[instrumentation] chat-service sudah hidup di :3003 — tidak di-spawn ulang.");
    return;
  }

  const cwd = `${process.cwd()}/mini-services/chat-service`;
  if (!fs.existsSync(`${cwd}/index.ts`)) {
    console.warn("[instrumentation] chat-service tidak ditemukan di", cwd);
    return;
  }

  const LOG = "/tmp/chat-service-child.log";
  try {
    const out = fs.openSync(LOG, "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", out, out],
      detached: false,
    });
    child.unref();
    fs.appendFileSync(
      LOG,
      `\n[instrumentation ${new Date().toISOString()}] spawn chat-service pid=${child.pid}\n`
    );
    console.log(`[instrumentation] chat-service di-spawn (pid ${child.pid}) → :3003`);
  } catch (err) {
    console.error("[instrumentation] gagal spawn chat-service:", err);
  }
}
