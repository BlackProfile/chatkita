"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Clock,
  Database,
  Flag,
  History,
  Loader2,
  Megaphone,
  Plus,
  ScrollText,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatChatTime } from "@/lib/chat-utils";
import type {
  AckOf,
  AuditAck,
  ConversationOverview,
  EditHistoryAck,
  ExportAck,
  FlaggedListAck,
  ForensicsAck,
  QuickRepliesAck,
  SearchAck,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

/**
 * v11 — kumpulan dialog "Intelijen & moderasi" admin: forensik (pesan
 * terhapus + pesan ditandai + riwayat edit), pencarian pesan global,
 * audit log, kata terlarang, balasan cepat, last seen palsu. Semua
 * berkomunikasi lewat socket admin yang sudah terautentikasi.
 */

/** Unduh `content` sebagai Blob (ekspor chat / data user). */
export function downloadTextFile(
  fileName: string,
  content: string,
  mime: string
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
};

const relTime = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "baru saja";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
};

/* ------------------------------------------------------------------ */
/* Dialog konfirmasi generik (aksi destruktif)                         */
/* ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Ya, lanjutkan",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-10"
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            className={cn(
              "h-10",
              destructive
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-emerald-600 text-white hover:bg-emerald-600/90"
            )}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Riwayat edit satu pesan                                             */
/* ------------------------------------------------------------------ */

