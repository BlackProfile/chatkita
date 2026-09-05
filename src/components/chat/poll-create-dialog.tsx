"use client";

/**
 * v42 — dialog "Buat polling" (dipakai Messenger & AdminPanel).
 * Pertanyaan 1–200 karakter + 2–6 opsi (≤60 karakter). Submit memanggil
 * onConfirm(question, options) — pengiriman event `messages:poll_create`
 * ditangani induk (sudah punya socket + conversation aktif).
 */

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function PollCreateDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (question: string, options: string[]) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  const submit = async () => {
    if (busy) return;
    const q = question.trim();
    if (q.length < 1 || q.length > 200) {
      setError("Pertanyaan wajib 1–200 karakter.");
      return;
    }
    if (cleanOptions.length < 2) {
      setError("Isi minimal 2 opsi.");
      return;
    }
    if (cleanOptions.some((o) => o.length > 60)) {
      setError("Opsi maksimal 60 karakter.");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await onConfirm(q, cleanOptions);
    setBusy(false);
    if (ok) onClose();
    else setError("Gagal membuat polling — coba lagi.");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buat polling</DialogTitle>
          <DialogDescription>
            Semua peserta percakapan bisa memilih satu opsi; hasil tampil langsung.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="poll-q">
              Pertanyaan
            </label>
            <Input
              id="poll-q"
              value={question}
              maxLength={200}
              placeholder="mis. Rapat jam berapa?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Opsi ({cleanOptions.length}/6)
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={opt}
                    maxLength={60}
                    placeholder={`Opsi ${i + 1}`}
                    aria-label={`Opsi ${i + 1}`}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                    }
                  />
                  {options.length > 2 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Hapus opsi ${i + 1}`}
                      onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            {options.length < 6 ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setOptions((prev) => [...prev, ""])}
              >
                <Plus className="mr-1 size-3.5" aria-hidden="true" />
                Tambah opsi
              </Button>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button className="w-full" disabled={busy} onClick={() => void submit()}>
            {busy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Membuat…
              </>
            ) : (
              "Buat polling"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
