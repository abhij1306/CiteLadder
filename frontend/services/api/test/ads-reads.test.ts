/**
 * Ads in AI answers over HTTP: the selection summary and its states, creative
 * pages, the execution evidence section, ads kept out of Sources, and
 * workspace isolation.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const app = createApp(config, db);
const PARSER = 'chatgpt-ads-1';

type Body = Record<string, unknown>;

async function get(tenant: Tenant, path: string, query: Record<string, string> = {}) {
  const token = await sessionToken({ sub: tenant.userId, ver: 0 });
  const search = new URLSearchParams(query);
  const response = await app.request(`${path}${search.size ? `?${search}` : ''}`, {
    headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` },
  });
  return { status: response.status, body: (await response.json()) as Body };
}

type Ad = { rank: number; domain: string; title: string; ownership?: string };

/** One answer; `ads` undefined leaves it unparsed for ads. */
async function answer(
  tenant: Tenant,
  auditId: string,
  input: {
    engine?: string;
    prompt?: string;
    brandMentioned?: boolean;
    citations?: string[];
    ads?: Ad[];
  },
) {
  const { taskId, analysisId } = await fixtures.execution(tenant, {
    auditId,
    engine: input.engine ?? 'chatgpt_search',
    promptText: input.prompt ?? 'best running shoes',
    theme: 'Shoes',
    analysis: {
      brandMentioned: input.brandMentioned ?? false,
      citations: (input.citations ?? []).map((url) => ({ url })),
    },
  });
  if (!input.ads) return taskId;
  const analysis = await db
    .updateTable('response_analyses')
    .set({ ads_parser_version: PARSER })
    .where('id', '=', analysisId!)
    .returning('artifact_id')
    .executeTakeFirstOrThrow();
  if (input.ads.length)
    await db
      .insertInto('answer_ad_observations')
      .values(
        input.ads.map((ad) => ({
          id: randomUUID(),
          workspace_id: tenant.workspaceId,
          project_id: tenant.projectId,
          audit_id: auditId,
          task_id: taskId,
          artifact_id: analysis.artifact_id,
          parser_version: PARSER,
          rank_absolute: ad.rank,
          rank_group: ad.rank,
          advertiser_name: ad.domain,
          advertiser_domain: ad.domain,
          landing_url_raw: `https://${ad.domain}/landing?gclid=1`,
          landing_url_canonical: `https://${ad.domain}/landing`,
          title: ad.title,
          snippet: '',
          image_url: `https://cdn.example/${ad.domain}.png`,
          ownership: ad.ownership ?? 'other',
          competitor_id: null,
          created_at: new Date(),
        })),
      )
      .execute();
  return taskId;
}

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /visibility/ads', () => {
  let tenant: Tenant;
  let auditId: string;
  let adTask: string;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    auditId = await fixtures.audit(tenant);
    adTask = await answer(tenant, auditId, {
      citations: ['https://reviews.example/shoes'],
      ads: [
        { rank: 1, domain: 'rival.example', title: 'Rival Runner', ownership: 'competitor' },
        { rank: 2, domain: 'acme.example', title: 'Acme Trail', ownership: 'owned' },
      ],
    });
    await answer(tenant, auditId, {
      brandMentioned: true,
      ads: [{ rank: 1, domain: 'rival.example', title: 'Rival Runner', ownership: 'competitor' }],
    });
    await answer(tenant, auditId, { prompt: 'trail shoes', ads: [] });
    await answer(tenant, auditId, { prompt: 'trail shoes' });
    await answer(tenant, auditId, { engine: 'claude', citations: ['https://blog.example/a'] });
  });

  it('summarises ad presence over answers parsed for ads, by advertiser and prompt', async () => {
    const { status, body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/ads`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      state: 'value',
      source_audit_ids: [auditId],
      parser_versions: [PARSER],
      presence: { answers: 3, answers_with_ads: 2, rate: 2 / 3 },
      engines: [
        {
          engine: 'chatgpt_search',
          applicability: 'applicable',
          answers: 4,
          presence: { answers: 3, answers_with_ads: 2, rate: 2 / 3 },
        },
        { engine: 'claude', applicability: 'not_applicable', answers: 1, presence: null },
      ],
      brand: { appearances: 1, share: 1 / 3, best_rank: 2 },
      advertisers_seen: 2,
      prompts: [
        {
          prompt: 'best running shoes',
          ads_seen: 3,
          top_advertiser: { name: 'rival.example', domain: 'rival.example' },
          competitor_ad_answers: { brand_mentioned: 1, brand_not_mentioned: 1 },
        },
      ],
    });
    expect((body.advertisers as Body[]).map((row) => [row.domain, row.appearances])).toEqual([
      ['rival.example', 2],
      ['acme.example', 1],
    ]);
  });

  it('pages creatives with a cursor and serves only the canonical landing URL', async () => {
    const path = `/api/v1/projects/${tenant.projectId}/visibility/ads`;
    const first = await get(tenant, path, { audit_id: auditId, limit: '1' });
    const creatives = first.body.creatives as { items: Body[]; total: number; next_cursor: string };
    expect(creatives.total).toBe(2);
    expect(creatives.items).toEqual([
      expect.objectContaining({
        title: 'Rival Runner',
        landing_url: 'https://rival.example/landing',
        appearances: 2,
      }),
    ]);
    expect(JSON.stringify(first.body)).not.toContain('gclid');
    const second = await get(tenant, path, {
      audit_id: auditId,
      limit: '1',
      cursor: creatives.next_cursor,
    });
    expect(second.body.creatives).toMatchObject({
      items: [{ title: 'Acme Trail' }],
      next_cursor: null,
    });
  });

  it('is not applicable for an engine without ads', async () => {
    const { body } = await get(tenant, `/api/v1/projects/${tenant.projectId}/visibility/ads`, {
      engine: 'claude',
    });
    expect(body).toMatchObject({
      state: 'not_applicable',
      presence: { answers: 0, answers_with_ads: 0, rate: null },
      brand: { appearances: 0, share: null, best_rank: null },
    });
  });

  it('lists the ads under the execution evidence and never among its citations or Sources', async () => {
    const evidence = await get(tenant, `/api/v1/executions/${adTask}`);
    expect(evidence.body.ads).toEqual({
      applicability: 'applicable',
      parser_version: PARSER,
      items: [
        {
          rank_absolute: 1,
          advertiser_name: 'rival.example',
          advertiser_domain: 'rival.example',
          ownership: 'competitor',
          title: 'Rival Runner',
          snippet: '',
          landing_url: 'https://rival.example/landing',
        },
        {
          rank_absolute: 2,
          advertiser_name: 'acme.example',
          advertiser_domain: 'acme.example',
          ownership: 'owned',
          title: 'Acme Trail',
          snippet: '',
          landing_url: 'https://acme.example/landing',
        },
      ],
    });
    expect((evidence.body.citations as Body[]).map((row) => row.url)).toEqual([
      'https://reviews.example/shoes',
    ]);
    const sources = await get(tenant, `/api/v1/projects/${tenant.projectId}/visibility/sources`, {
      audit_id: auditId,
    });
    expect((sources.body.items as Body[]).map((row) => row.key).sort()).toEqual([
      'blog.example',
      'reviews.example',
    ]);
  });

  it('is not found from another workspace', async () => {
    const outsider = await fixtures.tenant();
    const summary = await get(outsider, `/api/v1/projects/${tenant.projectId}/visibility/ads`, {
      audit_id: auditId,
    });
    const foreignRun = await get(
      outsider,
      `/api/v1/projects/${outsider.projectId}/visibility/ads`,
      { audit_id: auditId },
    );
    const evidence = await get(outsider, `/api/v1/executions/${adTask}`);
    expect([summary.status, foreignRun.status, evidence.status]).toEqual([404, 404, 404]);
  });
});
