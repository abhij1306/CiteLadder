import { afterAll, expect, it } from 'vitest';
import { architectureSchema } from '@citeladder/contracts/site-health/architecture';
import { buildArchitecture, type ArchitecturePage } from '../src/site-health/architecture-model.ts';
import { architectureRules } from '../src/site-health/architecture-rules.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { issueDetail, issues as readIssues } from '../src/site-health/reads/issues.ts';
import { testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';

const context = {
  business_model: 'retail',
  knowledge_strength: 'confirmed',
  field_confidence: { business_model: 0.9 },
  market_scope: 'national',
};
it('rejects malformed persisted identifiers in orphan-page projections', () => {
  const schema = architectureSchema.shape.internal_linking.shape.orphan_pages;
  const orphan = {
    site_url_id: '00000000-0000-4000-8000-000000000001',
    url: 'https://example.test/orphan',
    title: 'Orphan',
    page_kind: 'product',
  };
  expect(schema.safeParse([orphan]).success).toBe(true);
  expect(schema.safeParse([{ ...orphan, site_url_id: 'malformed' }]).success).toBe(false);
});
function page(
  id: string,
  path: string,
  kind = 'product',
  extra: Partial<ArchitecturePage> = {},
): ArchitecturePage {
  return {
    id,
    analysisId: `analysis-${id}`,
    artifactId: `artifact-${id}`,
    metricId: `metric-${id}`,
    url: `https://example.test${path}`,
    title: '',
    description: '',
    kind,
    depth: null,
    inbound: 0,
    outbound: 0,
    contentOutbound: 0,
    indexable: null,
    facts: {},
    ...extra,
  };
}
it('chooses visible breadcrumb, explicit structure, safe path hub and then unknown', () => {
  const pages = [
    page('home', '/', 'homepage'),
    page('category', '/products', 'category'),
    page('breadcrumb', '/products/one', 'product', {
      facts: {
        commerce: { breadcrumb_links: [{ url: '/' }, { url: '/products' }] },
        structured_data: [{ is_part_of_url: '/' }],
      },
    }),
    page('explicit', '/elsewhere/two', 'product', {
      facts: { structured_data: { blocks: [{ is_part_of_url: '/products' }] } },
    }),
    page('path', '/products/three'),
    page('unknown', '/missing/four'),
  ];
  const model = buildArchitecture(pages, 'complete', context);
  const rows = new Map(model.hierarchy.map((row) => [row.site_url_id, row]));
  expect(rows.get('breadcrumb')!.parent_source).toBe('breadcrumb');
  expect(rows.get('breadcrumb')!.parent_site_url_id).toBe('category');
  expect(rows.get('explicit')!.parent_source).toBe('explicit_structure');
  expect(rows.get('path')!.parent_source).toBe('url_parent');
  expect(rows.get('unknown')!.parent_site_url_id).toBeNull();
  expect(
    architectureRules(model, pages, 'complete').find((row) =>
      row.rule.rule_id.endsWith('hierarchy_conflict'),
    )!.outcome,
  ).toBe('missing');
});
it('abstains on redirect collisions and breaks cycles while retaining an outside child', () => {
  const pages = [
    page('outside', '/a', 'product', { facts: { structured_data: [{ is_part_of_url: '/b' }] } }),
    page('b', '/b', 'product', { facts: { structured_data: [{ is_part_of_url: '/c' }] } }),
    page('c', '/c', 'product', { facts: { structured_data: [{ is_part_of_url: '/b' }] } }),
  ];
  const rows = buildArchitecture(pages, 'complete', {}).hierarchy;
  expect(rows.find((row) => row.site_url_id === 'outside')!.parent_site_url_id).toBe('b');
  expect(rows.filter((row) => row.cycle_suppressed)).toHaveLength(1);
  const ambiguous = buildArchitecture(
    [
      page('first', '/hub', 'category'),
      page('second', '/hub', 'category'),
      page('child', '/hub/child'),
    ],
    'complete',
    {},
  );
  expect(
    ambiguous.hierarchy.find((row) => row.site_url_id === 'child')!.parent_site_url_id,
  ).toBeNull();
});
it('counts in-content links apart from the links that menus repeat on every page', () => {
  const pages = [
    page('home', '/', 'homepage', { depth: 0, outbound: 12, contentOutbound: 4 }),
    page('a', '/a', 'product', { depth: 1, inbound: 1, outbound: 10, contentOutbound: 1 }),
  ];
  const { internal_linking } = buildArchitecture(pages, 'complete', context);
  expect(internal_linking).toMatchObject({ internal_link_count: 22, content_link_count: 5 });
});
it('keeps observed orphan and duplicate counts under partial coverage but gates absence and depth findings', () => {
  const pages = [
    page('home', '/', 'homepage', { depth: 0, inbound: 1 }),
    ...['a', 'b', 'c'].map((id) =>
      page(id, `/missing/${id}`, 'product', {
        title: 'Same title',
        description: 'Same description',
        depth: 5,
      }),
    ),
  ];
  const model = buildArchitecture(pages, 'partial', context);
  expect(model.internal_linking.orphan_page_count).toBe(3);
  expect(
    model.page_kinds.find((row) => row.page_kind === 'product')!.duplicate_metadata_count,
  ).toBe(3);
  const partial = architectureRules(model, pages, 'partial');
  // Depth over a partly observed graph is an upper bound, not a finding.
  expect(partial.find((row) => row.rule.rule_id.endsWith('excessive_depth'))).toMatchObject({
    outcome: 'unknown',
    reason: 'coverage_not_complete',
  });
  expect(
    partial.find((row) => row.rule.rule_id.endsWith('duplicate_metadata_in_page_kind'))!.outcome,
  ).toBe('missing');
  expect(partial.filter((row) => row.reason === 'coverage_not_complete')).toHaveLength(5);
  const complete = architectureRules(
    buildArchitecture(pages, 'complete', context),
    pages,
    'complete',
  );
  expect(complete.filter((row) => row.outcome === 'missing')).toHaveLength(5);
  expect(model.structure_depth.buckets.find((row) => row.key === 'depth_3_plus')!.percentage).toBe(
    0.75,
  );
});
it('groups pages no link path from the homepage reaches by section, apart from orphans', () => {
  const pages = [
    page('home', '/', 'homepage', { depth: 0, inbound: 1 }),
    page('shop', '/collections/nets', 'category', { depth: 1, inbound: 3 }),
    // A testimonials section that only links to itself.
    page('hub', '/blogs/testimonials', 'editorial_index', { inbound: 3 }),
    page('one', '/blogs/testimonials/one', 'article', { inbound: 1 }),
    page('two', '/blogs/testimonials/two', 'article', { inbound: 1 }),
    page('tag', '/blogs/testimonials/tagged/golf', 'editorial_index', { inbound: 2 }),
    page('stray', '/products/old-cover', 'product', { inbound: 1 }),
    // No inbound link at all: the orphan rule's finding, never repeated here.
    page('orphan', '/pages/landing', 'other'),
  ];
  const rule = (coverage: string) =>
    architectureRules(buildArchitecture(pages, coverage, context), pages, coverage).find(
      (row) => row.rule.rule_id === 'architecture.unreachable_from_home',
    )!;
  const complete = rule('complete');
  const evidence = record(complete.evidence);
  expect([complete.outcome, complete.rule.finding_class, evidence.count]).toEqual([
    'missing',
    'defect',
    5,
  ]);
  expect(evidence.sections).toEqual([
    {
      path_prefix: '/blogs/testimonials',
      page_count: 4,
      example_url: 'https://example.test/blogs/testimonials',
    },
    {
      path_prefix: '/products/old-cover',
      page_count: 1,
      example_url: 'https://example.test/products/old-cover',
    },
  ]);
  // A link the crawl did not see could make a page reachable.
  expect(rule('partial')).toMatchObject({ outcome: 'unknown', reason: 'coverage_not_complete' });
  // Without the homepage in the graph no page has a depth, and none is unreachable.
  const homeless = pages.slice(1);
  expect(
    architectureRules(buildArchitecture(homeless, 'complete', context), homeless, 'complete').find(
      (row) => row.rule.rule_id === 'architecture.unreachable_from_home',
    ),
  ).toMatchObject({ outcome: 'unknown', reason: 'homepage_not_observed' });
});
it.each([
  [{}, 'profile_absent'],
  [{ ...context, knowledge_strength: 'none' }, 'knowledge_strength_none'],
  [
    { ...context, field_confidence: { business_model: 0.1 } },
    'business_model_confidence_below_floor',
  ],
  [
    { ...context, field_confidence: { business_model: '0.9' } },
    'business_model_confidence_below_floor',
  ],
  [{ ...context, business_model: 'unknown' }, 'business_model_not_mapped'],
] as const)('abstains on unsafe onboarding context %#', (input, reason) => {
  expect(buildArchitecture([page('product', '/product')], 'complete', input).archetype.reason).toBe(
    reason,
  );
});
it('crawl contradictions only veto an archetype and absence advisories require completeness', () => {
  const contradictions = Array.from({ length: 5 }, (_, index) =>
    page(`${index}`, `/docs/${index}`, 'docs'),
  );
  expect(buildArchitecture(contradictions, 'complete', context).archetype.reason).toBe(
    'crawl_materially_contradicts_profile',
  );
  const complete = buildArchitecture([page('product', '/product')], 'complete', context).archetype;
  expect(complete.archetype).toBe('commerce');
  expect(complete.not_observed.length).toBeGreaterThan(0);
  expect(
    buildArchitecture([page('product', '/product')], 'partial', context).archetype.not_observed,
  ).toEqual([]);
  expect(buildArchitecture(contradictions, 'complete', {}).archetype.archetype).toBe('other');
});

const db = testDatabase();
it('includes location advice only for local or regional service businesses', () => {
  const input = { ...context, business_model: 'professional_service' };
  const pages = [page('service', '/services', 'service')];
  expect(
    buildArchitecture(pages, 'complete', {
      ...input,
      market_scope: 'local',
    }).archetype.not_observed.some((row) => row.key === 'locations'),
  ).toBe(true);
  expect(
    buildArchitecture(pages, 'complete', input).archetype.not_observed.some(
      (row) => row.key === 'locations',
    ),
  ).toBe(false);
});
const fixtures = new SiteFixtures(db);
const settings = { ...siteWorkerSettings({}), concurrency: 1 };
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
type Seed = Awaited<ReturnType<SiteFixtures['crawl']>>;
async function derive(seed: Seed) {
  await fixtures.task(seed, 'link_metrics');
  const worker = fixtures.worker(seed, { settings });
  expect(await worker.runOnce()).toBe(1);
  expect(await worker.runOnce()).toBe(1);
}
it('downgrades complete coverage when architecture evidence reaches its source cap', async () => {
  const seed = await fixtures.crawl();
  await fixtures.snapshot(seed, 'complete');
  await fixtures.page(seed, '/', {});
  await fixtures.page(seed, '/orphan', {});
  const previous = policy.site_health.architecture.max_pages;
  policy.site_health.architecture.max_pages = 1;
  try {
    await derive(seed);
    const architecture = await db
      .selectFrom('site_observed_architectures')
      .selectAll()
      .where('crawl_id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
    expect(architecture.coverage_state).toBe('partial');
    expect(architecture.source_analysis_ids).toHaveLength(1);
    const evaluations = await db
      .selectFrom('site_rule_evaluations')
      .select(['outcome', 'reason_code'])
      .where('source_architecture_id', '=', architecture.id)
      .execute();
    // Orphans, unreachable pages, parentless details, unhubbed kinds and depth
    // all need complete coverage.
    expect(evaluations.filter((row) => row.reason_code === 'coverage_not_complete')).toHaveLength(
      5,
    );
  } finally {
    policy.site_health.architecture.max_pages = previous;
  }
});
it('persists exact source IDs, seven root evaluations and replay-safe architecture from current metrics', async () => {
  const seed = await fixtures.crawl();
  const snapshot = await fixtures.snapshot(seed);
  const profile = await fixtures.businessProfile(seed, context);
  const home = await fixtures.page(seed, '/', {
    title: 'Home',
    links: { anchors: [{ url: '/product', is_internal: true, region: 'main' }] },
  });
  const product = await fixtures.page(seed, '/product', {
    title: 'Product',
    commerce: { breadcrumb_links: [{ url: '/' }] },
  });
  const homeEvaluation = await fixtures.evaluation(seed, home, 'technical.indexable', 'satisfied');
  const productEvaluation = await fixtures.evaluation(
    seed,
    product,
    'technical.indexable',
    'unknown',
  );
  await fixtures.page(seed, '/stale', {}, { current: false });
  await derive(seed);
  const rows = await db
    .selectFrom('site_observed_architectures')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  expect(rows).toHaveLength(1);
  const architecture = rows[0]!;
  expect(architecture.page_count).toBe(2);
  expect(architecture.source_snapshot_id).toBe(snapshot);
  expect(architecture.source_brand_profile_id).toBe(profile);
  expect(new Set(architecture.source_artifact_ids)).toEqual(
    new Set([home.artifactId, product.artifactId]),
  );
  expect(new Set(architecture.source_analysis_ids)).toEqual(
    new Set([home.analysisId, product.analysisId]),
  );
  expect(architecture.source_link_metric_ids).toHaveLength(2);
  expect(new Set(architecture.source_evaluation_ids)).toEqual(
    new Set([homeEvaluation, productEvaluation]),
  );
  const kinds = architecture.page_kinds as { page_kind: string; indexable_count: number }[];
  expect(kinds.find((row) => row.page_kind === 'homepage')!.indexable_count).toBe(1);
  expect(kinds.find((row) => row.page_kind === 'product')!.indexable_count).toBe(0);
  const evaluations = await db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('source_architecture_id', '=', architecture.id)
    .execute();
  expect(evaluations).toHaveLength(7);
  expect(evaluations.every((row) => row.analysis_id === home.analysisId)).toBe(true);
  expect(evaluations.filter((row) => row.outcome === 'unknown')).toHaveLength(5);
  expect(record(architecture.archetype).archetype).toBe('commerce');
  await fixtures.task(seed, 'architecture');
  expect(await fixtures.worker(seed, { settings }).runOnce()).toBe(1);
  expect(
    await db
      .selectFrom('site_observed_architectures')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute(),
  ).toHaveLength(1);
  expect(
    await db
      .selectFrom('site_rule_evaluations')
      .select('id')
      .where('source_architecture_id', '=', architecture.id)
      .execute(),
  ).toHaveLength(7);
});
it('complete coverage creates actionable root findings without borrowing foreign evidence', async () => {
  const seed = await fixtures.crawl();
  const other = await fixtures.crawl();
  await fixtures.snapshot(seed, 'complete');
  await fixtures.snapshot(other, 'complete');
  const home = await fixtures.page(seed, '/', {});
  await fixtures.page(seed, '/orphan/product', {});
  await fixtures.page(seed, '/orphan/other', {});
  await fixtures.page(other, '/', {});
  await derive(seed);
  const issues = await db
    .selectFrom('site_issues')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  expect(issues.some((row) => row.rule_id === 'architecture.orphan_pages')).toBe(true);
  expect(issues.every((row) => row.site_url_id === home.id)).toBe(true);
  // Filed once against the homepage, the finding still counts the pages it names.
  const catalog = await readIssues(
    db,
    seed.workspaceId,
    seed.crawlId,
    {
      query: null,
      severity: null,
      category: null,
      dimension: null,
      rule: null,
      siteUrlId: null,
      pageKind: null,
      findingClass: 'defect',
    },
    { limit: 50, cursor: null },
  );
  const orphans = catalog.items.find((item) => item.rule_id === 'architecture.orphan_pages')!;
  expect(orphans.affected_url_count).toBe(2);
  expect(orphans.page_kinds).not.toContain('homepage');
  const detail = await issueDetail(db, seed.workspaceId, seed.crawlId, orphans.group_id, {
    limit: 10,
    cursor: null,
  });
  expect(detail.affected_url_count).toBe(2);
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select('top_issues')
    .where('crawl_id', '=', seed.crawlId)
    .executeTakeFirstOrThrow();
  const top = (snapshot.top_issues as { rule_id: string; affected_pages: number }[]).find(
    (item) => item.rule_id === 'architecture.orphan_pages',
  );
  expect(top?.affected_pages).toBe(2);
  expect(
    await db
      .selectFrom('site_observed_architectures')
      .select('id')
      .where('crawl_id', '=', other.crawlId)
      .execute(),
  ).toHaveLength(0);
});
it('requires a persisted coverage snapshot and current-version metrics before creating a model', async () => {
  const seed = await fixtures.crawl();
  await fixtures.page(seed, '/', {});
  await derive(seed);
  expect(
    await db
      .selectFrom('site_observed_architectures')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute(),
  ).toHaveLength(0);
  await fixtures.snapshot(seed);
  await db
    .updateTable('site_page_link_metrics')
    .set({ formula_version: 'historical' })
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  await fixtures.task(seed, 'architecture');
  expect(await fixtures.worker(seed, { settings }).runOnce()).toBe(1);
  expect(
    await db
      .selectFrom('site_observed_architectures')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute(),
  ).toHaveLength(0);
  expect(policy.site_health.link_metrics.formula_version).not.toBe('historical');
});
