# syntax=docker/dockerfile:1
# =====================================================================
# ChatKita — Dockerfile multi-stage (satu file, dua target runtime)
#
#   target "web"  : Next.js 16 standalone (dijalankan dengan Bun), :3000
#   target "chat" : chat-service (socket.io + bun:sqlite),        :3003
#
# Pemakaian: docker compose up -d --build  (lihat DEPLOY.md)
#
# Layout data di dalam container (semua di volume persisten /data):
#   /data/custom.db                 -> database web (Prisma)
#   /data/media                     -> file media gabungan web+chat
#   /data/backups                   -> folder backup
#   /opt/chat-service/chat.db(+wal) -> database chat (volume chatdata,
#                                      kode disinkronkan entrypoint agar
#                                      upgrade image tidak mengorbankan DB)
# =====================================================================

# ---------------------------------------------------------------------
# STAGE 1 — builder web (Next.js standalone)
# ---------------------------------------------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# DB dummy untuk proses build (tidak dipakai saat runtime)
ENV DATABASE_URL=file:/tmp/build.db

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx prisma generate
# `bun run build` = next build + salin static/public ke .next/standalone
RUN bun run build

# ---------------------------------------------------------------------
# STAGE 2 — runtime web
# ---------------------------------------------------------------------
FROM oven/bun:1-slim AS web
# openssl & ca-certificates dibutuhkan engine Prisma
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/custom.db

WORKDIR /app

# Hasil standalone (sudah berisi server.js, node_modules ter-trace,
# static & public hasil salinan `bun run build`)
COPY --from=builder /app/.next/standalone /app/.next/standalone

# Skema + CLI Prisma hanya untuk inisialisasi DB saat boot pertama
COPY --from=builder /app/prisma /app/prisma
COPY --from=builder /app/node_modules/prisma /app/node_modules/prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma

COPY deploy/docker-entrypoint-web.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data \
    # standalone server.js selalu chdir ke dirname(server.js); web menulis
    # media ke cwd()/db/media -> arahkan "db" ke volume /data
    && ln -s /data /app/.next/standalone/db

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["entrypoint.sh"]

# ---------------------------------------------------------------------
# STAGE 3 — runtime chat (socket.io + bun:sqlite)
# ---------------------------------------------------------------------
FROM oven/bun:1-slim AS chat
ENV NODE_ENV=production

WORKDIR /opt/chat-service-template
COPY mini-services/chat-service/package.json mini-services/chat-service/bun.lock ./
RUN bun install --frozen-lockfile
COPY mini-services/chat-service/index.ts ./

# Salinan awal untuk "seeding" volume chatdata:/opt/chat-service saat boot pertama
RUN mkdir -p /opt/chat-service && cp -a /opt/chat-service-template/. /opt/chat-service/ \
    && mkdir -p /data

COPY deploy/docker-entrypoint-chat.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["entrypoint.sh"]
