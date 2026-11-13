/**
 * The one DataForSEO envelope client: every DataForSEO product (audit search
 * surfaces and Keyword Research) sends through `call`, so a refused account,
 * an unauthorized login and a malformed body mean the same thing everywhere.
 */
import { retryAfterSeconds } from '@citeladder/contracts/retry-after';
import { z } from 'zod';
import { policy } from '../config.ts';
import { providerErrorCode } from '../models/http.ts';
import { round } from '../numbers.ts';
import { approvedEndpoint, basicAuthorization } from './connections.ts';
import type { ProviderSettings } from './config.ts';
import { ProviderError } from './errors.ts';
import { boundedJson } from './response.ts';

const constants = policy.dataforseo.constants;
const taskSchema = z.looseObject({ status_code: z.number().int() });
const envelopeSchema = z.looseObject({
  status_code: z.number().int(),
  tasks: z.array(taskSchema).nullable().optional(),
});
/** An accepted envelope; everything beyond the status codes is the provider's, kept as sent. */
type Envelope = z.infer<typeof envelopeSchema>;

type DataforseoTransport = {
  settings: ProviderSettings;
  timeoutSeconds: number;
  maxResponseBytes: number;
  send?: typeof fetch;
  signal?: AbortSignal;
};

/** What a refused envelope or task status means: one mapping for every product. */
export function envelopeStatusError(status: number): ProviderError {
  if (status === constants.status_unauthorized) return new ProviderError('auth_failure');
  // A paused, unfunded or unsubscribed account refuses every request until it is restored.
  if (constants.account_unavailable_status_codes.includes(status))
    return new ProviderError(constants.error_account_unavailable);
  return new ProviderError('client_error');
}

/** Whether a status code is one DataForSEO accepts (done or queued). */
export const acceptedStatus = (status: number) =>
  constants.accepted_submission_status_codes.includes(status);

/** A reported USD cost as a finite non-negative number; null when absent or unreadable. */
export function reportedCost(value: unknown): number | null {
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** A reported USD cost in whole micro-USD; null when absent, unreadable or out of range. */
export function costMicrousd(value: unknown): number | null {
  const cost = reportedCost(value);
  if (cost === null) return null;
  const result = round(cost * policy.dataforseo.microusd_per_usd, 0);
  return Number.isSafeInteger(result) ? result : null;
}

/**
 * A client for one DataForSEO login pair (JSON `{login, password}`) at an
 * approved base URL. Every local check runs here, before anything is sent: an
 * unreadable credential is an auth failure, an unapproved endpoint a client
 * error. No internal retries.
 */
export function dataforseoClient(
  credential: { secret: string; baseUrl: string },
  transport: DataforseoTransport,
) {
  let pair: { login: string; password: string };
  try {
    pair = z
      .object({ login: z.string().min(1), password: z.string().min(1) })
      .parse(JSON.parse(credential.secret));
  } catch {
    throw new ProviderError('auth_failure');
  }
  let base: string;
  try {
    base = approvedEndpoint('dataforseo', credential.baseUrl, transport.settings);
  } catch {
    throw new ProviderError('client_error');
  }
  const authorization = basicAuthorization(pair);
  const send = transport.send ?? globalThis.fetch;
  /** One request: a GET without payload, a POST with one. Refused envelopes throw. */
  async function call(
    path: string,
    payload?: unknown,
    timeoutSeconds = transport.timeoutSeconds,
  ): Promise<Envelope> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutSeconds * 1000),
      ...(transport.signal ? [transport.signal] : []),
    ]);
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        signal,
        redirect: 'error',
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      throw new ProviderError(signal.aborted ? 'timeout' : 'connection', true);
    }
    if (!response.ok) {
      const wait = retryAfterSeconds(response.headers.get('retry-after'));
      await response.body?.cancel();
      throw new ProviderError(
        providerErrorCode(response.status),
        response.status === 429 || response.status >= 500,
        wait,
      );
    }
    try {
      const body = await boundedJson(response, transport.maxResponseBytes, signal);
      const status = z.object({ status_code: z.number().int() }).parse(body).status_code;
      if (!acceptedStatus(status)) throw envelopeStatusError(status);
      return envelopeSchema.parse(body);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(signal.aborted ? 'timeout' : 'parse_error', signal.aborted);
    }
  }
  return { call };
}
export type DataforseoClient = ReturnType<typeof dataforseoClient>;
