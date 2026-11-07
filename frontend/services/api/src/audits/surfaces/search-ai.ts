/** The `search_ai` surface (Google AI Overview): every retrieval records an observation. */
import {
  overviewAnswer,
  parseOverview,
  surfaceFailure,
  type OverviewResult,
} from '../../search-surfaces/parsing.ts';
import {
  isOverviewObservation,
  persistOverviewFailure,
  persistOverviewObservation,
} from '../surface-persistence.ts';
import { observedAdapter, type ObservedSurface } from './dataforseo.ts';

const searchAiSurface: ObservedSurface = {
  capacity: (_task, context) => context.capacity,
  recoveryDeadline: () => null,
  // A Google AI Overview task is bounded by its poll count; it has no recovery deadline.
  pollCeiling: true,
  requestSettings: () => ({}),
  async settle(deps, context, payload, taskId) {
    const result = parseOverview(payload, taskId);
    if (result === 'still_pending') return 'still_pending';
    if (isOverviewObservation(result))
      await persistOverviewObservation(
        deps.db,
        context.task,
        deps.owner,
        result,
        await deps.derivation(context, overviewAnswer(result)),
        deps.now(),
      );
    else
      await persistOverviewFailure(deps.db, context.task, deps.owner, result, deps.runtime, {
        exchange: 'unpaid',
        at: deps.now(),
      });
    return 'settled';
  },
  failTask(deps, task, _context, { code, exchange, error }) {
    const result: OverviewResult =
      code === 'provider_error'
        ? {
            ...surfaceFailure('submission_unreconciled'),
            outcome: 'provider_error',
            error_code: error?.code ?? code,
          }
        : surfaceFailure(code);
    return persistOverviewFailure(deps.db, task, deps.owner, result, deps.runtime, {
      exchange,
      at: deps.now(),
    });
  },
};

export const searchAiAdapter = observedAdapter(searchAiSurface);
