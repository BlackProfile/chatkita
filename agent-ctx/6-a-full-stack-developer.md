# Task 6-a — full-stack-developer (backend)

Task: chat-service v7 — file sharing (out-of-band): `messages:send` accepts `type: 'file'` carrying `/api/media/<name>` content + fileName/fileSize/mimeType metadata; bytes never touch the socket (POST /api/upload stores, GET /api/media serves).

## Files modified
- `mini-services/chat-service/index.ts` (1541 → ~1650 lines) — the ONLY production file touched
- `mini-services/chat-service/test-protocol.ts` — new section h3 (7 file checks) + presence-section robustness + waitForSoft helper
- `mini-services/chat-service/cleanup-test-users.ts` — NEW helper (idempotent surgical cleanup of protocol-test rows; kept for future runs)
- `worklog.md` — appended Task 6-a entry
- NOT touched: `src/**` (frontend agent's domain), `src/lib/chat-types.ts` (frozen), Next dev server

## Server changes (index.ts)
- Migrations (existing addColumn pattern): `messages.file_name TEXT`, `messages.file_size INTEGER`, `messages.mime_type TEXT` (verified applied)
- `MessageRow` += `file_name?/file_size?/mime_type?`; `MessageType` += `'file'`; `ChatMessageApi.type` += `'file'`; `ChatMessageApi` += `fileName?/fileSize?/mimeType?`
- `toChatMessage`: emits file metadata only when present AND `deleted_at` is null — deleted file messages arrive with `content: ""` and NO metadata fields
- `messages:delete` UPDATE also NULLs the three file columns (redaction complete)
- `snippetOf`: Pick<> extended with `'file_name'`; file → `📎 ${row.file_name ?? 'File'}`. All call sites updated/audited: attachReplyPreviews SELECT now fetches file_name; conversations-overview pinned JOIN selects `pm.file_name AS pin_file_name`; pinnedSnapshotOf / conversation:pin / push body use full rows (SELECT *)
- `insertAndFanOut`: opts += fileName?/fileSize?/mimeType?; 10-column INSERT fills the three file columns ONLY when type==='file' (NULLs otherwise)
- `messages:send` file branch (reject → `INVALID_MESSAGE`):
  - `content` MUST match `/^\/api\/media\/[A-Za-z0-9._-]{1,120}$/` (path-only; the verbatim `url` returned by POST /api/upload; no protocol/host/whitespace/query)
  - `fileName`: string, trimmed length 1..255 (stored trimmed)
  - `mimeType`: string matching `/^[\w.+-]+\/[\w.+-]+$/`, length ≤ 100
  - `fileSize`: typeof-number integer, 0..26_214_400 (25 MiB — MAX_FILE_BYTES, matches /api/upload cap)
  - everything downstream (reply-target check, sender auto-read, fan-out, Web Push, archive auto-reopen, conversations push) works for 'file' unchanged; send log prints the fileName
- Guards verified: message:translate rejects non-text (file → NOT_FOUND); messages:edit rejects non-text (file → FORBIDDEN); transcribeAsync only for voice; message:react works on files (type-agnostic per contract)
- Boot log bumped to "chat-service v7"; header doc documents the /api/upload + /api/media architecture

## test-protocol.ts (v7)
- Section h3 (between h typing and i presence): h3a valid file send echoes type/content/fileName/fileSize/mimeType; h3b live admin receipt with metadata; h3c reply-to-file preview snippet === "📎 laporan-keuangan.pdf"; h3d absolute-URL content rejected; h3e 256-char fileName rejected; h3f 26_214_401-byte fileSize rejected; h3g missing metadata rejected
- i1/i2 robustness: real browser tabs auto-reconnect to the service (owner sessions), so the admin online-set may never empty and admin offline/online broadcasts may not fire during the test. waitForSoft (filtered wait, timeout → null) lets i1/i2 pass when the broadcasts fire OR when a foreign admin session is provably live (no event on disconnect AND none on fresh admin connect). i3 filter-scoped. Server behavior unchanged

## Verification
- Restart (safe pattern): killed old tree (pid 5820/pgid 5817), then from mini-services/chat-service: `setsid bash -c 'nohup bun run dev > /home/z/my-project/chat-service.log 2>&1 &'`. Boot log: "ChatKita chat-service v7 listening on port 3003 (path: '/', push: on)"
- Protocol suite: **43 passed, 0 failed** (36 before v7, +7 file checks). First run exposed the i1 environment issue (foreign admin tab), fixed in the suite, re-run all green
- Cleanup after runs: `bun cleanup-test-users.ts` — deletes ONLY exact-name 'Budi Test'/'Siti Test' users + their conversations/messages/reads/reactions/push subs; `PRAGMA integrity_check` ok; remaining users Admin + Budi Uji + rvg (real traffic untouched)

## Protocol notes for the frontend agent (6-b)
1. Flow: `POST /api/upload` (multipart) → `{ ok, url, fileName, mimeType, size }` → emit `messages:send { conversationId, content: url, type: 'file', fileName, fileSize, mimeType }`. content = the `url` field VERBATIM (`/api/media/<storedName>`); the server rejects absolute URLs, query strings, whitespace.
2. `ChatMessage.fileName/fileSize/mimeType` arrive on `message:new`, history (`messages:history`, `user:auth`) and the send ack. Reactions/delete/read receipts/pin/reply all work on file bubbles; `message:translate` and `messages:edit` are server-REJECTED for files (NOT_FOUND / FORBIDDEN) — hide those actions.
3. Reply-quote and pinned-banner snippets for file messages arrive prebuilt as `"📎 <name>"` with `type: 'file'` — no client-side special-casing needed there.
4. `conversations:update` lastMessage for a file carries `type: 'file'` with raw content (the URL) — build list previews from type (like image/voice), never render the content.
5. Deleted file message = tombstone (`deletedAt`, `content: ""`, no metadata), same as other media.
6. Web Push body for file messages is `"📎 <name>"` (server-side via snippetOf).
