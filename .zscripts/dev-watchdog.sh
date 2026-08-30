#!/bin/bash
# ChatKita service watchdog
# Keeps Next.js dev server (:3000) and chat-service (:3003) alive.
# Restarts Next.js BEFORE it OOM-crashes (RSS guard) — the box has only
# 4GB RAM and next-server historically grows past 1.9GB then dies.

PROJECT_DIR="/home/z/my-project"
CHAT_DIR="$PROJECT_DIR/mini-services/chat-service"
LOG="$PROJECT_DIR/.zscripts/watchdog.log"
PIDFILE="$PROJECT_DIR/.zscripts/watchdog.pid"
RSS_LIMIT_KB=1750000   # ~1.2GB: preemptive restart before the ~2GB OOM death
CHECK_INTERVAL=15

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# single instance
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "watchdog already running (pid $(cat "$PIDFILE"))"
  exit 0
fi
echo $$ > "$PIDFILE"

# keep log small
[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 200000 ] && : > "$LOG"

log "watchdog started (pid $$)"

start_next() {
  log "starting Next.js dev server..."
  cd "$PROJECT_DIR" || return 1
  ( setsid nohup bun run dev > /dev/null 2>&1 < /dev/null & )
  sleep 1
}

start_chat() {
  log "starting chat-service..."
  cd "$CHAT_DIR" || return 1
  ( setsid nohup bun run dev > /tmp/chat-service.log 2>&1 < /dev/null & )
  sleep 1
}

stop_next() {
  # kill wrapper (bun run dev), node next dev, next-server worker, tee
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  pkill -f "tee dev.log" 2>/dev/null
  local w
  w=$(ps aux | grep "bun run dev" | grep -v grep | grep -v watchdog | awk '{print $2}')
  [ -n "$w" ] && kill -9 $w 2>/dev/null
  sleep 2
}

port_up() { curl -s -o /dev/null --connect-timeout 3 --max-time 6 "http://127.0.0.1:$1/" ; }

next_pid() { ps aux | grep -E "next-server" | grep -v grep | awk '{print $2}' | head -1; }
next_rss_kb() { ps aux | grep -E "next-server" | grep -v grep | awk '{print $6}' | head -1; }
chat_alive() { ps aux | grep "bun --hot index.ts" | grep -v grep > /dev/null; }

# boot: bring everything up immediately if missing
port_up 3003 || start_chat
port_up 3000 || start_next

while true; do
  # ---- chat-service ----
  if ! chat_alive || ! ss -tln 2>/dev/null | grep -q ":3003 "; then
    log "chat-service DOWN -> restarting"
    start_chat
  fi

  # ---- Next.js ----
  np=$(next_pid)
  rss=$(next_rss_kb)
  if [ -z "$np" ] || ! ss -tln 2>/dev/null | grep -q ":3000 "; then
    log "Next.js DOWN (pid='$np') -> restarting"
    stop_next
    start_next
  elif [ -n "$rss" ] && [ "$rss" -gt "$RSS_LIMIT_KB" ]; then
    log "Next.js RSS ${rss}KB > limit ${RSS_LIMIT_KB}KB -> preemptive restart"
    stop_next
    start_next
  fi

  sleep "$CHECK_INTERVAL"
done
