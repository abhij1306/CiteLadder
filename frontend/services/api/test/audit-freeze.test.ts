import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareAudit } from '../src/audits/freeze.ts';
import { auditSettings } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createConnection, updateConnection } from '../src/providers/connections.ts';
import { createConnectionInput, updateConnectionInput } from '../src/providers/inputs.ts';
import { providerSettings } from '../src/providers/config.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { searchSettings } from '../src/search-surfaces/dataforseo.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const settings = auditSettings({});
const providers = providerSettings({});
const key = 'audit-freeze-test-encryption-key';
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function seed() {
  const t = await fixtures.tenant();
  await fixtures.brand(t.projectId, 'Acme Running');
  await db
    .updateTable('projects')
    .set({ benchmark_mode: 'consumer_like', serp_location_code: 2840 })
    .where('id', '=', t.projectId)
    .execute();
  const setId = await promptSet(db, t.projectId);
  const promptId = await prompt(db, setId, 'Which running shoes suit road use?');
  const connection = await createConnection(
    db,
    t.workspaceId,
    t.userId,
    createConnectionInput.parse({
      transport_provider: 'openai',
      api_key: 'test-key',
      routes: [{ logical_engine: 'chatgpt' }],
    }),
    key,
    providers,
  );
  await probeConnection(db, t.workspaceId, connection.id, key, providers, async () => ({
    status: 200,
    body: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'ok' }] }] },
  }));
  return { ...t, setId, promptId, connectionId: connection.id };
}
describe('audit admission freeze', () => {
  it('resolves an accepted panel and keeps identity and request policy independent from subsequent edits', async () => {
    const t = await seed();
    const input = auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: ['chatgpt'],
      random_seed: '42',
    });
    const plan = await prepareAudit(db, t.workspaceId, input, settings, providers, 'manual', {
      search: searchSettings({}),
    });
    expect(plan.configuration).toMatchObject({
      brand_name: 'Acme Running',
      engines: ['chatgpt'],
      measurement_policy: { retrieval_enabled: true },
      anthropic_max_uses: providers.anthropicMaxUses,
    });
    expect(plan.systemInstruction).not.toContain('Acme');
    await db
      .updateTable('projects')
      .set({ country_code: 'IN' })
      .where('id', '=', t.projectId)
      .execute();
    await db
      .updateTable('prompts')
      .set({ text: 'Changed later' })
      .where('id', '=', t.promptId)
      .execute();
    expect(plan.configuration.country_code).toBe('US');
    expect(plan.prompts[0]?.text).toBe('Which running shoes suit road use?');
  });
  it('freezes a common-word brand as needing context', async () => {
    const t = await seed();
    await db
      .updateTable('brands')
      .set({ name: 'Target' })
      .where('project_id', '=', t.projectId)
      .execute();
    const freeze = () =>
      prepareAudit(
        db,
        t.workspaceId,
        auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
        settings,
        providers,
        'manual',
        { search: searchSettings({}) },
      );
    expect((await freeze()).configuration.entity_matching).toMatchObject({
      entities: { target: { mode: 'context_required' } },
    });
  });
  it('rejects foreign, disabled and unreviewed explicit selections as a whole', async () => {
    const t = await seed();
    const foreign = await seed();
    const prepare = (ids: string[]) =>
      prepareAudit(
        db,
        t.workspaceId,
        auditInput.parse({ project_id: t.projectId, prompt_ids: ids, engines: ['chatgpt'] }),
        settings,
        providers,
        'manual',
        { search: searchSettings({}) },
      );
    await expect(prepare([t.promptId, foreign.promptId])).rejects.toMatchObject({ status: 400 });
    await db
      .updateTable('prompts')
      .set({ status: 'proposed' })
      .where('id', '=', t.promptId)
      .execute();
    await expect(prepare([t.promptId])).rejects.toMatchObject({ status: 400 });
    await expect(
      prepareAudit(
        db,
        randomUUID(),
        auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
        settings,
        providers,
        'manual',
        { search: searchSettings({}) },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('refuses newly rotated credentials until they are verified again', async () => {
    const t = await seed();
    await updateConnection(
      db,
      t.workspaceId,
      t.userId,
      t.connectionId,
      updateConnectionInput.parse({ api_key: 'new-key' }),
      key,
      providers,
    );
    await expect(
      prepareAudit(
        db,
        t.workspaceId,
        auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
        settings,
        providers,
        'manual',
        { search: searchSettings({}) },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
