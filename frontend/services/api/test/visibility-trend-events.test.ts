import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { actionRow, snapshotRow } from './opportunity-fixtures.ts';
import { promptSet, prompt as trackedPrompt } from './prompt-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';
import { frozen, route, visibilityReads } from './visibility-read-support.ts';

const { db, fixtures, get, measuredRun } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const metrics = { total_completed: 1, brand_mention_count: 1, brand_mention_rate: 1 };

async function run(
  tenant: Tenant,
  input: {
    at: string;
    panel: string;
    promptIds: readonly string[];
    model: string;
    selection?: 'selected';
  },
) {
  const auditId = await measuredRun(tenant, input.at, metrics, {
    configuration: frozen({
      panel_hash: input.panel,
      ...(input.selection ? { prompt_selection: input.selection } : {}),
    }),
  });
  await db
    .insertInto('audit_engine_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      audit_id: auditId,
      logical_engine: 'chatgpt',
      transport_provider: 'test',
      transport_model: input.model,
      base_url: '',
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('audit_prompt_snapshots')
    .values(
      input.promptIds.map((promptId, index) => ({
        id: randomUUID(),
        workspace_id: tenant.workspaceId,
        audit_id: auditId,
        prompt_id: promptId,
        prompt_index: index,
        text: `prompt ${index}`,
        theme: '',
        intent: '',
        buyer_stage: '',
        prompt_intent: '',
        created_at: new Date(),
      })),
    )
    .execute();
  return auditId;
}

async function wentLive(tenant: Tenant, title: string, at: string) {
  const scope = { workspace_id: tenant.workspaceId, project_id: tenant.projectId };
  const snapshot = snapshotRow(scope);
  await db.insertInto('opportunity_snapshots').values(snapshot).execute();
  const action = actionRow(scope, {
    group_key: `earned:${title}`,
    target_kind: 'earned_page',
    target_label: title,
    status: 'implemented',
  });
  await db.insertInto('actions').values(action).execute();
  await db
    .insertInto('opportunity_implementation_events')
    .values({
      ...scope,
      id: randomUUID(),
      action_id: action.id,
      output_revision_id: null,
      member_opportunity_ids: '[]',
      opportunity_snapshot_id: snapshot.id,
      target_site_url_ids: '[]',
      target_external_url: null,
      declared_implemented_at: new Date(at),
      expected_checks: '[]',
      actor_user_id: tenant.userId,
      idempotency_key: randomUUID(),
      request_fingerprint: 'fingerprint',
      created_at: new Date(),
    })
    .execute();
  return action.id;
}

describe('GET /visibility/trends events', () => {
  it('marks panel changes between whole-set runs, model changes and go-lives on the next run, per workspace', async () => {
    const tenant = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    const setId = await promptSet(db, tenant.projectId);
    const [kept, also, archived, dropped, newA, newB] = await Promise.all(
      ['kept', 'also', 'archived', 'dropped', 'new a', 'new b'].map((text) =>
        trackedPrompt(db, setId, text, text === 'archived' ? { status: 'archived' } : {}),
      ),
    );
    const first = [kept!, also!, archived!, dropped!];
    const second = [kept!, also!, newA!, newB!];
    await wentLive(tenant, 'before the trend', '2026-03-01T00:00:00Z');
    await run(tenant, { at: '2026-03-02T09:00:00Z', panel: 'p1', promptIds: first, model: 'm-a' });
    await run(tenant, {
      at: '2026-03-09T09:00:00Z',
      panel: 'p-kept',
      promptIds: [kept!],
      model: 'm-a',
      selection: 'selected',
    });
    await run(tenant, { at: '2026-03-16T09:00:00Z', panel: 'p2', promptIds: second, model: 'm-a' });
    const live = await wentLive(tenant, 'Pricing FAQ page', '2026-03-17T12:00:00Z');
    await wentLive(outsider, 'Outsider page', '2026-03-18T12:00:00Z');
    await run(tenant, { at: '2026-03-23T09:00:00Z', panel: 'p2', promptIds: second, model: 'm-b' });

    const { body } = await get(tenant, route(tenant, '/trends'));

    expect(body.map((point) => point.events)).toEqual([
      [],
      [],
      [{ kind: 'prompt_panel', added: 2, archived: 1, removed: 1 }],
      [
        { kind: 'model_change', logical_engine: 'chatgpt', from_model: 'm-a', to_model: 'm-b' },
        {
          kind: 'action_live',
          action_id: live,
          title: 'Pricing FAQ page',
          implemented_at: '2026-03-17T12:00:00Z',
        },
      ],
    ]);
  });
});
