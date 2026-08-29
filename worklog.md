# Project Worklog — ChatKita (Customer Service Chat App)

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Explore project + define shared chat protocol contract

Work Log:
- Read package.json, layout.tsx, page.tsx, examples/websocket (server.ts + frontend.tsx), Caddyfile
- Confirmed Next.js dev server running on port 3000 (dev.log OK)
- Installed socket.io-client@4.8.3 + socket.io@4.8.3 in main project
- Wrote shared protocol contract:
  - src/lib/chat-types.ts (ChatMessage, SessionOverview, event names, ack shapes, constants)
  - src/lib/chat-socket.ts (createChatSocket factory using io('/?XTransformPort=3003'))

Stage Summary:
- Protocol (client→server, ack via callback):
  user:join {sessionId?, name} → {ok, session:{id,name}, messages} | {ok:false,error}
  user:message {sessionId, content} → {ok, message} | err
  user:typing {sessionId, isTyping} (no ack)
  admin:auth {password} → {ok, sessions} | err
  admin:sessions (no payload) → {ok, sessions}
  admin:history {sessionId} → {ok, messages} (also marks read)
  admin:message {sessionId, content} → {ok, message} | err
  admin:read {sessionId} (no ack)
  admin:typing {sessionId, isTyping} (no ack)
- Server→client: chat:message (ChatMessage, to session room + admins room), sessions:update (SessionOverview[], to admins), user:typing {sessionId,isTyping}, admin:typing {isTyping}
- Rooms: `session:${sessionId}` per customer, `admins` for all authenticated admin sockets
- Storage: bun:sqlite at mini-services/chat-service/chat.db (sessions, messages, admin_reads tables)
- Admin password: ADMIN_PASSWORD env or default "admin123"
- Socket connection pattern (blessed by scaffold example): io('/?XTransformPort=3003', {transports:['websocket','polling'], forceNew:true, reconnection:true, timeout:10000})
- Constraints: single route (src/app/page.tsx), no server actions, Indonesian UI, emerald theme (no blue/indigo), sticky footer, responsive

---
Task ID: 2-b
Agent: full-stack-developer
Task: Build ChatKita frontend (customer chat + admin panel, single route)

