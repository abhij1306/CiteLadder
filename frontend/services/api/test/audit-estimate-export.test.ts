import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import { estimateAudit, estimateInput } from '../src/audits/estimate.ts';
import { exportAudit } from '../src/audits/exports.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({});
afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
describe('provider-free audit estimates and persisted exports', () => {
  it('estimates without a connection and retains unknown surface pricing and bounded recovery duration', async () => {
    const t = await auditTenant(db, fixtures),
      foreign = await auditTenant(db, fixtures);
    await db.deleteFrom('provider_connections').where('workspace_id', '=', t.workspaceId).execute();
    const input = estimateInput.parse({
      project_id: t.projectId,
      prompt_ids: [t.promptId, t.promptId],
      engines: ['chatgpt', 'chatgpt'],
      repetitions: 2,
    });
    const estimate = await estimateAudit(db, t.workspaceId, input, runtime);
    expect(estimate).toMatchObject({
      prompt_count: 1,
      engine_count: 1,
      repetition_count: 2,
      execution_count: 2,
      maximum_attempt_count: 2 * runtime.audits.max_attempts,
    });
    expect(estimate.engines[0]).toMatchObject({
      retrieval_enabled: true,
      estimated_output_tokens: 2 * runtime.audits.audit_max_output_tokens,
    });
    const surface = await estimateAudit(
      db,
      t.workspaceId,
      { ...input, engines: ['chatgpt_search'] },
      runtime,
    );
    expect(surface).toMatchObject({
      maximum_attempt_count: 2,
      maximum_wall_clock_seconds: runtime.search.recoveryDeadlineHours * 3600,
      cost_status: 'unknown',
      estimated_total_cost_microusd: null,
    });
    expect(surface.engines[0]).toMatchObject({
      retrieval_enabled: null,
      estimated_input_tokens: null,
    });
    await expect(estimateAudit(db, foreign.workspaceId, input, runtime)).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      estimateAudit(db, t.workspaceId, { ...input, prompt_ids: [foreign.promptId] }, runtime),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      await db
        .selectFrom('audits')
        .select('id')
        .where('workspace_id', '=', t.workspaceId)
        .execute(),
    ).toEqual([]);
  });
  it('exports persisted scores and frozen unknown retrieval while neutralizing spreadsheet formulas', async () => {
    const t = await auditTenant(db, fixtures),
      foreign = await auditTenant(db, fixtures);
    const [auditId] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({
        project_id: t.projectId,
        prompt_set_id: t.setId,
        engines: ['chatgpt'],
        repetitions: 1,
      }),
      {},
      runtime,
    );
    await db
      .updateTable('audits')
      .set({
        configuration: JSON.stringify({
          brand_name: 'Frozen Brand',
          engines: ['chatgpt'],
          competitors: [],
        }),
        summary: JSON.stringify({ total_completed: 1, brand_mention_rate: 0.75, per_prompt: [] }),
      })
      .where('id', '=', auditId)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({
        prompt_text: '=HYPERLINK("https://bad.example")',
        request_snapshot: '{}',
        provider_route_snapshot: '{}',
        score: JSON.stringify({ brand_mentioned: true, search_query_count: 2 }),
        search_events: JSON.stringify([{ query: 'Frozen query' }]),
      })
      .where('audit_id', '=', auditId)
      .execute();
    const csv = await exportAudit(db, t.workspaceId, auditId, 'csv');
    const task = await db
      .selectFrom('audit_tasks')
      .select('transport_model')
      .where('audit_id', '=', auditId)
      .executeTakeFirstOrThrow();
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csv).toContain(`chatgpt,${task.transport_model},,`);
    expect(csv).toContain('True');
    expect(csv).toContain('Frozen query');
    const markdown = await exportAudit(db, t.workspaceId, auditId, 'md');
    expect(markdown).toContain('Frozen Brand');
    expect(markdown).toContain('retrieval unrecorded');
    expect(markdown).toContain('| Brand mention rate | 75% |');
    await expect(exportAudit(db, foreign.workspaceId, auditId, 'csv')).rejects.toMatchObject({
      status: 404,
    });
  });
});
