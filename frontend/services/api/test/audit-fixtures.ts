import type { Database } from '../src/db/database.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { providerSettings } from '../src/providers/config.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';

export const auditTestKey = 'audit-freeze-test-encryption-key';
export async function auditTenant(db: Database, fixtures: VisibilityFixtures) {
  const t = await fixtures.tenant();
  await fixtures.brand(t.projectId, 'Acme Running');
  await db
    .updateTable('projects')
    .set({ benchmark_mode: 'consumer_like', serp_location_code: 2840 })
    .where('id', '=', t.projectId)
    .execute();
  const setId = await promptSet(db, t.projectId);
  const promptId = await prompt(db, setId, 'Which running shoes suit road use?');
  const providers = providerSettings({});
  const connection = await createConnection(
    db,
    t.workspaceId,
    t.userId,
    createConnectionInput.parse({
      transport_provider: 'openai',
      api_key: 'test-key',
      routes: [{ logical_engine: 'chatgpt' }],
    }),
    auditTestKey,
    providers,
  );
  await probeConnection(db, t.workspaceId, connection.id, auditTestKey, providers, () =>
    Promise.resolve({
      status: 200,
      body: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'ok' }] }] },
    }),
  );
  return { ...t, setId, promptId, connectionId: connection.id };
}
