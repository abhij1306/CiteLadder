import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { storedAnswerFormats } from '../src/analysis/answer-formats.ts';
import { deriveExecution } from '../src/audits/derivation.ts';
import adsEnvelope from './fixtures/chatgpt-ads/envelope.json' with { type: 'json' };
import formatsEnvelope from './fixtures/chatgpt-formats/envelope.json' with { type: 'json' };
import productsEnvelope from './fixtures/chatgpt-products/full-cards.json' with { type: 'json' };
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function derive(tenant: Tenant, auditId: string, engine: string, rawResponse: unknown) {
  const { taskId } = await fixtures.execution(tenant, { auditId, engine, analysis: null });
  const artifactId = randomUUID();
  await db
    .insertInto('raw_response_artifacts')
    .values({
      id: artifactId,
      workspace_id: tenant.workspaceId,
      audit_id: auditId,
      task_id: taskId,
      logical_engine: engine,
      transport_provider: 'dataforseo',
      transport_model: 'test-model',
      answer_text: 'Acme has the deepest billing.',
      search_used: true,
      citations: JSON.stringify([]),
      provider_metadata: JSON.stringify(
        rawResponse === undefined ? {} : { raw_response: rawResponse },
      ),
      finish_reason: 'stop',
      created_at: new Date(),
    })
    .execute();
  const task = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('id', '=', auditId)
    .executeTakeFirstOrThrow();
  await db.transaction().execute((trx) => deriveExecution(trx, task, audit, artifactId));
  const analysis = await db
    .selectFrom('response_analyses')
    .select(['answer_format_state', 'answer_formats', 'in_text_link_count', 'artifact_id'])
    .where('task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  expect(analysis.artifact_id).toBe(artifactId);
  return { ...analysis, read: storedAnswerFormats(analysis) };
}

describe('answer formats at analysis', () => {
  it('keeps found, none found, unavailable and not applicable apart', async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant, { configuration: { brand_name: 'Acme' } });
    const cases: [string, unknown][] = [
      ['chatgpt_search', formatsEnvelope],
      ['chatgpt_search', productsEnvelope],
      ['chatgpt_search', adsEnvelope],
      ['gemini_consumer', { tasks: [] }],
      ['gemini_consumer', { tasks: [{ result: [{ markdown: 'No item list' }] }] }],
      ['claude', formatsEnvelope],
    ];
    const results = [];
    for (const [engine, envelope] of cases)
      results.push(await derive(tenant, auditId, engine, envelope)); // NOSONAR -- one audit, in order.
    expect(results.map(({ artifact_id: _id, ...row }) => row)).toEqual([
      {
        answer_format_state: 'observed',
        answer_formats: ['map', 'comparison', 'image'],
        in_text_link_count: 2,
        read: { kind: 'observed', formats: ['map', 'comparison', 'image'], in_text_links: 2 },
      },
      {
        answer_format_state: 'observed',
        answer_formats: ['shopping'],
        in_text_link_count: 0,
        read: { kind: 'observed', formats: ['shopping'], in_text_links: 0 },
      },
      {
        answer_format_state: 'observed',
        answer_formats: [],
        in_text_link_count: 0,
        read: { kind: 'observed', formats: [], in_text_links: 0 },
      },
      {
        answer_format_state: 'unavailable',
        answer_formats: null,
        in_text_link_count: null,
        read: { kind: 'unavailable' },
      },
      {
        answer_format_state: 'unavailable',
        answer_formats: null,
        in_text_link_count: null,
        read: { kind: 'unavailable' },
      },
      {
        answer_format_state: 'not_applicable',
        answer_formats: null,
        in_text_link_count: null,
        read: { kind: 'not_applicable' },
      },
    ]);
  });

  it('fails a stored state outside the known ones', () => {
    const stored = (state: string) =>
      storedAnswerFormats({
        answer_format_state: state,
        answer_formats: null,
        in_text_link_count: null,
      });
    expect(stored('unavailable')).toEqual({ kind: 'unavailable' });
    expect(() => stored('partial')).toThrow('Unknown answer format state: partial');
  });
});
