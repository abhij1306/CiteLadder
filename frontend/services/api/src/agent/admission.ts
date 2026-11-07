/**
 * Agent admission: the Agent calls the operator's configured model gateway
 * (`DEFAULT_AGENT_*`). A turn is admitted when that gateway is configured and
 * the workspace is within its active-turn and daily request limits; before
 * each model call the run's model is checked against the gateway again.
 */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import { spendBudget } from '../abuse/usage.ts';
import { agentSettings } from './config.ts';
import { AgentError, type Run } from './contracts.ts';
import type { Admission } from './store.ts';
import type { ModelAvailability } from './model-calls.ts';
import type { GatewaySettings } from '../models/gateway.ts';

type Settings = ReturnType<typeof agentSettings>;

function configured(gateway: GatewaySettings) {
  return [gateway.apiKey, gateway.baseUrl, gateway.model].every((value) => value.trim());
}
export function agentAdmission(settings: Settings, gateway: GatewaySettings): Admission {
  return async (db, scope) => {
    if (!configured(gateway)) throw new AgentError('model_unavailable');
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
    await spendBudget(db, settings.dailyRuns, scope.workspaceId);
    return { requested_model: gateway.model };
  };
}
/** Before each call: the run's frozen model is still the gateway's, and the gateway is configured. */
export function agentAvailability(gateway: GatewaySettings): ModelAvailability {
  return (run: Run) => {
    if (run.requested_model !== gateway.model) throw new AgentError('model_changed');
    if (!configured(gateway)) throw new AgentError('model_unavailable');
  };
}
