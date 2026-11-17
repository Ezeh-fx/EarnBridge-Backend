# Google Authentication Infrastructure

This document covers the Google ID token verification service in
`src/lib/google.ts`. It is infrastructure only — no sign-in/sign-up
workflow, routes, or account linking exist yet.

## Required Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes (for Google login) | OAuth 2.0 Web client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Only for server-side OAuth code flow | Not used by ID token verification; reserved for future use |

Both are already validated in `src/config/env.ts` and listed in
`.env.example`.

## Google Cloud Setup

1. Go to <https://console.cloud.google.com> and create or select a project.
2. **APIs & Services → OAuth consent screen**: configure the app name,
   support email, and scopes (`email`, `profile`, `openid`).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: your frontend origin
     (e.g. `http://localhost:5173`)
4. Copy the generated **Client ID** into `GOOGLE_CLIENT_ID`.

The frontend uses Google Identity Services (GIS) to obtain an ID token;
this backend only ever sees that token.

## How Verification Works

`verifyGoogleIdToken(idToken)` in `src/lib/google.ts`:

1. Lazily creates a singleton `OAuth2Client` from `google-auth-library`
   using `GOOGLE_CLIENT_ID`. Throws `GOOGLE_AUTH_NOT_CONFIGURED` (500)
   if the client ID is missing.
2. Calls `client.verifyIdToken({ idToken, audience })`, which verifies
   the JWT signature against Google's public keys, expiry, and that the
   audience matches our client ID.
3. Additionally validates the issuer (`accounts.google.com` or
   `https://accounts.google.com`) and requires a `sub` claim.
4. Requires `email` to be present and `email_verified === true`.
5. Returns a `GoogleVerifiedUser`:

```ts
interface GoogleVerifiedUser {
  googleId: string;      // Google `sub` — stable account identifier
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  picture?: string;
}
```

The raw ID token is never logged. Verification failures are logged at
`warn` level and surfaced to callers as `AppError`s:

- `INVALID_GOOGLE_TOKEN` (401) — bad signature, expired, wrong
  audience/issuer, missing payload, or missing `sub`
- `GOOGLE_EMAIL_MISSING` (401) — token has no email claim
- `GOOGLE_EMAIL_UNVERIFIED` (401) — `email_verified` is not `true`
- `GOOGLE_AUTH_NOT_CONFIGURED` (500) — `GOOGLE_CLIENT_ID` not set
- `GOOGLE_AUTH_FAILED` (500) — Google transport/provider failure
  (e.g. network error); distinct from invalid credentials

## Consuming the Service

`POST /v1/auth/google` receives `{ idToken }` from the client, validates the
body with Zod, verifies it with `verifyGoogleIdToken`, then delegates account
creation/session issuance to `src/services/user.service.ts`.

The implemented workflow follows these rules: find-or-create the user by
`googleId` (never auto-link by email alone), issue the standard access/refresh
token pair, and set auth cookies.

## Tests

`src/tests/google.service.test.ts` mocks `OAuth2Client` — no real Google
calls or credentials needed.

```bash
npm run test:run          # full suite
npx vitest run src/tests/google.service.test.ts
```

Covered: valid token, invalid/expired/wrong-audience tokens, missing
email, unverified email, missing `sub`, invalid issuer, empty token,
missing `GOOGLE_CLIENT_ID`, and unexpected client errors.
