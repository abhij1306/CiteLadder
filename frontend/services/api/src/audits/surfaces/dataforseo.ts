/**
 * The phases every DataForSEO-observed surface shares: commit the paid intent, submit
 * once, reconcile an uncertain submission by its exact tag, then poll the free retrieval.
 * Never resubmits: once an intent is committed only reconciliation and retrieval follow.
 */
import { z } from 'zod';
import { record } from '../../db/json.ts';
import { getLogger } from '../../logging.ts';
import { ProviderError } from '../../providers/errors.ts';
import { ownedAuditTask, type AuditTask } from '../../queue/audit-queue.ts';
import {
  createDataforseoClient,
  searchPayload,
  searchPolicy,
  SubmissionUncertain,
  type SearchEngine,
  type SearchRequest,
} from '../../search-surfaces/dataforseo.ts';
import { reconcilePage } from '../../search-surfaces/reconciliation.ts';
import { isSearchSurface } from '../../search-surfaces/locations.ts';
import { providerPolicy } from '../../providers/config.ts';
import {
  pauseExecutionCredential,
  pauseUnavailableAccount,
  type ExecutionContext,
} from '../execution-context.ts';
import { readFrozenSearchRequest } from '../frozen-configuration.ts';
import { commitSubmissionIntent } from '../submission-intent.ts';
import { persistSurfaceExchange } from '../surface-persistence.ts';
import type { PhaseDeps, SurfaceAdapter, TaskFailure } from './adapter.ts';

const logger = getLogger('workers.audit');
const reconciliationState = z.object({
  offset: z.number().int().nonnegative(),
  matches: z.record(z.string(), z.number().nullable()),
  upper: z.string(),
});
type DataforseoClient = ReturnType<typeof createDataforseoClient>;
const REFUSAL_PAUSES = new Map([
  ['auth_failure', pauseExecutionCredential],
  [searchPolicy.constants.error_account_unavailable, pauseUnavailableAccount],
]);

/** What reached the provider before a failure: nothing, a free retrieval, or the paid submission. */
type Exchange = 'none' | 'unpaid' | 'paid';

/** What differs between observed surfaces inside the shared phases. */
export type ObservedSurface = Pick<SurfaceAdapter, 'capacity' | 'recoveryDeadline'> & {
  /** Whether retrieval polls stop at the configured poll ceiling. */
  pollCeiling: boolean;
  /** Only an LLM scraper freezes scraper request settings. */
  requestSettings: (frozen: ReturnType<typeof readFrozenSearchRequest>) => Record<string, unknown>;
  /** Parses one retrieved payload and persists its result, unless the provider is still working. */
  settle: (
    deps: PhaseDeps,
    context: ExecutionContext,
    payload: unknown,
    taskId: string,
  ) => Promise<'still_pending' | 'settled'>;
  /** Persists the surface's terminal failure evidence. */
  failTask: (
    deps: PhaseDeps,
    task: AuditTask,
    context: ExecutionContext | null,
    failure: { code: string; exchange: Exchange; error?: ProviderError },
  ) => Promise<unknown>;
};

/** The task's observed engine; a task routed here without one is refused before any call. */
function observedEngine(task: AuditTask): SearchEngine {
  if (!isSearchSurface(task.logical_engine))
    throw new ProviderError(providerPolicy.errors.invalid_surface);
  return task.logical_engine;
}
function frozenField<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`Frozen search request has no ${field}`);
  return value;
}
/** The provider timeout frozen for a search-surface task. */
const surfaceTimeoutSeconds = (task: AuditTask) =>
  frozenField(readFrozenSearchRequest(task.request_snapshot).timeout_seconds, 'timeout');
