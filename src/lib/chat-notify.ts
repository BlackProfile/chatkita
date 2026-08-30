/**
 * ChatKita notification helpers — new-message blip + unread tab title.
 * No assets: the blip is synthesized with WebAudio. All functions are
 * no-ops on the server / when the browser blocks audio.
 */

import { CHAT_SOUND_KEY } from "./chat-types";

let audioCtx: AudioContext | null = null;

/** Whether the user's mute preference allows sound (default: on). */
export function isSoundOn(): boolean {
  try {
    return window.localStorage.getItem(CHAT_SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(CHAT_SOUND_KEY);
    else window.localStorage.setItem(CHAT_SOUND_KEY, "off");
  } catch {
    /* private mode — ignore */
  }
}

/** Short two-tone "blip" (E6 → A6). Respects the mute preference. */
export function playBlip(): void {
  if (!isSoundOn()) return;
  try {
    type Ctx = AudioContext & { webkitAudioContext?: unknown };
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();

    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1318.5, t0); // E6
    osc.frequency.setValueAtTime(1760, t0 + 0.09); // A6
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + 0.24);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch {
    /* audio unavailable — silent */
  }
}

const BASE_TITLE = "ChatKita — Chat Sederhana";

/** `(n) ChatKita…` while unread; plain title when n <= 0. */
export function setTitleUnread(n: number): void {
  if (typeof document === "undefined") return;
  document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
}
