# Authentication

This document covers the custom authentication and user-account endpoints in
`src/routes/user.routes.ts`, `src/controllers/user.controller.ts`, and
`src/services/user.service.ts`.

## Overview

Earnbridge uses its own authentication. There is no third-party auth provider.

- Passwords are hashed with `argon2`.
- Email/password registration requires a 6-digit OTP before login.
- Google sign-in verifies the Google ID token server-side.
- Sessions use two httpOnly cookies:
  - a short-lived JWT access token
  - a longer-lived opaque refresh token rotated on every use
- Only SHA-256 hashes of refresh tokens and password-reset tokens are stored.
- OTP values are stored as argon2 hashes and expire after 10 minutes.
- Password reset tokens expire after 30 minutes.

Current cookie settings are `httpOnly`, `secure` in production, `sameSite=Lax`,
and `path=/`. If the frontend and API are deployed on different sites, revisit
this before launch and choose the cookie/CSRF strategy together.

## Endpoints

All routes are under `/v1` unless noted.

### `POST /v1/auth/register`

Creates an unverified password account and emails a verification OTP.

Request:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Jane Doe"
}
```

Response `201`:

```json
{
  "data": {
    "message": "If this email can be registered, a verification code has been sent."
  }
}
```

The response is intentionally generic so registration does not reveal whether an
email already exists. If the email belongs to an existing unverified password
account, a new OTP is sent.

### `POST /v1/auth/verify-otp`

Verifies the registration OTP and marks the email as verified. This endpoint
does not create a session; the user signs in separately.

Request:

```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

Response `200`:

```json
{
  "data": {
    "user": {
      "id": "665f...",
      "publicId": "...",
      "email": "user@example.com",
      "displayName": "Jane Doe",
      "role": "user",
      "emailVerified": true
    }
  }
}
```

### `POST /v1/auth/login`

Authenticates an email/password user and sets auth cookies.

Request:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Response `200`:

```json
{
  "data": {
    "user": {
      "id": "665f...",
      "publicId": "...",
      "email": "user@example.com",
      "role": "user",
      "emailVerified": true
    }
  }
}
```

Login errors are generic (`INVALID_CREDENTIALS`) so the endpoint does not reveal
whether an email exists. A correct password for an unverified account returns
`EMAIL_NOT_VERIFIED`.

### `POST /v1/auth/google`

Verifies a Google ID token and signs in or creates the Google user.

Request:

```json
{
  "idToken": "google-id-token"
}
```

Response `200` is the same user shape as login, with auth cookies set.

Google accounts are found by `googleId`. If the Google email already belongs to
a password account, the API returns `GOOGLE_ACCOUNT_LINK_REQUIRED` instead of
auto-linking by email.

### `POST /v1/auth/refresh`

Rotates the refresh-token cookie and returns a new access token plus a new
refresh token.

- The presented refresh token must be unused, unrevoked, and unexpired.
- Refresh tokens are stored as SHA-256 hashes.
- A reused or revoked refresh token revokes the whole token family.
- Rotation is transactional so concurrent refresh attempts cannot both succeed.

Response `200` returns `{ data: { user } }` and sets new cookies.

### `POST /v1/auth/logout`

Revokes the current refresh token and clears both auth cookies. Logout is
idempotent and does not require an access token.

Response `200`:

```json
{
  "data": { "message": "Logged out" }
}
```

### `GET /v1/me`

Returns the authenticated user. Requires the access-token cookie.

Response `200`:

```json
{
  "data": {
    "user": {
      "id": "665f...",
      "publicId": "...",
      "email": "user@example.com",
      "displayName": "Jane Doe",
      "avatarUrl": "https://...",
      "role": "user",
      "emailVerified": true
    }
  }
}
```

### `POST /v1/auth/forgot-password`

Sends a password-reset email when the account exists, has a password, is active,
and has a verified email.

Request:

```json
{
  "email": "user@example.com"
}
```

Response `200` is always generic:

```json
{
  "data": {
    "message": "If an account exists for this email, reset instructions have been sent."
  }
}
```

The email contains a link to `{CLIENT_URL}/reset-password?token=...`.

### `POST /v1/auth/verify-reset-token`

Checks whether a reset token from the email link is still valid. This does not
consume the token.

Request:

```json
{
  "token": "reset-token-from-url"
}
```

Response `200`:

```json
{
  "data": { "valid": true }
}
```

Invalid or expired tokens return `400 INVALID_RESET_TOKEN`.

### `POST /v1/auth/reset-password`

Consumes a valid reset token, sets a new password, clears the token, and
revokes all refresh tokens for the user.

Request:

```json
{
  "token": "reset-token-from-url",
  "newPassword": "new-password123"
}
```

Response `200`:

```json
{
  "data": { "message": "Password has been reset" }
}
```

### `POST /v1/me/password`

Changes the signed-in user's password. Requires the access-token cookie.

Request:

```json
{
  "oldPassword": "current-password",
  "newPassword": "new-password123"
}
```

Response `200`:

```json
{
  "data": { "message": "Password has been updated" }
}
```

All refresh tokens are revoked and auth cookies are cleared, so the user signs
in again with the new password.

## Data model

`User`

- `email` unique, lowercase
- `passwordHash` optional, argon2 hash, not selected by default
- `googleId` unique sparse
- `publicId` unique opaque public identifier
- `role`: `user` or `admin`
- `status`: `active`, `suspended`, or `deleted`
- `emailVerifiedAt`
- `emailVerificationOtpHash` / `emailVerificationOtpExpiresAt`
- `passwordResetTokenHash` / `passwordResetExpiresAt`
- `lastLoginAt`, `deletedAt`

`RefreshToken`

- `user`
- `tokenHash` unique
- `familyId`
- `userAgent`
- `expiresAt` with TTL index
- `usedAt`, `revokedAt`

## Security notes

- Every request body is validated with strict Zod schemas before services run.
- Auth routes use Arcjet rate limits. Credential endpoints fail closed if
  Arcjet is unavailable; refresh fails open. Bot detection runs in `DRY_RUN`
  outside production and `LIVE` in production.
- Login and registration responses avoid revealing whether an email exists.
- Google profiles are never trusted from the client; only the verified ID
  token claims are used.
- Refresh-token reuse revokes the entire family.
- Password reset and password change revoke all refresh tokens.
- Passwords, OTPs, reset tokens, refresh tokens, and Google ID tokens are
  never logged or returned.

## Testing

`src/tests/user.routes.test.ts` uses `mongodb-memory-server` as a replica set
and `supertest` against the Express app. Email delivery and Google token
verification are mocked; no real third-party calls are made.

Run:

```bash
npx vitest run src/tests/user.routes.test.ts
npm run test:run
```

Covered flows include registration, OTP verification, login, Google login,
refresh rotation, refresh-token reuse, logout, `/v1/me`, forgot/verify/reset
password, and change password.
