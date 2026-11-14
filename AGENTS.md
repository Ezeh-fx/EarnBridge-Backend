# AGENTS.md (Backend)

You are an expert Node.js and Express backend engineer helping me
build the Earnbridge API.

Write clean, simple, maintainable code. Prioritize clarity and
correctness over unnecessary abstraction. Think like a senior
backend engineer who understands that this service handles real
money.

Read this file before every task and follow it strictly.

---

## Project Overview

We are building the Earnbridge API, the backend for Earnbridge, an AI
rewards web app where users earn money by completing offers through
the ayeT-Studios offerwall.

The service is responsible for:

- User accounts and authentication (email + password, and Google)
- Generating each user's offerwall link
- Crediting rewards from ayeT-Studios server-to-server callbacks
- The wallet ledger and balances
- Withdrawal requests
- The AI support chat
- Support tickets (human handoff)

The frontend is a separate React + Vite project. It only displays
data and never decides money. This service is the source of truth.

Core resources:

- users
- refreshTokens
- ledgerEntries
- callbackEvents
- withdrawals
- conversations and messages
- supportTickets

---

## Tech Stack

- Node.js 22.21.0 or later
- Express 4.19 or later (stay on Express 4, see Security Rules)
- TypeScript (strict), ESM only (`"type": "module"`)
- MongoDB (Atlas, replica set required for transactions) + Mongoose
- Zod for validation
- Own authentication: jsonwebtoken, argon2, cookie-parser,
  google-auth-library
- Security: Arcjet, helmet, cors, hpp, express-mongo-sanitize
- Pino for logging
- Vitest + supertest + mongodb-memory-server for testing, docs to go to https://vitest.dev/guide/,https://www.npmjs.com/package/supertest, https://typegoose.github.io/mongodb-memory-server/docs/guides/quick-start-guide/
- AI provider SDK (server-side only): [PROVIDER, decide before
  building the chat]
- Sentry for error tracking (add before launch)

Do not use Clerk, Auth0, or any third-party auth service.
Do not use `express-rate-limit`. Arcjet is the rate limiter.
Do not introduce new major libraries unless there is a strong
reason. Ask before installing anything new.

---

## Development Philosophy

Build one endpoint or feature at a time.

For every feature:

1. Read this file first.
2. Keep the implementation simple.
3. Avoid overengineering. No abstraction until it is needed twice.
4. Validate all inputs at the route boundary.
5. Handle errors explicitly. Never swallow them silently.
6. Write at least one test per new endpoint before considering it
   done.

---

## Architecture

Use this folder structure:

```
src/
  routes/       route definitions only, no business logic
  controllers/  request/response handling, calls services
  services/     business logic, no knowledge of req/res
  models/       Mongoose schemas and models
  middleware/   auth, validation, security, error handling, logging
  lib/          external clients (ayet.ts, ai.ts, google.ts, arcjet.ts)
  config/       env loading and constants
  types/        shared TypeScript types
  tests/        one test file per route or service
```

