import { timingSafeEqual } from 'node:crypto';
import { reject } from '../../domain/errors';

export type SendblueConfig = Readonly<{
  enabled: boolean;
  account?: string;
  line?: string;
  keyId?: string;
  apiSecret?: string;
  signingSecret?: string;
}>;
export const phoneNumber = /^\+[1-9]\d{7,14}$/;
export function sendblueConfig(env: NodeJS.ProcessEnv = process.env): SendblueConfig {
  return Object.freeze({ enabled: env.NEMOPAL_SENDBLUE_ENABLED === 'true', account: env.SENDBLUE_ACCOUNT_EMAIL,
    line: env.SENDBLUE_RECEIVING_LINE, keyId: env.SENDBLUE_API_KEY_ID, apiSecret: env.SENDBLUE_API_SECRET_KEY,
    signingSecret: env.SENDBLUE_WEBHOOK_SECRET });
}
export function capability(config: SendblueConfig) {
  const state = !config.enabled ? 'disabled' : !config.account || config.account.length > 254 || !phoneNumber.test(config.line ?? '') ||
    ![config.keyId, config.apiSecret, config.signingSecret].every(value => value && value.length >= 8 && value.length <= 512) ? 'unconfigured' : 'configured';
  return { state, available: state === 'configured', transport: 'iMessage_or_SMS' } as const;
}
export function requireSendblue(config: SendblueConfig) {
  const { state } = capability(config);
  if (state !== 'configured') reject(503, `sendblue_${state}`, 'Phone messaging is unavailable.');
}
export function authenticateWebhook(config: SendblueConfig, secret: unknown) {
  requireSendblue(config);
  // Ordinary Sendblue webhooks carry a separate shared secret, not a Verify-product HMAC.
  if (typeof secret !== 'string' || secret.length > 512) reject(401, 'sendblue_auth', 'Webhook authorization failed.');
  const actual = Buffer.from(secret), expected = Buffer.from(config.signingSecret!);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) reject(401, 'sendblue_auth', 'Webhook authorization failed.');
}