Work Log:
- Read worklog.md (protocol contract), chat-types.ts + chat-socket.ts (used as-is, unmodified), examples/websocket/frontend.tsx (blessed io pattern), globals.css, layout.tsx, use-mobile.ts, and the shadcn exports used (button/input/card/badge/scroll-area/avatar/label)
- Confirmed Radix ScrollArea injects global CSS hiding native scrollbars → scoped `.chat-scroll` CSS re-enables a 6px native thin scrollbar (display:block + scrollbar-width:thin, thumb = var(--border)) and hides Radix's own overlay bar to avoid double bars
- src/lib/chat-utils.ts: formatChatTime (id-ID HH:MM), initials (max 2 uppercase), avatarColorClass (name-hash over fixed 7-color solid array)
- src/components/theme-provider.tsx (next-themes, attribute="class", defaultTheme="system", enableSystem, disableTransitionOnChange) + theme-toggle.tsx (Sun/Moon switched via CSS dark: variants → zero hydration mismatch, aria-label "Ganti tema", size-11 touch target)
- src/components/chat/ChatBubble.tsx: motion.div fade+y6 0.15s; left = bg-card border shadow-sm rounded-bl-md, right = bg-emerald-600 text-white (text-white instead of text-primary-foreground because this theme's dark-mode primary-foreground is near-black → would be illegible on emerald); text via whitespace-pre-wrap break-words <p> only
- src/components/chat/TypingDots.tsx: 3 staggered dots using @keyframes typing-bounce (globals.css, respects prefers-reduced-motion) + optional italic label
- src/components/chat/CustomerChat.tsx: own socket via createChatSocket(), always disconnect() on unmount; localStorage CUSTOMER_STORAGE_KEY read synchronously before connect so the first `connect` rejoins; `user:join` with stored sessionId on EVERY connect (ack replaces messages → closes reconnect gaps; error clears storage → name form); name form maps INVALID_NAME → "Nama tidak valid (1–40 karakter)."; messages appended ONLY in `chat:message` listener (sessionId guard + last-id dedup; success acks ignored); send = emit `user:message`, clear input immediately, on error-ack restore text + inline error; `admin:typing` auto-clears after 4s; typing emit debounced 1.5s idle → isTyping:false via ref timer; delete via window.confirm; amber "Koneksi terputus" strip when disconnected; header shows avatar (initials + hashed color), emerald/gray status dot; h-[calc(100dvh-10rem)] min-h-[460px] card, internal ScrollArea, viewport-only auto-scroll
- src/components/chat/AdminPanel.tsx: own socket; password kept ONLY in a ref (never localStorage); login → `admin:auth` (UNAUTHORIZED → "Password salah.", hint shows ADMIN_PASSWORD_HINT); on every `connect` while authed → re-auth, refresh sessions + reopen active `admin:history` + `admin:read`; layout grid md:grid-cols-[320px_1fr] h-[calc(100dvh-10rem)] min-h-[520px]; sidebar: search filter by name, session rows (avatar, name, formatChatTime(lastMessageAt), preview with "Anda: " prefix, unread Badge bg-emerald-600), empty states; right pane: empty state MessagesSquare, chat header with mobile ArrowLeft back, messages via `chat:message` (last-id dedup, auto admin:read when active), `user:typing` per-session with 4s auto-clear timers, input emits `admin:message` + debounced `admin:typing`; logout resets state and bumps an "epoch" that recreates the socket so the server drops the stale admins-room membership; useIsMobile() shows EITHER list OR chat on mobile, both on md+
- src/app/page.tsx rewritten: min-h-screen flex-col, sticky blurred header (emerald-600 logo tile + Badge outline, ThemeToggle, "← Beranda" ghost button when off-home), AnimatePresence mode="wait" fade+4px slide 0.2s between home/customer/admin, home hero + 2 role cards (emerald "Mulai Chat" / outline "Masuk Admin") + feature row (Lock/Zap/History), footer mt-auto sticky-bottom
- layout.tsx: lang="id", metadata title "ChatKita — Customer Service Chat" + Indonesian description, {children} wrapped in ThemeProvider, Toaster kept inside provider
- globals.css: only appended (dark variant already existed) — typing-bounce keyframes + .chat-scroll scrollbar block
- Verified dev.log: GET / 200, compiled with no errors; grep confirms no ports/absolute URLs/`any`/dangerouslySetInnerHTML in new code

Stage Summary:
- Files created: src/lib/chat-utils.ts, src/components/theme-provider.tsx, src/components/theme-toggle.tsx, src/components/chat/{ChatBubble,TypingDots,CustomerChat,AdminPanel}.tsx
- Files modified: src/app/page.tsx (full rewrite), src/app/layout.tsx (metadata/lang/ThemeProvider), src/app/globals.css (append-only)
- Views switch via a single `view` state in page.tsx ('home' | 'customer' | 'admin') rendered through AnimatePresence mode="wait"; exiting view unmounts → its socket disconnects, entering view creates a fresh one. Customer persists {sessionId,name} in localStorage and rejoins automatically on reconnect; admin re-auths from the in-memory password ref on reconnect.
- Design decisions: emerald-600 accent with explicit text-white (dark-mode-safe), shadcn tokens elsewhere for light/dark legibility; 44px touch targets (size-11/h-11); message text always plain <p>; dedup by message id against last element; viewport-targeted auto-scroll so the page itself never scrolls when a chat is open.
- Protocol assumptions: none beyond the Task 1 contract (customer filters chat:message by own sessionId; admin ignores message payloads in success acks — both consistent with the documented "append only via chat:message" rule).

---
Task ID: 2-a
Agent: full-stack-developer
Task: Build chat-service mini service backend (socket.io + bun:sqlite, port 3003)

Work Log:
- Read worklog.md, src/lib/chat-types.ts (shared contract, unmodified), examples/websocket/server.ts (blessed pattern)
- Created mini-services/chat-service/package.json (name "chat-service", script dev = "bun --hot index.ts")
- Installed deps in the mini-service project: socket.io@4.8.3, dev: socket.io-client@4.8.3 + @types/bun@1.4.0
- Wrote index.ts: http createServer + socket.io Server { path:'/', cors origin:*, methods GET/POST, pingTimeout 60000, pingInterval 25000 }, hardcoded PORT 3003
- Persistence via bun:sqlite at mini-services/chat-service/chat.db, PRAGMA journal_mode=WAL; tables sessions / messages (+idx_messages_session_id) / admin_reads exactly per spec
- Implemented all 9 events (user:join, user:message, user:typing, admin:auth, admin:sessions, admin:history, admin:message, admin:read, admin:typing) with exact contract ack shapes; every handler body wrapped in try/catch -> SERVER_ERROR ack
- Handler wrapper extracts ack as last-function-arg, so both emit(ev, ack) and emit(ev, payload, ack) work (robust for admin:sessions which has no payload)
- getSessionsOverview(): all sessions ORDER BY last_message_at DESC with lastMessage + unread (sender='user' AND id > COALESCE(admin_reads.last_read_message_id,0)); ISO timestamps via row mapper
- markSessionRead(): upsert admin_reads.last_read_message_id = MAX(messages.id) per session
- Added SIGTERM/SIGINT graceful shutdown (httpServer.close + db.close); logs connections, disconnections, auth failures, errors
- Wrote test-protocol.ts (socket.io-client, direct 127.0.0.1:3003 for test only) covering scenarios a-h; ran twice, both runs exit code 0
- Left server running in background: nohup bun run dev > dev.log 2>&1 (PID 1692, listening on *:3003)

Stage Summary:
- Files created: mini-services/chat-service/{package.json, index.ts, test-protocol.ts} (+ generated chat.db, dev.log, node_modules, bun.lock)
- Test result: 20/20 PASS (a1-a4 join, b1-b4 user message, c1 wrong-password UNAUTHORIZED, d1-d4 admin auth+inbox unread=1, e1-e3 history + admin reply fanned out to session room, f1-f2 read marking unread=0, g1 typing relay, h1 sort order). Re-run also fully green.
- DB schema: sessions(id TEXT PK, name, created_at INT, last_message_at INT) | messages(id INTEGER PK AUTOINC, session_id TEXT, sender TEXT, content TEXT, created_at INT, idx on session_id) | admin_reads(session_id TEXT PK, last_read_message_id INT DEFAULT 0) — epoch millis, API returns ISO strings
- Admin password: process.env.ADMIN_PASSWORD || 'admin123'
- Restart command: cd /home/z/my-project/mini-services/chat-service && (nohup bun run dev > dev.log 2>&1 &)
- Contract notes for frontend agent (2-b): socket.io path '/' via io('/?XTransformPort=3003'); server emits chat:message to room session:<id> AND admins (a message can arrive twice only if an admin socket were in both rooms — admin never joins session rooms in this design); user:typing payload is {sessionId, isTyping}; admin:typing payload is {isTyping}; empty/whitespace content and names are rejected (trim applied server-side, name 1..40, message 1..1000)

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Integration — lint fix, layout bug fix, end-to-end browser verification

Work Log:
- Fixed lint error (react-hooks/set-state-in-effect) in CustomerChat.tsx: session restore now reads storage into a ref at mount; session STATE is set inside the connect ack (async callback)
- Discovered critical routing context: app must be tested through the Caddy gateway (port 81) — direct :3000 access bypasses XTransformPort socket routing. All browser verification done via http://localhost:81 (same path as user preview)
- Verified full protocol through real browser: customer join/send, admin auth (correct + wrong password + logout), real-time message fan-out both directions, unread badges + mark-as-read, sessions:update inbox stream, typing indicators (admin↔customer), session persistence across reload, stale-session recovery (server transparently creates a fresh session), 1-on-1 isolation (Budi never sees Siti's messages)
- FIXED mobile overflow bug in AdminPanel: grid auto-track + Radix ScrollArea `display:table` wrapper + `truncate` (nowrap) text inflated intrinsic min-content to 633px, pushing the sidebar to 649px inside a 341px container (Keluar button off-screen). Fix: (1) `grid-cols-[minmax(0,1fr)]` base on the dashboard grid, (2) `min-w-0 overflow-hidden` on aside/sections, (3) CSS override in globals.css forcing Radix content wrapper to `display:block; width:100%` within `.chat-scroll`
- Cleaned all test data from chat.db (sessions/messages/admin_reads = 0) for a fresh handover
- Final lint: clean. dev.log: no errors.

Stage Summary:
- App fully working end-to-end via gateway; both servers running (Next.js :3000, chat-service :3003 with bun --hot)
- Verified screenshots: desktop light/dark customer chat, admin dashboard, mobile 375px list⇄chat toggle, sticky footer OK (mt-auto pattern)
- Key lesson: socket tests MUST go through gateway port 81, never direct :3000
