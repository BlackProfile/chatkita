"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import type { Socket } from "socket.io-client";

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
import type { ChatErrorAck, SearchAck, SearchUser, StartConversationAck } from "@/lib/chat-types";
import { avatarColorClass, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socket: Socket | null;
  /** Called after a conversation exists (new or already existing). */
  onStarted: (conversationId: string) => void;
}

/**
 * "Chat Baru" dialog: search users by name and start a 1-on-1
 * conversation with one of them.
 */
export function NewChatDialog({ open, onOpenChange, socket, onStarted }: NewChatDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Reset state when the dialog closes (via any close path). */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setResults([]);
      setError(null);
      setStartingId(null);
    }
    onOpenChange(next);
  };

  /* Debounced search. Empty query lists recent users (server-side). */
  useEffect(() => {
    if (!open || !socket) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      socket.emit("users:search", { query }, (res: SearchAck | ChatErrorAck) => {
        setSearching(false);
        if (res.ok) {
          setResults(res.users);
        } else {
          setResults([]);
          setError("Gagal mencari pengguna.");
        }
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, socket]);

  const handleStart = (userId: string) => {
    if (!socket) return;
    setStartingId(userId);
    setError(null);
    socket.emit("conversations:start", { userId }, (res: StartConversationAck | ChatErrorAck) => {
      if (res.ok) {
        onOpenChange(false);
        onStarted(res.conversation.id);
      } else {
        setStartingId(null);
        setError(
          res.error === "FORBIDDEN"
            ? "Tidak bisa chat dengan diri sendiri."
            : res.error === "NOT_FOUND"
              ? "Pengguna tidak ditemukan."
              : "Gagal memulai percakapan."
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-600" aria-hidden="true" />
            Chat Baru
          </DialogTitle>
          <DialogDescription>
            Cari nama seseorang untuk memulai percakapan 1-on-1
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            placeholder="Cari nama… (kosongkan untuk lihat semua)"
            aria-label="Cari pengguna"
            autoFocus
            className="h-11 pl-9"
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="max-h-72 overflow-y-auto">
          {searching ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Mencari…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "Tidak ada pengguna dengan nama itu."
                : "Belum ada pengguna lain. Buka tab baru dan daftar dengan nama lain."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={startingId !== null}
                    onClick={() => handleStart(u.id)}
                    className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
                  >
                    <span className="relative shrink-0">
                      <Avatar className="size-10">
                        <AvatarFallback
                          className={cn(
                            "text-sm font-semibold text-white",
                            avatarColorClass(u.name)
                          )}
                        >
                          {initials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        aria-label={u.online ? "Online" : "Offline"}
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background",
                          u.online ? "bg-emerald-500" : "bg-muted-foreground/40"
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {startingId === u.id ? "Membuka…" : u.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          Tutup
        </Button>
      </DialogContent>
    </Dialog>
  );
}
