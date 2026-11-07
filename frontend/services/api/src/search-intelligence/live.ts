import { createHash } from 'node:crypto';
import { ProviderError } from '../providers/errors.ts';
import { providerSettings } from '../providers/config.ts';
import {
  dataforseoClient,
  envelopeStatusError,
  reportedCost,
  type DataforseoClient,
} from '../providers/dataforseo.ts';
import { policy } from '../config.ts';
import type { SettingSource } from '../config/settings.ts';
import { si } from './requests.ts';
import { canonicalJson } from '../canonical-json.ts';
import { record } from '../db/json.ts';

export type ResearchResponse = {
  body: Record<string, unknown>;
  hash: string;
  taskId: string;
  cost: string | null;
};
type LiveInput = {
  /** The DataForSEO login pair as JSON, decrypted by the credential owner. */
  secret: string;
  endpoint: string;
  baseUrl: string;
};
type LiveOptions = {
  send?: typeof fetch;
  signal?: AbortSignal;
};
/** A resolved paid target: the approved endpoint path on a client that sends nothing yet. */
export type LiveTarget = { endpoint: string; credential: { secret: string; baseUrl: string } };

/** Every local check a call needs, before its dispatch commits: nothing here is sent. */
export function resolveLive(input: LiveInput, env?: SettingSource): LiveTarget {
  if (
    ![...Object.values(si.endpoints), ...Object.values(si.broad_endpoints)].includes(input.endpoint)
  )
    throw new ProviderError('client_error');
  const credential = { secret: input.secret, baseUrl: input.baseUrl };
  liveClient(credential, providerSettings(env));
  return { endpoint: input.endpoint, credential };
}

function liveClient(
  credential: LiveTarget['credential'],
  settings: ReturnType<typeof providerSettings>,
  options: LiveOptions = {},
): DataforseoClient {
  return dataforseoClient(credential, {
    settings,
    timeoutSeconds: si.provider_timeout_seconds,
    maxResponseBytes: si.provider_max_response_bytes,
    ...options,
  });
}

/** One paid Live POST; classification and bounded retries belong to persisted dispatch evidence. */
export async function sendLive(
  target: LiveTarget,
  payload: Record<string, unknown>,
  options: LiveOptions & { env?: SettingSource } = {},
): Promise<ResearchResponse> {
  const { env, ...transport } = options;
  const client = liveClient(target.credential, providerSettings(env), transport);
  return receipt(record(await client.call(target.endpoint, [payload])));
}

/** One successful task in one successful envelope, kept with its exact hash and cost. */
function receipt(body: Record<string, unknown>): ResearchResponse {
  const tasks = body.tasks;
  if (body.status_code !== policy.dataforseo.constants.status_ok)
    throw new ProviderError('parse_error');
  if (!Array.isArray(tasks) || tasks.length !== 1) throw new ProviderError('parse_error');
  const task = record(tasks[0]);
  // A refused task (unauthorized login, unavailable account) means what it means for every product.
  if (task.status_code !== policy.dataforseo.constants.status_ok)
    throw typeof task.status_code === 'number'
      ? envelopeStatusError(task.status_code)
      : new ProviderError('parse_error');
  const utf8Canonical = canonicalJson(body, false);
  const cost = reportedCost(task.cost) ?? reportedCost(body.cost);
  return {
    body,
    hash: createHash('sha256').update(utf8Canonical).digest('hex'),
    taskId: typeof task.id === 'string' ? task.id.slice(0, 255) : '',
    cost: cost === null ? null : String(cost),
  };
}
