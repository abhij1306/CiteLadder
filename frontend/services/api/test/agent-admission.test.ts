import { afterAll, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { AgentFixtures } from './agent-support.ts';
import { agentAdmission, agentAvailability } from '../src/agent/admission.ts';
import { agentSettings } from '../src/agent/config.ts';
import type { Run } from '../src/agent/contracts.ts';
import { gatewaySettings } from '../src/models/gateway.ts';

const gateway = {
  ...gatewaySettings({}),
  apiKey: 'test-key',
  baseUrl: 'https://model.example.test/v1',
  model: 'test-model',
};
const unconfigured = { ...gateway, apiKey: ' ' };

describe('Agent admission on PostgreSQL', () => {
  const db = testDatabase();
  const fixtures = new AgentFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  it('admits a turn on the configured gateway and freezes its model', async () => {
    const scope = await fixtures.scope();
    await expect(agentAdmission(agentSettings({}), gateway)(db, scope)).resolves.toEqual({
      requested_model: 'test-model',
    });
  });
  it('refuses a turn when no Agent model is configured', async () => {
    const scope = await fixtures.scope();
    await expect(agentAdmission(agentSettings({}), unconfigured)(db, scope)).rejects.toMatchObject({
      code: 'model_unavailable',
    });
  });
  it('refuses a turn over the workspace active-turn limit', async () => {
    const scope = await fixtures.scope();
    await expect(
      agentAdmission({ ...agentSettings({}), activeLimit: 0 }, gateway)(db, scope),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('Agent model availability before each call', () => {
  const run = { requested_model: 'test-model' } as Run;
  it('passes while the frozen model is the configured one', () => {
    expect(() => agentAvailability(gateway)(run)).not.toThrow();
  });
  it('refuses a call whose frozen model is no longer configured', () => {
    expect(() => agentAvailability({ ...gateway, model: 'other-model' })(run)).toThrow(
      expect.objectContaining({ code: 'model_changed' }),
    );
  });
  it('refuses a call once the gateway is no longer configured', () => {
    expect(() => agentAvailability(unconfigured)(run)).toThrow(
      expect.objectContaining({ code: 'model_unavailable' }),
    );
  });
});
