import { policy } from '../config.ts';
import { createModelGateway, type GatewaySettings } from '../models/gateway.ts';
import { defaultTransport, type Transport } from '../models/http.ts';
import { runMetered } from '../models/meter-scope.ts';
import type { Run } from './contracts.ts';
import type { AgentModel } from './model-calls.ts';
import { requireOffered } from './model-choice.ts';

/**
 * The Agent always answers through the configured model gateway; its calls
 * run in the dispatch owner's metering scope.
 */
export function agentModels(platform: GatewaySettings, transport: Transport = defaultTransport) {
  return (run: Run): Promise<AgentModel> =>
    Promise.resolve().then(() => {
      const gateway = createModelGateway(
        {
          ...platform,
          model: requireOffered(run.requested_model),
          attempts: policy.agent.provider_max_attempts,
        },
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
