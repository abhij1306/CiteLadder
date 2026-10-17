/**
 * Agent admission: the Agent calls the operator's configured model gateway
 * (`DEFAULT_AGENT_*`). Nothing is reserved or charged; admission only
 * requires the gateway to be configured and the workspace within its
 * concurrency and daily request limits.
 */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { agentSettings } from './config.ts';
import { AgentError, type Run } from './contracts.ts';
import type { Admission } from './store.ts';
import type { Funding } from './model-calls.ts';
import type { GatewaySettings } from '../models/gateway.ts';

type Settings = ReturnType<typeof agentSettings>;

/** The single funding source: the operator's own gateway credentials. */
export const SELF_HOSTED = 'self_hosted';

function configured(gateway: GatewaySettings) {
  return [gateway.apiKey, gateway.baseUrl, gateway.model].every((value) => value.trim());
}
export function agentAdmission(settings: Settings, gateway: GatewaySettings): Admission {
  return async (db, scope) => {
    if (!configured(gateway)) throw new AgentError('funding_unavailable');
    const active = await db
      .selectFrom('agent_runs')
      .select(sql<string>`count(*)`.as('count'))
      .where('workspace_id', '=', scope.workspaceId)
      .where('status', 'in', policy.task_queue.active)
      .executeTakeFirstOrThrow();
    if (Number(active.count) >= settings.activeLimit)
      throw new ApiError(429, 'Workspace active Agent limit exceeded', {
        headers: { 'retry-after': String(settings.retryAfterSeconds) },
      });
    await enforceWorkspaceRequest(db, scope.workspaceId, {
      operation: 'agent.runs',
      limit: settings.dailyLimit,
      windowSeconds: settings.dailyWindowSeconds,
    });
    return { funding_source: SELF_HOSTED, requested_model: gateway.model };
  };
}
function recheck(run: Run, gateway: GatewaySettings) {
  if (run.requested_model !== gateway.model) throw new AgentError('model_changed');
  if (!configured(gateway)) throw new AgentError('funding_unavailable');
}
export function agentFunding(gateway: GatewaySettings): Funding {
  return {
    reserve: async (_db, run) => {
      recheck(run, gateway);
      return { reservationId: null, credits: 0, pricingRevision: '' };
    },
    settle: async () => ({ credits: 0, status: 'zero_debit' }),
  };
}
