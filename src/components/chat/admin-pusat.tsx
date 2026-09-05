"use client";

import { useRef, useState, useEffect } from "react";
import type { Socket } from "socket.io-client";
import {
  Download,
  FileJson,
  Landmark,
  Loader2,
  RotateCcw,
  Save,
  ShieldAlert,
  TriangleAlert,
  Upload,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AckOf,
  AdminAutoBackupGetAck,
  AdminAutoBackupNowAck,
  AdminResetAllAck,
  AdminRestoreAck,
  BackupAck,
} from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * v20 — tab "Pusat" di Dashboard Aplikasi: pusat kendali data aplikasi.
 * - Backup  : unduh JSON penuh (pengguna, percakapan, pesan, pengaturan).
 * - Pemulihan: impor file backup (metadata — file media tidak ikut).
 * - Reset   : hapus SELURUH data chat + file media (akun Admin tetap).
 * Setiap aksi tercatat di jejak audit. Setelah reset/pemulihan server
 * menyiarkan `app:reset` sehingga semua klien memuat ulang otomatis.
 */

interface ParsedBackup {
  data: Record<string, unknown>;
  exportedAt: string;
  version: string;
  users: number;
  conversations: number;
  messages: number;
  settings: number;
}

type PusatBusy = "backup" | "restore" | "reset" | "autobackup" | null;

