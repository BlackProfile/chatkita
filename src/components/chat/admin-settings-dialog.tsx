"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Socket } from "socket.io-client";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isSoundOn, setSoundOn } from "@/lib/chat-notify";
import type { AckOf, ServiceSettings, SettingsAck } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/**
 * Admin service settings: operating hours, AI assistant + knowledge base,
 * outside-hours notice, quick reply templates, and the local sound toggle.
 */
export function AdminSettingsDialog({
  open,
  onOpenChange,
  socketRef,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socketRef: React.RefObject<Socket | null>;
  onSaved: (s: ServiceSettings) => void;
}) {
  const [draft, setDraft] = useState<ServiceSettings | null>(null);
  const [sound, setSound] = useState(() => isSoundOn());
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  // Mounted only while open — state is fresh on every remount.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("admin:getsettings", {}, (res: AckOf<SettingsAck>) => {
      if (res.ok) setDraft(res.settings);
    });
  }, [socketRef]);

  const patch = (p: Partial<ServiceSettings>) =>
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));

  const save = () => {
    const socket = socketRef.current;
    if (!socket || !draft) return;
    setSaving(true);
    socket.emit("admin:settings", { settings: draft }, (res: AckOf<SettingsAck>) => {
      setSaving(false);
      if (res.ok) {
        onSaved(res.settings);
        setDraft(res.settings);
        setSavedOnce(true);
        setTimeout(() => onOpenChange(false), 600);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl chat-scroll">
        <DialogHeader>
          <DialogTitle>Pengaturan Layanan</DialogTitle>
          <DialogDescription>
            Jam operasional, asisten AI, dan template balasan cepat.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="space-y-5">
            {/* Operating hours */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Jam operasional</p>
                  <p className="text-xs text-muted-foreground">
                    Di luar jam ini, pengumuman otomatis + AI menjawab (waktu Bangkok).
                  </p>
                </div>
                <Switch
                  checked={draft.hours.enabled}
                  onCheckedChange={(v) => patch({ hours: { ...draft.hours, enabled: v } })}
                  aria-label="Aktifkan jam operasional"
                />
              </div>
              {draft.hours.enabled ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={draft.hours.start}
                      aria-label="Jam mulai"
                      className="h-9"
                      onChange={(e) =>
                        patch({ hours: { ...draft.hours, start: e.target.value } })
                      }
                    />
                    <span className="text-xs text-muted-foreground">s/d</span>
                    <Input
                      type="time"
                      value={draft.hours.end}
                      aria-label="Jam selesai"
                      className="h-9"
                      onChange={(e) => patch({ hours: { ...draft.hours, end: e.target.value } })}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DAY_LABELS.map((label, idx) => {
                      const active = draft.hours.days.includes(idx);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={active}
                          className={cn(
                            "h-8 rounded-full border px-3 text-xs",
                            active
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "text-muted-foreground hover:bg-accent"
                          )}
                          onClick={() => {
                            const days = active
                              ? draft.hours.days.filter((d) => d !== idx)
                              : [...draft.hours.days, idx].sort((a, b) => a - b);
                            if (days.length > 0)
                              patch({ hours: { ...draft.hours, days } });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="outside-msg">Pengumuman di luar jam</Label>
                    <Textarea
                      id="outside-msg"
                      rows={2}
                      value={draft.outsideMsg}
                      onChange={(e) => patch({ outsideMsg: e.target.value })}
                    />
                  </div>
                </>
              ) : null}
            </section>

            {/* AI assistant */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">🤖 Asisten AI</p>
                  <p className="text-xs text-muted-foreground">
                    Menjawab otomatis saat Admin offline, plus saran balasan & ringkasan.
                  </p>
                </div>
                <Switch
                  checked={draft.aiEnabled}
                  onCheckedChange={(v) => patch({ aiEnabled: v })}
                  aria-label="Aktifkan asisten AI"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-kb">Basis pengetahuan AI</Label>
                <Textarea
                  id="ai-kb"
                  rows={4}
                  value={draft.aiKb}
                  placeholder="Jelaskan produk/jam buka/kebijakan agar AI bisa menjawab…"
                  onChange={(e) => patch({ aiKb: e.target.value })}
                />
              </div>
            </section>

            {/* Quick replies */}
            <section className="space-y-2">
              <p className="text-sm font-medium">Balasan cepat</p>
              <div className="space-y-2">
                {draft.quickReplies.map((qr, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={qr.label}
                      aria-label={`Label balasan ${idx + 1}`}
                      className="h-9 w-28 shrink-0"
                      maxLength={40}
                      onChange={(e) => {
                        const next = [...draft.quickReplies];
                        next[idx] = { ...next[idx], label: e.target.value };
                        patch({ quickReplies: next });
                      }}
                    />
                    <Input
                      value={qr.text}
                      aria-label={`Isi balasan ${idx + 1}`}
                      className="h-9 flex-1"
                      maxLength={300}
                      onChange={(e) => {
                        const next = [...draft.quickReplies];
                        next[idx] = { ...next[idx], text: e.target.value };
                        patch({ quickReplies: next });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Hapus balasan ${idx + 1}`}
                      onClick={() =>
                        patch({
                          quickReplies: draft.quickReplies.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {draft.quickReplies.length < 20 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() =>
                    patch({
                      quickReplies: [...draft.quickReplies, { label: "Baru", text: "" }],
                    })
                  }
                >
                  <Plus className="mr-1 size-3.5" aria-hidden="true" />
                  Tambah template
                </Button>
              ) : null}
            </section>

            {/* SLA alert (v5) */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">⏰ Batas tunggu (SLA)</p>
                  <p className="text-xs text-muted-foreground">
                    Alarm + badge merah jika pelanggan menunggu lebih dari X menit.
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={240}
                  value={draft.slaMinutes}
                  aria-label="Batas tunggu dalam menit"
                  className="h-9 w-24"
                  onChange={(e) =>
                    patch({ slaMinutes: Math.min(240, Math.max(1, Number(e.target.value) || 1)) })
                  }
                />
              </div>
            </section>

            {/* Chatbot menu (v5) */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">📋 Menu chatbot</p>
                  <p className="text-xs text-muted-foreground">
                    Tombol jawaban instan di chat pelanggan — aktif bahkan saat Anda online.
                  </p>
                </div>
                <Switch
                  checked={draft.chatMenuEnabled}
                  onCheckedChange={(v) => patch({ chatMenuEnabled: v })}
                  aria-label="Aktifkan menu chatbot"
                />
              </div>
              {draft.chatMenuEnabled ? (
                <div className="space-y-2">
                  {draft.chatMenuItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={item.label}
                        aria-label={`Label menu ${idx + 1}`}
                        className="h-9 w-32 shrink-0"
                        maxLength={60}
                        placeholder="Label tombol"
                        onChange={(e) => {
                          const next = [...draft.chatMenuItems];
                          next[idx] = { ...next[idx], label: e.target.value };
                          patch({ chatMenuItems: next });
                        }}
                      />
                      <Input
                        value={item.answer}
                        aria-label={`Jawaban menu ${idx + 1}`}
                        className="h-9 flex-1"
                        maxLength={500}
                        placeholder="Jawaban otomatis"
                        onChange={(e) => {
                          const next = [...draft.chatMenuItems];
                          next[idx] = { ...next[idx], answer: e.target.value };
                          patch({ chatMenuItems: next });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Hapus menu ${idx + 1}`}
                        onClick={() =>
                          patch({
                            chatMenuItems: draft.chatMenuItems.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {draft.chatMenuItems.length < 12 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        patch({
                          chatMenuItems: [...draft.chatMenuItems, { label: "", answer: "" }],
                        })
                      }
                    >
                      <Plus className="mr-1 size-3.5" aria-hidden="true" />
                      Tambah item menu
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* Pre-chat topics (v5) */}
            <section className="space-y-1.5">
              <Label htmlFor="pre-chat-topics">Topik form login (opsional)</Label>
              <Input
                id="pre-chat-topics"
                value={draft.preChatTopics}
                placeholder="cth. Tanya produk, Komplain, Lainnya — pisahkan dengan koma"
                onChange={(e) => patch({ preChatTopics: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Kosongkan untuk menyembunyikan pilihan topik di layar masuk pelanggan.
              </p>
            </section>

            {/* Sound */}
            <section className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">🔊 Suara notifikasi</p>
                <p className="text-xs text-muted-foreground">Bunyi saat ada pesan masuk.</p>
              </div>
              <Switch
                checked={sound}
                onCheckedChange={(v) => {
                  setSound(v);
                  setSoundOn(v);
                }}
                aria-label="Suara notifikasi"
              />
            </section>

            <Button
              className="h-10 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
              disabled={saving}
              onClick={save}
            >
              {savedOnce ? "Tersimpan ✓" : saving ? "Menyimpan…" : "Simpan pengaturan"}
            </Button>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
