"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Headset,
  History,
  Lock,
  MessageCircleMore,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { AdminPanel } from "@/components/chat/AdminPanel";
import { CustomerChat } from "@/components/chat/CustomerChat";
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

type View = "home" | "customer" | "admin";

export default function Page() {
  const [view, setView] = useState<View>("home");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ------------------------------ Header ------------------------------ */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"
              aria-hidden="true"
            >
              <MessageCircleMore className="size-5" />
            </span>
            <span className="truncate text-lg font-bold tracking-tight">ChatKita</span>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Customer Service
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            {view !== "home" ? (
              <Button variant="ghost" className="h-11" onClick={() => setView("home")}>
                ← Beranda
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {/* ------------------------------- Main ------------------------------- */}
      <main className="flex flex-1 flex-col">
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
                    Butuh bantuan? Kami siap membantu.
                  </h1>
                  <p className="mt-3 text-balance text-muted-foreground">
                    Pilih peran Anda untuk melanjutkan — chat berjalan real-time dan privat.
                  </p>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  <Card className="rounded-2xl">
                    <CardHeader>
                      <span
                        className="w-fit rounded-lg bg-emerald-600/10 p-3 text-emerald-600"
                        aria-hidden="true"
                      >
                        <Headset className="size-6" />
                      </span>
                      <CardTitle className="text-xl">Saya Customer</CardTitle>
                      <CardDescription>
                        Chat privat 1-on-1 dengan tim admin kami
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
                        onClick={() => setView("customer")}
                      >
                        Mulai Chat
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl">
                    <CardHeader>
                      <span
                        className="w-fit rounded-lg bg-emerald-600/10 p-3 text-emerald-600"
                        aria-hidden="true"
                      >
                        <ShieldCheck className="size-6" />
                      </span>
                      <CardTitle className="text-xl">Saya Admin</CardTitle>
                      <CardDescription>
                        Lihat daftar customer &amp; balas pesan mereka
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        className="h-11 w-full"
                        onClick={() => setView("admin")}
                      >
                        Masuk Admin
                      </Button>
                    </CardContent>
                  </Card>
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

          {view === "customer" ? (
            <motion.div
              key="customer"
              className="flex flex-1 flex-col"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <CustomerChat />
            </motion.div>
          ) : null}

          {view === "admin" ? (
            <motion.div
              key="admin"
              className="flex flex-1 flex-col"
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
      <footer className="mt-auto border-t py-4 text-center text-sm text-muted-foreground">
        © 2025 ChatKita · Demo Customer Service
      </footer>
    </div>
  );
}
