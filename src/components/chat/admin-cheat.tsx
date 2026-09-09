"use client";

/**
 * v25 — Pusat Cheat (tab Cheat di Dashboard Aplikasi).
 *
 * v46 — KONSOLIDASI: seluruh logika & UI cheat dipindah ke cheat-core.tsx
 * (CheatBody) yang juga dipakai dialog 🎭 di toolbar percakapan admin.
 * Komponen ini kini hanya: kartu info + pemilih user + CheatBody.
 */

import { useState } from "react";
import type { Socket } from "socket.io-client";
import { Users, Wand2 } from "lucide-react";

import { CheatBody } from "@/components/chat/cheat-core";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardUserRow } from "@/lib/chat-types";

const ADMIN_USER_ID = "admin";

export function AdminCheat({
  socket,
  users,
}: {
  socket: Socket | null;
  users: DashboardUserRow[];
}) {
  const targets = users.filter((u) => u.id !== ADMIN_USER_ID);
  const [selUserId, setSelUserId] = useState("");
  const selUser = targets.find((u) => u.id === selUserId) ?? null;

  return (
    <div className="space-y-3">
      {/* Info utama */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm shadow-purple-600/25"
        >
          <Wand2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Pusat Cheat</p>
            <Badge className="bg-violet-600 text-white">Admin only</Badge>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Semua fitur cheat dalam satu tempat: kirim pesan sebagai user lain
            (bisa dibackdate), edit/hapus pesan siapa saja, reaksi atas nama user,
            ubah waktu pesan, dan sinyal ilusi. Setiap aksi tercatat di jejak audit.
          </p>
        </div>
      </div>

      {/* Pilih target */}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Users className="size-3.5" aria-hidden="true" />
          Target user (percakapan user ↔ Admin)
        </Label>
        <Select value={selUserId} onValueChange={setSelUserId}>
          <SelectTrigger className="h-10 w-full" aria-label="Pilih user target cheat">
            <SelectValue placeholder="Pilih user…" />
          </SelectTrigger>
          <SelectContent>
            {targets.length === 0 ? (
              <SelectItem value="__kosong" disabled>
                Belum ada user
              </SelectItem>
            ) : (
              targets.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                  {u.online ? " · online" : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {!selUser ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Pilih user untuk memuat pesannya, lalu jalankan cheat apa pun di bawah.
          </p>
        ) : null}
      </div>

      {/* Isi cheat — SATU sumber bersama dialog 🎭 (v46). */}
      {selUser ? (
        <CheatBody key={selUser.id} socket={socket} target={{ id: selUser.id, name: selUser.name }} />
      ) : null}
    </div>
  );
}
