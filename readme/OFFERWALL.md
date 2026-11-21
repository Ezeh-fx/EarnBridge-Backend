# Offerwall & Rewarded Video (ayeT-Studios)

Earnbridge users earn rewards by completing offers in the ayeT-Studios
Web Offerwall and by watching rewarded videos. This service builds each
user's offerwall link and credits rewards from ayeT's server-to-server
callbacks. The API is the source of truth; the frontend only displays data.

Source of truth: https://docs.ayet.io (publishers → Offerwall, Callbacks).

## Endpoints

### `GET /v1/offerwall/link`

Authenticated. Returns the Web Offerwall URL for the signed-in user.

Response `200`:

```json
{
  "data": {
    "url": "https://offerwall.ayet.io/offers?adSlot=ADSLOT_ID&externalIdentifier=USER_PUBLIC_ID"
  }
}
```

`externalIdentifier` is the user's opaque `publicId` — never their email,
name, or database ID. The frontend opens this URL in a new tab or iframe.

### `GET /v1/callbacks/ayet`

Public, server-to-server. ayeT calls this URL for offerwall conversions,
rewarded video views, reversals (chargebacks), sandbox tests, and optional
event notifications. Configure it in the ayeT dashboard under
**Placements / Apps → Postback / Callbacks → Conversion Callback URL**.

Recommended callback URL macros:

```
https://<api>/v1/callbacks/ayet?transaction_id={transaction_id}&external_identifier={external_identifier}&payout_usd={payout_usd}&currency_amount={currency_amount}&is_chargeback={is_chargeback}&callback_type={callback_type}&is_sandbox={is_sandbox}&adslot_id={adslot_id}&offer_id={offer_id}&offer_name={offer_name}
```

Security:

- Every request must carry a valid `X-Ayetstudios-Security-Hash` header:
  HMAC-SHA256 of the canonicalized raw query string, keyed with the
  publisher API key (`AYET_CALLBACK_SECRET`). Implemented in
  `src/lib/ayet.ts` following the official Node.js reference.
- `AYET_CALLBACK_IP_WHITELIST` optionally restricts the endpoint to ayeT's
  published callback IPs. The signature check is the primary protection.
- The route is excluded from Arcjet bot rules in `app.ts`; ayeT's servers
  look like automated clients.

Responses: HTTP `200` for every verified callback — processed, duplicate,
unknown user, ignored, or malformed — so ayeT does not retry (it resends up
to 12 times otherwise). HTTP `403` only for missing/invalid signatures or
disallowed IPs. HTTP `503` for transient failures (e.g. DB outage) so ayeT
retries; idempotency makes retries safe.

## Processing rules

- **User mapping**: `external_identifier` → `User.publicId`. Unknown users
  are stored with status `unknown_user` and nobody is credited.
- **Dedupe**: `transaction_id` has a unique index on `callbackEvents`
  (`provider` + `transactionId`). Resends return `duplicate` and never
  credit twice.
- **Reward**: `payout_usd` (decimal string) is parsed directly into
  micro-USD integer — never through a float, never from `currency_amount`.
  The user is credited `payout × REWARD_SHARE_BPS / 10000`. Each ledger
  entry stores both the network payout and the credited amount for audit.
- **Reversal**: `is_chargeback=1` or `callback_type=chargeback`. The
  transaction ID is the original with an `r-` prefix; a `reversal` ledger
  entry is linked to the original reward via `relatedEntryId`. Reversals
  are always recorded and may take the balance below zero; withdrawals
  are blocked until the balance is positive again.
- **Sandbox** (`is_sandbox=1`): recorded, never credited. Stored under a
  suffixed dedupe key so it cannot collide with real conversions.
- **Optional events** (`callback_type` = `installation`, `optional`,
  `iap`, `iaa`): recorded, never credited, and stored under a suffixed
  dedupe key because they can share a `transaction_id` with the
  conversion they belong to.
- **Adslot check**: when `adslot_id` is present it must match
  `AYET_ADSLOT_ID` (offerwall) or `AYET_REWARDED_VIDEO_ADSLOT_ID`
  (rewarded video). Unknown adslots are recorded as `error` and not
  credited.
- **Rewarded video** uses the same endpoint and signature. Credit from
  server-to-server callbacks only — never also from the browser
  `callbackRewarded` result, or users get paid twice.

## Data model

- `callbackEvents` — every verified callback, deduplicated by
  `(provider, transactionId)`. Statuses: `received`, `processed`,
  `duplicate`, `unknown_user`, `error`.
- `ledgerEntries` — append-only. `reward` (positive) and `reversal`
  (negative, linked via `relatedEntryId`) entries written inside a MongoDB
  transaction together with the wallet update.
- `wallets` — cached `availableMicroUsd` / `heldMicroUsd`, updated with
  `$inc` in the same transaction as the ledger entry. `availableMicroUsd`
  may go negative after reversals.

## Configuration

| Variable | Purpose |
| --- | --- |
| `AYET_ADSLOT_ID` | Offerwall adslot ID used in the link |
| `AYET_REWARDED_VIDEO_ADSLOT_ID` | Rewarded Video adslot ID accepted in callbacks |
| `AYET_CALLBACK_SECRET` | Publisher API key for HMAC verification |
| `AYET_CALLBACK_IP_WHITELIST` | Optional comma-separated callback IP allowlist |
| `REWARD_SHARE_BPS` | User share of each payout in basis points (default 7000) |
| `CURRENCY_CODE` | Currency stored on ledger entries (default USD) |

## Testing

`src/tests/callback.routes.test.ts` and `src/tests/offerwall.routes.test.ts`
use `mongodb-memory-server` (replica set) and mock ayeT entirely — no real
calls. The signature tests include ayeT's official worked example and
canonicalization test vectors. Covered: valid conversion, rewarded video
adslot, duplicate resend, chargeback reversal (including negative
balance), unknown user, sandbox, optional events not blocking conversions,
unknown adslot, malformed callback, and invalid/missing signature.
