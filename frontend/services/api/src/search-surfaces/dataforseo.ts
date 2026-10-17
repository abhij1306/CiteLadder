import { z } from 'zod';
import { surfaceSupports, type SearchSurface } from './locations.ts';
import { policy, resolveSettingSpec, ConfigError } from '../config.ts';
import { providerErrorCode } from '../models/http.ts';
import { approvedEndpoint, basicAuthorization } from '../providers/connections.ts';
import { type ProviderSettings } from '../providers/config.ts';
import { ProviderError } from '../answer-engines/contracts.ts';
import { round } from '../analysis/round.ts';
import { boundedJson } from '../providers/response.ts';

export const searchPolicy = policy.dataforseo;
export type SearchEngine = SearchSurface;
export type SearchRequest = {
  query: string;
  location_code: number;
  language_code: string;
  device: 'desktop' | 'mobile';
  depth: number;
  load_async_ai_overview: boolean;
  timeout_seconds: number;
  provider_submission_ref: string;
  request_settings: Record<string, unknown>;
};
const providerTaskSchema = z
  .object({
    id: z.string().nullable().optional(),
    status_code: z.number().int(),
    cost: z.number().nonnegative().nullable().optional(),
    result: z.array(z.unknown()).nullable().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const envelopeSchema = z
  .object({
    status_code: z.number().int(),
    tasks: z.array(providerTaskSchema).nullable().optional(),
  })
  .passthrough();
export type Envelope = z.infer<typeof envelopeSchema>;
export class SubmissionUncertain extends ProviderError {
  readonly submission: { taskId: string | null; chargeMicrousd: number | null } | undefined;
  constructor(submission?: SubmissionUncertain['submission']) {
    super('submission_uncertain');
    this.submission = submission;
  }
}
export function searchSettings(env: Record<string, string | undefined> = process.env) {
  const timeoutSeconds = Number(
    resolveSettingSpec(searchPolicy.settings.request_timeout_seconds, env),
  );
  const recoveryDeadlineHours = Number(
    resolveSettingSpec(searchPolicy.settings.recovery_deadline_hours, env),
  );
  if (!(recoveryDeadlineHours > 0 && recoveryDeadlineHours < 24 * 28))
    throw new ConfigError(
      'DataForSEO recovery deadline must be positive and shorter than provider retention',
    );
  return { timeoutSeconds, recoveryDeadlineHours };
}
export function providerCharge(cost: unknown): number | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
  const result = round(cost * searchPolicy.microusd_per_usd, 0);
  return Number.isSafeInteger(result) ? result : null;
}
function providerPath(
  engine: SearchEngine,
  operation: 'task_post' | 'task_get/advanced' | 'id_list',
): string {
  const scraper = engine !== 'google_ai_overview';
  if (operation === 'id_list')
    return scraper ? searchPolicy.scraper.id_list_path : searchPolicy.constants.path_id_list;
  if (scraper)
    return `/v3/ai_optimization/${searchPolicy.scraper.products[engine]}/llm_scraper/${operation}`;
  return operation === 'task_post'
    ? searchPolicy.constants.path_task_post
    : searchPolicy.constants.path_task_get_advanced;
}
export function searchPayload(engine: SearchEngine, input: SearchRequest) {
  const c = searchPolicy.constants;
  if (!input.provider_submission_ref || input.provider_submission_ref.length > c.tag_max_chars)
    throw new ProviderError('invalid_submission_ref');
  // DataForSEO treats percent and plus characters as encoding syntax.
  const keyword = input.query.replaceAll('%', '%25').replaceAll('+', '%2B');
  const limit =
    engine === 'google_ai_overview' ? c.keyword_max_chars : searchPolicy.scraper.keyword_max_chars;
  if (Array.from(keyword).length > limit) throw new ProviderError('keyword_too_long');
  if (
    !surfaceSupports(engine, input.location_code, input.language_code) ||
    !c.supported_devices.includes(input.device)
  )
    throw new ProviderError('invalid_search_context');
  const market = {
    keyword,
    location_code: input.location_code,
    language_code: input.language_code,
    tag: input.provider_submission_ref,
  };
  return engine === 'google_ai_overview'
    ? {
        ...market,
        device: input.device,
        os: c.os_for_device[input.device],
        depth: input.depth,
        load_async_ai_overview: input.load_async_ai_overview,
      }
    : { ...input.request_settings, ...market };
}
function rejectStatus(status: number) {
  return new ProviderError(
    status === searchPolicy.constants.status_unauthorized ? 'auth_failure' : 'client_error',
  );
}
function requireAccepted(envelope: Envelope) {
  if (!searchPolicy.constants.accepted_submission_status_codes.includes(envelope.status_code))
    throw rejectStatus(envelope.status_code);
}

/** No internal retries. Paid POST, free retrieval and reconciliation are separate operations. */
export function createDataforseoClient(
  credential: { secret: string; base_url: string },
  providerSettings: ProviderSettings,
  timeoutSeconds: number,
  send: typeof fetch = globalThis.fetch,
  externalSignal?: AbortSignal,
) {
  let pair: { login: string; password: string };
  try {
    pair = z
      .object({ login: z.string().min(1), password: z.string().min(1) })
      .parse(JSON.parse(credential.secret));
  } catch {
    throw new ProviderError('auth_failure');
  }
  const base = approvedEndpoint('dataforseo', credential.base_url, providerSettings);
  const maxBytes = Number(
    resolveSettingSpec(searchPolicy.settings.max_response_bytes, process.env),
  );
  const authorization = basicAuthorization(pair);
  async function call(
    path: string,
    payload?: unknown,
    timeout = timeoutSeconds,
  ): Promise<Envelope> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout * 1000),
      ...(externalSignal ? [externalSignal] : []),
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
      await response.body?.cancel();
      throw new ProviderError(
        providerErrorCode(response.status),
        response.status === 429 || response.status >= 500,
      );
    }
    let responsePayload: unknown;
    try {
      responsePayload = await boundedJson(response, maxBytes, signal);
      const status = z.object({ status_code: z.number().int() }).parse(responsePayload).status_code;
      if (!searchPolicy.constants.accepted_submission_status_codes.includes(status))
        throw rejectStatus(status);
      return envelopeSchema.parse(responsePayload);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(signal.aborted ? 'timeout' : 'parse_error', signal.aborted);
    }
  }
  return {
    async submit(engine: SearchEngine, input: SearchRequest) {
      const body = [searchPayload(engine, input)];
      let envelope: Envelope;
      try {
        envelope = await call(providerPath(engine, 'task_post'), body, input.timeout_seconds);
      } catch (error) {
        if (
          error instanceof ProviderError &&
          ['connection', 'timeout', 'parse_error', 'server_error'].includes(error.code)
        )
          throw new SubmissionUncertain();
        throw error;
      }
      requireAccepted(envelope);
      const task = envelope.tasks?.[0];
      if (!task) throw new SubmissionUncertain();
      if (!searchPolicy.constants.accepted_submission_status_codes.includes(task.status_code))
        throw rejectStatus(task.status_code);
      const submission = {
        taskId: task.id?.trim() || null,
        chargeMicrousd: providerCharge(task.cost),
      };
      if (!submission.taskId) throw new SubmissionUncertain(submission);
      return { ...submission, taskId: submission.taskId, envelope };
    },
    async retrieve(engine: SearchEngine, taskId: string) {
      if (!taskId || !/^[\w-]+$/u.test(taskId)) throw new ProviderError('invalid_task_id');
      return call(`${providerPath(engine, 'task_get/advanced')}/${taskId}`);
    },
    async reconcilePage(engine: SearchEngine, from: Date, to: Date, offset: number) {
      if (to.getTime() >= Date.now() || to <= from || offset < 0 || !Number.isSafeInteger(offset))
        throw new ProviderError('invalid_reconciliation_window');
      const timestamp = (date: Date) =>
        `${date.toISOString().slice(0, 19).replace('T', ' ')} +00:00`;
      const envelope = await call(providerPath(engine, 'id_list'), [
        {
          datetime_from: timestamp(from),
          datetime_to: timestamp(to),
          offset,
          limit: searchPolicy.constants.reconcile_page_size,
          include_metadata: true,
        },
      ]);
      requireAccepted(envelope);
      return envelope;
    },
  };
}
