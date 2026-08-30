"use client";

import { useSyncExternalStore } from "react";
import { MessageCircleMore } from "lucide-react";

import { AdminPanel } from "@/components/chat/AdminPanel";
import { Messenger } from "@/components/chat/Messenger";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";

type View = "loading" | "chat" | "admin";

/**
 * ChatKita — shell satu halaman.
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
      {/* ------------------------------ Header ------------------------------ */}
      <header className="z-40 shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-none items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"
              aria-hidden="true"
            >
              <MessageCircleMore className="size-5" />
            </span>
            <span className="truncate text-lg font-bold tracking-tight">ChatKita</span>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Chat 1-on-1
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ------------------------------- Main ------------------------------- */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "chat" ? <Messenger /> : view === "admin" ? <AdminPanel /> : null}
      </main>
    </div>
  );
}
