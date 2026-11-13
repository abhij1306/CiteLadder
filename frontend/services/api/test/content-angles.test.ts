/**
 * The content-angle refresh against real PostgreSQL: which citations are
 * clustered, the window, recompute keys and reuse, failed runs, lineages,
 * idempotent and concurrent tasks, and workspace isolation. The model gateway
 * is a scripted `complete`; nothing reaches a provider.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { contentAngleRefresh } from '../src/content-gaps/refresh.ts';
import { enqueueContentAngles } from '../src/content-gaps/enqueue.ts';
import { createModelGateway, gatewayCalls, gatewaySettings } from '../src/models/gateway.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { enqueueOpportunityRefresh } from '../src/opportunities/enqueue.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
import { SiteFixtures, storedFacts, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
const settings = loadWorkerSettings({});
const DAY = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

type Kind = 'competitor' | 'editorial' | 'social' | 'owned';
/** Each answer is its own repetition, so engines and prompts never collide. */
let repetition = 0;
type Cited = { url: string; title: string; kind: Kind };

/** One answer to `promptId` in `auditId`, citing `cited`. */
async function answer(
  seed: SiteSeed,
  auditId: string,
  promptRef: { id: string; index: number },
  cited: Cited[],
  engine = 'chatgpt',
) {
  const { analysisId } = await fixtures.execution(seed, {
    auditId,
    engine,
    promptIndex: promptRef.index,
    repetition: (repetition += 1),
    analysis: {
      citations: cited.map((citation) => ({
        url: citation.url,
        title: citation.title,
        isOwned: citation.kind === 'owned',
        sourceClass: {
          competitor: 'competitor_owned',
          editorial: 'editorial_third_party',
          social: 'community',
          owned: 'brand_owned',
        }[citation.kind],
      })),
    },
  });
  await db
    .updateTable('audit_prompt_snapshots')
    .set({ prompt_id: promptRef.id })
    .where('audit_id', '=', auditId)
    .where('prompt_index', '=', promptRef.index)
    .execute();
  for (const citation of cited.filter((item) => item.kind !== 'editorial'))
    await db // NOSONAR -- Fixture rows update in a fixed order.
      .updateTable('citations')
      .set({
        classification: { competitor: 'competitor', social: 'third_party', owned: 'owned' }[
          citation.kind as 'competitor' | 'social' | 'owned'
        ],
        matched_competitor: citation.kind === 'competitor' ? new URL(citation.url).hostname : null,
      })
      .where('analysis_id', '=', analysisId!)
      .where('url', '=', citation.url)
      .execute();
}

const PRICING: Cited[] = [
  { url: 'https://globex.com/pricing', title: 'Globex pricing plans', kind: 'competitor' },
  { url: 'https://review.example/crm-pricing', title: 'CRM pricing compared', kind: 'editorial' },
  { url: 'https://reddit.com/r/crm', title: 'CRM pricing thread', kind: 'social' },
  { url: 'https://example.test/crm-pricing', title: 'Acme pricing', kind: 'owned' },
];
const PRICING_GEMINI: Cited[] = [
  { url: 'https://globex.com/pricing', title: 'Globex pricing plans', kind: 'competitor' },
  { url: 'https://initech.com/pricing', title: 'Initech pricing', kind: 'competitor' },
];
const SETUP: Cited[] = [
  { url: 'https://globex.com/setup', title: 'Globex setup guide', kind: 'competitor' },
  { url: 'https://news.example/crm-setup', title: 'How to setup a CRM', kind: 'editorial' },
];

type Scenario = SiteSeed & { auditId: string; pageId: string; prompts: string[] };

