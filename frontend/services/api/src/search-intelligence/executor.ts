import { z } from 'zod';
import { policy, resolveSettingSpec } from '../config.ts';
import { auditRuntime } from '../audits/config.ts';
import { ProviderError } from '../answer-engines/contracts.ts';
import { acquireCapacity, releaseCapacity, type CapacityRequest } from '../providers/capacity.ts';
import type { Executor } from '../workers/executor.ts';
import { record } from '../db/json.ts';
import { AcquisitionState, type PreparedResearch, type ResearchPlan } from './acquisition-state.ts';
import { connectionSecret } from './credentials.ts';
import { resolveLive, sendLive, type LiveTarget } from './live.ts';
import { si } from './requests.ts';

type AcquisitionOptions = { send?: typeof fetch; env?: Record<string, string | undefined> };
type Dispatchable = Extract<PreparedResearch, { action: 'dispatch' | 'publish' }>;
type StepContext = {
  state: AcquisitionState;
  task: Parameters<Executor>[0];
  context: Parameters<Executor>[1];
  encryptionKey: string;
  runtime: ReturnType<typeof auditRuntime>;
  options: AcquisitionOptions;
};

/** The paid target, or the refusal that stops the run before any send. */
function resolveTarget(
  prepared: Dispatchable,
  encryptionKey: string,
  options: AcquisitionOptions,
): LiveTarget | ProviderError {
  try {
    return resolveLive(
      {
        secret: connectionSecret(prepared.connection, encryptionKey),
        baseUrl: prepared.connection.base_url,
        endpoint: prepared.call.endpoint,
      },
      options.env,
    );
  } catch (cause) {
    if (!(cause instanceof ProviderError)) throw cause;
    return cause;
  }
}

/**
 * One paid send under leased capacity: `'stop'` when the dispatch was not
 * recorded, the provider's error once sent, else undefined.
 */
async function sendPaid(
  c: StepContext,
  prepared: Dispatchable,
  target: LiveTarget,
  capacity: CapacityRequest,
): Promise<'stop' | ProviderError | undefined> {
  let error: ProviderError | undefined;
  let sent = false;
  try {
    await c.context.checkCancelled('paid research dispatch');
    if (!(await c.state.dispatch(prepared))) return 'stop';
    sent = true;
    const response = await sendLive(target, record(prepared.call.sanitized_request), c.options);
    await c.state.saveResponse(prepared.call.id, response);
  } catch (cause) {
    if (!sent || !(cause instanceof ProviderError)) throw cause;
    error = cause;
  } finally {
    await releaseCapacity(c.context.db, capacity, c.runtime, {
      rateLimited: error?.code === 'rate_limit',
      retryAfterSeconds: error?.retryAfterSeconds,
    });
  }
  return error;
}

/** A failed send either parks the task for a rate-limit wait or ends the run. */
async function settleFailure(
  state: AcquisitionState,
  prepared: Dispatchable,
  error: ProviderError,
) {
  const result = await state.fail(prepared, error);
  if (result.wait) {
    await state.park(result.wait);
    return 'stop';
  }
  return result.stop ? 'stop' : 'next';
}

/** One plan step: `'stop'` ends this execution, `'next'` continues with the following plan. */
async function runStep(
  c: StepContext,
  plan: ResearchPlan,
  sequence: number,
  later: ResearchPlan[],
): Promise<'next' | 'stop'> {
  const { state, task, context } = c;
  const prepared = await state.prepare(plan, sequence);
  if (prepared.action === 'stop') return 'stop';
  if (prepared.action === 'skip') return 'next';
  if (prepared.action === 'publish')
    return (await state.settle(plan, prepared.call.id, later)) ? 'stop' : 'next';
  const target = resolveTarget(prepared, c.encryptionKey, c.options);
  if (target instanceof ProviderError) {
    await state.refuse(prepared, target);
    return 'stop';
  }
  const capacity: CapacityRequest = {
    taskId: null,
    analyticsTaskId: task.id,
    attempt: sequence * (si.rate_limit_retries + 1) + prepared.ordinal,
    engine: 'search_intelligence',
    transport: 'dataforseo',
    connectionId: prepared.run.connection_id,
    accountPoolIdentity: prepared.run.account_identity,
  };
  const decision = await acquireCapacity(context.db, capacity, c.runtime);
  if (!decision.acquired) {
    await state.park(decision.availableAt);
    return 'stop';
  }
  const outcome = await sendPaid(c, prepared, target, capacity);
  if (outcome === 'stop') return 'stop';
  if (outcome) return settleFailure(state, prepared, outcome);
  return (await state.settle(plan, prepared.call.id, later)) ? 'stop' : 'next';
}

/** Runs the frozen plan until it ends or parks. */
async function acquire(
  state: AcquisitionState,
  task: Parameters<Executor>[0],
  context: Parameters<Executor>[1],
  options: AcquisitionOptions,
) {
  const plans = await state.start();
  if (!plans) return;
  const runtime = auditRuntime(options.env);
  const encryptionKey = String(resolveSettingSpec(policy.settings.encryption_key, options.env));
  const step: StepContext = { state, task, context, encryptionKey, runtime, options };
  for (const [sequence, plan] of plans.entries()) {
    await context.checkCancelled('research plan');
    if ((await runStep(step, plan, sequence, plans.slice(sequence + 1))) === 'stop') return;
  }
  await state.finish();
}

/**
 * Finite frozen plan: park without spending queue attempts; an ambiguous paid
 * dispatch is never repeated. A managed analysis that ended is charged at once.
 */
export function acquisitionExecutor(options: AcquisitionOptions = {}): Executor {
  return async (task, context) => {
    const runId = z.uuid().parse(record(task.payload).run_id);
    if (!task.project_id) throw new Error('Research acquisition requires its project');
    await acquire(new AcquisitionState(context.db, task, runId), task, context, options);
  };
}
export const acquireResearch = acquisitionExecutor();
