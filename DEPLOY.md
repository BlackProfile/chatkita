# 🚀 DEPLOY.md — Panduan Hosting & Deploy ChatKita

Panduan lengkap membawa ChatKita dari kode di GitHub ke server produksi.
**Semua perintah dijalankan di VPS** (asumsi: Ubuntu 22.04/24.04, akses `sudo`).

---

## 📐 Arsitektur

ChatKita terdiri dari **3 komponen yang wajib berjalan di SATU mesin**:

```
                    ┌──────────────────────────────────────┐
 Browser / HP  ───► │  Caddy (:80/:443, HTTPS otomatis)    │
                    │   ├── tanpa query  ──► web  :3000    │
                    │   └── ?XTransformPort=3003 ─► chat:3003 │
                    └──────────────────────────────────────┘
                        │                      │
                 ┌──────▼──────┐        ┌──────▼───────────┐
                 │ web (Next)  │        │ chat-service     │
                 │ standalone  │        │ socket.io +      │
                 │ Bun, :3000  │        │ bun:sqlite, :3003│
                 └──────┬──────┘        └──────┬───────────┘
                        │   db/custom.db       │ mini-services/chat-service/
                        │   db/media/  ◄───────┼── (media & blob di chat.db)
                        └──────────────────────┴─── db/backups/
```

> ⚠️ Port `3003` **hard-coded** di chat-service dan klien selalu memanggil
> `/?XTransformPort=3003` — karena itu **Vercel/Netlify tidak bisa** dipakai
> (tak ada WebSocket permanen + SQLite + port tetap). Gunakan VPS/Docker.

**Data yang harus dipersistenkan / dibackup:**
| Data | Lokasi (Opsi A) | Isi |
|---|---|---|
| DB web (Prisma) | `db/custom.db` | pengaturan, dsb. |
| DB chat | `mini-services/chat-service/chat.db` (+`-wal`,`-shm`) | **pesan, media blob, semua percakapan** |
| Media di disk | `db/media/` | cache file unggahan |
| Backup otomatis | `backups/` | hasil backup chat-service |

> ⚠️ **Khusus proyek ini**: `mini-services/chat-service/chat.db` (berisi blob
> media) dan `db/custom.db` **sengaja di-track git** sebagai mekanisme backup.
> Artinya clone repo = ikut membawa data sandbox saat ini. Jika repo bersifat
> **publik**, pertimbangkan menjadikannya **private** (ada riwayat percakapan
> di dalamnya). Untuk mulai bersih di VPS, hapus DB bawaan repo sebelum service
> pertama dijalankan (langkah 4b).

---

## ✅ Persiapan Awal

1. **VPS** minimum 1 GB RAM. Bila 1 GB, buat swap 2 GB agar build tidak OOM:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
2. **Domain** (opsional tapi disarankan): arahkan record `A` domain → IP VPS.
3. Buka firewall:
   ```bash
   sudo apt update && sudo apt install -y ufw
   sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
   sudo ufw enable
   ```

---

## 🅰️ Opsi A — VPS + systemd + Caddy (disarankan)

### 1. Install Bun & tools
```bash
sudo apt install -y git caddy sqlite3
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # bun masuk PATH
```

### 2. Buat user khusus & clone repo
```bash
sudo useradd --system --create-home --home-dir /opt/chatkita --shell /bin/bash chatkita
sudo -iu chatkita git clone https://github.com/BlackProfile/chatkita.git /opt/chatkita 2>/dev/null || true
sudo -iu chatkita bash -c "git clone https://github.com/BlackProfile/chatkita.git ~/ 2>/dev/null; ls /opt/chatkita"
```
> Jika folder tidak terisi karena home = `/opt/chatkita` itu sendiri, cukup:
> `sudo -iu chatkita git clone https://github.com/BlackProfile/chatkita.git /opt/chatkita`

