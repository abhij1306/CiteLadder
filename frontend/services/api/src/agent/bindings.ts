import type { Database } from '../db/database.ts';
import { gatewaySettings } from '../models/gateway.ts';
import { agentSettings } from './config.ts';
import { loadSkillCatalog } from './skills.ts';
import { agentTools } from './tool-adapters.ts';
import { agentAdmission, agentFunding } from './funding.ts';
import { agentModels } from './models.ts';
import { ModelCalls } from './model-calls.ts';
import { AgentStore } from './store.ts';
import { AgentOutputs } from './outputs.ts';
import { AgentQueue } from './queue.ts';
import { AgentRuntime } from './runtime.ts';
import { readAgentContext } from './context-adapter.ts';
import { attachAgentTarget } from './target-adapter.ts';

export async function createAgentBindings(db: Database, env = process.env) {
  const settings = agentSettings(env),
    platform = gatewaySettings(env);
  const catalog = await loadSkillCatalog(settings.skillsDirectory),
    tools = agentTools(db);
  const models = new ModelCalls(db, agentFunding(platform));
  const store = new AgentStore(db, {
    catalog,
    registryVersion: tools.version,
    context: readAgentContext,
    admission: agentAdmission(settings, platform),
    timeoutSeconds: settings.executionTimeoutSeconds,
  });
  const runtime = new AgentRuntime(db, {
    catalog,
    tools,
    models,
    attachTarget: attachAgentTarget,
    modelFor: agentModels(platform),
  });
  return {
    catalog,
    store,
    runtime,
    models,
    settings,
    outputs: new AgentOutputs(db),
    queue: new AgentQueue(db, settings.executionTimeoutSeconds + settings.leaseMarginSeconds),
  };
}
const bindings = new WeakMap<Database, ReturnType<typeof createAgentBindings>>();
export function agentBindings(db: Database) {
  let value = bindings.get(db);
  if (!value) {
    value = createAgentBindings(db);
    bindings.set(db, value);
    value.catch(() => bindings.delete(db));
  }
  return value;
}
