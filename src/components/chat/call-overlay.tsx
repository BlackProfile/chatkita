"use client";

/**
 * v44 — Call suara/video (WebRTC) antara user dan admin (1-on-1).
 *
 * Pembagian kerja:
 *  - SINYAL via socket.io chat-service — event `call:*` didaftarkan di INDUK
 *    (AdminPanel/Messenger); hook `useWebRTC` hanya menerima fungsi kirim.
 *  - MEDIA P2P langsung antar browser via RTCPeerConnection (+ STUN publik
 *    sebagai TAMBAHAN; di sandbox satu mesin host candidate langsung berhasil)
 *    — media TIDAK melewati server/gateway.
 *
 * Alur penelepon  : ring → call:answered → getUserMedia + createOffer →
 *                   call:offer → call:answer_sdp → ICE → connected.
 * Alur penerima   : call:incoming → Terima (getUserMedia dulu) → call:offer →
 *                   setRemote → createAnswer → call:answer_sdp → ICE.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { avatarColorClass, initials } from "@/lib/chat-utils";
import type { CallMedia, CallPeer, CallPhase, CallRole } from "@/lib/chat-types";

/* ------------------------------------------------------------------ */
/* State call (dipegang induk) + util                                  */
/* ------------------------------------------------------------------ */

/** Satu snapshot keadaan call yang sedang berjalan di sisi lokal. */
export interface CallState {
  callId: string;
  role: CallRole;
  peer: CallPeer;
  media: CallMedia;
  phase: CallPhase;
}

/** Label fase call untuk UI (Bahasa Indonesia). */
export function callPhaseLabel(phase: CallPhase): string {
  switch (phase) {
    case "outgoing":
      return "Memanggil…";
    case "ringing":
      return "Call masuk";
    case "connecting":
      return "Menghubungkan…";
    case "ended":
      return "Call berakhir";
    default:
      return "";
  }
}

/** Durasi call mm:ss (dipakai induk untuk elapsedLabel). */
export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* useWebRTC — RTCPeerConnection lifecycle                             */
/* ------------------------------------------------------------------ */

/** Fungsi kirim sinyal (disediakan induk — emit socket event call:*). */
export interface UseWebRTCOptions {
  /** Caller: kirim SDP offer (event call:offer). */
  sendOffer: (sdp: string) => void;
  /** Callee: kirim SDP answer (event call:answer_sdp). */
  sendAnswer: (sdp: string) => void;
  /** Kedua arah: kirim satu ICE candidate (event call:ice, JSON string). */
  sendIce: (candidate: string) => void;
  /** Media tersambung (ice/connection state 'connected') — mulai timer durasi. */
  onConnected: () => void;
  /** getUserMedia gagal (izin ditolak / perangkat tidak ada) — induk menutup call. */
  onMediaError: (message: string) => void;
  /** Elemen video lawan (video call saja). */
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Elemen video lokal PIP (video call saja). */
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Elemen audio lawan (call suara — tanpa elemen video). */
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const RTC_CONFIG: RTCConfiguration = {
  // STUN publik = TAMBAHAN (bukan pengganti host candidates — di sandbox
  // satu mesin host candidate langsung berhasil, STUN membantu lintas jaringan).
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

/** Pesan error getUserMedia dalam Bahasa Indonesia. */
const mediaErrorMessage = (err: unknown): string => {
  const name = (err as DOMException)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Izin kamera/mikrofon ditolak — izinkan akses di browser lalu coba lagi.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "Kamera/mikrofon tidak ditemukan di perangkat ini.";
  if (name === "NotReadableError")
    return "Kamera/mikrofon sedang dipakai aplikasi lain.";
  return "Gagal mengakses kamera/mikrofon.";
};

/**
 * Hook WebRTC. Objek yang dikembalikan STABIL (semua state mutable di ref);
 * `muted`/`camOff` adalah state React untuk render tombol.
 */
export function useWebRTC(options: UseWebRTCOptions) {
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  // latest-ref pattern: callback induk selalu terbaru tanpa perlu re-register.
  const optRef = useRef(options);
  useEffect(() => {
    optRef.current = options;
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  /** ICE yang datang sebelum remote description siap — diputar setelahnya. */
  const pendingIceRef = useRef<string[]>([]);
  /** Offer yang datang sebelum pc penerima siap (race Terima vs offer). */
  const pendingOfferRef = useRef<string | null>(null);
  const mediaRef = useRef<CallMedia>("audio");

  /** Tempel stream ke elemen video/audio (bila elemennya sudah ada). */
  const attachStreams = () => {
    const o = optRef.current;
    const local = localStreamRef.current;
    const remote = remoteStreamRef.current;
    if (o.localVideoRef.current && local) o.localVideoRef.current.srcObject = local;
    if (o.remoteVideoRef.current && remote) o.remoteVideoRef.current.srcObject = remote;
    if (o.remoteAudioRef.current && remote) o.remoteAudioRef.current.srcObject = remote;
  };

  /** Buat RTCPeerConnection + pasang handler track/ICE/state. */
  const ensurePc = (): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) optRef.current.sendIce(JSON.stringify(ev.candidate.toJSON()));
    };
    pc.ontrack = (ev) => {
      remoteStreamRef.current = ev.streams[0] ?? null;
      attachStreams();
    };
    const connected = () => {
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      )
        optRef.current.onConnected();
    };
    pc.onconnectionstatechange = connected;
    pc.oniceconnectionstatechange = connected;
    pcRef.current = pc;
    return pc;
  };

