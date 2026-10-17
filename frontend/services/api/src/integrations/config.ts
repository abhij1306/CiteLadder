import { createHmac } from 'node:crypto';
import { ConfigError, policy, resolveSettingSpec } from '../config.ts';
import { createSecretCipher } from './fernet.ts';

export const integrationPolicy = policy.integrations;
export const endpoints = integrationPolicy.transport;
export const codes = integrationPolicy.contracts;
export type IntegrationProvider = 'gsc' | 'ga4' | 'bing';
export type IntegrationTransport = 'google_oauth' | 'microsoft_oauth';
export type Dataset = (typeof integrationPolicy.datasets)[keyof typeof integrationPolicy.datasets];

export function integrationSettings(env: Record<string, string | undefined> = process.env) {
  const specs = integrationPolicy.settings;
  const settings = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, resolveSettingSpec(spec, env) as number]),
  ) as { [Key in keyof typeof specs]: number };
  if (settings.heartbeat_interval_seconds >= settings.lease_ttl_seconds) {
    throw new ConfigError('Integration heartbeat must be shorter than the lease');
  }
  if (settings.token_refresh_claim_seconds <= settings.sync_request_timeout_seconds) {
    throw new ConfigError('Integration refresh claim must outlive the provider timeout');
  }
  for (const name of ['sync_default_window_days', 'sync_late_data_revision_days'] as const) {
    if (settings[name] > settings.sync_backfill_max_days) {
      throw new ConfigError(`${name} must not exceed sync_backfill_max_days`);
    }
  }
  if (settings.retry_max_delay_seconds < settings.retry_base_delay_seconds) {
    throw new ConfigError('Integration maximum retry delay must cover the base delay');
  }
  return settings;
}

export function integrationSecrets(env: Record<string, string | undefined> = process.env) {
  const value = (name: keyof typeof policy.settings) =>
    resolveSettingSpec(policy.settings[name], env) as string;
  return {
    cipher: createSecretCipher(value('encryption_key')),
    frontendUrl: value('frontend_url').replace(/\/$/u, ''),
    // OAuth state signing key, derived so it is independent of the cipher key.
    stateSigningKey: createHmac('sha256', value('encryption_key'))
      .update('integration-oauth-state')
      .digest('hex'),
    stateTtl: resolveSettingSpec(integrationPolicy.state_ttl_seconds, env) as number,
    credentials: {
      google_oauth: {
        id: value('integration_google_client_id'),
        secret: value('integration_google_client_secret'),
      },
      microsoft_oauth: {
        id: value('integration_microsoft_client_id'),
        secret: value('integration_microsoft_client_secret'),
      },
    },
  };
}
