"use client";

/**
 * Web Push + PWA helpers (v5).
 *
 * - Registers /sw.js (push display + notification click focus).
 * - Subscribes the browser to push and hands the subscription to the
 *   chat-service via the `push:subscribe` socket event.
 * - Captures the beforeinstallprompt event so login screens can offer a
 *   one-tap "Install aplikasi" button.
 *
 * Everything degrades silently: no service worker support / permission
 * denied / no VAPID key → the app simply keeps working without push.
 */

import type { Socket } from "socket.io-client";

export type InstallPromptState = {
  available: boolean;
  promptInstall: () => void;
};

let deferredPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
const listeners = new Set<(available: boolean) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as Event & { prompt: () => Promise<void> };
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn(false));
  });
}

/** Subscribe to install-availability changes; returns an unsubscribe fn. */
export function onInstallAvailability(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  fn(deferredPrompt !== null);
  return () => listeners.delete(fn);
}

/** Show the browser install dialog. Returns false when unavailable. */
export function promptInstall(): boolean {
  if (!deferredPrompt) return false;
  void deferredPrompt.prompt();
  deferredPrompt = null;
  listeners.forEach((fn) => fn(false));
  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Register the service worker (idempotent). Best effort. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      // Some sandbox gateways serve plain http — SW still works on
      // http://localhost only, so skip elsewhere instead of throwing.
      return null;
    }
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/**
 * Full push opt-in for the current user: register SW → ask permission →
 * subscribe → deliver the subscription to the server. Called after a
 * successful login (user side and admin side).
 */
export async function subscribeToPush(
  socket: Socket,
  vapidPublicKey: string
): Promise<void> {
  try {
    if (!vapidPublicKey || typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!("Notification" in window)) return;

    const registration = await ensureServiceWorker();
    if (!registration) return;

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      }));
    if (!subscription) return;

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

    socket.emit("push:subscribe", {
      subscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
    });
  } catch {
    /* push is a bonus — never break the chat over it */
  }
}
