import { afterEach, expect, it, vi } from 'vitest';
import { agentSettings } from '../src/agent/config.ts';
import { gatewaySettings } from '../src/models/gateway.ts';
import { discoverySettings } from '../src/projects/discovery-inputs.ts';
import { generationInput } from '../src/prompts/generation-input.ts';
import { loadWorkerSettings, policy, resolveSettingSpec } from '../src/config.ts';
import { integrationSettings } from '../src/integrations/config.ts';
import { validateReferralRules } from '../src/config/referral-rules.ts';
import { generationSystemPrompt } from '../src/config/prompt-generation.ts';
import { publicUrl } from '../src/projects/safe-fetch.ts';

it.each(['https://example..com/', 'https://.example.com/'])(
  'rejects malformed DNS labels before acquisition: %s',
  (url) => {
    expect(() => publicUrl(url)).toThrow('invalid_url');
  },
);

it('rejects an unknown prompt cohort before model I/O', () => {
  expect(() =>
    generationSystemPrompt({ businessModel: 'retail', cohort: 'new_cohort' as 'core' }),
  ).toThrow('Unknown prompt cohort');
});

afterEach(() => vi.unstubAllEnvs());

it('resolves model aliases and rejects an unusable output budget', () => {
  expect(gatewaySettings({ default_agent_max_output_tokens: '2048' }).maxOutputTokens).toBe(2048);
  expect(() => gatewaySettings({ DEFAULT_AGENT_MAX_OUTPUT_TOKENS: '0' })).toThrow();
  for (const timeout of ['0', '-1'])
    expect(() => gatewaySettings({ DEFAULT_AGENT_TIMEOUT_SECONDS: timeout })).toThrow();
  expect(agentSettings({ AGENT_SKILLS_DIRECTORY: '/app/agent-skills' }).skillsDirectory).toBe(
    '/app/agent-skills',
  );
  expect(() => agentSettings({ DEFAULT_AGENT_LEASE_MARGIN_SECONDS: '0' })).toThrow();
});

it('bounds research retries', () => {
  expect(() =>
    discoverySettings({ BRAND_DISCOVERY_COMPETITOR_MODEL_MAXIMUM_ATTEMPTS: '4' }),
  ).toThrow();
});

it('resolves the generation count lazily and refuses an invalid default', () => {
  vi.stubEnv('GENERATION_DEFAULT_COUNT', '7');
  expect(generationInput.parse({}).count).toBe(7);
  vi.stubEnv('GENERATION_DEFAULT_COUNT', '0');
  expect(() => generationInput.parse({})).toThrow();
});

it('preserves integration credential aliases and refuses unsafe worker bounds', () => {
  expect(
    resolveSettingSpec(policy.settings.integration_google_client_id, {
      GOOGLE_OAUTH_CLIENT_ID: 'alias',
      INTEGRATION_GOOGLE_CLIENT_ID: 'canonical',
    }),
  ).toBe('canonical');
  expect(
    resolveSettingSpec(policy.settings.integration_microsoft_client_secret, {
      BING_OAUTH_CLIENT_SECRET: 'fixture-only',
    }),
  ).toBe('fixture-only');
  for (const budget of ['0', '-1', 'inf', 'nan']) {
    expect(() => loadWorkerSettings({ ANALYTICS_DRAIN_BUDGET_SECONDS: budget })).toThrow();
    expect(() => integrationSettings({ INTEGRATION_LEASE_TTL_SECONDS: budget })).toThrow();
  }
  for (const ttl of ['0', '-1']) {
    expect(() =>
      resolveSettingSpec(policy.integrations.state_ttl_seconds, {
        OAUTH_STATE_TTL_SECONDS: ttl,
      }),
    ).toThrow();
  }
  expect(() => integrationSettings({ INTEGRATION_HEARTBEAT_INTERVAL_SECONDS: '120' })).toThrow();
  expect(() => integrationSettings({ INTEGRATION_TOKEN_REFRESH_CLAIM_SECONDS: '60' })).toThrow();
  expect(() => integrationSettings({ INTEGRATION_SYNC_BACKFILL_MAX_DAYS: '20' })).toThrow();
  expect(() => integrationSettings({ INTEGRATION_RETRY_MAX_DELAY_SECONDS: '1' })).toThrow();
});

it('rejects ambiguous referral provenance and UTM rules matching every event', () => {
  const rules = structuredClone(policy.referrals);
  rules.ua_rules[0]!.rule_id = rules.host_rules[0]!.rule_id;
  expect(() => validateReferralRules(rules)).toThrow('unique');
  const unconstrained = {
    ...policy.referrals,
    utm_rules: [{ rule_id: 'unconstrained', utm_source: null, utm_medium: null }],
  };
  expect(() => validateReferralRules(unconstrained)).toThrow('constrain');
});
