# Task 2-b — full-stack-developer

Task: Build ChatKita frontend (customer chat + admin panel, single route)

## Files created
- `src/lib/chat-utils.ts` — formatChatTime (id-ID HH:MM), initials (≤2 uppercase), avatarColorClass (name-hash over fixed solid color array)
- `src/components/theme-provider.tsx` — next-themes wrapper (attribute="class", defaultTheme="system", enableSystem, disableTransitionOnChange)
- `src/components/theme-toggle.tsx` — Sun/Moon ghost icon button, CSS dark:-switched icons (no hydration mismatch), aria-label "Ganti tema", size-11
- `src/components/chat/ChatBubble.tsx` — motion fade/y6 0.15s; left = bg-card/border/rounded-bl-md, right = bg-emerald-600/text-white; plain text `whitespace-pre-wrap break-words`
- `src/components/chat/TypingDots.tsx` — 3 staggered bouncing dots (`typing-bounce` keyframes in globals.css) + optional italic label
- `src/components/chat/CustomerChat.tsx` — customer view (name form ⇄ private chat), own socket via createChatSocket(), disconnect on unmount
- `src/components/chat/AdminPanel.tsx` — admin view (login ⇄ inbox + chat pane), own socket, epoch-based socket recreation on logout

## Files modified
- `src/app/page.tsx` — full rewrite: sticky blurred header, home hero (2 role cards + 3 feature items), AnimatePresence mode="wait" (fade + 4px slide, 0.2s) switching 'home' | 'customer' | 'admin', sticky footer (mt-auto)
- `src/app/layout.tsx` — lang="id", metadata "ChatKita — Customer Service Chat" + Indonesian description, ThemeProvider wraps children (Toaster kept)
- `src/app/globals.css` — append-only: `typing-bounce` keyframes + scoped `.chat-scroll` thin scrollbar (6px, thumb = var(--border)); re-enables native scrollbar that Radix hides and hides Radix's overlay bar to avoid double bars

## Behavior notes
- Customer: session persisted in localStorage (`chatkita:customer-session`); on EVERY socket `connect` emits `user:join` {sessionId, name} → ack replaces history (closes reconnect gaps); errors clear storage → name form. Messages appended ONLY via `chat:message` (sessionId guard + last-id dedup); success acks ignored. Send: optimistic clear, error-ack restores text + inline error. Typing: emit true on input, 1.5s idle → false (ref timer). `admin:typing` shows dots, 4s auto-clear. Delete button (Trash2) → window.confirm → clears storage/state.
- Admin: password only in a ref (never persisted); login emits `admin:auth` (UNAUTHORIZED → "Password salah."); on every `connect` while authed re-auths, refreshes sessions + re-fetches active history + marks read. Sidebar: search filter, unread emerald badges, previews ("Anda: " prefix for own messages), count badge, LogOut. Right pane: MessagesSquare empty state; mobile uses ArrowLeft to return to list (useIsMobile). `chat:message` appended per-session (last-id dedup) + auto `admin:read` when active; `user:typing` per-session with 4s auto-clear.
- Layout: chat cards `h-[calc(100dvh-10rem)]` with min-heights (460/520px), internal ScrollArea with viewport-targeted auto-scroll → no page-level scrollbar; 44px touch targets; emerald-600 accent + white text (dark-mode-safe), no blue/indigo.

## Protocol assumptions
None beyond the Task 1 contract. Verified against Task 2-a notes: `user:typing` = {sessionId, isTyping}, `admin:typing` = {isTyping}, chat:message goes to session room + admins room. Names 1–40 / messages 1–1000 match client maxLengths (MAX_NAME_LENGTH / MAX_MESSAGE_LENGTH).
