import { env } from './config/env';
import { logger } from './config/logger';
import { registerProcessHandlers } from './middleware/errorHandler';
import { connectDatabase, disconnectDatabase } from './lib/db';
import { app } from './app';

registerProcessHandlers();

const port = Number(env.PORT);

try {
  await connectDatabase();
} catch (err) {
  logger.fatal({ err }, 'Failed to connect to MongoDB');
  process.exit(1);
}

const server = app.listen(port, () => {
  logger.info({ port, env: env.NODE_ENV }, 'Server listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');

  server.close(async () => {
    try {
      await disconnectDatabase();
    } catch (err) {
      logger.error({ err }, 'Error while disconnecting MongoDB');
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