/** The surface request exactly as frozen at admission; a missing field refuses the submission. */
export function frozenSurfaceRequest(
  surface: ObservedSurface,
  context: ExecutionContext,
  submissionRef: string,
): SearchRequest {
  const frozen = readFrozenSearchRequest(context.task.request_snapshot);
  const request: SearchRequest = {
    query: context.task.prompt_text,
    location_code: frozenField(frozen.location_code, 'location_code'),
    language_code: frozenField(frozen.language_code, 'language_code'),
    device: frozenField(frozen.device, 'device'),
    depth: searchPolicy.constants.default_depth,
    load_async_ai_overview: searchPolicy.constants.load_async_ai_overview,
    timeout_seconds: frozenField(frozen.timeout_seconds, 'timeout_seconds'),
    provider_submission_ref: submissionRef,
    request_settings: surface.requestSettings(frozen),
  };
  searchPayload(observedEngine(context.task), request);
  return request;
}
/** Settings frozen by an LLM scraper task; refused when missing. */
export const frozenRequestSettings = (frozen: ReturnType<typeof readFrozenSearchRequest>) =>
  frozenField(frozen.request_settings, 'request_settings');

/** A rejected key or a refused provider account pauses the connection the task used. */
async function pauseRefused(deps: PhaseDeps, error: ProviderError, context: ExecutionContext) {
  const pause = REFUSAL_PAUSES.get(error.code);
  if (!pause) return;
  await deps.db.transaction().execute(async (trx) => {
    if (await ownedAuditTask(trx, context.task, deps.owner))
      await pause(trx, context, deps.runtime, deps.now());
  });
  logger.info('provider_connection_paused', {
    task_id: context.task.id,
    connection_id: context.connectionId,
    error_code: error.code,
  });
}

async function failObserved(
  surface: ObservedSurface,
  deps: PhaseDeps,
  task: AuditTask,
  context: ExecutionContext | null,
  failure: { code: string; exchange: Exchange; error?: ProviderError },
) {
  if (failure.error && context) await pauseRefused(deps, failure.error, context);
  await surface.failTask(deps, task, context, failure);
}

async function poll(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  client: DataforseoClient,
  taskId: string,
) {
  const task = context.task,
    c = searchPolicy.constants;
  if (surface.pollCeiling && task.provider_poll_count >= c.poll_ceiling) {
    await failObserved(surface, deps, task, context, {
      code: 'poll_ceiling_exceeded',
      exchange: 'none',
    });
    return;
  }
  try {
    const payload = await client.retrieve(observedEngine(task), taskId);
    if ((await surface.settle(deps, context, payload, taskId)) === 'still_pending')
      await persistSurfaceExchange(
        deps.db,
        task,
        deps.owner,
        { poll: true, delaySeconds: c.poll_interval_seconds },
        deps.now(),
      );
  } catch (error) {
    const safe = error instanceof ProviderError ? error : new ProviderError('parse_error');
    if (safe.retryable)
      await persistSurfaceExchange(
        deps.db,
        task,
        deps.owner,
        { error: safe, poll: true, delaySeconds: c.poll_interval_seconds },
        deps.now(),
      );
    else
      await failObserved(surface, deps, task, context, {
        code: 'provider_error',
        exchange: 'unpaid',
        error: safe,
      });
    if (safe.code === 'rate_limit') throw safe;
  }
}

async function submit(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  client: DataforseoClient,
) {
  const engine = observedEngine(context.task),
    c = searchPolicy.constants;
  // The intent commits before any network I/O: a crash after it reconciles, never resubmits.
  const intent = await commitSubmissionIntent(deps.db, context, deps.owner, deps.now());
  if (!intent) return;
  if (!intent.fresh) {
    await reconcile(surface, deps, { ...context, task: intent.task }, client);
    return;
  }
  const request = frozenSurfaceRequest(surface, context, intent.task.provider_submission_ref);
  try {
    const submission = await client.submit(engine, request);
    await persistSurfaceExchange(
      deps.db,
      intent.task,
      deps.owner,
      {
        taskId: submission.taskId,
        chargeMicrousd: submission.chargeMicrousd,
        raw: submission.envelope,
        paid: true,
        delaySeconds: c.first_poll_delay_seconds,
      },
      deps.now(),
    );
  } catch (error) {
    if (error instanceof SubmissionUncertain)
      await persistSurfaceExchange(
        deps.db,
        intent.task,
        deps.owner,
        {
          error,
          paid: true,
          uncertain: true,
          chargeMicrousd: error.submission?.chargeMicrousd,
          delaySeconds: c.poll_interval_seconds,
        },
        deps.now(),
      );
    else {
      const safe = error instanceof ProviderError ? error : new ProviderError('client_error');
      await failObserved(surface, deps, intent.task, context, {
        code: 'provider_error',
        exchange: 'paid',
        error: safe,
      });
      if (safe.code === 'rate_limit') throw safe;
    }
  }
}

