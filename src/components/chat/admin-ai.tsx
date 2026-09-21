"use client";

/**
 * v41 — Paket AI khusus Admin (Task 60-a).
 *
 * Semua pemanggilan AI (LLM/ASR/TTS/VLM/Text-to-Image) dijalankan di
 * chat-service lewat event socket `admin:ai_*` (adminGuard + audit) —
 * SDK z-ai-web-dev-sdk TIDAK pernah dipakai di klien.
 *
 * Isi dialog (5 tab):
 *  - Ringkasan   : ringkasan percakapan aktif oleh AI.
 *  - Asisten     : chat bebas dengan "ChatKita AI".
 *  - Cari media  : cari foto lewat bahasa sehari-hari (VLM + LLM ranking).
 *  - Gambar      : buat gambar dari teks, pratinjau, kirim ke percakapan.
 *  - Moderasi    : moderasi otomatis pesan user (blok / sensor).
 *
 * Dilengkap AISuggestChips: 3 saran balasan pintar di atas kotak ketik.
 */

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Loader2, RefreshCw, Search, Send, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ----------------------------- tipe protokol ----------------------------- */

export interface AdminAIChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface AdminAIModerationState {
  enabled: boolean;
  mode: "block" | "censor";
}

export interface AdminAIMediaHit {
  messageId: number;
  conversationId: string;
  mediaUrl: string;
  fileName: string;
  senderName: string;
  createdAt: string;
  caption: string;
}

export interface AdminAIImagePreview {
  prompt: string;
  size: string;
  imageBase64: string;
}

type Ack = { ok: boolean; error?: string };

/* ------------------------------- util emit ------------------------------- */

/** Promisified socket.emit — SELALU resolve (ack server dipercaya ada). */
function emitAck<T extends Ack>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload ?? {}, (res: T) => resolve(res ?? ({ ok: false } as T)));
  });
}

const AI_IMAGE_SIZES = [
  { value: "1024x1024", label: "Persegi (1024×1024)" },
  { value: "1344x768", label: "Lanskap (1344×768)" },
  { value: "768x1344", label: "Potret (768×1344)" },
] as const;

/* ================================================================ */
/* Dialog utama AI                                                    */
/* ================================================================ */