export function EditHistoryDialog({
  messageId,
  socket,
  onClose,
}: {
  messageId: number;
  socket: Socket | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<EditHistoryAck["items"] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const t = setTimeout(() => {
      socket.emit(
        "admin:edit_history",
        { messageId },
        (res: AckOf<EditHistoryAck>) => {
          if (res.ok) setItems(res.items);
          else setFailed(true);
        }
      );
    }, 0);
    return () => clearTimeout(t);
  }, [socket, messageId]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-emerald-600" aria-hidden="true" />
            Riwayat edit
          </DialogTitle>
          <DialogDescription>
            Pesan #{messageId} — revisi dari terlama ke terbaru.
          </DialogDescription>
        </DialogHeader>
        {items === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {failed ? "Gagal memuat riwayat." : "Memuat…"}
          </p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada riwayat revisi (direkam sejak v11).
          </p>
        ) : (
          <ol className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="rounded-lg border p-2.5">
                <p className="whitespace-pre-wrap break-words text-sm">{it.text}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {fmtDateTime(it.at)}
                  {i === items.length - 1 ? " · versi lama" : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Forensik: pesan terhapus + pesan ditandai                           */
/* ------------------------------------------------------------------ */

const TYPE_ICONS: Record<string, string> = {
  text: "💬",
  image: "📷",
  voice: "🎤",
  file: "📎",
  system: "⚙️",
};

export function ForensicsDialog({
  open,
  onOpenChange,
  socket,
  conversations,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  conversations: ConversationOverview[];
  onNotice?: (text: string) => void;
}) {
  const [tab, setTab] = useState<"terhapus" | "ditandai">("terhapus");
  const [deleted, setDeleted] = useState<ForensicsAck["items"] | null>(null);
  const [flagged, setFlagged] = useState<FlaggedListAck["items"] | null>(null);
  const [convFilter, setConvFilter] = useState("");
  const [histId, setHistId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !socket) return;
    const t = setTimeout(() => {
      socket.emit("admin:forensics", {}, (res: AckOf<ForensicsAck>) => {
        if (res.ok) setDeleted(res.items);
      });
      socket.emit("admin:flagged_list", {}, (res: AckOf<FlaggedListAck>) => {
        if (res.ok) setFlagged(res.items);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, socket]);

  const convName = (id: string): string =>
    conversations.find((c) => c.id === id)?.partner.name ?? id.slice(0, 10);

  const deletedItems = (deleted ?? []).filter(
    (it) => !convFilter || it.conversationId === convFilter
  );

  const moderateDelete = (messageId: number) => {
    socket?.emit("admin:delete_message", { messageId });
    setFlagged((prev) =>
      prev ? prev.map((it) => (it.messageId === messageId ? { ...it, deletedAt: new Date().toISOString() } : it)) : prev
    );
    setDeleted((prev) =>
      prev
        ? prev.some((it) => it.messageId === messageId)
          ? prev
          : [
              {
                messageId,
                conversationId: "",
                senderName: "",
                type: "text",
                content: "",
                createdAt: new Date().toISOString(),
                deletedAt: new Date().toISOString(),
              },
              ...prev,
            ].slice(0, 100)
        : prev
    );
    onNotice?.("Pesan dihapus (moderasi)");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-emerald-600" aria-hidden="true" />
              Forensik
            </DialogTitle>
            <DialogDescription>
              Pesan terhapus (isi asli tersimpan) dan pesan yang ditandai kata terlarang.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1">
            {(
              [
                { key: "terhapus", label: "Terhapus" },
                { key: "ditandai", label: "Ditandai" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium",
                  tab === t.key
                    ? "bg-emerald-600 text-white"
                    : "bg-muted/60 text-muted-foreground hover:bg-accent"
                )}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
            {tab === "terhapus" && conversations.length > 0 ? (
              <select
                value={convFilter}
                aria-label="Filter percakapan"
                className="ml-auto h-8 rounded-lg border bg-background px-2 text-xs"
                onChange={(e) => setConvFilter(e.target.value)}
              >
                <option value="">Semua percakapan</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.partner.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="max-h-96 min-h-40 space-y-2 overflow-y-auto">
            {tab === "terhapus" ? (
              deleted === null ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>
              ) : deletedItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Tidak ada pesan terhapus.
                </p>
              ) : (
                deletedItems.map((it) => (
                  <button
                    key={it.messageId}
                    type="button"
                    className="w-full rounded-xl border p-2.5 text-left transition-colors hover:bg-accent"
                    onClick={() => setHistId(it.messageId)}
                  >
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span aria-hidden="true">{TYPE_ICONS[it.type] ?? "💬"}</span>
                      <span className="font-medium text-foreground">{it.senderName}</span>
                      {it.conversationId ? <span>· {convName(it.conversationId)}</span> : null}
                      <span className="ml-auto">{formatChatTime(it.deletedAt)}</span>
                    </p>
                    <p className="mt-1 break-words text-sm">
                      {it.content || <span className="italic text-muted-foreground">(tanpa teks)</span>}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Dihapus {relTime(it.deletedAt)} · ketuk untuk riwayat edit
                    </p>
                  </button>
                ))
              )
            ) : flagged === null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>
            ) : flagged.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Belum ada pesan ditandai.
              </p>
            ) : (
              flagged.map((it) => (
                <div key={it.messageId} className="rounded-xl border p-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="h-5 border-amber-500/60 px-1.5 text-[10px] text-amber-600">
                      <Flag className="mr-0.5 size-2.5" aria-hidden="true" />
                      {it.keyword}
                    </Badge>
                    <span className="font-medium text-foreground">{it.senderName}</span>
                    <span className="ml-auto">{formatChatTime(it.createdAt)}</span>
                  </p>
                  <p className="mt-1 break-words text-sm">{it.snippet}</p>
                  {!it.deletedAt ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1.5 h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => moderateDelete(it.messageId)}
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      Hapus (moderasi)
                    </Button>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">Pesan sudah dihapus</p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      {histId !== null ? (
        <EditHistoryDialog
          messageId={histId}
          socket={socket}
          onClose={() => setHistId(null)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pencarian pesan global                                              */
/* ------------------------------------------------------------------ */

function Highlight({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-300/60 px-0.5 text-foreground dark:bg-amber-500/40">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchMessagesDialog({
  open,
  onOpenChange,
  socket,
  onJump,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  /** Buka percakapan hasil yang diketuk. */
  onJump: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchAck["items"] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = () => {
    const q = query.trim();
    if (!socket || q.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    socket.emit("admin:search", { query: q }, (res: AckOf<SearchAck>) => {
      setSearching(false);
      if (res.ok) setItems(res.items);
      else setError("Pencarian gagal, coba lagi.");
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setQuery("");
          setItems(null);
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4 text-emerald-600" aria-hidden="true" />
            Pencarian pesan
          </DialogTitle>
          <DialogDescription>
            Cari teks di semua percakapan (2–100 karakter).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <Input
            value={query}
            maxLength={100}
            placeholder="Kata kunci…"
            aria-label="Kata kunci pencarian"
            className="h-10"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="submit"
            className="h-10 bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={query.trim().length < 2 || searching}
          >
            {searching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Cari"}
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {items !== null ? (
          items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Tidak ada hasil untuk “{query.trim()}”.
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <button
                  key={it.messageId}
                  type="button"
                  className="w-full rounded-xl border p-2.5 text-left transition-colors hover:bg-accent"
                  onClick={() => onJump(it.conversationId)}
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{it.senderName}</span>
                    <span>di {it.conversationName}</span>
                    <span className="ml-auto">{formatChatTime(it.createdAt)}</span>
                  </p>
                  <p className="mt-1 break-words text-sm">
                    <Highlight text={it.snippet} query={query.trim()} />
                  </p>
                  <p className="mt-1 text-[10px] text-emerald-600">Ketuk untuk buka percakapan →</p>
                </button>
              ))}
            </div>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

const AUDIT_LABELS: Record<string, string> = {
  freeze: "Bekukan akun",
  mute: "Bisukan",
  slowmode: "Mode lambat",
  mediablock: "Blokir media",
  kick: "Paksa keluar",
  ghost: "Mode hantu",
  delete_message: "Hapus pesan",
  reset_conversation: "Reset chat",
  broadcast: "Siaran",
  settings: "Pengaturan aplikasi",
  backup: "Backup JSON",
  vacuum: "Kompres VACUUM",
  export_conversation: "Ekspor chat",
  export_user: "Ekspor data user",
  always_online: "Selalu online",
  fake_last_seen: "Last seen palsu",
  mirror: "Mode cermin",
  quick_replies: "Balasan cepat",
  keywords: "Kata terlarang",
};

function AuditIcon({ action, className }: { action: string; className?: string }) {
  const cls = className ?? "size-3.5";
  if (
    ["freeze", "mute", "slowmode", "mediablock", "kick", "delete_message", "reset_conversation"].includes(action)
  ) {
    return <ShieldAlert className={cn(cls, "text-rose-500")} aria-hidden="true" />;
  }
  if (["backup", "vacuum", "export_conversation", "export_user"].includes(action)) {
    return <Database className={cn(cls, "text-sky-500")} aria-hidden="true" />;
  }
  if (action === "broadcast") {
    return <Megaphone className={cn(cls, "text-amber-500")} aria-hidden="true" />;
  }
  if (action === "ghost") {
    return <ScrollText className={cn(cls, "text-violet-500")} aria-hidden="true" />;
  }
  if (action === "keywords") {
    return <Flag className={cn(cls, "text-amber-500")} aria-hidden="true" />;
  }
  return <Settings2 className={cn(cls, "text-muted-foreground")} aria-hidden="true" />;
}

export function AuditLogDialog({
  open,
  onOpenChange,
  socket,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
}) {
  const [items, setItems] = useState<AuditAck["items"] | null>(null);

  useEffect(() => {
    if (!open || !socket) return;
    const t = setTimeout(() => {
      socket.emit("admin:audit", { limit: 100 }, (res: AckOf<AuditAck>) => {
        if (res.ok) setItems(res.items);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, socket]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-emerald-600" aria-hidden="true" />
            Audit log
          </DialogTitle>
          <DialogDescription>
            100 aksi admin terbaru (terbaru dulu) — tercatat otomatis di server.
          </DialogDescription>
        </DialogHeader>
        {items === null ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Belum ada aksi tercatat.
          </p>
        ) : (
          <ol className="max-h-96 space-y-1.5 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border p-2">
                <span className="mt-0.5 shrink-0">
                  <AuditIcon action={it.action} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {AUDIT_LABELS[it.action] ?? it.action}
                  </p>
                  <p className="break-words text-[11px] text-muted-foreground">{it.detail}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground" title={fmtDateTime(it.at)}>
                  {relTime(it.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Kata terlarang                                                      */
/* ------------------------------------------------------------------ */

export function KeywordsDialog({
  open,
  onOpenChange,
  socket,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  onNotice?: (text: string) => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !socket || loaded) return;
    const t = setTimeout(() => {
      socket.emit("admin:keywords:get", {}, (res: AckOf<QuickRepliesAck>) => {
        if (res.ok) setItems(res.items);
        setLoaded(true);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, socket, loaded]);

  const add = () => {
    const v = draft.trim();
    if (!v || v.length > 60 || items.length >= 50 || items.some((k) => k.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    setItems((prev) => [...prev, v]);
    setDraft("");
  };

  const save = () => {
    if (!socket || saving) return;
    setSaving(true);
    socket.emit("admin:keywords:set", { items }, (res: AckOf<QuickRepliesAck>) => {
      setSaving(false);
      if (res.ok) {
        setItems(res.items);
        onNotice?.(`Kata terlarang tersimpan (${res.items.length}) ✓`);
        onOpenChange(false);
      } else {
        onNotice?.("Gagal menyimpan kata terlarang");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setDraft("");
          setLoaded(false);
        }
      }}
    >
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-4 text-emerald-600" aria-hidden="true" />
            Kata terlarang
          </DialogTitle>
          <DialogDescription>
            Pesan yang cocok ditandai diam-diam (tidak diblokir) dan muncul di Forensik → Ditandai.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={60}
            placeholder="Tambah kata…"
            aria-label="Kata baru"
            className="h-10"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            disabled={!draft.trim()}
            onClick={add}
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Belum ada kata. Contoh: scam, judi, toxik.
          </p>
        ) : (
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {items.map((k) => (
              <span
                key={k}
                className="flex h-7 items-center gap-1 rounded-full border bg-muted/60 pl-2.5 pr-1 text-xs"
              >
                {k}
                <button
                  type="button"
                  aria-label={`Hapus kata ${k}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  onClick={() => setItems((prev) => prev.filter((x) => x !== k))}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            className="h-10 bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={saving}
            onClick={save}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Balasan cepat                                                       */
/* ------------------------------------------------------------------ */

export function QuickRepliesDialog({
  open,
  onOpenChange,
  socket,
  onNotice,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  onNotice?: (text: string) => void;
  onSaved?: (items: string[]) => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !socket || loaded) return;
    const t = setTimeout(() => {
      socket.emit("admin:quick_replies:get", {}, (res: AckOf<QuickRepliesAck>) => {
        if (res.ok) setItems(res.items);
        setLoaded(true);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, socket, loaded]);

  const upsert = () => {
    const v = draft.trim();
    if (!v || v.length > 200) return;
    setItems((prev) =>
      prev.includes(v) ? prev : [...prev, v].slice(0, 20)
    );
    setDraft("");
  };

  const save = () => {
    if (!socket || saving) return;
    setSaving(true);
    socket.emit("admin:quick_replies:set", { items }, (res: AckOf<QuickRepliesAck>) => {
      setSaving(false);
      if (res.ok) {
        setItems(res.items);
        onSaved?.(res.items);
        onNotice?.(`Balasan cepat tersimpan (${res.items.length}) ✓`);
        onOpenChange(false);
      } else {
        onNotice?.("Gagal menyimpan balasan cepat");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setDraft("");
          setLoaded(false);
        }
      }}
    >
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-emerald-600" aria-hidden="true" />
            Balasan cepat
          </DialogTitle>
          <DialogDescription>
            Maksimal 20 template (masing-masing ≤200 karakter). Muncul sebagai chip di atas kotak tulis.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={200}
            placeholder="Tulis balasan…"
            aria-label="Balasan baru"
            className="h-10"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                upsert();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            disabled={!draft.trim()}
            onClick={upsert}
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Belum ada template.
          </p>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {items.map((q) => (
              <li key={q} className="flex items-center gap-2 rounded-lg border p-2">
                <p className="min-w-0 flex-1 break-words text-xs">{q}</p>
                <button
                  type="button"
                  aria-label={`Edit balasan ${q}`}
                  className="shrink-0 text-[10px] text-emerald-600 hover:underline"
                  onClick={() => {
                    setItems((prev) => prev.filter((x) => x !== q));
                    setDraft(q);
                  }}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  aria-label={`Hapus balasan ${q}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  onClick={() => setItems((prev) => prev.filter((x) => x !== q))}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            className="h-10 bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={saving}
            onClick={save}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Last seen palsu                                                     */
/* ------------------------------------------------------------------ */

export function FakeLastSeenDialog({
  open,
  onOpenChange,
  socket,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socket: Socket | null;
  onNotice?: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = (v: string) => {
    if (!socket || saving) return;
    setSaving(true);
    socket.emit("admin:fake_last_seen", { value: v }, (res: AckOf<ExportAck>) => {
      setSaving(false);
      if (res.ok) {
        onNotice?.(v ? `Last seen palsu aktif: “${v}”` : "Last seen palsu dikosongkan");
        onOpenChange(false);
      } else {
        onNotice?.("Gagal menyimpan");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setValue("");
      }}
    >
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-emerald-600" aria-hidden="true" />
            Last seen palsu
          </DialogTitle>
          <DialogDescription>
            Teks singkat (≤40 karakter) yang LIHAT USER sebagai status terakhir lihat Admin.
            Kosongkan untuk mematikan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="fake-last-seen">Teks last seen</Label>
          <Input
            id="fake-last-seen"
            value={value}
            maxLength={40}
            placeholder="cth. baru saja online"
            className="h-10"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(value.trim());
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="h-10"
            disabled={saving}
            onClick={() => submit("")}
          >
            Kosongkan
          </Button>
          <Button
            className="h-10 bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={saving || !value.trim()}
            onClick={() => submit(value.trim())}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