export function AdminPusat({
  socket,
  version,
}: {
  socket: Socket | null;
  version: string;
}) {
  const [busy, setBusy] = useState<PusatBusy>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<ParsedBackup | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* v43 — backup otomatis terjadwal (jam WIB bisa diubah admin). */
  const [autoAt, setAutoAt] = useState("");
  const [autoLast, setAutoLast] = useState<AdminAutoBackupGetAck["lastRun"]>(null);

  useEffect(() => {
    if (!socket) return;
    const onAutoBackup = (p: { ok: boolean; at: string }) => {
      setAutoLast((prev) =>
        prev ? { ...prev, ok: p.ok, at: p.at, detail: p.ok ? "OK" : "GAGAL" } : {
          at: p.at,
          ok: p.ok,
          detail: p.ok ? "OK" : "GAGAL",
        }
      );
      setNotice({
        ok: p.ok,
        text: p.ok ? "Backup otomatis (berlapis) selesai." : "Backup otomatis (berlapis) GAGAL — cek log server.",
      });
    };
    socket.on("admin:auto_backup", onAutoBackup);
    return () => {
      socket.off("admin:auto_backup", onAutoBackup);
    };
  }, [socket]);

  /* Muat status jadwal saat tab dibuka / socket siap. */
  useEffect(() => {
    if (!socket) return;
    socket.emit("admin:auto_backup_get", {}, (res: AckOf<AdminAutoBackupGetAck>) => {
      if (res.ok) {
        setAutoAt(res.at);
        setAutoLast(res.lastRun);
      }
    });
  }, [socket]);

  const downloadBackup = () => {
    if (!socket || busy) return;
    setBusy("backup");
    setNotice(null);
    socket.emit("admin:backup", {}, (res: AckOf<BackupAck>) => {
      setBusy(null);
      if (!res.ok) {
        setNotice({ ok: false, text: "Gagal membuat backup." });
        return;
      }
      try {
        const blob = new Blob([JSON.stringify(res, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chatkita-backup-${res.exportedAt.slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setNotice({
          ok: true,
          text: `Backup diunduh (${res.messages.length} pesan, ${res.conversations.length} percakapan, ${res.users.length} pengguna).`,
        });
      } catch {
        setNotice({ ok: false, text: "Gagal menyimpan file backup." });
      }
    });
  };

  const onPickFile = async (file: File | undefined | null) => {
    if (!file) return;
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.users)) {
        setNotice({ ok: false, text: "File bukan backup ChatKita yang valid." });
        return;
      }
      setPendingRestore({
        data: parsed,
        exportedAt:
          typeof parsed.exportedAt === "string" ? parsed.exportedAt : "tidak diketahui",
        version: typeof parsed.version === "string" ? parsed.version : "?",
        users: parsed.users.length,
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations.length : 0,
        messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
        settings: Array.isArray(parsed.settings) ? parsed.settings.length : 0,
      });
    } catch {
      setNotice({ ok: false, text: "Gagal membaca file JSON." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmRestore = () => {
    const target = pendingRestore;
    if (!target || !socket || busy) return;
    setBusy("restore");
    socket.emit(
      "admin:restore",
      { backup: target.data },
      (res: AckOf<AdminRestoreAck>) => {
        setBusy(null);
        setPendingRestore(null);
        if (!res.ok) {
          setNotice({ ok: false, text: "Pemulihan gagal — format backup tidak sesuai." });
          return;
        }
        setNotice({
          ok: true,
          text: `Pemulihan selesai: ${res.restored.messages} pesan, ${res.restored.conversations} percakapan, ${res.restored.users} pengguna. Aplikasi dimuat ulang…`,
        });
      }
    );
  };

  const confirmReset = () => {
    if (!socket || busy) return;
    setBusy("reset");
    setResetOpen(false);
    socket.emit("admin:reset_all", {}, (res: AckOf<AdminResetAllAck>) => {
      setBusy(null);
      if (!res.ok) {
        setNotice({ ok: false, text: "Reset gagal — coba lagi." });
        return;
      }
      setNotice({
        ok: true,
        text: `Reset selesai: ${res.deleted.messages} pesan, ${res.deleted.conversations} percakapan, ${res.deleted.users} pengguna dihapus; ${res.mediaFiles} file media (${formatFileSize(res.freedBytes)}) dibebaskan. Aplikasi dimuat ulang…`,
      });
    });
  };

  /* v43 — simpan jam backup otomatis (WIB). */
  const saveAutoAt = () => {
    if (!socket || busy) return;
    const v = autoAt.trim();
    if (v !== "" && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(v)) {
      setNotice({ ok: false, text: "Format jam salah — pakai HH:MM (contoh 03:07)." });
      return;
    }
    setBusy("autobackup");
    socket.emit("admin:settings:set", { autoBackupAt: v }, (res: AckOf<{ ok: true }> | { ok: false; error?: string }) => {
      setBusy(null);
      if (!res.ok) {
        setNotice({ ok: false, text: "Gagal menyimpan jadwal backup otomatis." });
        return;
      }
      setNotice({ ok: true, text: `Jadwal backup otomatis disimpan: ${v === "" ? "03:07 (default)" : v} WIB.` });
    });
  };

  /* v43 — jalankan backup berlapis sekarang. */
  const runBackupNow = () => {
    if (!socket || busy) return;
    setBusy("autobackup");
    socket.emit("admin:auto_backup_now", {}, (res: AckOf<AdminAutoBackupNowAck>) => {
      setBusy(null);
      setNotice({
        ok: res.ok,
        text: res.ok ? "Backup dimulai — hasil menyusul." : "Backup masih berjalan — tunggu sebentar.",
      });
    });
  };

  return (
    <div className="space-y-3">
      {/* Info pusat kendali */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25"
        >
          <Landmark className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Pusat Aplikasi</p>
            <Badge className="bg-emerald-600 text-white">v{version.replace(/^v/, "")}</Badge>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Kendali data aplikasi: backup, pemulihan, dan reset. Semua aksi tercatat
            di jejak audit (tab Sistem). File media tidak ikut dalam backup —
            hanya metadata pesannya.
          </p>
        </div>
      </div>

      {/* Backup */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileJson className="size-3.5" aria-hidden="true" />
          Backup data
        </p>
        <p className="text-xs text-muted-foreground">
          Unduh seluruh isi aplikasi sebagai satu file JSON: pengguna, percakapan,
          pesan, dan pengaturan. Simpan file ini di tempat aman.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          onClick={downloadBackup}
          disabled={busy !== null}
        >
          {busy === "backup" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Unduh backup JSON
        </Button>
      </div>

      {/* v43 — Backup otomatis terjadwal */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Save className="size-3.5" aria-hidden="true" />
          Backup otomatis terjadwal
        </p>
        <p className="text-xs text-muted-foreground">
          Setiap hari pada jam WIB yang dipilih, server menjalankan backup
          berlapis (git bundle + tar media) ke /home/z/backups/. Default 03:07.
        </p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              id="auto-backup-at"
              value={autoAt}
              onChange={(e) => setAutoAt(e.target.value)}
              placeholder="03:07"
              inputMode="numeric"
              maxLength={5}
              className="h-9"
              aria-label="Jam backup otomatis (WIB)"
            />
            <p className="text-[11px] text-muted-foreground">
              Format HH:MM WIB. Terakhir dijalankan:{" "}
              {autoLast
                ? `${new Date(autoLast.at).toLocaleString("id-ID")} — ${autoLast.ok ? "✅" : "❌"}`
                : "belum pernah"}
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-9" onClick={saveAutoAt} disabled={busy !== null}>
            <Save className="size-4" aria-hidden="true" />
            Simpan
          </Button>
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={runBackupNow} disabled={busy !== null}>
          {busy === "autobackup" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Jalankan backup sekarang
        </Button>
      </div>

      {/* Pemulihan */}
      <div className="space-y-2.5 rounded-xl border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Upload className="size-3.5" aria-hidden="true" />
          Pemulihan backup
        </p>
        <p className="text-xs text-muted-foreground">
          Pulihkan dari file backup. Data saat ini akan DIGANTI dengan isi file —
          gunakan hanya jika benar-benar diperlukan.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0])}
          aria-label="Pilih file backup JSON"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          <Upload className="size-4" aria-hidden="true" />
          Pilih file backup (.json)
        </Button>
      </div>

      {/* Reset */}
      <div className="space-y-2.5 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/50 dark:bg-red-950/30">
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          Reset aplikasi
        </p>
        <p className="text-xs text-red-700/80 dark:text-red-400/80">
          Menghapus SEMUA pesan, percakapan, pengguna (akun Admin tetap), pengaturan,
          dan file media. Tindakan ini tidak bisa dibatalkan — unduh backup dulu
          bila ragu.
        </p>
        <Button
          size="sm"
          variant="destructive"
          className="h-9"
          onClick={() => setResetOpen(true)}
          disabled={busy !== null}
        >
          {busy === "reset" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="size-4" aria-hidden="true" />
          )}
          Reset aplikasi sekarang
        </Button>
      </div>

      {notice ? (
        <p
          className={cn(
            "rounded-xl border px-3 py-2 text-xs font-medium",
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
          )}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}

      {/* Konfirmasi pemulihan */}
      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-600" aria-hidden="true" />
              Pulihkan backup ini?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Backup dibuat {pendingRestore?.exportedAt ?? "—"} (versi{" "}
                  {pendingRestore?.version ?? "?"}):
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                  <li>{pendingRestore?.users ?? 0} pengguna</li>
                  <li>{pendingRestore?.conversations ?? 0} percakapan</li>
                  <li>{pendingRestore?.messages ?? 0} pesan</li>
                  <li>{pendingRestore?.settings ?? 0} pengaturan</li>
                </ul>
                <p className="font-medium text-foreground">
                  Semua data saat ini akan DIGANTI. File media lama mungkin tidak
                  tersedia lagi.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmRestore();
              }}
              disabled={busy !== null}
              className="bg-amber-600 text-white hover:bg-amber-600/90"
            >
              {busy === "restore" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, pulihkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi reset */}
      <AlertDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!open) setResetOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-red-600" aria-hidden="true" />
              Reset seluruh aplikasi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Semua pesan, percakapan, pengguna (kecuali Admin), pengaturan, dan
              file media akan DIHAPUS PERMANEN. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmReset();
              }}
              disabled={busy !== null}
              className="bg-red-600 text-white hover:bg-red-600/90"
            >
              {busy === "reset" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, reset semuanya
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
