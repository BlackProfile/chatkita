// SEMENTARA (Task 31) — spawn ulang chat-service dari subtree next-server.
export async function GET() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return Response.json({ ok: false, error: "nodejs only" }, { status: 400 });
  }
  const { spawn } = await import(/* turbopackIgnore: true */ "node:child_process");
  const fs = await import(/* turbopackIgnore: true */ "node:fs");
  const net = await import(/* turbopackIgnore: true */ "node:net");
  const alive = await new Promise<boolean>((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(1200);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(3003, "127.0.0.1");
  });
  if (alive) return Response.json({ ok: true, spawned: false, note: "3003 sudah hidup" });
  const cwd = `${process.cwd()}/mini-services/chat-service`;
  const out = fs.openSync("/tmp/chat-service-child.log", "a");
  const child = spawn("bun", ["run", "dev"], { cwd, env: { ...process.env, PORT: "3003" }, stdio: ["ignore", out, out], detached: false });
  child.unref();
  return Response.json({ ok: true, spawned: true, pid: child.pid });
}
