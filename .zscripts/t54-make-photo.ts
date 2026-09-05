/**
 * Task 54 — buat foto JPEG uji ber-EXIF (GPS Jakarta + kamera + waktu jepret)
 * untuk E2E metadata admin. Output: /tmp/t54-photo.jpg
 * Pemakaian: bun .zscripts/t54-make-photo.ts
 */
import { writeFileSync } from "node:fs";
import piexif from "piexifjs";

// 1x1 JPEG standar (SOI+APP0+DHT+SOF0+scan) — valid utk penyisipan APP1 EXIF.
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAAAv/aAAwDAQACEQMRAD8AmgA//9k=";

const jpegDataUrl = `data:image/jpeg;base64,${JPEG_1X1}`;

const LAT = -6.2; // Jakarta selatan
const LON = 106.816664;

const zeroth: Record<number, [number, number] | string | number> = {};
const exifIfd: Record<number, [number, number] | string> = {};
const gpsIfd: Record<number, [number, number][] | string> = {};

zeroth[piexif.ImageIFD.Make] = "TestCam";
zeroth[piexif.ImageIFD.Model] = "T54 X-Phone";
zeroth[piexif.ImageIFD.Software] = "ChatKita Test 54";

exifIfd[piexif.ExifIFD.DateTimeOriginal] = "2026:09:04 09:41:00";
exifIfd[piexif.ExifIFD.LensModel] = "TestLens 24-70mm";

gpsIfd[piexif.GPSIFD.GPSLatitudeRef] = LAT < 0 ? "S" : "N";
gpsIfd[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(LAT));
gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = LON < 0 ? "W" : "E";
gpsIfd[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(LON));

const exifBytes = piexif.dump({ "0th": zeroth, Exif: exifIfd, GPS: gpsIfd });
const newDataUrl = piexif.insert(exifBytes, jpegDataUrl);
const b64 = newDataUrl.split(",")[1];
writeFileSync("/tmp/t54-photo.jpg", Buffer.from(b64, "base64"));
process.stdout.write(
  `OK /tmp/t54-photo.jpg (${Buffer.from(b64, "base64").length} bytes, GPS ${LAT},${LON})\n`
);