### 3. Konfigurasi environment
```bash
sudo -iu chatkita cp /opt/chatkita/deploy/chatkita.env.example /opt/chatkita/deploy/chatkita.env
sudo -iu chatkita nano /opt/chatkita/deploy/chatkita.env
# .env bawaan repo berisi path sandbox — timpa untuk produksi:
sudo -iu chatkita bash -c "echo 'DATABASE_URL=file:/opt/chatkita/db/custom.db' > /opt/chatkita/.env"
```
Wajib ubah **`ADMIN_PASSWORD`** (jangan `admin123`!). File env berisi:
`DATABASE_URL`, `ADMIN_PASSWORD`, `MEDIA_RETENTION_DAYS`.

### 4. Install dependensi & build web
```bash
sudo -iu chatkita bash -lc '
cd /opt/chatkita
bun install --frozen-lockfile
bunx prisma generate
bun run build
mkdir -p db backups
# WAJIB setiap selesai build: standalone selalu dibuat ulang
ln -sfn /opt/chatkita/db /opt/chatkita/.next/standalone/db
cd mini-services/chat-service && bun install --frozen-lockfile
'
```

### 4b. (Opsional) Mulai BERSIH — sekali saja sebelum service pertama jalan
```bash
# Hapus data sandbox bawaan repo (DB akan dibuat ulang kosong):
sudo -iu chatkita bash -lc '
cd /opt/chatkita
rm -f mini-services/chat-service/chat.db mini-services/chat-service/chat.db-wal mini-services/chat-service/chat.db-shm db/custom.db
'
```

### 4c. Inisialisasi skema DB web (idempoten — aman diulang)
```bash
sudo -iu chatkita bash -lc 'cd /opt/chatkita && bunx prisma db push --skip-generate'
```

### 5. Pasang service systemd
```bash
sudo cp /opt/chatkita/deploy/chatkita-web.service  /etc/systemd/system/
sudo cp /opt/chatkita/deploy/chatkita-chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chatkita-web chatkita-chat
sudo systemctl status chatkita-web chatkita-chat --no-pager
```

### 6. Pasang Caddy (HTTPS otomatis)
```bash
sudo nano /opt/chatkita/deploy/Caddyfile      # ganti chatkita.example.com → domain Anda
sudo cp /opt/chatkita/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 7. Verifikasi
| Cek | Cara | Hasil benar |
|---|---|---|
| Web | `curl -I https://domain.com` | `200`/`308` (redirect https) |
| Chat | `curl "https://domain.com/?XTransformPort=3003&XPortCheck=1"` atau buka app & kirim pesan | pesan terkirim (WebSocket jalan) |
| Log | `journalctl -u chatkita-chat -n 20` | banner `chat-service vX listening on port 3003` |
| Admin | `https://domain.com/?admin` | masuk dengan ADMIN_PASSWORD baru |

🔒 **Mode privat (v75)**: bila aktif, pengunjung tanpa tautan hanya melihat
layar gembok. Login lewat **`https://domain.com/?masuk=<kode>`**
(kode diatur admin → Dashboard → *Mode privat* 🔒).

---

## 🅱️ Opsi B — Docker Compose

```bash
# 1. Install Docker (contoh Ubuntu)
sudo apt install -y docker.io docker-compose-v2 && sudo usermod -aG docker $USER
# (login ulang agar grup docker aktif)

# 2. Clone & konfigurasi
git clone https://github.com/BlackProfile/chatkita.git && cd chatkita
nano .env     # isi: DOMAIN, ADMIN_PASSWORD (wajib!), MEDIA_RETENTION_DAYS
              # DOMAIN=chatkita.example.com  (atau DOMAIN=:80 bila belum ada domain)

# 3. Jalankan
docker compose up -d --build
docker compose ps
docker compose logs -f chat   # tunggu banner "chat-service vX listening on port 3003"
```

- Web `:3000`, chat `:3003` berjalan di jaringan internal; Caddy menerbitkan HTTPS ke domain di `.env`.
- Data tersimpan di Docker volumes: `chatkita_data` (DB web + media + backup) dan `chatdata` (kode + DB chat).
- **Update**: data asli ada di **volume Docker** (bukan file git) → aman reset kode:
  ```bash
  git fetch origin && git reset --hard origin/main
  docker compose up -d --build
  ```
  (kode chat-service otomatis disinkronkan entrypoint ke volume; chat.db di volume tak tersentuh).

