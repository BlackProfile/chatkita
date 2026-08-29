"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  History,
  Lock,
  MessageCircleMore,
  MessagesSquare,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { AdminPanel } from "@/components/chat/AdminPanel";
import { Messenger } from "@/components/chat/Messenger";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type View = "home" | "chat" | "admin";

export default function Page() {
  const [view, setView] = useState<View>("home");
  const isChatView = view !== "home";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ------------------------------ Header ------------------------------ */}
      <header className="z-40 shrink-0 border-b bg-background/80 backdrop-blur">
        <div
          className={cn(
            "mx-auto flex h-16 w-full items-center justify-between px-4",
            isChatView ? "max-w-none" : "max-w-5xl"
          )}
        >
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
            {isChatView ? (
              <Button variant="ghost" className="h-11" onClick={() => setView("home")}>
                ← Beranda
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {/* ------------------------------- Main ------------------------------- */}
      <main
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isChatView ? "overflow-hidden" : "overflow-y-auto"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {view === "home" ? (
            <motion.div
              key="home"
              className="flex flex-1 flex-col"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mx-auto w-full max-w-3xl px-4 py-10">
                <div className="text-center">
                  <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                    Chatting simpel, langsung terhubung.
                  </h1>
                  <p className="mt-3 text-balance text-muted-foreground">
                    Masuk dengan namamu dan ngobrol real-time dengan Admin —
                    privat 1-on-1, rasanya seperti aplikasi chat biasa.
                  </p>
                </div>

                <Card className="mx-auto mt-8 max-w-md rounded-2xl">
                  <CardHeader className="items-center text-center">
                    <span
                      className="mx-auto rounded-full bg-emerald-600/10 p-4 text-emerald-600"
                      aria-hidden="true"
                    >
                      <MessagesSquare className="size-7" />
                    </span>
                    <CardTitle className="text-xl">Mulai Chat</CardTitle>
                    <CardDescription>
                      Tidak perlu akun — cukup nama untuk langsung terhubung
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                      onClick={() => setView("chat")}
                    >
                      Masuk Chat
                    </Button>
                    <ol className="space-y-1.5 pt-1 text-left text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-[10px] font-bold text-emerald-700">
                          1
                        </span>
                        Masukkan nama Anda
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-[10px] font-bold text-emerald-700">
                          2
                        </span>
                        Langsung terhubung dengan Admin
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-[10px] font-bold text-emerald-700">
                          3
                        </span>
                        Ngobrol real-time — pesan, status online, &amp; lampu typing
                      </li>
                    </ol>
                  </CardContent>
                </Card>

                <div className="mt-5 flex flex-col items-center gap-1.5">
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => setView("admin")}
                  >
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Masuk Admin
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Untuk pemilik — baca &amp; balas pesan semua user
                  </p>
                </div>

                <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Lock className="size-4 text-emerald-600" aria-hidden="true" />
                    Privat 1-on-1
                  </li>
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Zap className="size-4 text-emerald-600" aria-hidden="true" />
                    Real-time
                  </li>
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <History className="size-4 text-emerald-600" aria-hidden="true" />
                    Riwayat tersimpan
                  </li>
                </ul>
              </div>
            </motion.div>
          ) : null}

          {view === "chat" ? (
            <motion.div
              key="chat"
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <Messenger />
            </motion.div>
          ) : null}

          {view === "admin" ? (
            <motion.div
              key="admin"
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <AdminPanel />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      {/* ------------------------------ Footer ------------------------------ */}
      {/* Footer hanya tampil di beranda — saat chat, area chat memenuhi layar */}
      {view === "home" ? (
        <footer className="shrink-0 border-t py-4 text-center text-sm text-muted-foreground">
          © 2025 ChatKita · Chat Sederhana
        </footer>
      ) : null}
    </div>
  );
}
