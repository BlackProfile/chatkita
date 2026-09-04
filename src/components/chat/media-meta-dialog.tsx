"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  Camera,
  FileText,
  MapPin,
  Mountain,
  Navigation,
  Sun,
  Timer,
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
import { Separator } from "@/components/ui/separator";
import {
  type AdminMessageMetaAck,
  type ExifMetaInfo,
} from "@/lib/chat-types";
import { formatFileSize } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * v35 — dialog "Metadata Media" KHUSUS ADMIN (Task 54).
 *
 * Permintaan user: admin bisa membaca metadata foto/video/file yang dikirim
 * pengguna — termasuk LOKASI (EXIF GPS), kamera/lensa, waktu jepret, dan
 * pencahayaan. Data diambil via event socket `admin:message_meta` (server
 * membaca header file + EXIF via exifr; media lama di-enrich saat dibuka).
 *
 * - Lokasi tampil menonjol dengan tautan Google Maps & OpenStreetMap
 *   (target _blank + rel noopener noreferrer).
 * - Tanpa EXIF → pesan tenang "Tidak ada data EXIF" (bukan error).
 */

export interface MediaMetaTarget {
  messageId: number;
  /** Label kecil di header (mis. nama file asli). */
  label?: string;
}

/** Label orientasi EXIF (1–8). */
const ORIENTATION_LABELS: Record<number, string> = {
  1: "Normal",
  2: "Cermin horizontal",
  3: "Rotasi 180°",
  4: "Cermin vertikal",
  5: "Transpose",
  6: "Rotasi 90° searah jarum jam",
  7: "Transverse",
  8: "Rotasi 90° berlawanan jarum jam",
};

