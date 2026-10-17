/**
 * Ads persistence in the derive transaction against real PostgreSQL: ownership
 * with the frozen competitor id, the parsed-for-ads marker, and ads kept out
 * of citations and mentions.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { analyzeExecution } from '../src/analysis/execution.ts';
import adsEnvelope from './fixtures/chatgpt-ads/envelope.json' with { type: 'json' };
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const RIVAL_ID = randomUUID();
const CONFIGURATION = {
  brand_name: 'Acme',
  owned_domains: ['acme.example'],
  competitors: [{ id: RIVAL_ID, name: 'Rival', aliases: [], domains: ['rival.example'] }],
};

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** Derive one answer whose immutable artifact stores `rawResponse`. */
async function derive(tenant: Tenant, auditId: string, engine: string, rawResponse: unknown) {
  const { taskId } = await fixtures.execution(tenant, { auditId, engine, analysis: null });
  const artifactId = randomUUID();
  await db
    .insertInto('raw_response_artifacts')
    .values({
      id: artifactId,
      audit_id: auditId,
      task_id: taskId,
      logical_engine: engine,
      transport_provider: 'dataforseo',
      transport_model: 'test-model',
      answer_text: 'Acme and Rival both make good road shoes.',
      search_used: true,
      citations: JSON.stringify([{ url: 'https://rival.example/shoes', title: 'Rival shoes' }]),
      provider_metadata: JSON.stringify({ raw_response: rawResponse }),
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
  await db.transaction().execute((trx) => analyzeExecution(trx, task, audit, artifactId));
  return taskId;
}

async function analysisOf(taskId: string) {
  return db
    .selectFrom('response_analyses')
    .select(['ads_parser_version', 'citation_count', 'brand_mentioned'])
    .where('task_id', '=', taskId)
    .executeTakeFirstOrThrow();
}

async function adsOf(taskId: string) {
  return db
    .selectFrom('answer_ad_observations')
    .select([
      'rank_absolute',
      'advertiser_domain',
      'landing_url_canonical',
      'ownership',
      'competitor_id',
      'parser_version',
      'workspace_id',
    ])
    .where('task_id', '=', taskId)
    .orderBy('rank_absolute')
    .execute();
}

describe('ads persistence', () => {
  it('stores each ChatGPT Search ad with its ownership and keeps it out of citations', async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    const taskId = await derive(tenant, auditId, 'chatgpt_search', adsEnvelope);
    expect(await adsOf(taskId)).toEqual([
      {
        rank_absolute: 2,
        advertiser_domain: 'rival.example',
        landing_url_canonical: 'https://shop.rival.example/runner-3',
        ownership: 'competitor',
        competitor_id: RIVAL_ID,
        parser_version: 'chatgpt-ads-1',
        workspace_id: tenant.workspaceId,
      },
      {
        rank_absolute: 3,
        advertiser_domain: 'acme.example',
        landing_url_canonical: 'https://acme.example/trail',
        ownership: 'owned',
        competitor_id: null,
        parser_version: 'chatgpt-ads-1',
        workspace_id: tenant.workspaceId,
      },
    ]);
    expect(await analysisOf(taskId)).toEqual({
      ads_parser_version: 'chatgpt-ads-1',
      citation_count: 1,
      brand_mentioned: true,
    });
    const citations = await db
      .selectFrom('citations')
      .innerJoin('response_analyses as ra', 'ra.id', 'citations.analysis_id')
      .select('citations.url')
      .where('ra.task_id', '=', taskId)
      .execute();
    expect(citations).toEqual([{ url: 'https://rival.example/shoes' }]);
  });

  it('marks zero ads as observed only when the answer was parsed for ads', async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    const noAds = {
      status_code: 20000,
      tasks: [{ id: 'ours', status_code: 20000, result: [{ markdown: 'Plain', items: [] }] }],
    };
    const observedZero = await derive(tenant, auditId, 'chatgpt_search', noAds);
    const unreadable = await derive(tenant, auditId, 'chatgpt_search', { tasks: [] });
    const otherEngine = await derive(tenant, auditId, 'gemini_consumer', adsEnvelope);
    expect(
      await Promise.all(
        [observedZero, unreadable, otherEngine].map(async (taskId) => ({
          marker: (await analysisOf(taskId)).ads_parser_version,
          ads: (await adsOf(taskId)).length,
        })),
      ),
    ).toEqual([
      { marker: 'chatgpt-ads-1', ads: 0 },
      { marker: null, ads: 0 },
      { marker: null, ads: 0 },
    ]);
  });
});