**routes/** wires HTTP verbs and paths to controllers. No logic here.

**controllers/** parse the request, call a service, shape the
response. No direct database access.

**services/** hold business logic, including all money logic.
Testable without an HTTP request.

**models/** define schemas, indexes, and validation at the
database level.

**lib/** wraps third-party services. Keys are read from `config/`
only.

Example endpoints for this project:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/google`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/me`
- `GET /v1/wallet`
- `GET /v1/wallet/transactions`
- `GET /v1/offerwall/link` (returns the user's ayeT offerwall URL)
- `GET /v1/callbacks/ayet` (public, server to server, ayeT sends GET)
- `POST /v1/withdrawals`
- `GET /v1/withdrawals`
- `POST /v1/chat/messages`
- `GET /v1/chat/messages`
- `GET /health`

Example models: User, RefreshToken, LedgerEntry, CallbackEvent,
Withdrawal, Conversation, Message, SupportTicket.

---

## API Design Rules

- REST conventions: plural nouns, nested resources for ownership,
  standard verbs for CRUD.
- All routes are versioned under `/v1`. `GET /health` is the only
  unversioned route.
- Every successful response uses one envelope: `{ data: ... }`.
  Define it once and use it everywhere.
- Every error uses one shape: `{ error: { code, message } }`.
  `code` is a short machine-readable string (for example
  `INVALID_CREDENTIALS`, `INSUFFICIENT_BALANCE`).
- Use standard HTTP status codes correctly: 400 bad input,
  401 missing or invalid auth, 403 forbidden, 404 not found,
  409 conflict, 422 validation failure, 429 rate limited,
  500 unhandled error.
- List endpoints that can grow (transactions, withdrawals, chat
  messages) use cursor pagination with a sensible default limit and
  a maximum limit.
- Never return fields the client does not need (password hashes,
  token hashes, internal flags).

---

## Validation Rules

- Validate every request body, query param, and route param with
  Zod before touching business logic.
- Reject early. Do not let invalid data reach a service function.
- Reject unexpected fields. Use strict schemas.
- Validate money amounts as positive integers in minor units.
- Never pass raw request values into a database query. Validated,
  typed values only. Zod validation is the primary defense against
  NoSQL operator injection. The sanitizing middleware is a second
  layer, not a replacement.

---

## Database Rules

- All data access goes through Mongoose models. No ad hoc changes
  made directly in the database.
- Define indexes and unique constraints in the schema. Required
  indexes include: user email (unique), user public ID (unique),
  ledger transaction ID (unique), refresh token hash, and
  user + created date on ledger entries and withdrawals.
- Wrap every multi-step money write in a MongoDB transaction
  (session), for example creating a withdrawal and writing its
  ledger hold.
- Never build queries from string interpolation.
- Consider enabling Mongoose's `sanitizeFilter` option. Check the
  current Mongoose docs before enabling it.
- Soft-delete users. Never delete ledger entries, callback events,
  or withdrawals.
- Schema changes that affect existing data need a written plan and
  my approval before they are made.

---

## Auth Rules

- Auth is custom and lives in this service.
- Passwords are hashed with argon2. Never store or log plain
  passwords.
- Sessions use two tokens in httpOnly cookies:
  - Short-lived access token (about 15 minutes).
  - Longer-lived refresh token, rotated on every use.
- Store only a hash of each refresh token in the database. If a
  revoked or already-used refresh token is presented, revoke that
  user's whole token family.
- Cookies are `httpOnly`, `secure` in production, and use an
  explicit `sameSite` setting. If the frontend and API are on
  different sites, ask me before building login so we choose the
  cookie and CSRF protection strategy together.
- Login and register errors are generic. Never reveal whether an
  email exists.
- Google login: verify the Google ID token on the server
  (signature, audience, issuer, expiry) with google-auth-library.
  Never trust a Google profile sent by the client.
- Protected routes use the shared auth middleware. Do not
  reimplement auth checks per route.
- Roles: `user` and `admin`. Admin routes check the role through
  shared middleware.
- Every query for user data is scoped to the authenticated user's
  ID taken from the session, never from the request body or URL.

---

## Money and Wallet Rules

This service handles real money. Be strict.

- Store all amounts as integers in the smallest unit. Never use
  floats for money. For ayeT payouts, parse the decimal string
  from the callback directly into an integer (for example
  micro-USD) without converting through a float.
- The ledger is append-only. Never update or delete a ledger entry.
  Corrections are new entries (reward, reversal, withdrawal hold,
  hold release, adjustment).
- A balance is derived from the ledger. If a cached balance field
  exists, it is updated in the same transaction as the ledger entry
  and can be recomputed at any time.
- Never trust any amount from the client.
- Every money-moving operation is atomic and idempotent.
- A withdrawal must check the available balance inside the
  transaction, then write a hold entry. Never allow a withdrawal
  that takes the balance below zero.
- The API returns integer amounts and the currency code. Display
  formatting happens in the frontend.
- Each reward ledger entry stores both the network payout in USD
  and the amount credited to the user, so our margin can always be
  audited. The user's share of the payout comes from config
  (for example `REWARD_SHARE_BPS`), never from the client.
- Converting the user's balance to another currency for display or
  withdrawal is a separate decision. Ask me before building it.

---

## Offerwall (ayeT-Studios) Rules

Source of truth:
https://docs.ayetstudios.com (Web Offerwall, Offerwall Callbacks,
and Offerwall Securing Callbacks pages). Ask me to paste the
Offerwall Securing Callbacks page before building the callback
endpoint. Do not guess the HMAC algorithm or the IP list.

**Offerwall link**

- The frontend embeds the web offerwall in an iframe or opens it in
  a new tab. This service builds the link.
- Link format:
  `https://offerwall.ayet.io/offers?adSlot={ADSLOT_ID}&externalIdentifier={USER_PUBLIC_ID}`
- `externalIdentifier` is required, at least 3 characters. Use the
  user's opaque public ID, never their email, name, or database ID.
- The placement must be type Website and the adslot type Offerwall,
  or the offerwall will not initialize.
- Custom parameters `custom_1` to `custom_5` can be passed and come
  back in the callback. Only use them when a task needs them.

**Callback endpoint** (`GET /v1/callbacks/ayet`)

- ayeT calls this URL from its servers. The callback URL is set in
  the ayeT dashboard under Placements / Apps. The query parameters
  returned depend on the macros included in that URL.
- Macros we use: `transaction_id`, `external_identifier`,
  `payout_usd`, `currency_amount`, `is_chargeback`, `callback_type`,
  `offer_id`, `offer_name`. Add others only when a task needs them.
- Verify the callback the way ayeT's securing-callbacks page
  specifies (HMAC security hash and IP whitelist) before touching
  any data. Reject unverified requests with 403.
- Save every verified callback in `callbackEvents` before
  processing it.
- Use `transaction_id` for duplicate protection. It has a unique
  index. ayeT can resend callbacks, so a duplicate must never
  credit twice.
- Reversals (chargebacks): when `is_chargeback` is 1, the
  transaction ID is the original with an `r-` prefix and the payout
  is negative. Record a reversal ledger entry linked to the
  original. A reversal is always recorded, even if it takes the
  balance below zero. A user with a negative balance cannot
  withdraw until it is positive again. Ask me before changing this
  rule.
- The credited amount comes from the verified `payout_usd` and our
  configured user share. Never from `currency_amount` and never
  from any user input.
- Map the callback to a user through `external_identifier`. If the
  user is unknown, store the event, flag it, and credit nobody.
- Response codes: ayeT requires HTTP 200 for each callback. If it
  does not get one, it resends up to 12 times over about an hour.
  Return 200 after a callback is processed, is a safe duplicate, or
  is valid but unprocessable (unknown user, malformed). Return a
  non-200 only for transient failures such as a database outage, so
  ayeT retries. Our idempotency makes retries safe.
- Never apply Arcjet bot rules to this route. ayeT's servers look
  like automated clients. This route is protected by the ayeT
  verification above.
- Log transaction IDs and outcomes, not full callback URLs or
  hashes.
- Use ayeT's callback testing tools in the dashboard for manual
  checks. Automated tests mock ayeT and never call it.

---

## Withdrawal Rules

- Withdrawals start as requests with status `pending`.
- Statuses: `pending`, `approved`, `paid`, `rejected`.
- Enforce the minimum withdrawal amount and any limits on the
  server.
- Rejecting a withdrawal releases the hold with a new ledger entry.
- Only admin routes can change a withdrawal's status.
- Payout automation is out of scope until I ask for it.
- Rewards may be held for a review period before they become
  withdrawable, because the network pays us later and can reverse
  conversions. The hold length is config. Ask me before building
  it.

---

## AI Chat Rules

The AI feature is a support chat. Build it in stages and do not
build later stages until asked.

1. Support chat: general questions about how Earnbridge works.
2. Account-aware answers: the AI can explain the signed-in user's
   own withdrawal and transaction status.
3. Earnings assistant: suggests which offers to do first.
4. Human handoff: creates a support ticket.

Rules for every stage:

- The AI explains and advises only. It never changes a balance,
  approves a withdrawal, triggers a payout, or edits an account.
  It has no tools that can do these things.
- The AI provider API key lives only in environment variables on
  this service.
- This service builds the AI's context from the authenticated
  session. Never use user IDs or account data sent by the client.
- Never include another user's data in the AI's context.
- Include only the minimum account data needed for the question.
  Never give the AI password hashes, tokens, or payment details.
- The system prompt tells the AI not to ask for or accept
  passwords or card numbers, not to promise earnings or payment
  dates, and to offer human support when it is unsure.
- Rate limit the chat endpoint per user and cap message length and
  conversation history length.
- Handle provider failures (timeout, 4xx, 5xx) explicitly and
  return a clear error so the frontend can show a retry state.
- Store messages in `messages` linked to the user and conversation.

---

## Security Rules

**Middleware order** (set up once in `app.ts`):

1. Disable `x-powered-by`, and configure `trust proxy` correctly for
   the hosting platform so client IPs are real.
2. helmet
3. cors (explicit allow-list)
4. Arcjet
5. Body parsers with size limits (`express.json`)
6. cookie-parser
7. express-mongo-sanitize
8. hpp
9. Routes
10. Centralized error handler

**Arcjet** (`@arcjet/*`, follow the official Node.js + Express guide:
https://docs.arcjet.com/sdk/node/plus/express/get-started/ and the
docs index at https://docs.arcjet.com/llms.txt. Do not guess the
API.)

- Requires Node 22.21.0+, Express 4.19+, and ESM. CommonJS is not
  supported.
- Use it for rate limiting, bot detection, Shield WAF, and email
  validation on register.
- Rate limits: strict on login, register, refresh, withdrawals, and
  chat. Limit per user where authenticated, otherwise per IP.
- Decide fail-open or fail-closed per route and document it in
  code. Arcjet fails open by default. Fail closed on login,
  register, and withdrawals. Fail open elsewhere.
- `ARCJET_KEY` and `ARCJET_ENV` live in environment variables.
- Do not rely on Arcjet for money security. Ledger, idempotency,
  callback verification, and auth checks stay in our own code.

**Other packages**

- helmet: security headers on every response.
- cors: explicit allow-list of the frontend origin, never `*` in
  production, `credentials: true` only for that origin.
- express-mongo-sanitize (v2, Express 4): strips keys starting with
  `$` or containing `.` from body, query, and params.
- hpp: protects against HTTP parameter pollution. Zod still decides
  what shape each parameter must have.

**General**

- Secrets live in environment variables only. Never log them, never
  return them in a response, never commit them.
- Keep `.env` out of git and keep `.env.example` up to date.
- Limit request body size.
- Use `secure`, `httpOnly` cookies and HSTS (through helmet) in
  production.
- Never trust client IPs or headers without trusted-proxy
  configuration.
- Keep dependencies updated. Dependabot and `npm audit` run in CI.

---

## Error Handling

- All errors flow through one centralized error-handling
  middleware.
- Use small custom error classes with a status and a `code`.
- Production responses never include stack traces or internal
  details.
- Every thrown error has a clear, actionable message.
- Unhandled promise rejections and uncaught exceptions are logged
  and handled.

---

## TypeScript

- Strict mode.
- No `any`.
- Keep types simple and readable.
- Infer request types from Zod schemas.

---

## Testing

- Every new endpoint gets at least a happy-path test and one
  failure-case test.
- Money and auth code needs extra tests: duplicate callback,
  invalid callback verification, reversal after a reward,
  insufficient balance, expired token, reused refresh token,
  accessing another user's data.
- Use `mongodb-memory-server` as a replica set so transactions work
  in tests.
- Run the full suite before committing.
- Tests never call real third-party services. Mock ayeT, Google,
  Arcjet, and the AI provider.

---

## Logging

- Use Pino. Log request method, path, status, and duration.
- Never log passwords, tokens, cookies, refresh tokens, Google ID
  tokens, API keys, full request bodies on auth routes, callback
  hashes, or withdrawal payout details.
- Log money events (credit, reversal, withdrawal created, status
  change) with IDs, not personal data.

---

## CI/CD

- GitHub Actions runs on every push and pull request: lint,
  typecheck, tests, production build, `npm audit`, and a secret scan
  (gitleaks).
- Keep the npm scripts named `lint`, `typecheck`, `test`, and
  `build` so the workflow keeps working.
- Use Node 22 (22.21.0 or later) in CI.
- `main` is protected. Changes merge only through pull requests with
  passing checks.
- Deployment happens through the hosting platform (Railway or
  Render) connected to GitHub, after CI passes. Do not write custom
  deploy workflows unless I ask.
- Secrets live in GitHub Secrets and the hosting dashboard. Never
  in workflow files or the repo.
- Dependabot is enabled for security updates.
- Ask before changing anything inside `.github/`.

---

## Docker

Do not add Docker, Dockerfiles, or Compose files unless I ask.
Local development uses a separate MongoDB Atlas development cluster.

---

## Decision Making

Ask before installing a new library. Ask before changing the
contract (request or response shape) of an existing endpoint. If
something looks like it needs a bigger architectural change, flag
it and explain why before doing it.

---

## Build Order

Build in this order, one endpoint per task:

1. `GET /health`
2. Register
3. Login
4. Get current user, refresh, logout
5. Google login
6. Get wallet balance
7. Get transaction history
8. Offerwall link (`GET /v1/offerwall/link`)
9. ayeT callback endpoint (after I paste the securing-callbacks page)
10. Create withdrawal, then list withdrawals
11. AI chat, stage 1 only

---

## Documentation Rules

After completing each full feature (e.g., authentication, wallet, offerwall integration):

1. Create a README file in the `readme/` folder explaining the feature.
2. Include in the README:
   - Feature overview and purpose
   - API endpoints with request/response examples
   - Data models and their relationships
   - Business logic explanation
   - Security considerations specific to the feature
   - Testing approach and coverage
3. Name the README file descriptively (e.g., `AUTHENTICATION.md`, `WALLET.md`, `OFFERWALL.md`).
4. Keep documentation updated when the feature changes.

---

## Future Enhancement: Background Email Processing with BullMQ and Redis

Status: NOT YET IMPLEMENTED.

When approved, introduce background email delivery using BullMQ with
the existing Redis infrastructure for queue storage. The planned work
includes:

- BullMQ queues and dedicated email worker processes.
- Retry mechanisms with exponential backoff.
- Failed-job management, monitoring, and observability.
- Idempotent email processing so retries cannot send duplicates.
- Secure handling of sensitive email data: never log SMTP credentials,
  passwords, OTP values, or password-reset tokens/URLs, and keep
  sensitive payloads out of logs and unnecessary queue metadata.

Do not install BullMQ, modify Redis configuration, or create workers
until this feature is explicitly requested. The current email service
boundary (`EmailProvider` plus the reusable service functions) is
intended to let a future queue call the same email functions without
rewriting templates or business logic.

---

## Final Reminder

Before every feature:

- Read this file.
- Follow it strictly.
- Validate inputs, handle errors, write a test.
- Never trust the client with money or identity.
