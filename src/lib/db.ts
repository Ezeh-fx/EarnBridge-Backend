import dns from 'node:dns';
import mongoose from 'mongoose';

import { env } from '../config/env';
import {logger} from '../config/logger';

if (env.NODE_ENV === 'development' && env.DNS_SERVERS) {
  const dnsServers = env.DNS_SERVERS
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (dnsServers.length) {
    dns.setServers(dnsServers);
    logger.info(
      // { dnsServers },
      'Development DNS servers configured',
    );
  }
}

export const connectDatabase = async (): Promise<void> => {
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(env.MONGODB_URI);
  if (env.NODE_ENV === 'development' && env.MONGODB_URI === 'mongodb://localhost:27017/test-earnbridge') {
    logger.info('MongoDB connected (Local Host)');
  }else{
    logger.info('MongoDB connected (Live Server)');
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  if (env.NODE_ENV === 'development' && env.MONGODB_URI === 'mongodb://localhost:27017/test-earnbridge') {
    logger.info('MongoDB disconnected (Local Host)');
  }else{
    logger.info('MongoDB disconnected (Live Server)');
  }
};
