"use client";

import { useSyncExternalStore } from "react";

import { AdminPanel } from "@/components/chat/AdminPanel";
import { Messenger } from "@/components/chat/Messenger";

type View = "loading" | "chat" | "admin";

/**
 * ChatKita — shell satu halaman, tanpa header global (setiap view punya
 * header-nya sendiri; tombol tema ada di header chat/panel admin).
 *
 * - `/`          : halaman publik. Langsung form nama → chat 1-on-1 dengan
 *                  Admin (tidak ada landing page, tidak ada link admin).
 * - `/?admin`    : panel Admin (tersembunyi — TIDAK ditautkan di UI publik).
 * - `/#admin`    : alternatif akses admin via hash.
 */

const emptySubscribe = () => () => {};

/** Client snapshot: admin hanya bila URL meminta secara eksplisit. */
function getClientView(): View {
  if (typeof window === "undefined") return "loading";
  const adminByQuery = new URLSearchParams(window.location.search).has("admin");
  const adminByHash = window.location.hash.replace(/^#/, "") === "admin";
  return adminByQuery || adminByHash ? "admin" : "chat";
}

/** Server/prerender snapshot: netral sampai hidrasi selesai. */
const getServerView = (): View => "loading";

export default function Page() {
  const view = useSyncExternalStore(emptySubscribe, getClientView, getServerView);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "chat" ? <Messenger /> : view === "admin" ? <AdminPanel /> : null}
      </main>
    </div>
  );
}
