"use client";

/**
 * v38 — Pusat Cheat PER-USER, dibuka langsung dari toolbar percakapan admin
 * (pill "🎭 Cheat").
 *
 * v46 — KONSOLIDASI: seluruh logika & UI cheat dipindah ke cheat-core.tsx
 * (CheatBody) yang juga dipakai tab Cheat di dashboard. Komponen ini kini
 * hanya bingkai dialog; target otomatis = partner percakapan aktif.
 */

import type { Socket } from "socket.io-client";
import { Wand2 } from "lucide-react";

import { CheatBody, type CheatTarget } from "@/components/chat/cheat-core";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type { CheatTarget as UserCheatTarget };

export function UserCheatDialog({
  target,
  onClose,
  socket,
}: {
  target: CheatTarget | null;
  onClose: () => void;
  socket: Socket | null;
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="rounded-2xl">
        {target ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white"
                >
                  <Wand2 className="size-4" />
                </span>
                <span className="min-w-0 truncate">Cheat {target.name}</span>
                <Badge className="bg-violet-600 text-white">Ter-audit</Badge>
              </DialogTitle>
              <DialogDescription>
                Semua aksi cheat untuk user ini dalam satu tempat — kirim pesan sebagai
                dia, edit/hapus/ubah waktu pesannya, bereaksi atas namanya, dan sinyal
                ilusi. Setiap aksi tercatat di jejak audit server.
              </DialogDescription>
            </DialogHeader>
            <CheatBody key={target.id} socket={socket} target={target} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