/** A project with one topic, three prompts, one audit and one content page. */
async function scenario(): Promise<Scenario> {
  const seed = await fixtures.crawl();
  const crm = await topic(db, seed.projectId, 'CRM');
  const set = await promptSet(db, seed.projectId);
  const pricing = await prompt(db, set, 'best crm pricing', { topicId: crm });
  const setup = await prompt(db, set, 'crm setup', { topicId: crm });
  const general = await prompt(db, set, 'what is a crm');
  const auditId = await fixtures.audit(seed);
  await answer(seed, auditId, { id: pricing, index: 0 }, PRICING);
  await answer(seed, auditId, { id: pricing, index: 0 }, PRICING_GEMINI, 'gemini');
  await answer(seed, auditId, { id: setup, index: 1 }, SETUP);
  // A topicless prompt with too little to cluster.
  await answer(seed, auditId, { id: general, index: 2 }, [
    { url: 'https://globex.com/what-is-crm', title: 'What is a CRM', kind: 'competitor' },
  ]);
  const page = await fixtures.page(
    seed,
    '/crm-pricing',
    storedFacts({
      title: 'CRM pricing comparison',
      primary_heading_outline: [{ level: 1, text: 'CRM pricing plans compared' }],
      primary_content_text: 'Compare CRM pricing plans for small teams.',
    }),
  );
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: 'comparison' })
    .where('id', '=', page.analysisId)
    .execute();
  return { ...seed, auditId, pageId: page.id, prompts: [pricing, setup, general] };
}

type Payload = {
  pages: { id: string; title: string; excerpt?: string }[];
  angles?: { id: string; label: string; candidate_ids: string[] }[];
};
type Responder = (payload: Payload) => unknown;
type AsyncResponder = (payload: Payload) => Promise<unknown>;

/** Clusters titles by the first keyword they share with a label; picks a page sharing it. */
const labels = ['Pricing comparison', 'Setup guide'];
const keyword = (label: string) => label.split(' ')[0]!.toLowerCase();
const byKeyword: Responder = (payload) => {
  if (payload.angles) {
    const titles = new Map(payload.pages.map((page) => [page.id, page.title.toLowerCase()]));
    return {
      matches: payload.angles.map((angle) => ({
        angle_id: angle.id,
        owned_page_id:
          angle.candidate_ids.find((id) => titles.get(id)?.includes(keyword(angle.label))) ?? null,
      })),
    };
  }
  return {
    angles: labels.flatMap((label) => {
      const members = payload.pages
        .filter((page) => page.title.toLowerCase().includes(keyword(label)))
        .map((page) => page.id);
      return members.length ? [{ label, member_ids: members }] : [];
    }),
  };
};

/** A gateway whose every call is answered by `respond`; `calls` records each request. */
function scripted(respond: Responder | AsyncResponder | (() => never)) {
  const calls: { step: 'cluster' | 'match'; payload: Payload }[] = [];
  const base = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'test',
      baseUrl: 'https://model.test/v1',
    },
    {
      fetch: () => Promise.reject(new Error('no network in tests')),
      sleep: async () => {},
    },
  );
  const gateway = {
    ...base,
    ...gatewayCalls(async (_system, user) => {
      const payload = JSON.parse(user.split('\n\nReturn only JSON')[0]!) as Payload;
      calls.push({ step: payload.angles ? 'match' : 'cluster', payload });
      return {
        content: JSON.stringify(await respond(payload)),
        provider_adapter: 'openai_compatible',
        endpoint_host: 'model.test',
        requested_model: 'test',
        returned_model: 'test',
        finish_status: 'stop',
        usage: { input_tokens: 10, output_tokens: 5 },
        latency_ms: 1,
      };
    }),
  };
  return { gateway, calls };
}

/** Enqueue one refresh for a fresh trigger and drain it with `gateway`. */
async function refresh(seed: SiteSeed, gateway: ReturnType<typeof scripted>['gateway']) {
  await enqueueContentAngles(db, seed, { kind: 'audit', id: randomUUID() });
  await drain(seed, gateway);
}

async function drain(seed: SiteSeed, gateway: ReturnType<typeof scripted>['gateway']) {
  const ids = await taskIds(seed);
  await new AnalyticsWorker(db, settings, {
    executors: { content_angle_refresh: contentAngleRefresh(() => gateway) },
    taskScope: { workspaceId: seed.workspaceId, taskIds: ids },
  }).runUntilIdle();
}