### Backup (Docker)
```bash
mkdir -p backup
docker compose cp web:/data/custom.db backup/custom.db
docker compose cp chat:/opt/chat-service/chat.db backup/chat.db
docker compose cp web:/data/media backup/media
```

---

## 🔄 Update Aplikasi (Opsi A)

> `chat.db`/`custom.db` di-track git → `git pull` biasa bisa konflik dengan
> data lokal. Pakai alur resmi berikut (backup → reset kode → restore data):

```bash
# 0. Stop & backup data dulu
sudo systemctl stop chatkita-web chatkita-chat
sudo -iu chatkita bash -lc '
mkdir -p /opt/chatkita/backups/pre-update
sqlite3 /opt/chatkita/mini-services/chat-service/chat.db ".backup /opt/chatkita/backups/pre-update/chat.db"
sqlite3 /opt/chatkita/db/custom.db ".backup /opt/chatkita/backups/pre-update/custom.db"
'
# 1-3. Samakan kode, kembalikan data, rebuild
sudo -iu chatkita bash -lc '
cd /opt/chatkita
git fetch origin
git reset --hard origin/main
cp /opt/chatkita/backups/pre-update/chat.db   mini-services/chat-service/chat.db
cp /opt/chatkita/backups/pre-update/custom.db db/custom.db
rm -f mini-services/chat-service/chat.db-wal mini-services/chat-service/chat.db-shm
bun install --frozen-lockfile
bunx prisma generate
bun run build
ln -sfn /opt/chatkita/db /opt/chatkita/.next/standalone/db   # WAJIB lagi
'
sudo systemctl start chatkita-web chatkita-chat
```

## 💾 Backup & Restore (Opsi A)

```bash
# Backup (contoh harian — pasang di cron)
sudo -iu chatkita bash -lc '
mkdir -p /opt/chatkita/backups
sqlite3 /opt/chatkita/db/custom.db ".backup /opt/chatkita/backups/custom-$(date +%F).db"
sqlite3 /opt/chatkita/mini-services/chat-service/chat.db ".backup /opt/chatkita/backups/chat-$(date +%F).db"
rsync -a /opt/chatkita/db/media /opt/chatkita/backups/media-$(date +%F)
'
```
> `chat-service` juga membuat backup otomatis ke `backups/` (fitur bawaan).

**Restore**: `sudo systemctl stop chatkita-web chatkita-chat` → salin kembali
file DB/media ke tempat asal → `sudo systemctl start ...`.

## 🔐 Checklist Keamanan

- [ ] `ADMIN_PASSWORD` **bukan** `admin123` (env file / `.env` compose)
- [ ] Mode privat 🔒 **AKTIF** + kode akses kuat (Dashboard → Mode privat)
- [ ] `ufw` hanya membuka 22/80/443
- [ ] HTTPS aktif (Caddy otomatis)
- [ ] File env (`deploy/chatkita.env` / `.env`) **tidak pernah** diedit sembarangan; repo **private** (chat.db berisi riwayat chat ikut ter-commit)
- [ ] Backup berkala diuji restore-nya

## 🛠️ Troubleshooting

| Gejala | Sebab umum | Solusi |
|---|---|---|
| `502 Bad Gateway` | web/chat mati | `systemctl status chatkita-web chatkita-chat` |
| Pesan tak terkirim | chat-service mati / port 3003 bentrok | `journalctl -u chatkita-chat -n 50`; `ss -ltnp | grep 3003` |
| Build berhenti / server mati sendiri | RAM 1 GB habis saat build | buat swap (lihat Persiapan) |
| Media gagal tampil setelah build | symlink `db` hilang di standalone | ulangi `ln -sfn` langkah 4 |
| Sertifikat gagal | DNS belum mengarah / port 443 tertutup | cek DNS A + `ufw allow 443` + `journalctl -u caddy` |
| `ExecStartPre` gagal | symlink standalone/db belum dibuat | jalankan ulang langkah 4 |
| `git pull` konflik chat.db | chat.db/custom.db di-track git & berubah dua sisi | pakai alur update resmi (backup → fetch + reset --hard → restore) |
