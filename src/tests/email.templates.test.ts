import { describe, expect, it } from 'vitest';
import { AppError } from '../lib/errors';
import {
  renderEmailTemplate,
  type EmailTemplateName,
} from '../services/email.templates';

const baseData = {
  appName: 'EarnBridge & Co',
  clientUrl: 'http://localhost:5173/account?source=email&campaign=test',
  currentYear: 2026,
};

describe('renderEmailTemplate', () => {
  it('renders the verification OTP template with HTML and plain text', async () => {
    const result = await renderEmailTemplate('verification-otp', {
      ...baseData,
      otp: '123456',
      expiresInMinutes: 10,
    });

    expect(result.html).toContain('123456');
    expect(result.html).toContain('EarnBridge &amp; Co');
    expect(result.html).toContain('expires in 10 minutes');
    expect(result.text).toContain('123456');
    expect(result.text).toContain('EarnBridge & Co');
  });

  it('renders the password reset template and escapes the reset URL in HTML', async () => {
    const resetUrl =
      'https://app.example.com/reset-password?token=abc123&foo=bar';
    const result = await renderEmailTemplate('password-reset', {
      ...baseData,
      resetUrl,
      expiresInMinutes: 30,
    });

    expect(result.html).toContain('token=abc123&amp;foo=bar');
    expect(result.html).toContain('expires in 30 minutes');
    expect(result.text).toContain('token=abc123&foo=bar');
    expect(result.text).toContain('expires in 30 minutes');
  });

  it('escapes notification HTML while preserving plain text', async () => {
    const result = await renderEmailTemplate('account-notification', {
      ...baseData,
      title: 'Account update',
      message: 'First line\n<img src=x onerror=alert(1)>',
    });

    expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(result.html).toContain('white-space: pre-line');
    expect(result.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('returns a sanitized application error when rendering fails', async () => {
    await expect(
      renderEmailTemplate('missing-template' as EmailTemplateName, baseData)
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'EMAIL_TEMPLATE_RENDER_FAILED',
    });

    await expect(
      renderEmailTemplate('missing-template' as EmailTemplateName, baseData)
    ).rejects.toBeInstanceOf(AppError);
  });
});
