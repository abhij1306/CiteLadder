/** Pure cost and failure rules for one Search Intelligence acquisition; nothing here writes. */
import type { Selectable } from 'kysely';
import type { SearchIntelligenceCalls, SearchIntelligenceRuns } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import type { ProviderError } from '../providers/errors.ts';
import { si, usdUnits } from './requests.ts';

type Run = Selectable<SearchIntelligenceRuns>;
type Call = Selectable<SearchIntelligenceCalls>;

/** Provider refusals that every later call on the same connection would repeat. */
const REFUSED_CODES = new Set([
  'auth_failure',
  policy.dataforseo.constants.error_account_unavailable,
]);
/** What one failed send means for the call and the run. */
export function failureStates(error: ProviderError, ordinal: number) {
  const uncertain = ['connection', 'timeout'].includes(error.code),
    rateLimited = error.code === 'rate_limit',
    retry = rateLimited && ordinal <= si.rate_limit_retries;
  let attempt = 'failed';
  if (uncertain) attempt = 'uncertain';
  else if (rateLimited) attempt = 'rate_limited';
  let callStatus = 'failed';
  if (retry) callStatus = 'intent';
  else if (uncertain) callStatus = 'uncertain';
  // Every remaining call would use the same refused credential or account.
  const refused = REFUSED_CODES.has(error.code);
  return { uncertain, retry, refused, attempt, callStatus };
}
/** When a rate-limited call may be sent again: the provider's wait, bounded. */
export const retryAt = (error: ProviderError, at: Date) =>
  new Date(
    at.getTime() +
      Math.min(
        si.rate_limit_max_wait_seconds,
        Math.max(0, error.retryAfterSeconds ?? si.rate_limit_default_wait_seconds),
      ) *
        1000,
  );
export const money = usdUnits;
const amount = (value: number) => (value / 1e8).toFixed(8);

/** The run's cost, status and error after one paid page is added to it. */
export function costUpdate(run: Run, call: Call, at: Date) {
  const totalCost = money(run.provider_reported_cost_usd) + money(call.provider_reported_cost_usd);
  const missingCost = call.provider_reported_cost_usd === null,
    over = totalCost > money(run.estimated_cost_usd);
  let status = 'running';
  let errorCode = run.error_code;
  if (missingCost) {
    status = 'uncertain';
    errorCode = 'provider_cost_unavailable';
  } else if (over) {
    status = 'partial';
    errorCode = 'cost_ceiling_exceeded';
  }
  const update = {
    provider_reported_cost_usd: missingCost ? run.provider_reported_cost_usd : amount(totalCost),
    uncertain_calls: run.uncertain_calls + (missingCost ? 1 : 0),
    status,
    error_code: errorCode,
    completed_at: missingCost || over ? at : null,
    updated_at: at,
  };
  return { update, missingCost, stopped: missingCost || over };
}
/** The run after a paid page its schema refused: the page's reported cost still counts. */
export function rejectedCost(run: Run, call: Call, at: Date) {
  const missingCost = call.provider_reported_cost_usd === null;
  const update = {
    provider_reported_cost_usd: missingCost
      ? run.provider_reported_cost_usd
      : amount(money(run.provider_reported_cost_usd) + money(call.provider_reported_cost_usd)),
    ...(missingCost
      ? {
          status: 'uncertain',
          uncertain_calls: run.uncertain_calls + 1,
          error_code: 'provider_cost_unavailable',
          completed_at: at,
        }
      : {}),
    updated_at: at,
  };
  return { missingCost, update };
}
/** The run's reported cost: every call's, summed. */
export const summedCost = (calls: { provider_reported_cost_usd: string | null }[]) =>
  amount(calls.reduce((sum, item) => sum + money(item.provider_reported_cost_usd), 0));
/** The run ended early: partial once a call completed, else failed. */
export const stoppedRun = (run: Run, code: string, at: Date) => ({
  status: run.completed_calls ? 'partial' : 'failed',
  error_code: code,
  completed_at: at,
  updated_at: at,
});
/** The run once a sent call's outcome cannot be known. */
export const uncertainRun = (run: Run, at: Date) => ({
  status: 'uncertain',
  uncertain_calls: run.uncertain_calls + 1,
  completed_at: at,
  updated_at: at,
});
