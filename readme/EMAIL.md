# Email Service

## Overview

Earnbridge uses a centralized email delivery layer built with Nodemailer and Gmail SMTP. The service is designed for reuse across authentication, account notifications, support workflows, and future background jobs.

The implementation is split into three layers:

- `src/lib/email/` wraps the SMTP provider and exposes a small provider interface.
- `src/services/email.templates.ts` renders EJS email templates.
- `src/services/email.service.ts` validates input, renders templates, sends email, maps errors, and exposes reusable functions.

No public HTTP endpoint is exposed for email delivery. Other backend services import the service functions directly.

## Configuration

Email settings are validated when the application starts. Add these values to `.env`:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=your-gmail-address@gmail.com
EMAIL_PASSWORD=your-google-app-password
EMAIL_FROM=your-gmail-address@gmail.com
# Optional sender display name. Defaults to EMAIL_APP_NAME when empty.
EMAIL_FROM_NAME=EarnBridge
EMAIL_APP_NAME=EarnBridge
CLIENT_URL=http://localhost:5173
```

`CLIENT_URL` is used for links inside emails. `FRONTEND_ORIGIN` remains the CORS origin.

### Gmail App Password setup

1. Enable two-factor authentication on the Google account used for sending.
2. Open Google Account security settings.
3. Generate an App Password for "Mail" or "Other" as appropriate for the account type.
4. Copy the generated 16-character code into `EMAIL_PASSWORD` without the display spaces.
5. Do not use the normal Gmail account password.
6. Keep `.env` private and never commit it.

For local Gmail SMTP, `EMAIL_USER`, `EMAIL_FROM`, and the Gmail account should normally match unless a verified send-as alias is configured.

## Usage

Import the reusable functions from `src/services/email.service.ts`:

```ts
import {
  sendEmail,
  sendVerificationOTPEmail,
  sendPasswordResetEmail,
  sendNotificationEmail,
  verifyEmailConnection,
} from './services/email.service';
```

Examples:

```ts
await sendVerificationOTPEmail(user.email, otp, { expiresInMinutes: 10 });

await sendPasswordResetEmail(user.email, resetUrl, { expiresInMinutes: 30 });

await sendNotificationEmail(
  user.email,
  'Withdrawal update',
  'Your withdrawal request is being reviewed.'
);

await sendEmail({
  to: ['user@example.com', 'admin@example.com'],
  subject: 'Manual notice',
  html: '<p>Hello</p>',
  text: 'Hello',
});
```

The service returns delivery metadata:

```ts
{
  messageId: string;
  acceptedCount: number;
  rejectedCount: number;
}
```

OTP generation, reset-token generation, and account lookups remain outside this service. Callers provide the already-generated OTP or reset URL.

## Templates

Templates live in `src/services/email/templates/` and are rendered with EJS.

Available templates:

- `verification-otp`
- `password-reset`
- `account-notification`

Each template has an HTML version and a plain-text version. HTML templates escape dynamic values. Plain-text versions preserve readable formatting.

The production build copies templates to `dist/services/email/templates/` through the `postbuild` script.

## SMTP verification and test email

Verify Gmail SMTP and send a real test email locally with:

```bash
npm run email:test -- you@example.com
```

If no recipient is provided, the script sends the test to `EMAIL_USER`. The script is disabled when `NODE_ENV=production` and is not exposed as an API route.

## Error handling

The service validates input with Zod before calling the provider. Provider failures are logged with sanitized SMTP details and converted to application errors:

- `EMAIL_AUTH_FAILED` for SMTP authentication failures.
- `EMAIL_CONNECTION_FAILED` for timeouts and unavailable SMTP connections.
- `EMAIL_RECIPIENT_REJECTED` for recipient rejection responses.
- `EMAIL_DELIVERY_FAILED` for other delivery failures.
- `EMAIL_TEMPLATE_RENDER_FAILED` for template rendering failures.

Logs include the operation, error name/code/response code, and a truncated message. They do not include Gmail App Passwords, OTP values, or password-reset tokens/URLs.

## Security considerations

- SMTP credentials are read only from environment variables.
- `.env` is ignored by git.
- Nodemailer uses a single reusable transporter with connection, greeting, and socket timeouts.
- Email input is validated and unexpected fields are rejected.
- HTML email content escapes dynamic template values.
- The provider interface keeps SMTP-specific details separate from callers, allowing a future provider migration without changing templates or business logic.
- BullMQ/Redis background email processing is documented in `AGENTS.md` as a future enhancement and is not implemented.

## Testing

Automated tests use mocked transports and never send real email:

```bash
npm run test:run -- src/tests/email.provider.test.ts src/tests/email.templates.test.ts src/tests/email.service.test.ts
```

Covered behavior includes SMTP option construction, connection verification, successful sends, invalid recipients, authentication failures, timeouts, template rendering, HTML/plain-text output, and service error mapping.
