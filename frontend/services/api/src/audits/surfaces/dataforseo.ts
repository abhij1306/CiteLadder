import { z } from 'zod';
import { record } from '../../db/json.ts';
import { failureFacts, getLogger } from '../../logging.ts';
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
import { persistSurfaceExchange, releaseRefusedSubmission } from '../surface-persistence.ts';
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

type Exchange = 'none' | 'unpaid' | 'paid';

export type ObservedSurface = Pick<SurfaceAdapter, 'capacity' | 'recoveryDeadline'> & {
  pollCeiling: boolean;
  requestSettings: (frozen: ReturnType<typeof readFrozenSearchRequest>) => Record<string, unknown>;
  settle: (
    deps: PhaseDeps,
    context: ExecutionContext,
    payload: unknown,
    taskId: string,
  ) => Promise<'still_pending' | 'settled'>;
  failTask: (
    deps: PhaseDeps,
    task: AuditTask,
    context: ExecutionContext | null,
    failure: { code: string; exchange: Exchange; error?: ProviderError },
  ) => Promise<unknown>;
};

function observedEngine(task: AuditTask): SearchEngine {
  if (!isSearchSurface(task.logical_engine))
    throw new ProviderError(providerPolicy.errors.invalid_surface);
  return task.logical_engine;
}
function frozenField<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`Frozen search request has no ${field}`);
  return value;
}
const surfaceTimeoutSeconds = (task: AuditTask) =>
  frozenField(readFrozenSearchRequest(task.request_snapshot).timeout_seconds, 'timeout');
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
    timeout_seconds: frozenField(frozen.timeout_seconds, 'timeout_seconds'),
    provider_submission_ref: submissionRef,
    request_settings: surface.requestSettings(frozen),
  };
  searchPayload(observedEngine(context.task), request);
  return request;
}
export const frozenRequestSettings = (frozen: ReturnType<typeof readFrozenSearchRequest>) =>
  frozenField(frozen.request_settings, 'request_settings');

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
  let payload: unknown;
  try {
    payload = await client.retrieve(observedEngine(task), taskId);
  } catch (error) {
    const safe = error instanceof ProviderError ? error : new ProviderError('parse_error');
    await pollFailed(surface, deps, context, safe);
    return;
  }
  let settled: Awaited<ReturnType<ObservedSurface['settle']>>;
  try {
    settled = await surface.settle(deps, context, payload, taskId);
  } catch (error) {
    if (!(error instanceof ProviderError))
      logger.warning('surface_result_unsaved', { task_id: task.id, ...failureFacts(error) });
    await pollFailed(
      surface,
      deps,
      context,
      error instanceof ProviderError ? error : new ProviderError(c.error_result_unsaved, true),
    );
    return;
  }
  if (settled === 'still_pending')
    await persistSurfaceExchange(
      deps.db,
      task,
      deps.owner,
      { poll: true, delaySeconds: c.poll_interval_seconds },
      deps.now(),
    );
}

async function pollFailed(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  error: ProviderError,
) {
  const task = context.task;
  if (error.retryable)
    await persistSurfaceExchange(
      deps.db,
      task,
      deps.owner,
      { error, poll: true, delaySeconds: searchPolicy.constants.poll_interval_seconds },
      deps.now(),
    );
  else
    await failObserved(surface, deps, task, context, {
      code: 'provider_error',
      exchange: 'unpaid',
      error,
    });
  if (error.code === 'rate_limit') throw error;
}

async function submit(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  client: DataforseoClient,
) {
  const engine = observedEngine(context.task),
    c = searchPolicy.constants;
  const intent = await commitSubmissionIntent(deps.db, context, deps.owner, deps.now());
  if (!intent) return;
  if (!intent.fresh) {
    await reconcile(surface, deps, { ...context, task: intent.task }, client);
    return;
  }
  let request: SearchRequest;
  try {
    request = frozenSurfaceRequest(surface, context, intent.task.provider_submission_ref);
  } catch (error) {
    const safe = error instanceof ProviderError ? error : new ProviderError('client_error');
    await failObserved(surface, deps, intent.task, context, {
      code: 'provider_error',
      exchange: 'none',
      error: safe,
    });
    return;
  }
  let submission: Awaited<ReturnType<DataforseoClient['submit']>>;
  try {
    submission = await client.submit(engine, request);
  } catch (error) {
    await submitFailed(surface, deps, { ...context, task: intent.task }, error);
    return;
  }
  try {
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
    logger.warning('surface_submission_unsaved', {
      task_id: intent.task.id,
      provider_task_id: submission.taskId,
      ...failureFacts(error),
    });
  }
}

async function submitFailed(
  surface: ObservedSurface,
  deps: PhaseDeps,
  context: ExecutionContext,
  error: unknown,
) {
  const task = context.task,
    c = searchPolicy.constants;
  if (error instanceof SubmissionUncertain) {
    await persistSurfaceExchange(
      deps.db,
      task,
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
    return;
  }
  const safe = error instanceof ProviderError ? error : new ProviderError('client_error');
  if (safe.code !== 'rate_limit') {
    await failObserved(surface, deps, task, context, {
      code: 'provider_error',
      exchange: 'paid',
      error: safe,
    });
    return;
  }
  await releaseRefusedSubmission(deps.db, task, deps.owner, safe, deps.runtime, deps.now());
  throw safe;
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

function failureCode(failure: Exclude<TaskFailure, { kind: 'internal' }>) {
  switch (failure.kind) {
    case 'context_unavailable':
      return failure.error.code === searchPolicy.constants.error_account_unavailable
        ? failure.error.code
        : 'credential_unavailable_for_retrieval';
    case 'run_deadline':
      return 'poll_ceiling_exceeded';
    case 'recovery_deadline':
      return 'submission_unreconciled';
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

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
    async fail(deps, task, context, failure) {
      if (failure.kind === 'internal') return;
      await failObserved(surface, deps, task, context, {
        code: failureCode(failure),
        exchange: 'none',
      });
    },
  };
}
