/**
 * Next.js instrumentation — dipanggil sekali saat server (dev/prod) boot
 * dan saat instrumentation di-reload di dev.
 *
 * Tugas: pastikan mini-service chat-service (:3003) hidup. Proses ini
 * di-spawn sebagai CHILD dari server Next, sehingga ikut bertahan selama
 * server Next hidup dan otomatis ada lagi setiap kali sandbox/servis boot.
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
  void 0; // v20 — bump agar register() dijalankan ulang oleh dev server.
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