/** Detik eksposur → "1/250 s" / "2 s". */
const formatExposure = (t: number): string =>
  t >= 1 ? `${Number(t.toFixed(1))} s` : `1/${Math.round(1 / t)} s`;

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} mnt ${s} dtk` : `${s} dtk`;
};

/** Satu baris label: nilai. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-xs font-medium">{value}</span>
    </div>
  );
}

function GpsCard({ gps }: { gps: NonNullable<ExifMetaInfo["gps"]> }) {
  const coord = `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Lokasi (EXIF GPS)
        </p>
      </div>
      <p className="mt-1.5 font-mono text-sm font-semibold">{coord}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button asChild size="sm" className="h-8">
          <a
            href={`https://maps.google.com/?q=${gps.lat},${gps.lon}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation className="size-3.5" aria-hidden="true" />
            Google Maps
          </a>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-8">
          <a
            href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=17/${gps.lat}/${gps.lon}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Mountain className="size-3.5" aria-hidden="true" />
            OpenStreetMap
          </a>
        </Button>
      </div>
    </div>
  );
}

export function MediaMetaDialog({
  socket,
  target,
  onClose,
}: {
  socket: Socket | null;
  target: MediaMetaTarget | null;
  onClose: () => void;
}) {
  const [ack, setAck] = useState<AdminMessageMetaAck | null>(null);
  const [failed, setFailed] = useState(false);

  const open = target != null;
  const noSocket = open && !socket;

  /* Fetch hanya di sini — setState HANYA di callback socket (aturan
   * react-hooks/set-state-in-effect). Reset state dilakukan induk via
   * key={messageId} sehingga tiap pembukaan remount bersih. */
  useEffect(() => {
    if (!target || !socket) return;
    let alive = true;
    socket.emit(
      "admin:message_meta",
      { messageId: target.messageId },
      (res: AdminMessageMetaAck | { ok: false; error: string }) => {
        if (!alive) return;
        if (res?.ok) setAck(res);
        else setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [target, socket]);

  const loadFailed = failed || noSocket;

  const exif = ack?.meta.exif ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Camera className="size-4 shrink-0" aria-hidden="true" />
            Metadata Media
          </DialogTitle>
          <DialogDescription className="line-clamp-1">
            {target?.label || ack?.file.fileName || `Pesan #${target?.messageId ?? ""}`}
          </DialogDescription>
        </DialogHeader>

        {loadFailed ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Metadata tidak dapat dibaca untuk pesan ini.
          </p>
        ) : !ack ? (
          <div aria-hidden="true" className="space-y-2.5 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Info file */}
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                File
              </p>
              <Separator className="mb-1" />
              <MetaRow label="Nama" value={ack.file.fileName ?? "—"} />
              <MetaRow
                label="Jenis"
                value={
                  ack.file.mimeType
                    ? ack.file.mimeType
                    : ack.file.mediaName.split(".").pop()?.toUpperCase() ?? "—"
                }
              />
              <MetaRow
                label="Ukuran"
                value={ack.file.fileSize != null ? formatFileSize(ack.file.fileSize) : "—"}
              />
              <MetaRow label="Pengirim" value={ack.file.senderName ?? ack.file.senderId} />
              <MetaRow label="Dikirim" value={formatDateTime(ack.file.createdAt)} />
              {(ack.file.deleted || ack.file.expired) && (
                <div className="pt-1.5">
                  <Badge variant="destructive">
                    {ack.file.expired ? "Media kedaluwarsa" : "Pesan dihapus"}
                  </Badge>
                </div>
              )}
            </section>

            {/* Metadata teknis */}
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Media
              </p>
              <Separator className="mb-1" />
              {ack.meta.width != null && ack.meta.height != null ? (
                <MetaRow label="Dimensi" value={`${ack.meta.width} × ${ack.meta.height} px`} />
              ) : null}
              {ack.meta.durationMs != null ? (
                <MetaRow label="Durasi" value={formatDuration(ack.meta.durationMs)} />
              ) : null}
              {ack.meta.pages != null ? (
                <MetaRow label="Halaman PDF" value={String(ack.meta.pages)} />
              ) : null}
              {ack.meta.videoCreated ? (
                <MetaRow
                  label="Video dibuat"
                  value={formatDateTime(ack.meta.videoCreated)}
                />
              ) : null}
              {ack.meta.width == null &&
              ack.meta.durationMs == null &&
              ack.meta.pages == null &&
              ack.meta.videoCreated == null ? (
                <p className="py-2 text-xs text-muted-foreground">
                  Tidak ada data teknis yang terbaca dari file.
                </p>
              ) : null}
            </section>

            {/* EXIF */}
            <section>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sun className="size-3.5" aria-hidden="true" />
                EXIF / detail jepretan
              </p>
              <Separator className="mb-2" />
              {!exif ? (
                <p className="py-1 text-xs text-muted-foreground">
                  Tidak ada data EXIF pada file ini (dihapus saat ekspor/unduh, atau
                  jenis file tidak menyimpan EXIF).
                </p>
              ) : (
                <div className="space-y-2.5">
                  {exif.gps ? <GpsCard gps={exif.gps} /> : null}
                  <div>
                    {exif.make || exif.model ? (
                      <MetaRow
                        label="Kamera"
                        value={[exif.make, exif.model].filter(Boolean).join(" ")}
                      />
                    ) : null}
                    {exif.lens ? <MetaRow label="Lensa" value={exif.lens} /> : null}
                    {exif.takenAt ? (
                      <MetaRow label="Waktu jepret" value={formatDateTime(exif.takenAt)} />
                    ) : null}
                    {exif.software ? (
                      <MetaRow label="Software" value={exif.software} />
                    ) : null}
                    {exif.orientation != null ? (
                      <MetaRow
                        label="Orientasi"
                        value={
                          ORIENTATION_LABELS[exif.orientation] ?? String(exif.orientation)
                        }
                      />
                    ) : null}
                    {exif.iso != null ? <MetaRow label="ISO" value={String(exif.iso)} /> : null}
                    {exif.fNumber != null ? (
                      <MetaRow label="Bukaan" value={`f/${exif.fNumber}`} />
                    ) : null}
                    {exif.exposureTime != null ? (
                      <MetaRow
                        label="Eksposur"
                        value={formatExposure(exif.exposureTime)}
                      />
                    ) : null}
                    {exif.focalLength != null ? (
                      <MetaRow label="Focal length" value={`${exif.focalLength} mm`} />
                    ) : null}
                    {exif.gps == null &&
                    !exif.make &&
                    !exif.model &&
                    !exif.takenAt &&
                    exif.iso == null ? (
                      <p className="py-1 text-xs text-muted-foreground">
                        Hanya sebagian kecil data EXIF ditemukan.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </section>

            {/* Catatan privasi */}
            <p
              className={cn(
                "flex items-start gap-1.5 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground"
              )}
            >
              <FileText className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              Metadata dibaca langsung dari file di server — tanpa mengubah file
              atau pesan. Hanya admin yang dapat melihatnya.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
