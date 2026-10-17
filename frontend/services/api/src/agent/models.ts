import { policy } from '../config.ts';
import { createModelGateway, type GatewaySettings } from '../models/gateway.ts';
import { defaultTransport, type Transport } from '../models/http.ts';
import { runMetered } from '../models/meter-scope.ts';
import { AgentError, type Run } from './contracts.ts';
import type { AgentModel } from './model-calls.ts';

/**
 * The Agent always answers through the configured model gateway; its calls
 * run in the dispatch owner's metering scope.
 */
export function agentModels(platform: GatewaySettings, transport: Transport = defaultTransport) {
  // Built inside the promise, so a changed model or an unconfigured gateway rejects, never throws.
  return (run: Run): Promise<AgentModel> =>
    Promise.resolve().then(() => {
      if (run.requested_model !== platform.model) throw new AgentError('model_changed');
      const gateway = createModelGateway(
        { ...platform, attempts: policy.agent.provider_max_attempts },
        transport,
      );
      return {
        model: gateway.model,
        endpointHost: gateway.baseUrlHost,
        adapter: gateway.adapter,
        converse: (request, signal, listener) =>
          runMetered({ workspaceId: run.workspace_id, feature: 'agent' }, () =>
            gateway.converse(request, signal, listener),
          ),
      };
    });
}
