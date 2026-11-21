import { z } from 'zod';

// Optional event callbacks share the endpoint but carry no reward, so they
// may omit payout_usd. Everything else must include a valid payout.
export const AYET_NON_FINANCIAL_CALLBACK_TYPES = [
  'installation',
  'optional',
  'iap',
  'iaa',
] as const;

const PAYOUT_PATTERN = /^-?\d+(\.\d{1,6})?$/;

// Strict: the callback URL macros are fixed in the ayeT dashboard, so any
// unexpected parameter means the integration config drifted. Every param is
// already authenticated by the HMAC on the raw query.
export const ayetCallbackSchema = z
  .strictObject({
    transaction_id: z.string().min(1).max(128),
    external_identifier: z.string().min(3).max(128),
    payout_usd: z.string().regex(PAYOUT_PATTERN).optional(),
    currency_amount: z.string().max(64).optional(),
    is_chargeback: z.enum(['0', '1']).optional(),
    callback_type: z.string().max(64).optional(),
    is_sandbox: z.enum(['0', '1']).optional(),
    adslot_id: z.string().max(64).optional(),
    offer_id: z.string().max(64).optional(),
    offer_name: z.string().max(200).optional(),
    event_name: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    const nonFinancial =
      value.callback_type !== undefined &&
      (AYET_NON_FINANCIAL_CALLBACK_TYPES as readonly string[]).includes(
        value.callback_type
      );
    if (!nonFinancial && value.payout_usd === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'payout_usd is required',
        path: ['payout_usd'],
      });
    }
  });

export type AyetCallbackInput = z.infer<typeof ayetCallbackSchema>;
