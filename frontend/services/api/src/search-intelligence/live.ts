import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProviderError } from '../answer-engines/contracts.ts';
import { providerSettings } from '../providers/config.ts';
import { approvedEndpoint, basicAuthorization } from '../providers/connections.ts';
import { boundedJson } from '../providers/response.ts';
import { providerErrorCode } from '../models/http.ts';
import { canonicalJson, si } from './requests.ts';
import { record } from '../db/json.ts';

export type ResearchResponse = {
  body: Record<string, unknown>;
  hash: string;
  taskId: string;
  cost: string | null;
};
const numericCost = (value: unknown) =>
  (typeof value === 'number' || typeof value === 'string') &&
  String(value).trim() &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? String(value)
    : null;
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
export type LiveTarget = { url: string; authorization: string };

/** Every local check a call needs, before its dispatch commits: nothing here is sent. */
export function resolveLive(
  input: LiveInput,
  env?: Record<string, string | undefined>,
): LiveTarget {
  if (
    ![...Object.values(si.endpoints), ...Object.values(si.broad_endpoints)].includes(input.endpoint)
  )
    throw new ProviderError('client_error');
  let pair: { login: string; password: string };
  try {
    pair = z
      .object({ login: z.string().min(1), password: z.string().min(1) })
      .parse(JSON.parse(input.secret));
  } catch {
    throw new ProviderError('auth_failure');
  }
  let base: string;
  try {
    base = approvedEndpoint('dataforseo', input.baseUrl, providerSettings(env));
  } catch {
    throw new ProviderError('client_error');
  }
  return {
    url: `${base}${input.endpoint}`,
    authorization: basicAuthorization(pair),
  };
}

/** One paid Live POST; classification and bounded retries belong to persisted dispatch evidence. */
export async function sendLive(
  target: LiveTarget,
  payload: Record<string, unknown>,
  options: LiveOptions = {},
): Promise<ResearchResponse> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(si.provider_timeout_seconds * 1000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let response: Response;
  try {
    response = await (options.send ?? fetch)(target.url, {
      method: 'POST',
      headers: {
        authorization: target.authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify([payload]),
      redirect: 'error',
      signal,
    });
  } catch {
    throw new ProviderError(signal.aborted ? 'timeout' : 'connection');
  }
  if (!response.ok) {
    const wait = retryAfterSeconds(response.headers.get('retry-after'));
    await response.body?.cancel();
    throw new ProviderError(providerErrorCode(response.status), false, wait);
  }
  let body: Record<string, unknown>;
  try {
    body = record(await boundedJson(response, si.provider_max_response_bytes, signal));
  } catch {
    throw new ProviderError(signal.aborted ? 'timeout' : 'parse_error');
  }
  return receipt(body);
}

/** A Retry-After header in seconds or as a date; undefined when absent or unreadable. */
function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const until = Date.parse(header);
  return Number.isFinite(until) ? Math.max(0, (until - Date.now()) / 1000) : undefined;
}

/** One successful task in one successful envelope, kept with its exact hash and cost. */
function receipt(body: Record<string, unknown>): ResearchResponse {
  const tasks = body.tasks;
  if (
    body.status_code !== 20000 ||
    !Array.isArray(tasks) ||
    tasks.length !== 1 ||
    record(tasks[0]).status_code !== 20000
  )
    throw new ProviderError('parse_error');
  const task = record(tasks[0]);
  const utf8Canonical = canonicalJson(body, false);
  return {
    body,
    hash: createHash('sha256').update(utf8Canonical).digest('hex'),
    taskId: typeof task.id === 'string' ? task.id.slice(0, 255) : '',
    cost: numericCost(task.cost) ?? numericCost(body.cost),
  };
}
