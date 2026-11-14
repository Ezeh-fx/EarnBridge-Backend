import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { sanitizeEmailError } from '../lib/email/errors';
import {
  sendNotificationEmail,
  verifyEmailConnection,
} from '../services/email.service';

const recipientSchema = z.string().trim().email();

const main = async (): Promise<void> => {
  if (env.NODE_ENV === 'production') {
    throw new Error('Email smoke test is disabled in production');
  }

  const recipient = recipientSchema.parse(process.argv[2] ?? env.EMAIL_USER);

  await verifyEmailConnection();

  const delivery = await sendNotificationEmail(
    recipient,
    'EarnBridge email test',
    `This is a development-only email delivery test for ${env.EMAIL_APP_NAME}. If you received it, Gmail SMTP and the email templates are working.\n\nClient URL: ${env.CLIENT_URL}`
  );

  logger.info(
    {
      messageId: delivery.messageId,
      acceptedCount: delivery.acceptedCount,
      rejectedCount: delivery.rejectedCount,
    },
    'Email smoke test completed'
  );
};

main().catch((err: unknown) => {
  logger.error({ err: sanitizeEmailError(err) }, 'Email smoke test failed');
  process.exitCode = 1;
});
