// Sends a locally-signed ayeT-style callback to the running API.
// Usage: npx tsx scripts/test-callback.ts [options]
//   --external-id <id>   external_identifier (default: test-user-id)
//   --payout <usd>       payout_usd (default: 0.10)
//   --tx <id>            transaction_id (default: test-callback-1)
//   --type <type>        callback_type (default: conversion)
//   --adslot <id>        adslot_id (default: AYET_ADSLOT_ID)
//   --real               omit is_sandbox (default sends is_sandbox=1)
//   --port <port>        API port (default: PORT env or 3000)
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { canonicalAyetQuery } from '../src/lib/ayet.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name: string): boolean => args.includes(`--${name}`);

const apiKey = process.env.AYET_CALLBACK_SECRET;
const adslotId = flag('adslot') ?? process.env.AYET_ADSLOT_ID;

if (!apiKey) {
  console.error('AYET_CALLBACK_SECRET is not set in .env');
  process.exit(1);
}
if (!adslotId) {
  console.error('No adslot_id: pass --adslot or set AYET_ADSLOT_ID');
  process.exit(1);
}

const params: Record<string, string> = {
  transaction_id: flag('tx') ?? 'test-callback-1',
  external_identifier: flag('external-id') ?? 'test-user-id',
  payout_usd: flag('payout') ?? '0.10',
  currency_amount: '100',
  is_chargeback: '0',
  callback_type: flag('type') ?? 'conversion',
  adslot_id: adslotId,
  offer_id: '123',
  offer_name: 'Test+Offer',
};
if (!has('real')) {
  params.is_sandbox = '1';
}

const rawQuery = new URLSearchParams(params).toString();
const canonical = canonicalAyetQuery(rawQuery);
if (!canonical) {
  console.error('Generated query is outside the supported subset');
  process.exit(1);
}

const signature = createHmac('sha256', apiKey)
  .update(canonical.canonical)
  .digest('hex');

const port = flag('port') ?? process.env.PORT ?? '3000';
const url = `http://localhost:${port}/v1/callbacks/ayet?${rawQuery}`;

console.log('Canonical query:', canonical.canonical);
console.log('Signature:', signature);
console.log('Requesting:', url.replace(apiKey, '***'), '\n');

const res = await fetch(url, {
  headers: { 'X-Ayetstudios-Security-Hash': signature },
});
console.log('Status:', res.status);
console.log('Body:', await res.text());
