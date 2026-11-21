import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export const OFFERWALL_BASE_URL = 'https://offerwall.ayet.io/offers';

export const buildOfferwallLink = (publicId: string): string => {
  if (!env.AYET_ADSLOT_ID) {
    throw AppError.serviceUnavailable(
      'OFFERWALL_NOT_CONFIGURED',
      'Offerwall is not configured'
    );
  }

  const url = new URL(OFFERWALL_BASE_URL);
  url.searchParams.set('adSlot', env.AYET_ADSLOT_ID);
  url.searchParams.set('externalIdentifier', publicId);
  return url.toString();
};
