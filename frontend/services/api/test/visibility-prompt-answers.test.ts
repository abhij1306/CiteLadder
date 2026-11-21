import { afterAll, describe, expect, it } from 'vitest';

import { record } from '../src/db/json.ts';
import { promptSet, prompt as trackedPrompt } from './prompt-fixtures.ts';
import type { ExecutionInput, Tenant } from './visibility-fixtures.ts';
import { frozen, visibilityReads, type Row } from './visibility-read-support.ts';

const { db, fixtures, get, newMarket } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const answersOf = (tenant: Tenant, promptId: string) =>
  `/api/v1/projects/${tenant.projectId}/prompts/${promptId}/executions`;

const run = (tenant: Tenant, day: string, status?: string) =>
  fixtures.audit(tenant, {
    completedAt: status ? null : new Date(`${day}T00:00:00Z`),
    configuration: frozen(),
    ...(status ? { status } : {}),
  });

async function answer(
  tenant: Tenant,
  input: Omit<ExecutionInput, 'promptIndex' | 'promptText'>,
): Promise<string> {
  const { taskId } = await fixtures.execution(tenant, {
    ...input,
    promptIndex: 0,
    promptText: 'best crm',
  });
  return taskId;
}

async function measuredPrompt() {
  const tenant = await fixtures.tenant();
  const setId = await promptSet(db, tenant.projectId);
  const promptId = await trackedPrompt(db, setId, 'best crm');
  const otherPrompt = await trackedPrompt(db, setId, 'cheap crm');
  const early = await run(tenant, '2026-03-02');
  const late = await run(tenant, '2026-03-09');
  const named = await answer(tenant, {
    auditId: early,
    promptId,
    analysis: {
      brandMentioned: true,
      avgPosition: 2,
      ownedCited: true,
      searchUsed: true,
      brandMentions: ['Acme Corp'],
      competitorMentions: ['Globex', 'Initech'],
      mentionOffsets: { Globex: 3, 'Acme Corp': 10, Initech: 40 },
      firstNamed: { kind: 'competitor', name: 'Globex' },
    },
  });
  const unnamed = await answer(tenant, {
    auditId: late,
    promptId,
    engine: 'claude',
    analysis: {
      competitorMentions: ['Globex', 'Initech'],
      mentionOffsets: { Globex: 5, Initech: 5 },
      firstNamed: { kind: 'competitor', name: 'Initech' },
    },
  });
  const overview = await answer(tenant, {
    auditId: late,
    promptId,
    engine: 'google_ai_overview',
    providerMetadata: { fanout_availability: 'unavailable' },
    analysis: {},
  });
  await fixtures.execution(tenant, {
    auditId: late,
    promptId,
    promptIndex: 0,
    taskStatus: 'failed',
    analysis: null,
  });
  await fixtures.execution(tenant, { auditId: late, promptId: otherPrompt, promptIndex: 2 });
  await answer(tenant, { auditId: await run(tenant, '', 'running'), promptId });
  return { tenant, promptId, early, late, named, unnamed, overview };
}

const ids = (body: Row) => (body.items as Row[]).map((item) => item.execution_id);

describe('GET /projects/{project_id}/prompts/{prompt_id}/executions', () => {
  it('lists each successful answer newest run first, with its brands in mention order', async () => {
    const { tenant, promptId, named, unnamed, overview } = await measuredPrompt();

    const { status, body } = await get(tenant, answersOf(tenant, promptId));

    expect(status).toBe(200);
    const late = [unnamed, overview].sort().reverse();
    expect([ids(body), body.next_cursor, body.market_id]).toEqual([[...late, named], null, null]);
    const rows = new Map((body.items as Row[]).map((item) => [item.execution_id, item]));
    expect(rows.get(named)).toMatchObject({
      run_at: '2026-03-02T00:00:00Z',
      logical_engine: 'chatgpt',
      brands: [
        { kind: 'competitor', name: 'Globex' },
        { kind: 'brand', name: 'Acme Corp' },
        { kind: 'competitor', name: 'Initech' },
      ],
      brand_mentioned: true,
      position: 2,
      first_named: { kind: 'competitor', name: 'Globex' },
      cited: true,
      search: 'used',
    });
    expect(rows.get(unnamed)).toMatchObject({
      brands: [
        { kind: 'competitor', name: 'Globex' },
        { kind: 'competitor', name: 'Initech' },
      ],
      first_named: { kind: 'competitor', name: 'Initech' },
      brand_mentioned: false,
      position: null,
      cited: false,
      search: 'not_used',
    });
    expect(rows.get(overview)).toMatchObject({ brands: [], search: 'not_reported' });
  });

  it('pages by keyset, so a run landing between pages neither repeats nor skips an answer', async () => {
    const { tenant, promptId, named, unnamed, overview } = await measuredPrompt();
    const path = answersOf(tenant, promptId);

    const first = await get(tenant, path, { limit: '2' });
    const newer = await answer(tenant, { auditId: await run(tenant, '2026-03-30'), promptId });
    const second = await get(tenant, path, {
      limit: '2',
      cursor: String(first.body.next_cursor),
    });
    const fresh = await get(tenant, path, { limit: '2' });

    expect(ids(first.body)).toEqual([unnamed, overview].sort().reverse());
    expect([ids(second.body), second.body.next_cursor]).toEqual([[named], null]);
    expect(ids(fresh.body)[0]).toBe(newer);
  });

  it('narrows by engine, window, brand named, cited, search used and market', async () => {
    const { tenant, promptId, named, unnamed, overview } = await measuredPrompt();
    const marketId = await newMarket(tenant);
    const abroad = await run(tenant, '2026-03-04');
    await db.updateTable('audits').set({ market_id: marketId }).where('id', '=', abroad).execute();
    const away = await answer(tenant, { auditId: abroad, promptId });
    const path = answersOf(tenant, promptId);
    const cases: [Record<string, string>, string[]][] = [
      [{ engine: 'claude' }, [unnamed]],
      [{ from: '2026-03-05T00:00:00Z' }, [unnamed, overview]],
      [{ to: '2026-03-05T00:00:00Z' }, [named]],
      [{ brand: ' globex ' }, [unnamed, named]],
      [{ brand: 'Acme Corp' }, [named]],
      [{ brand: 'Umbrella' }, []],
      [{ cited: 'true' }, [named]],
      [{ cited: 'false' }, [unnamed, overview]],
      [{ search: 'used' }, [named]],
      [{ search: 'not_used' }, [unnamed]],
      [{ search: 'not_reported' }, [overview]],
      [{ market: marketId }, [away]],
    ];

    for (const [query, expected] of cases) {
      const { status, body } = await get(tenant, path, query);
      expect([query, status, [...ids(body)].sort()]).toEqual([query, 200, [...expected].sort()]);
    }
  });

  it("refuses another workspace's prompt and a cursor from other filters", async () => {
    const { tenant, promptId } = await measuredPrompt();
    const stranger = await fixtures.tenant();

    const foreign = await get(stranger, answersOf(stranger, promptId));
    const page = await get(tenant, answersOf(tenant, promptId), { limit: '1' });
    const replayed = await get(tenant, answersOf(tenant, promptId), {
      limit: '1',
      cited: 'true',
      cursor: String(page.body.next_cursor),
    });
    const forged = await get(tenant, answersOf(tenant, promptId), { cursor: 'not-a-cursor!' });

    expect([foreign.status, record(foreign.body.error).message]).toEqual([404, 'Prompt not found']);
    expect([replayed.status, forged.status]).toEqual([422, 422]);
  });
});
