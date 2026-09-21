"use client";

/**
 * v9 — Forward a message into another conversation.
 * Only meaningful on the admin side (regular users have exactly one
 * conversation — with the Admin — so there is nothing to forward TO).
 * The parent performs the actual send; this dialog just picks a target.
 */

import { useMemo, useState } from "react";
import { Check, Forward, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { avatarColorClass, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

export interface ForwardTarget {
  id: string;
  name: string;
}

export function ForwardDialog({
  open,
  onOpenChange,
  targets,
  snippet,
  busyId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** All conversations that can receive the message (excluding the source). */
  targets: ForwardTarget[];
  /** One-line preview of the message being forwarded. */
  snippet: string;
  /** Conversation currently receiving the send (shows a spinner). */
  busyId: string | null;
  onPick: (conversationId: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? targets.filter((t) => t.name.toLowerCase().includes(q)) : targets;
  }, [filter, targets]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busyId) {
          onOpenChange(v);
          if (!v) setFilter("");
        }
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="size-5 text-emerald-600" aria-hidden="true" />
            Teruskan pesan
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {snippet}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filter}
            placeholder="Cari percakapan…"
            aria-label="Cari percakapan tujuan"
            className="h-9 pl-9"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="max-h-72 space-y-0.5 overflow-y-auto" role="listbox" aria-label="Daftar percakapan">
          {list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Tidak ada percakapan cocok.
            </p>
          ) : (
            list.map((target) => (
              <button
                key={target.id}
                type="button"
                role="option"
                aria-selected={busyId === target.id}
                disabled={!!busyId}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent",
                  busyId === target.id && "bg-accent"
                )}
                onClick={() => onPick(target.id)}
              >
                <Avatar className="size-9">
                  <AvatarFallback
                    className={cn("text-xs font-semibold text-white", avatarColorClass(target.name))}
                  >
                    {initials(target.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {target.name}
                </span>
                {busyId === target.id ? (
                  <span className="text-xs text-muted-foreground">Meneruskan…</span>
                ) : (
                  <Forward className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>

        <Button
          variant="outline"
          className="h-10"
          disabled={!!busyId}
          onClick={() => onOpenChange(false)}
        >
          <Check className="size-4" aria-hidden="true" />
          Selesai
        </Button>
      </DialogContent>
    </Dialog>
  );
}