  /** getUserMedia + tambahkan track lokal ke pc (muted/camOff direset). */
  const prepareLocalMedia = async (media: CallMedia): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: media === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      localStreamRef.current = stream;
      mediaRef.current = media;
      setMuted(false);
      setCamOff(false);
      ensurePc();
      for (const track of stream.getTracks()) pcRef.current?.addTrack(track, stream);
      attachStreams();
      return true;
    } catch (err) {
      optRef.current.onMediaError(mediaErrorMessage(err));
      return false;
    }
  };

  const applyRemoteAndBufferedIce = async (sdp: string, type: RTCSdpType) => {
    const pc = ensurePc();
    await pc.setRemoteDescription({ type, sdp });
    const pending = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const raw of pending) {
      try {
        await pc.addIceCandidate(JSON.parse(raw));
      } catch {
        /* candidate basi — abaikan */
      }
    }
  };

  return useMemo(
    () => ({
      muted,
      camOff,
      /** Caller (setelah call:answered): media → offer → call:offer. */
      beginCaller: async (media: CallMedia) => {
        if (!(await prepareLocalMedia(media))) return false;
        const pc = ensurePc();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        optRef.current.sendOffer(pc.localDescription?.sdp ?? offer.sdp ?? "");
        return true;
      },
      /** Callee (saat klik Terima): siapkan media dulu — gagal → batal. */
      beginCallee: async (media: CallMedia) => {
        const ok = await prepareLocalMedia(media);
        // Offer yang tercepat mungkin sudah menunggu — proses sekarang.
        const pending = pendingOfferRef.current;
        pendingOfferRef.current = null;
        if (ok && pending) await applyRemoteAndBufferedIce(pending, "offer");
        return ok;
      },
      /** Callee: offer penelepon diterima (call:offer). */
      handleOffer: async (sdp: string) => {
        if (!localStreamRef.current) {
          // Media penerima belum siap (masih dialog izin) — simpan dulu.
          pendingOfferRef.current = sdp;
          return;
        }
        await applyRemoteAndBufferedIce(sdp, "offer");
        const pc = ensurePc();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        optRef.current.sendAnswer(pc.localDescription?.sdp ?? answer.sdp ?? "");
      },
      /** Caller: SDP jawaban penerima diterima (call:answer_sdp). */
      handleAnswer: async (sdp: string) => {
        await applyRemoteAndBufferedIce(sdp, "answer");
      },
      /** ICE candidate lawan diterima (call:ice, JSON string). */
      handleIce: async (candidate: string) => {
        const pc = pcRef.current;
        if (pc?.remoteDescription) {
          try {
            await pc.addIceCandidate(JSON.parse(candidate));
          } catch {
            /* candidate basi — abaikan */
          }
        } else {
          // Remote description belum ada — buffer (diputar setelah setRemote).
          pendingIceRef.current.push(candidate);
        }
      },
      toggleMute: () => {
        const next = !muted;
        setMuted(next);
        for (const track of localStreamRef.current?.getAudioTracks() ?? [])
          track.enabled = !next;
      },
      toggleCamera: () => {
        const next = !camOff;
        setCamOff(next);
        for (const track of localStreamRef.current?.getVideoTracks() ?? [])
          track.enabled = !next;
      },
      /** Hentikan semua: stop track, tutup pc, reset buffer + state. */
      stop: () => {
        for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
        localStreamRef.current = null;
        remoteStreamRef.current = null;
        pendingIceRef.current = [];
        pendingOfferRef.current = null;
        try {
          pcRef.current?.close();
        } catch {
          /* sudah tertutup */
        }
        pcRef.current = null;
        setMuted(false);
        setCamOff(false);
      },
    }),
    // muted/camOff ikut supaya toggleMute/toggleCamera melihat nilai terbaru.
    [muted, camOff]
  );
}

/* ------------------------------------------------------------------ */
/* CallOverlay — UI full-screen                                        */
/* ------------------------------------------------------------------ */

export interface CallOverlayProps {
  state: CallState;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Audio lawan (call suara — tanpa elemen video). */
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  muted: boolean;
  camOff: boolean;
  /** "02:31" saat aktif; kosong untuk fase lain (label fase dipakai). */
  elapsedLabel: string;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}

