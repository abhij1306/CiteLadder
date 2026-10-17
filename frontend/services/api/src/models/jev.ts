import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { getLogger } from '../logging.ts';
import { assertMetered } from './meter-scope.ts';
import {
  defaultTransport,
  endpointUrl,
  ModelError,
  modelJson,
  parseEndpoint,
  postModel,
  providerErrorCode,
  type Transport,
} from './http.ts';

export function jevSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.models.jev;
  const setting = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return {
    apiKey: String(setting('api_key')).trim(),
    baseUrl: String(setting('base_url')).trim(),
    model: String(setting('model')),
    timeoutSeconds: Number(setting('timeout_seconds')),
    attempts: Number(setting('max_attempts')),
    baseDelaySeconds: Number(setting('backoff_seconds')),
    maxDelaySeconds: policy.models.quality.retry_after_cap_seconds,
  };
}
const decision = z.object({
  model: z.string().default(''),
  answers: z.record(z.string(), z.record(z.string(), z.unknown())),
  usage: z.record(z.string(), z.unknown()).optional(),
});

export function createJevClient(settings = jevSettings(), transport: Transport = defaultTransport) {
  if (!settings.apiKey) return null;
  const endpoint = parseEndpoint(settings.baseUrl);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ModelError('not_configured');
  }
  return {
    model: settings.model,
    async decide(state: unknown, questions: Record<string, unknown>, signal?: AbortSignal) {
      assertMetered('jev');
      const response = await postModel(
        endpointUrl(settings.baseUrl, '/v1/systemone'),
        settings.apiKey,
        { state, model: settings.model, questions },
        {
          ...settings,
          retryStatus: (status) => [429, 503, 529].includes(status),
          retryConnection: false,
        },
        transport,
        signal,
      );
      if (!response.ok)
        getLogger('app.connectors.jev').warning('jev call failed', {
          status: response.status,
          error_code: providerErrorCode(response.status),
        });
      const parsed = decision.safeParse(await modelJson(response));
      if (!parsed.success) throw new ModelError('parse');
      return parsed.data;
    },
  };
}
export type JevClient = NonNullable<ReturnType<typeof createJevClient>>;
