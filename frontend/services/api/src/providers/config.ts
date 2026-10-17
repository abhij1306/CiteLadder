import { policy, resolveSettingSpec } from '../config.ts';

export const providerPolicy = policy.providers;
export type Engine = keyof typeof providerPolicy.routes;
export type ProviderTransport = 'openai' | 'google' | 'anthropic' | 'dataforseo';

export function providerSettings(env: Record<string, string | undefined> = process.env) {
  const spec = providerPolicy.settings;
  return {
    endpoints: {
      openai: String(resolveSettingSpec(spec.openai_responses_url, env)),
      google: String(resolveSettingSpec(spec.google_interactions_url, env)),
      anthropic: String(resolveSettingSpec(spec.anthropic_messages_url, env)),
      dataforseo: String(resolveSettingSpec(providerPolicy.dataforseo.base_url, env)),
    },
    timeoutSeconds: Number(resolveSettingSpec(spec.test_timeout_seconds, env)),
    outputTokens: Number(resolveSettingSpec(spec.test_max_output_tokens, env)),
    anthropicVersion: String(resolveSettingSpec(spec.anthropic_version, env)),
    anthropicMaxUses: Number(resolveSettingSpec(spec.anthropic_max_uses, env)),
    keyGraceDays: Number(resolveSettingSpec(spec.byok_key_grace_days, env)),
    maxResponseBytes: Number(resolveSettingSpec(spec.max_response_bytes, env)),
    dataforseoTimeout: Number(
      resolveSettingSpec(providerPolicy.dataforseo.test_timeout_seconds, env),
    ),
  };
}
export type ProviderSettings = ReturnType<typeof providerSettings>;

/**
 * OpenAI reasoning control for a route's effort. `off` maps to `none` for
 * models that accept it; supported levels are sent explicitly, since a model's
 * own default (e.g. `medium`) costs more than the configured route effort.
 */
export function openaiReasoning(effort: string | null | undefined) {
  if (effort === 'off') return { reasoning: { effort: 'none' } };
  return effort && ['low', 'medium', 'high'].includes(effort) ? { reasoning: { effort } } : {};
}
