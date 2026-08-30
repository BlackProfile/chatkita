"use client";

/**
 * useVoiceRecorder — microphone capture via MediaRecorder, exposed as a
 * tiny state machine: idle → recording → (result | cancelled).
 * Produces a base64 data URL the chat-service accepts for voice messages.
 * The stream is ALWAYS torn down on stop/cancel/unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceRecording {
  dataUrl: string;
  durationMs: number;
}

type RecorderState = { phase: "idle" } | { phase: "error"; message: string };

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const resolveRef = useRef<((r: VoiceRecording | null) => void) | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setElapsedMs(0);
  }, []);

  useEffect(
    () => () => {
      // Unmount mid-recording → abort silently (no result).
      resolveRef.current = null;
      try {
        recorderRef.current?.stop();
      } catch {
        /* already stopped */
      }
    },
    []
  );

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const resolve = resolveRef.current;
        resolveRef.current = null;
        const durationMs = Math.max(500, Date.now() - (startedAtRef.current || Date.now()));
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        teardown();
        if (!resolve) return; // cancelled
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(
            typeof reader.result === "string" && reader.result.startsWith("data:audio/")
              ? { dataUrl: reader.result, durationMs }
              : null
          );
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setElapsedMs(0);
      timerRef.current = setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        200
      );
    } catch (err) {
      teardown();
      setState({
        phase: "error",
        message:
          err instanceof Error && err.name === "NotAllowedError"
            ? "Izin mikrofon ditolak."
            : "Mikrofon tidak tersedia.",
      });
    }
  }, [teardown]);

  /** Stop and receive the recording (null when cancelled/too short). */
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    return new Promise<VoiceRecording | null>((resolve) => {
      resolveRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        resolveRef.current = null;
        teardown();
        resolve(null);
      }
    });
  }, [teardown]);

  /** Abort without producing a result. */
  const cancel = useCallback(() => {
    resolveRef.current = null;
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const clearError = useCallback(
    () => setState((s) => (s.phase === "error" ? { phase: "idle" } : s)),
    []
  );

  const error = state.phase === "error" ? state.message : null;

  return { recording, error, elapsedMs, start, stop, cancel, clearError };
}