const taskIds = async (seed: SiteSeed) =>
  (
    await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', seed.workspaceId)
      .where('task_kind', '=', 'content_angle_refresh')
      .where('status', '=', 'queued')
      .execute()
  ).map((row) => row.id);

const runs = (seed: SiteSeed) =>
  db
    .selectFrom('content_angle_runs')
    .selectAll()
    .where('workspace_id', '=', seed.workspaceId)
    .orderBy('created_at')
    .execute();

/** A run's angles with members and owned matches, by label. */
async function angles(runId: string) {
  const rows = await db
    .selectFrom('content_angles as angle')
    .innerJoin('content_angle_owned_matches as match', 'match.angle_id', 'angle.id')
    .select([
      'angle.id',
      'angle.lineage_id',
      'angle.label',
      'angle.citation_count',
      'angle.domain_count',
      'angle.competitor_count',
      'angle.engines',
      'angle.prompt_ids',
      'match.site_url_id',
      'match.method',
      'match.owned_cited',
    ])
    .where('angle.run_id', '=', runId)
    .orderBy('angle.label')
    .execute();
  if (!rows.length) return [];
  const members = await db
    .selectFrom('content_angle_members')
    .select(['angle_id', 'canonical_url', 'citation_ids'])
    .where(
      'angle_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('canonical_url')
    .execute();
  return rows.map(({ id, ...row }) => ({
    ...row,
    members: members.filter((member) => member.angle_id === id).map((m) => m.canonical_url),
    citationIds: members.filter((member) => member.angle_id === id).flatMap((m) => m.citation_ids),
  }));
}

const refreshTasks = (seed: SiteSeed) =>
  db
    .selectFrom('analytics_tasks')
    .select('payload')
    .where('workspace_id', '=', seed.workspaceId)
    .where('task_kind', '=', 'opportunity_refresh')
    .execute();

describe('a succeeded run', () => {
  it('clusters only competitor and editorial citations and matches the owned content page', async () => {
    const seed = await scenario();
    const model = scripted(byKeyword);
    await refresh(seed, model.gateway);

    const [run, ...rest] = await runs(seed);
    expect(rest).toEqual([]);
    expect(run).toMatchObject({
      outcome: 'succeeded',
      outcome_reason: null,
      audit_ids: [seed.auditId],
      crawl_id: seed.crawlId,
      model_provider: 'openai_compatible',
      model: 'test',
      methodology_version: 'content-angles-1',
      formula_version: 'content-gaps-1',
      limitations: [
        { code: 'topicless_prompts', count: 1, total: 3 },
        { code: 'too_few_citations', topics: 1 },
      ],
    });
    expect(await angles(run!.id)).toEqual([
      {
        lineage_id: expect.any(String),
        label: 'Pricing comparison',
        citation_count: 4,
        domain_count: 3,
        competitor_count: 2,
        engines: ['chatgpt', 'gemini'],
        prompt_ids: [seed.prompts[0]],
        site_url_id: seed.pageId,
        method: 'model_pick',
        // The matched page is cited for the angle's prompt.
        owned_cited: true,
        members: [
          'https://globex.com/pricing',
          'https://initech.com/pricing',
          'https://review.example/crm-pricing',
        ],
        citationIds: expect.any(Array),
      },
      {
        lineage_id: expect.any(String),
        label: 'Setup guide',
        citation_count: 2,
        domain_count: 2,
        competitor_count: 1,
        engines: ['chatgpt'],
        prompt_ids: [seed.prompts[1]],
        site_url_id: null,
        method: 'none',
        owned_cited: false,
        members: ['https://globex.com/setup', 'https://news.example/crm-setup'],
        citationIds: expect.any(Array),
      },
    ]);
    // One cluster call for the CRM topic, one match call for its angles.
    expect(model.calls.map((call) => call.step)).toEqual(['cluster', 'match']);
    // Most-cited first, then by URL; the social, owned and topicless citations are not sent.
    expect(model.calls[0]!.payload.pages.map((page) => page.title)).toEqual([
      'Globex pricing plans',
      'Globex setup guide',
      'Initech pricing',
      'How to setup a CRM',
      'CRM pricing compared',
    ]);
    expect((await refreshTasks(seed)).map((task) => task.payload)).toEqual([
      { trigger_kind: 'content_angles', trigger_id: run!.id },
    ]);
  });

  it('reads no citation from an answer without a tracked prompt', async () => {
    const seed = await scenario();
    // The run's fourth prompt snapshot names no prompt in the library.
    await fixtures.execution(seed, {
      auditId: seed.auditId,
      promptIndex: 3,
      repetition: (repetition += 1),
      analysis: {
        citations: [
          {
            url: 'https://news.example/crm-pricing-guide',
            title: 'CRM pricing guide',
            isOwned: false,
            sourceClass: 'editorial_third_party',
          },
        ],
      },
    });
    const model = scripted(byKeyword);
    await refresh(seed, model.gateway);

    const [run] = await runs(seed);
    expect(run?.limitations).toEqual([
      { code: 'topicless_prompts', count: 1, total: 3 },
      { code: 'too_few_citations', topics: 1 },
    ]);
    expect(model.calls[0]!.payload.pages.map((page) => page.title)).toEqual([
      'Globex pricing plans',
      'Globex setup guide',
      'Initech pricing',
      'How to setup a CRM',
      'CRM pricing compared',
    ]);
  });

  it('joins the Opportunity refresh its audit already queued instead of queueing a second', async () => {
    const seed = await scenario();
    await enqueueOpportunityRefresh(db, {
      ...seed,
      triggerKind: 'audit',
      triggerId: seed.auditId,
    });
    await refresh(seed, scripted(byKeyword).gateway);

    expect(await runs(seed)).toMatchObject([{ outcome: 'succeeded' }]);
    expect((await refreshTasks(seed)).map((task) => task.payload)).toEqual([
      { trigger_kind: 'audit', trigger_id: seed.auditId },
    ]);
  });

  it('reads only its own workspace when two workspaces hold identical data', async () => {
    const [a, b] = [await scenario(), await scenario()];
    await refresh(a, scripted(byKeyword).gateway);
    await refresh(b, scripted(byKeyword).gateway);
    for (const seed of [a, b]) {
      const [run] = await runs(seed);
      const found = await angles(run!.id);
      const own = await db
        .selectFrom('citations')
        .select('id')
        .where('workspace_id', '=', seed.workspaceId)
        .execute();
      const ids = new Set(own.map((row) => row.id));
      const cited = found.flatMap((angle) => angle.citationIds);
      expect(cited).toHaveLength(6);
      expect(cited.filter((id) => !ids.has(id))).toEqual([]);
      expect(found.map((angle) => angle.site_url_id)).toEqual([seed.pageId, null]);
    }
  });

  it('anchors the window at the newest audit: a 31-day-older audit is excluded', async () => {
    const seed = await scenario();
    const anchor = await db
      .selectFrom('audits')
      .select('completed_at')
      .where('id', '=', seed.auditId)
      .executeTakeFirstOrThrow();
    const at = (days: number) => new Date(anchor.completed_at!.getTime() - days * DAY);
    const recent = await fixtures.audit(seed, { completedAt: at(29) });
    const old = await fixtures.audit(seed, { completedAt: at(31) });
    const pricing = { id: seed.prompts[0]!, index: 0 };
    await answer(seed, recent, pricing, [
      { url: 'https://hooli.com/pricing', title: 'Hooli pricing', kind: 'competitor' },
    ]);
    await answer(seed, old, pricing, [
      { url: 'https://oldco.com/pricing', title: 'Oldco pricing', kind: 'competitor' },
    ]);
    await refresh(seed, scripted(byKeyword).gateway);

    const [run] = await runs(seed);
    expect([...run!.audit_ids].sort()).toEqual([seed.auditId, recent].sort());
    const [pricingAngle] = await angles(run!.id);
    expect(pricingAngle!.members).toEqual([
      'https://globex.com/pricing',
      'https://hooli.com/pricing',
      'https://initech.com/pricing',
      'https://review.example/crm-pricing',
    ]);
  });
});

describe('recompute keys', () => {
  it('appends a run only when an input changed, and calls the model only for what changed', async () => {
    const seed = await scenario();
    const model = scripted(byKeyword);
    await refresh(seed, model.gateway);
    // Same inputs: no run, no call.
    await refresh(seed, model.gateway);
    expect(await runs(seed)).toHaveLength(1);
    expect(model.calls.map((call) => call.step)).toEqual(['cluster', 'match']);

    // A changed title: a new clustering key and a clustering call.
    await db
      .updateTable('citations')
      .set({ title: 'Initech pricing tiers' })
      .where('workspace_id', '=', seed.workspaceId)
      .where('url', '=', 'https://initech.com/pricing')
      .execute();
    await refresh(seed, model.gateway);
    const [first, second] = await runs(seed);
    expect(second!.cluster_key).not.toBe(first!.cluster_key);
    expect(model.calls.map((call) => call.step)).toEqual(['cluster', 'match', 'cluster', 'match']);

    // Only a new crawl: the clustering is reused and only the match is recomputed.
    const crawlId = await fixtures.sibling(seed, { completed_at: new Date(Date.now() + 60_000) });
    const page = await fixtures.page(
      { ...seed, crawlId },
      '/crm-pricing',
      storedFacts({ title: 'CRM pricing comparison', primary_content_text: 'CRM pricing plans.' }),
      { siteUrlId: seed.pageId },
    );
    await db
      .updateTable('site_page_analyses')
      .set({ page_kind: 'comparison' })
      .where('id', '=', page.analysisId)
      .execute();
    await refresh(seed, model.gateway);
    const third = (await runs(seed))[2]!;
    expect(third).toMatchObject({ crawl_id: crawlId, cluster_key: second!.cluster_key });
    expect(third.match_key).not.toBe(second!.match_key);
    expect(model.calls.slice(4).map((call) => call.step)).toEqual(['match']);
    // The reused clustering keeps every angle on its lineage.
    const lineageOf = async (runId: string) =>
      (await angles(runId)).map((angle) => [angle.label, angle.lineage_id]);
    expect(await lineageOf(third.id)).toEqual(await lineageOf(second!.id));
  });
});

describe('a failed run', () => {
  it('records output naming an unknown URL ID, with no angles and no refresh', async () => {
    const seed = await scenario();
    await refresh(
      seed,
      scripted((payload) =>
        payload.angles
          ? byKeyword(payload)
          : { angles: [{ label: 'Pricing', member_ids: ['u99'] }] },
      ).gateway,
    );
    const [run] = await runs(seed);
    expect(run).toMatchObject({ outcome: 'failed', outcome_reason: 'rejected:unknown_member' });
    expect(await angles(run!.id)).toEqual([]);
    expect(await refreshTasks(seed)).toEqual([]);
  });
});

describe('lineages', () => {
  /** Relabels the pricing angle and regroups the setup pages into a new angle. */
  const relabelled: Responder = (payload) => {
    if (payload.angles) return byKeyword(payload);
    const ids = (pattern: RegExp) =>
      payload.pages.filter((page) => pattern.test(page.title.toLowerCase())).map((p) => p.id);
    return {
      angles: [
        { label: 'Pricing plans', member_ids: ids(/pricing/u) },
        { label: 'Onboarding', member_ids: ids(/guide|checklist|docs/u) },
      ],
    };
  };

  it('keeps a relabelled angle on its lineage and its planned-page key unchanged', async () => {
    const seed = await scenario();
    await refresh(seed, scripted(byKeyword).gateway);
    const [first] = await runs(seed);
    const [pricing, setup] = await angles(first!.id);
    // A new pricing page joins (3 shared of 4: 0.75); setup pages regroup.
    const pricingAudit = await fixtures.audit(seed);
    await answer(seed, pricingAudit, { id: seed.prompts[0]!, index: 0 }, [
      ...PRICING,
      { url: 'https://hooli.com/pricing', title: 'Hooli pricing', kind: 'competitor' },
    ]);
    await answer(seed, pricingAudit, { id: seed.prompts[0]!, index: 0 }, PRICING_GEMINI, 'gemini');
    await answer(seed, pricingAudit, { id: seed.prompts[1]!, index: 1 }, [
      SETUP[0]!,
      { url: 'https://globex.com/onboarding', title: 'Globex setup checklist', kind: 'competitor' },
      { url: 'https://initech.com/setup', title: 'Initech setup docs', kind: 'competitor' },
    ]);
    await refresh(seed, scripted(relabelled).gateway);

    const second = (await runs(seed))[1]!;
    const [onboarding, plans] = await angles(second.id);
    expect(plans).toMatchObject({ label: 'Pricing plans', lineage_id: pricing!.lineage_id });
    // Setup kept 1 of its 2 pages among 4: 0.25, below the minimum.
    expect(onboarding!.label).toBe('Onboarding');
    expect(onboarding!.lineage_id).not.toBe(setup!.lineage_id);
    // Each lineage is keyed by the label it was created with, never by a later one.
    const lineages = await db
      .selectFrom('content_angle_lineages')
      .select(['id', 'planned_page_key', 'first_run_id'])
      .where('id', 'in', [pricing!.lineage_id, onboarding!.lineage_id])
      .execute();
    expect(
      [pricing!.lineage_id, onboarding!.lineage_id].map((id) => {
        const { planned_page_key, first_run_id } = lineages.find((row) => row.id === id)!;
        return [planned_page_key, first_run_id];
      }),
    ).toEqual([
      ['planned:pricing-comparison', first!.id],
      ['planned:onboarding', second.id],
    ]);
  });
});

describe('idempotent tasks', () => {
  it('a replayed trigger is one task, and concurrent tasks over the same inputs write one run', async () => {
    const seed = await scenario();
    const trigger = { kind: 'audit' as const, id: seed.auditId };
    expect(await enqueueContentAngles(db, seed, trigger)).toEqual(expect.any(String));
    expect(await enqueueContentAngles(db, seed, trigger)).toBeNull();
    await enqueueContentAngles(db, seed, { kind: 'site_crawl', id: seed.crawlId });
    const ids = await taskIds(seed);
    expect(ids).toHaveLength(2);
    const model = scripted(byKeyword);
    await Promise.all(
      ids.map((id) =>
        new AnalyticsWorker(db, settings, {
          executors: { content_angle_refresh: contentAngleRefresh(() => model.gateway) },
          taskScope: { workspaceId: seed.workspaceId, taskIds: [id] },
        }).runUntilIdle(),
      ),
    );
    expect(await runs(seed)).toHaveLength(1);
    const statuses = await db
      .selectFrom('analytics_tasks')
      .select('status')
      .where('id', 'in', ids)
      .execute();
    expect(statuses.map((row) => row.status)).toEqual(['succeeded', 'succeeded']);
    expect(await refreshTasks(seed)).toHaveLength(1);
  });

  it('writes no run when a newer crawl lands while the model is called', async () => {
    const seed = await scenario();
    let newer = false;
    await refresh(
      seed,
      scripted(async (payload) => {
        if (!newer) {
          newer = true;
          await fixtures.sibling(seed, { completed_at: new Date(Date.now() + 60_000) });
        }
        return byKeyword(payload);
      }).gateway,
    );
    expect(await runs(seed)).toEqual([]);
    expect(await refreshTasks(seed)).toEqual([]);
  });
});