/** Overlay call full-screen (z-50) — tampil di atas chat selama call. */
export function CallOverlay({
  state,
  remoteVideoRef,
  localVideoRef,
  remoteAudioRef,
  muted,
  camOff,
  elapsedLabel,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera,
}: CallOverlayProps) {
  const { role, peer, media, phase } = state;
  const isVideo = media === "video";
  const ringing = phase === "ringing" || phase === "outgoing";
  const showControls = phase === "connecting" || phase === "active";

  const label =
    phase === "active"
      ? elapsedLabel || "00:00"
      : phase === "ringing"
        ? `Call masuk · ${isVideo ? "video" : "suara"}`
        : callPhaseLabel(phase);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-zinc-950/95 px-4 text-white backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isVideo ? "Panggilan video" : "Panggilan suara"}
    >
      {/* Media lawan: video penuh utk video call; audio tersembunyi utk suara */}
      {isVideo ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 size-full bg-black object-cover"
          aria-label={`Video dari ${peer.name}`}
        />
      ) : (
        <audio ref={remoteAudioRef} autoPlay className="hidden" aria-hidden="true" />
      )}
      {isVideo ? (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-24 right-4 z-10 h-40 w-28 rounded-xl border border-white/20 bg-black object-cover shadow-xl sm:h-48 sm:w-36"
          aria-label="Video Anda sendiri"
        />
      ) : null}

      {/* Identitas + fase (disembunyikan saat video aktif agar tidak menutupi) */}
      <div
        className={`relative z-10 flex flex-col items-center gap-4 ${
          isVideo && phase === "active" ? "opacity-0 transition-opacity" : ""
        }`}
      >
        <span className="relative flex items-center justify-center">
          {ringing ? (
            <>
              <span
                aria-hidden="true"
                className="absolute size-28 animate-ping rounded-full bg-emerald-500/30"
              />
              <span
                aria-hidden="true"
                className="absolute size-24 animate-pulse rounded-full bg-emerald-500/20"
              />
            </>
          ) : null}
          <Avatar className="relative size-24">
            <AvatarFallback
              className={`text-3xl font-semibold text-white ${avatarColorClass(peer.name)}`}
            >
              {initials(peer.name)}
            </AvatarFallback>
          </Avatar>
        </span>
        <div className="text-center">
          <p className="text-xl font-semibold">{peer.name}</p>
          <p
            className={`mt-1 text-sm ${
              phase === "active" ? "tabular-nums text-emerald-300" : "text-white/70"
            }`}
            aria-live="polite"
          >
            {label}
          </p>
        </div>
      </div>

      {/* Kontrol */}
      <div className="relative z-10 flex items-center gap-3">
        {/* Callee saat ringing: Terima + Tolak */}
        {role === "callee" && phase === "ringing" ? (
          <>
            <Button
              type="button"
              size="lg"
              className="size-14 rounded-full bg-emerald-600 text-white hover:bg-emerald-500"
              aria-label="Terima panggilan"
              title="Terima"
              onClick={onAccept}
            >
              <Phone className="size-6" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="lg"
              variant="destructive"
              className="size-14 rounded-full"
              aria-label="Tolak panggilan"
              title="Tolak"
              onClick={onReject}
            >
              <PhoneOff className="size-6" aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            {/* Bisu mikrofon (hanya saat media siap) */}
            {showControls ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className={`size-12 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white ${
                  muted ? "bg-amber-500/80 text-white hover:bg-amber-500" : ""
                }`}
                aria-label={muted ? "Aktifkan mikrofon" : "Bisu mikrofon"}
                aria-pressed={muted}
                title={muted ? "Aktifkan mikrofon" : "Bisu"}
                onClick={onToggleMute}
              >
                {muted ? (
                  <MicOff className="size-5" aria-hidden="true" />
                ) : (
                  <Mic className="size-5" aria-hidden="true" />
                )}
              </Button>
            ) : null}
            {/* Kamera on/off (hanya video call + media siap) */}
            {isVideo && showControls ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className={`size-12 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white ${
                  camOff ? "bg-amber-500/80 text-white hover:bg-amber-500" : ""
                }`}
                aria-label={camOff ? "Nyalakan kamera" : "Matikan kamera"}
                aria-pressed={camOff}
                title={camOff ? "Nyalakan kamera" : "Matikan kamera"}
                onClick={onToggleCamera}
              >
                {camOff ? (
                  <VideoOff className="size-5" aria-hidden="true" />
                ) : (
                  <Video className="size-5" aria-hidden="true" />
                )}
              </Button>
            ) : null}
            {/* Akhiri (penelepon / setelah tersambung) */}
            <Button
              type="button"
              size="lg"
              variant="destructive"
              className="size-14 rounded-full"
              aria-label="Akhiri panggilan"
              title="Akhiri"
              onClick={onEnd}
            >
              <PhoneOff className="size-6" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
