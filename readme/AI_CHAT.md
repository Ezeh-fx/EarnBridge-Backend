# AI Chat (Stage 1 — Support Chat)

Service-layer foundation for the EarnBridge AI support chat. Stage 1
answers general questions about how Earnbridge works. There are no HTTP
endpoints yet — controllers/routes come in a later task.

## Provider

- OpenAI Responses API via the official `openai` SDK (`openai@7.53.0`).
- Function/tool calling is supported by the client wrapper so later
  stages (account-aware answers, earnings assistant) can add read-only
  tools without changing the plumbing.

## Files

- `src/lib/ai.ts` — OpenAI client wrapper. Lazy-initialized client,
  30s request timeout, 1 SDK retry, and the function-calling loop
  (max 5 iterations). Maps provider failures to `AppError`s:
  - `AI_NOT_CONFIGURED` / `AI_PROVIDER_UNSUPPORTED` (500) — missing key
    or unsupported `AI_PROVIDER`.
  - `AI_TIMEOUT` / `AI_UNAVAILABLE` / `AI_PROVIDER_UNAVAILABLE` (503) —
    transient failures; the frontend can show a retry state.
  - `AI_REQUEST_FAILED` (500) — other provider errors.
- `src/services/chat.service.ts` — business logic:
  - `sendChatMessage(userId, { conversationId?, message })` — validates
    input with Zod, resolves or creates an open `Conversation` scoped to
    the user, loads the last `CHAT_HISTORY_LIMIT` (20) messages as
    Responses API input, calls the model, then stores the user and
    assistant `Message` documents and updates `lastMessageAt`.
  - `listChatMessages(userId, { conversationId, limit, cursor })` —
    cursor-paginated history (newest first, max 50 per page).
- `src/config/constants.ts` — `CHAT_MAX_MESSAGE_LENGTH` (2000),
  `CHAT_HISTORY_LIMIT` (20), `CHAT_LIST_MAX_LIMIT` (50).
- `src/lib/errors.ts` — added `AppError.serviceUnavailable`.

## System prompt rules (enforced in code)

- Explains and advises only — cannot change balances, approve
  withdrawals, process payouts, or edit accounts.
- Never asks for or accepts passwords, card numbers, or other sensitive
  data.
- Never promises earnings amounts, payment dates, or withdrawal
  approval.
- Offers human support when unsure.

## Data flow

```
userId (from session, never from client input)
  -> Conversation (open, owned by user)
  -> Message history (last 20, user/assistant roles only)
  -> OpenAI Responses API (instructions + input + optional tools)
  -> Message docs (user + assistant, with token usage on assistant)
```

Account data is not included in stage 1. When stage 2 lands, context
must be built here from the authenticated user ID only.

## Configuration

```
AI_PROVIDER=openai
AI_API_KEY=...
AI_MODEL=gpt-4.1-mini   # optional, this is the fallback default
```

## Tests

`src/tests/chat.service.test.ts` — 10 tests using
`mongodb-memory-server` (replica set) with the `openai` module mocked.
Covers: message persistence, history replay, conversation reuse,
cross-user isolation, input validation, provider failure mapping, and
missing-key configuration.
