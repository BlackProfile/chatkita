"use client";

/**
 * v9 — App Lock: optional screen lock protected by a 4–8 digit PIN.
 *
 * - The PIN never leaves the browser: localStorage stores a salted
 *   SHA-256 hash (WebCrypto) per scope ("user" | "admin").
 * - Locks when: the user taps "Kunci sekarang", the tab stays hidden for
 *   ≥ 30 s, or there is no interaction for 5 minutes.
 * - The overlay blocks the whole app until the PIN is entered; "Keluar"
 *   is the escape hatch (clears the session AND the lock so nobody gets
 *   permanently locked out of their own device).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, LockKeyhole, LogOut } from "lucide-react";

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
import { appLockKey } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

interface LockConfig {
  salt: string;
  hash: string;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readLockConfig(scope: string): LockConfig | null {
  try {
    const raw = window.localStorage.getItem(appLockKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockConfig> | null;
    if (parsed && typeof parsed.salt === "string" && typeof parsed.hash === "string") {
      return { salt: parsed.salt, hash: parsed.hash };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeLockConfig(scope: string, config: LockConfig | null): void {
  try {
    if (config) window.localStorage.setItem(appLockKey(scope), JSON.stringify(config));
    else window.localStorage.removeItem(appLockKey(scope));
  } catch {
    /* ignore */
  }
}

/** PIN state machine + auto-lock triggers shared by both sides. */
export function useAppLock(scope: string) {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the stored config (also syncs when another tab changes it).
  useEffect(() => {
    const sync = () => setEnabled(readLockConfig(scope) !== null);
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [scope]);

  const lockNow = useCallback(() => {
    if (readLockConfig(scope)) setLocked(true);
  }, [scope]);

  /** Force-remove the overlay (used together with logout). */
  const forceUnlock = useCallback(() => setLocked(false), []);

  const unlock = useCallback(
    async (pin: string): Promise<boolean> => {
      const config = readLockConfig(scope);
      if (!config) {
        setLocked(false);
        return true;
      }
      const hash = await sha256Hex(`${config.salt}:${pin}`);
      if (hash === config.hash) {
        setLocked(false);
        return true;
      }
      return false;
    },
    [scope]
  );

  const savePin = useCallback(
    async (pin: string): Promise<void> => {
      const salt = crypto.randomUUID();
      writeLockConfig(scope, { salt, hash: await sha256Hex(`${salt}:${pin}`) });
      setEnabled(true);
    },
    [scope]
  );

  const removePin = useCallback(() => {
    writeLockConfig(scope, null);
    setEnabled(false);
    setLocked(false);
  }, [scope]);

  // Auto-lock: tab hidden ≥ 30 s, or 5 minutes without interaction.
  useEffect(() => {
    if (!enabled) return;
    const IDLE_MS = 5 * 60_000;
    const HIDDEN_MS = 30_000;
    const armIdle = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setLocked(true), IDLE_MS);
    };
    const reset = () => armIdle();
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else if (
        hiddenAtRef.current &&
        Date.now() - hiddenAtRef.current >= HIDDEN_MS
      ) {
        setLocked(true);
      }
      hiddenAtRef.current = null;
      armIdle();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    armIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [enabled]);

  return { enabled, locked, lockNow, forceUnlock, unlock, savePin, removePin };
}

/** Full-screen PIN gate. Renders nothing while unlocked. */
export function AppLockOverlay({
  locked,
  unlock,
  onLogout,
}: {
  locked: boolean;
  unlock: (pin: string) => Promise<boolean>;
  onLogout: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!locked) return null;

  const submit = async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    const ok = await unlock(pin);
    setBusy(false);
    if (ok) {
      setPin("");
      setError(false);
    } else {
      setError(true);
      setPin("");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 px-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="Layar terkunci"
    >
      <div className="w-full max-w-xs rounded-2xl border bg-card p-6 text-center shadow-xl">
        <span
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600"
          aria-hidden="true"
        >
          <LockKeyhole className="size-7" />
        </span>
        <h2 className="mt-3 text-lg font-semibold">Chat terkunci</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Masukkan PIN untuk membuka kembali.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            placeholder="••••"
            aria-label="PIN"
            className={cn("h-11 text-center tracking-[0.4em]", error && "border-destructive")}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setError(false);
            }}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              PIN salah — coba lagi.
            </p>
          ) : null}
          <Button
            type="submit"
            className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={busy || pin.length < 4}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Buka"}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="mt-2 h-10 w-full text-muted-foreground hover:text-destructive"
          onClick={onLogout}
        >
          <LogOut className="size-4" aria-hidden="true" />
          Keluar dari akun
        </Button>
      </div>
    </motion.div>
  );
}

/** Set / change / remove the app-lock PIN. Mounted only while open. */
export function AppLockSetupDialog({
  open,
  onOpenChange,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (pin: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) {
      setError("PIN harus 4–8 angka.");
      return;
    }
    if (pin !== confirmPin) {
      setError("Konfirmasi PIN tidak sama.");
      return;
    }
    setBusy(true);
    await onSave(pin);
    setBusy(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-5 text-emerald-600" aria-hidden="true" />
            Kunci Layar (App Lock)
          </DialogTitle>
          <DialogDescription>
            Layar akan terkunci otomatis saat aplikasi dibiarkan 5 menit atau
            tab disembunyikan ≥ 30 detik. PIN hanya tersimpan di perangkat ini.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="applock-pin">PIN baru (4–8 angka)</Label>
            <Input
              id="applock-pin"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              placeholder="••••"
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="applock-confirm">Ulangi PIN</Label>
            <Input
              id="applock-confirm"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={confirmPin}
              placeholder="••••"
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
              disabled={busy || !pin || !confirmPin}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                "Aktifkan"
              )}
            </Button>
            <Button variant="outline" className="h-10" disabled={busy} onClick={onRemove}>
              Hapus
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
