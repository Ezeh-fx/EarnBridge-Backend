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
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(env.MONGODB_URI);
  logger.info('MongoDB connected');
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
};