async function reconcile(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  client: DataforseoClient,
) {
  const task = context.task,
    engine = observedEngine(task),
    c = searchPolicy.constants,
    at = deps.now();
  if (surface.pollCeiling && task.provider_poll_count >= c.poll_ceiling) {
    await failObserved(surface, deps, task, context, {
      code: 'submission_unreconciled',
      exchange: 'none',
    });
    return;
  }
  const saved = reconciliationState.safeParse(record(task.provider_metadata).reconciliation).data;
  const upper = saved?.upper
    ? new Date(saved.upper)
    : new Date(at.getTime() - c.reconcile_window_lag_seconds * 1000);
  const from = new Date(
    (
      task.provider_task_submitted_at ??
      new Date(upper.getTime() - c.reconcile_window_hours * 3600000)
    ).getTime() -
      c.reconcile_window_lag_seconds * 1000,
  );
  try {
    const page = await client.reconcilePage(engine, from, upper, saved?.offset ?? 0);
    const result = reconcilePage(
      page,
      engine,
      task.provider_submission_ref,
      saved ?? { offset: 0, matches: {}, upper: upper.toISOString() },
    );
    if (result.ambiguous) {
      await failObserved(surface, deps, task, context, {
        code: 'submission_unreconciled',
        exchange: 'unpaid',
      });
      return;
    }
    await persistSurfaceExchange(
      deps.db,
      task,
      deps.owner,
      {
        reconciliation: result.state,
        poll: !result.match,
        resetPoll: Boolean(result.match),
        taskId: result.match?.id,
        chargeMicrousd: result.match?.chargeMicrousd,
        uncertain: !result.match,
        delaySeconds: result.match ? c.first_poll_delay_seconds : c.poll_interval_seconds,
      },
      at,
    );
  } catch (error) {
    const safe =
      error instanceof ProviderError
        ? error
        : new ProviderError('reconciliation_unavailable', true);
    await pauseRefused(deps, safe, context);
    await persistSurfaceExchange(
      deps.db,
      task,
      deps.owner,
      {
        error: safe,
        poll: true,
        uncertain: true,
        delaySeconds: c.poll_interval_seconds,
      },
      at,
    );
    if (safe.code === 'rate_limit') throw safe;
  }
}

/** The terminal code a worker-detected failure records on an observed surface. */
function failureCode(failure: TaskFailure) {
  switch (failure.kind) {
    case 'context_unavailable':
      return failure.error.code === searchPolicy.constants.error_account_unavailable
        ? failure.error.code
        : 'credential_unavailable_for_retrieval';
    case 'run_deadline':
      return 'poll_ceiling_exceeded';
    case 'recovery_deadline':
    case 'internal':
      return 'submission_unreconciled';
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

/** An observed surface's adapter: the shared DataForSEO phases around its own hooks. */
export function observedAdapter(surface: ObservedSurface): SurfaceAdapter {
  return {
    capacity: surface.capacity,
    recoveryDeadline: surface.recoveryDeadline,
    async dispatch(deps, context, _state, signal) {
      const task = context.task;
      const client = createDataforseoClient(
        { secret: context.secret, base_url: context.endpoint },
        deps.runtime.providers,
        surfaceTimeoutSeconds(task),
        deps.send,
        signal,
      );
      if (task.provider_task_id) await poll(surface, deps, context, client, task.provider_task_id);
      else if (task.provider_submission_ref) await reconcile(surface, deps, context, client);
      else await submit(surface, deps, context, client);
    },
    fail: (deps, task, context, failure) =>
      failObserved(surface, deps, task, context, {
        code: failureCode(failure),
        exchange: 'none',
      }),
  };
}
