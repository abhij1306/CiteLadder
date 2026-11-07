import { z } from 'zod';
import { surfaceSupports, type SearchSurface } from './locations.ts';
import { policy, ConfigError } from '../config.ts';
import { resolveSettingSpec, type SettingSource } from '../config/settings.ts';
import { surfaceKindOf, type ProviderSettings } from '../providers/config.ts';
import {
  acceptedStatus,
  costMicrousd,
  dataforseoClient,
  envelopeStatusError,
} from '../providers/dataforseo.ts';
import { ProviderError } from '../providers/errors.ts';

export const searchPolicy = policy.dataforseo;
export type SearchEngine = SearchSurface;
/** An observed engine reached through DataForSEO's LLM scraper, with its scraper product. */
export type ScraperEngine = keyof typeof searchPolicy.scraper.products;
export const isScraperEngine = (engine: string): engine is ScraperEngine =>
  surfaceKindOf(engine) === 'llm_scraper' && Object.hasOwn(searchPolicy.scraper.products, engine);
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
const providerTaskSchema = z.looseObject({
  id: z.string().nullable().optional(),
  status_code: z.number().int(),
  cost: z.unknown().optional(),
  result: z.array(z.unknown()).nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const envelopeSchema = z.looseObject({
  status_code: z.number().int(),
  tasks: z.array(providerTaskSchema).nullable().optional(),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export class SubmissionUncertain extends ProviderError {
  readonly submission: { taskId: string | null; chargeMicrousd: number | null } | undefined;
  constructor(submission?: SubmissionUncertain['submission']) {
    super('submission_uncertain');
    this.submission = submission;
  }
}
export function searchSettings(env: SettingSource = process.env) {
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
  const accountPauseMinutes = Number(
    resolveSettingSpec(searchPolicy.settings.account_pause_minutes, env),
  );
  return { timeoutSeconds, recoveryDeadlineHours, accountPauseMinutes };
}
/** A consumer-app surface's DataForSEO product and request settings, frozen with each task. */
export function scraperConfiguration(engine: string) {
  const products: Record<string, string | undefined> = searchPolicy.scraper.products;
  const settings: Record<string, Record<string, unknown> | undefined> =
    searchPolicy.scraper.request_settings;
  const product = products[engine],
    requestSettings = settings[engine];
  if (!product || !requestSettings)
    throw new ConfigError(`Scraper surface ${engine} has no DataForSEO product`);
  return { provider_product: product, request_settings: requestSettings };
}
function providerPath(
  engine: SearchEngine,
  operation: 'task_post' | 'task_get/advanced' | 'id_list',
): string {
  if (operation === 'id_list')
    return isScraperEngine(engine)
      ? searchPolicy.scraper.id_list_path
      : searchPolicy.constants.path_id_list;
  if (isScraperEngine(engine))
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
  const scraper = isScraperEngine(engine);
  const limit = scraper ? searchPolicy.scraper.keyword_max_chars : c.keyword_max_chars;
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
  return scraper
    ? { ...input.request_settings, ...market }
    : {
        ...market,
        device: input.device,
        os: c.os_for_device[input.device],
        depth: input.depth,
        load_async_ai_overview: input.load_async_ai_overview,
      };
}
function requireAccepted(envelope: Envelope) {
  if (!acceptedStatus(envelope.status_code)) throw envelopeStatusError(envelope.status_code);
}

/** No internal retries. Paid POST, free retrieval and reconciliation are separate operations. */
export function createDataforseoClient(
  credential: { secret: string; base_url: string },
  providerSettings: ProviderSettings,
  timeoutSeconds: number,
  send: typeof fetch = globalThis.fetch,
  externalSignal?: AbortSignal,
) {
  const transport = dataforseoClient(
    { secret: credential.secret, baseUrl: credential.base_url },
    {
      settings: providerSettings,
      timeoutSeconds,
      maxResponseBytes: Number(
        resolveSettingSpec(searchPolicy.settings.max_response_bytes, process.env),
      ),
      send,
      ...(externalSignal ? { signal: externalSignal } : {}),
    },
  );
  /** The shared envelope, read with the task shape search surfaces rely on. */
  async function call(path: string, payload?: unknown, timeout?: number): Promise<Envelope> {
    const parsed = envelopeSchema.safeParse(await transport.call(path, payload, timeout));
    if (!parsed.success) throw new ProviderError('parse_error');
    return parsed.data;
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
      if (!acceptedStatus(task.status_code)) throw envelopeStatusError(task.status_code);
      const submission = {
        taskId: task.id?.trim() || null,
        chargeMicrousd: costMicrousd(task.cost),
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
