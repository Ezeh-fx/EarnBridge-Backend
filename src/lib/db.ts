import dns from 'node:dns';
import mongoose from 'mongoose';

import { env } from '../config/env.js';
import {logger} from '../config/logger.js';

if (env.NODE_ENV === 'development' && env.DNS_SERVERS) {
  const dnsServers = env.DNS_SERVERS
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (dnsServers.length) {
    dns.setServers(dnsServers);
    logger.info('Development DNS servers configured');
  }
}

export const connectDatabase = async (): Promise<void> => {
  // NOTE: mongoose sanitizeFilter is intentionally NOT enabled — it wraps
  // any filter value containing $-operators in $eq, which breaks legitimate
  // queries like { expiresAt: { $gt: date } } and { revokedAt: { $exists: false } }.
  // Injection protection lives in express-mongo-sanitize + Zod validation.
  await mongoose.connect(env.MONGODB_URI);
  logger.info('MongoDB connected');
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
};