export function AdminAIDialog({
  open,
  onClose,
  socket,
  conversationId,
  partnerName,
  onOpenMedia,
}: {
  open: boolean;
  onClose: () => void;
  socket: Socket | null;
  conversationId: string | null;
  partnerName: string;
  onOpenMedia: (hit: AdminAIMediaHit) => void;
}) {
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  const [assistantMsgs, setAssistantMsgs] = useState<AdminAIChatMsg[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);

  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaHits, setMediaHits] = useState<AdminAIMediaHit[] | null>(null);
  const [mediaScanned, setMediaScanned] = useState(0);
  const [mediaBusy, setMediaBusy] = useState(false);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<string>("1024x1024");
  const [imagePreview, setImagePreview] = useState<AdminAIImagePreview | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageSending, setImageSending] = useState(false);

  const [modState, setModState] = useState<AdminAIModerationState>({
    enabled: false,
    mode: "censor",
  });
  const [modLoaded, setModLoaded] = useState(false);

  /* Muat ulang status moderasi saat dialog dibuka. */
  useEffect(() => {
    if (!open || !socket || modLoaded) return;
    let alive = true;
    void emitAck<{ ok: boolean; state?: AdminAIModerationState }>(
      socket,
      "admin:ai_moderation"
    ).then((res) => {
      if (!alive) return;
      if (res.ok && res.state) setModState(res.state);
      setModLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [open, socket, modLoaded]);

  const runSummary = async () => {
    if (!socket || !conversationId || summarizing) return;
    setSummarizing(true);
    setSummary("");
    const res = await emitAck<{ ok: boolean; summary?: string; error?: string }>(
      socket,
      "admin:ai_summary",
      { conversationId }
    );
    setSummarizing(false);
    if (res.ok && res.summary) setSummary(res.summary);
    else toast.error(deskripsiError(res.error, "Ringkasan gagal dibuat"));
  };

  const sendAssistant = async () => {
    const text = assistantInput.trim();
    if (!socket || !text || assistantBusy) return;
    const history = [...assistantMsgs, { role: "user" as const, content: text }].slice(-20);
    setAssistantMsgs(history);
    setAssistantInput("");
    setAssistantBusy(true);
    const res = await emitAck<{ ok: boolean; reply?: string; error?: string }>(
      socket,
      "admin:ai_assistant",
      { history }
    );
    setAssistantBusy(false);
    if (res.ok && res.reply) {
      setAssistantMsgs((prev) => [...prev, { role: "assistant", content: res.reply as string }]);
    } else {
      toast.error(deskripsiError(res.error, "ChatKita AI tidak bisa menjawab"));
    }
  };

  const searchMedia = async () => {
    const q = mediaQuery.trim();
    if (!socket || !q || mediaBusy) return;
    setMediaBusy(true);
    const res = await emitAck<{
      ok: boolean;
      hits?: AdminAIMediaHit[];
      scanned?: number;
      error?: string;
    }>(socket, "admin:ai_media_search", { query: q });
    setMediaBusy(false);
    if (res.ok) {
      setMediaHits(res.hits ?? []);
      setMediaScanned(res.scanned ?? 0);
      if ((res.hits ?? []).length === 0) toast.info("Tidak ada foto yang cocok");
    } else {
      toast.error(deskripsiError(res.error, "Pencarian media gagal"));
    }
  };

  const generateImage = async () => {
    const prompt = imagePrompt.trim();
    if (!socket || !prompt || imageBusy) return;
    setImageBusy(true);
    setImagePreview(null);
    const res = await emitAck<{ ok: boolean; imageBase64?: string; error?: string }>(
      socket,
      "admin:ai_image_generate",
      { prompt, size: imageSize }
    );
    setImageBusy(false);
    if (res.ok && res.imageBase64) {
      setImagePreview({ prompt, size: imageSize, imageBase64: res.imageBase64 });
    } else {
      toast.error(deskripsiError(res.error, "Gagal membuat gambar"));
    }
  };

  const sendImage = async () => {
    if (!socket || !conversationId || !imagePreview || imageSending) return;
    setImageSending(true);
    const res = await emitAck<{ ok: boolean; error?: string }>(socket, "admin:ai_image_send", {
      conversationId,
      prompt: imagePreview.prompt,
      size: imagePreview.size,
    });
    setImageSending(false);
    if (res.ok) {
      toast.success("Gambar AI terkirim ke percakapan");
      setImagePreview(null);
    } else {
      toast.error(deskripsiError(res.error, "Gagal mengirim gambar"));
    }
  };

  const toggleModeration = async (enabled: boolean) => {
    if (!socket) return;
    const res = await emitAck<{ ok: boolean; state?: AdminAIModerationState; error?: string }>(
      socket,
      "admin:ai_moderation",
      { enabled }
    );
    if (res.ok && res.state) {
      setModState(res.state);
      toast.success(res.state.enabled ? "Moderasi AI aktif" : "Moderasi AI dimatikan");
    } else {
      toast.error(deskripsiError(res.error, "Gagal mengubah moderasi"));
    }
  };

  const changeMode = async (mode: "block" | "censor") => {
    if (!socket) return;
    const res = await emitAck<{ ok: boolean; state?: AdminAIModerationState; error?: string }>(
      socket,
      "admin:ai_moderation",
      { mode }
    );
    if (res.ok && res.state) setModState(res.state);
    else toast.error(deskripsiError(res.error, "Gagal mengubah mode"));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-emerald-600" aria-hidden="true" />
            Asisten AI Admin
          </DialogTitle>
          <DialogDescription>
            AI khusus admin — {conversationId ? `percakapan dengan ${partnerName}` : "pilih percakapan dulu untuk fitur konteks"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ringkasan" className="gap-3">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="ringkasan" className="text-[11px]">Ringkasan</TabsTrigger>
            <TabsTrigger value="asisten" className="text-[11px]">Asisten</TabsTrigger>
            <TabsTrigger value="media" className="text-[11px]">Cari Media</TabsTrigger>
            <TabsTrigger value="gambar" className="text-[11px]">Gambar</TabsTrigger>
            <TabsTrigger value="moderasi" className="text-[11px]">Moderasi</TabsTrigger>
          </TabsList>

          {/* ------------------------- RINGKASAN ------------------------- */}
          <TabsContent value="ringkasan" className="space-y-3">
            <Button
              size="sm"
              className="w-full"
              disabled={!socket || !conversationId || summarizing}
              onClick={() => void runSummary()}
            >
              {summarizing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  AI sedang membaca percakapan…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" aria-hidden="true" />
                  Ringkas percakapan ini
                </>
              )}
            </Button>
            {summary ? (
              <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">
                {summary}
              </div>
            ) : null}
          </TabsContent>

          {/* -------------------------- ASISTEN -------------------------- */}
          <TabsContent value="asisten" className="space-y-3">
            <div className="max-h-72 min-h-40 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              {assistantMsgs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Tanya apa saja pada <span className="font-medium">ChatKita AI</span> —
                  riwayat tersimpan selama dialog terbuka.
                </p>
              ) : (
                assistantMsgs.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                      m.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-background"
                    )}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {assistantBusy ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ChatKita AI mengetik…
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Input
                value={assistantInput}
                placeholder="Tanya ChatKita AI…"
                aria-label="Pertanyaan untuk AI"
                disabled={!socket || assistantBusy}
                onChange={(e) => setAssistantInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendAssistant();
                  }
                }}
              />
              <Button
                size="icon"
                aria-label="Kirim pertanyaan"
                disabled={!socket || assistantBusy || !assistantInput.trim()}
                onClick={() => void sendAssistant()}
              >
                <Send className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </TabsContent>

          {/* ------------------------ CARI MEDIA ------------------------- */}
          <TabsContent value="media" className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={mediaQuery}
                placeholder="mis. foto pantai, makanan, kucing…"
                aria-label="Kata kunci pencarian media"
                disabled={!socket || mediaBusy}
                onChange={(e) => setMediaQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void searchMedia();
                  }
                }}
              />
              <Button
                size="icon"
                aria-label="Cari media"
                disabled={!socket || mediaBusy || !mediaQuery.trim()}
                onClick={() => void searchMedia()}
              >
                {mediaBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            {mediaHits && mediaHits.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {mediaHits.length} foto cocok · {mediaScanned} foto diperiksa — ketuk untuk
                  membuka
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {mediaHits.map((hit) => (
                    <button
                      key={hit.messageId}
                      type="button"
                      className="group overflow-hidden rounded-lg border text-left transition-colors hover:border-emerald-600"
                      onClick={() => onOpenMedia(hit)}
                    >
                      {hit.mediaUrl ? (
                        <img
                          src={hit.mediaUrl}
                          alt={hit.caption || hit.fileName}
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
                          tanpa pratinjau
                        </div>
                      )}
                      <div className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                        {hit.senderName} · {hit.caption || hit.fileName}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : mediaHits && mediaHits.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Tidak ada foto yang cocok dengan “{mediaQuery}”.
              </p>
            ) : null}
          </TabsContent>

          {/* -------------------------- GAMBAR --------------------------- */}
          <TabsContent value="gambar" className="space-y-3">
            <Textarea
              value={imagePrompt}
              placeholder="Deskripsikan gambar yang mau dibuat…"
              aria-label="Deskripsi gambar"
              rows={2}
              disabled={!socket || imageBusy}
              onChange={(e) => setImagePrompt(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={imageSize}
                aria-label="Ukuran gambar"
                disabled={imageBusy}
                onChange={(e) => setImageSize(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {AI_IMAGE_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!socket || imageBusy || !imagePrompt.trim()}
                onClick={() => void generateImage()}
              >
                {imageBusy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    Membuat…
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 size-4" aria-hidden="true" />
                    Buat gambar
                  </>
                )}
              </Button>
            </div>
            {imagePreview ? (
              <div className="space-y-2">
                <img
                  src={`data:image/png;base64,${imagePreview.imageBase64}`}
                  alt={`Hasil AI: ${imagePreview.prompt}`}
                  className="mx-auto max-h-80 rounded-lg border"
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!conversationId || imageSending}
                  onClick={() => void sendImage()}
                >
                  {imageSending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      Mengirim…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 size-4" aria-hidden="true" />
                      Kirim ke percakapan {partnerName ? `dengan ${partnerName}` : ""}
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </TabsContent>

          {/* ------------------------- MODERASI -------------------------- */}
          <TabsContent value="moderasi" className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Moderasi otomatis AI</p>
                <p className="text-xs text-muted-foreground">
                  Pesan teks user diperiksa AI setelah terkirim.
                </p>
              </div>
              <Switch
                checked={modState.enabled}
                disabled={!socket || !modLoaded}
                onCheckedChange={(v) => void toggleModeration(v)}
                aria-label="Aktifkan moderasi AI"
              />
            </div>
            <div
              className={cn(
                "grid grid-cols-2 gap-2",
                !modState.enabled && "pointer-events-none opacity-50"
              )}
              role="radiogroup"
              aria-label="Mode moderasi AI"
            >
              <button
                type="button"
                role="radio"
                aria-checked={modState.mode === "censor"}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  modState.mode === "censor"
                    ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950"
                    : "hover:bg-accent"
                )}
                onClick={() => void changeMode("censor")}
              >
                <span className="font-medium">Sensor ***</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Kata terlarang diganti *** otomatis.
                </p>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={modState.mode === "block"}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  modState.mode === "block"
                    ? "border-red-600 bg-red-50 dark:bg-red-950"
                    : "hover:bg-accent"
                )}
                onClick={() => void changeMode("block")}
              >
                <span className="font-medium text-red-700 dark:text-red-300">Blok pesan</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pesan dihapus, pengirim diberi tahu.
                </p>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Bila AI tidak bisa dihubungi, pesan tetap lolos (fail-open). Semua aksi
              dicatat di audit log.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ */
/* Saran balasan pintar (chip di atas kotak ketik admin)              */
/* ================================================================ */

export function AISuggestChips({
  socket,
  conversationId,
  connected,
  onPick,
}: {
  socket: Socket | null;
  conversationId: string | null;
  connected: boolean;
  onPick: (text: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const lastConvRef = useRef<string | null>(null);

  /* Muat saran saat percakapan berganti / tombol muat-ulang ditekan. */
  useEffect(() => {
    if (!socket || !conversationId || !connected) return;
    const changed = lastConvRef.current !== conversationId;
    lastConvRef.current = conversationId;
    if (!changed && tick === 0) return; // percakapan sama & belum minta refresh
    let alive = true;
    // queueMicrotask: setState tidak boleh dipanggil sinkron di badan effect.
    queueMicrotask(() => {
      if (alive) setBusy(true);
    });
    void emitAck<{ ok: boolean; suggestions?: string[] }>(socket, "admin:ai_suggest", {
      conversationId,
    }).then((res) => {
      if (!alive) return;
      setBusy(false);
      if (res.ok && res.suggestions) setSuggestions(res.suggestions.slice(0, 3));
    });
    return () => {
      alive = false;
    };
  }, [socket, conversationId, connected, tick]);

  if (!conversationId) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 pb-1"
      aria-label="Saran balasan AI"
    >
      <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <Sparkles className="size-3" aria-hidden="true" />
        Saran AI
      </span>
      {busy && suggestions.length === 0 ? (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          menyiapkan…
        </span>
      ) : null}
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          className="h-7 shrink-0 rounded-full border bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-emerald-600 hover:text-foreground"
          onClick={() => onPick(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Muat ulang saran AI"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        disabled={busy}
        onClick={() => {
          setSuggestions([]);
          setTick((t) => t + 1);
        }}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/* ------------------------------- util kecil ------------------------------ */

function deskripsiError(error: string | undefined, fallback: string): string {
  switch (error) {
    case "AI_UNAVAILABLE":
      return "Layanan AI sedang tidak bisa dihubungi — coba lagi.";
    case "NOT_FOUND":
      return "Data tidak ditemukan.";
    case "FORBIDDEN":
      return "Tidak diizinkan.";
    default:
      return error ? `${fallback} (${error})` : fallback;
  }
}
