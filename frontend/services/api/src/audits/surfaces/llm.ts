/** The `llm` surface: one direct answer-engine call per lease, retried within the task's budget. */
import { record } from '../../db/json.ts';
import { answerRequestSchema } from '../../answer-engines/contracts.ts';
import { ProviderError } from '../../providers/errors.ts';
import { auditPolicy } from '../config.ts';
import type { ExecutionContext } from '../execution-context.ts';
import { persistAnswerFailure, persistExecutionSuccess } from '../result-persistence.ts';
import type { PhaseDeps, SurfaceAdapter, TaskFailure } from './adapter.ts';

/** The answer request exactly as frozen at admission; an invalid one refuses the call. */
export function directRequest(context: ExecutionContext) {
  const { task, audit, config, measurement } = context;
  const parsed = answerRequestSchema.safeParse({
    logical_engine: task.logical_engine,
    transport_provider: task.transport_provider,
    transport_model: task.transport_model,
    prompt: task.prompt_text,
    system_instruction: audit.system_instruction,
    timeout_seconds: measurement.timeout_seconds,
    max_output_tokens: measurement.max_output_tokens,
    retrieval_enabled: measurement.retrieval_enabled,
    reasoning_effort: record(context.route).reasoning_effort,
    anthropic_thinking: context.route.anthropic_thinking ?? null,
    country_code: config.country_code,
    anthropic_max_uses: config.anthropic_max_uses,
    openai_max_tool_calls: config.openai_max_tool_calls,
  });
  if (!parsed.success) throw new ProviderError('parse_error');
  return parsed.data;
}

function failureFor(failure: TaskFailure): {
  error: ProviderError;
  called: boolean;
} {
  switch (failure.kind) {
    case 'context_unavailable':
      return { error: failure.error, called: false };
    case 'run_deadline':
    case 'recovery_deadline':
      return {
        error: new ProviderError(auditPolicy.constants.error_run_deadline),
        called: false,
      };
    case 'internal':
      return {
        error:
          failure.error instanceof ProviderError ? failure.error : new ProviderError('unknown'),
        called: failure.dispatched,
      };
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

export const llmSurface: SurfaceAdapter = {
  capacity: (_task, context) => context.capacity,
  recoveryDeadline: () => null,
  async dispatch(deps: PhaseDeps, context, state, signal) {
    const claimed = context.task;
    const request = directRequest(context);
    state.started = true;
    let answer;
    try {
      answer = await deps.executeAnswer(
        request,
        { secret: context.secret, base_url: context.endpoint },
        deps.runtime.providers,
        deps.send,
        signal,
      );
    } catch (error) {
      const safe = error instanceof ProviderError ? error : new ProviderError('unknown');
      state.rateError = safe;
      await persistAnswerFailure(deps.db, claimed, deps.owner, safe, deps.runtime, {
        called: true,
        context,
        at: deps.now(),
      });
      return;
    }
    await persistExecutionSuccess(
      deps.db,
      claimed,
      deps.owner,
      answer,
      await deps.derivation(context, answer),
      { at: deps.now() },
    );
  },
  fail(deps, task, context, failure) {
    const { error, called } = failureFor(failure);
    return persistAnswerFailure(deps.db, task, deps.owner, error, deps.runtime, {
      called,
      ...(context ? { context } : {}),
      at: deps.now(),
    });
  },
};
