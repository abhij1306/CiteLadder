/**
 * Issue-family Actions (A4) against real PostgreSQL: one Site Health defect
 * across many pages is one Action with its cohort; a declaration freezes the
 * whole cohort; the next comparable crawl decides the outcome page by page.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildManifest } from '../src/agent/context.ts';
import { policy } from '../src/config.ts';
import type { Database } from '../src/db/database.ts';
import { enqueueImplementationVerification } from '../src/opportunities/enqueue.ts';
import { getAction, listActions } from '../src/opportunities/actions.ts';
import { declareAction } from '../src/opportunities/declarations.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const RULE = 'web.mobile_viewport';
// More pages than one declaration may target on its own.
const PAGES = policy.opportunity.opportunities.IMPLEMENTATION_TARGETS_MAX + 6;
const HOUR = 3_600_000;
const seeds: SiteSeed[] = [];

type Page = { id: string; url: string };

/** One page's reading of the rule in `seed.crawlId`, fetched at `fetchedAt`. */
async function readPage(
  trx: Database,
  fixtures: SiteFixtures,
  seed: SiteSeed,
  path: string,
  options: { outcome: string; fetchedAt: Date; siteUrlId?: string },
) {
  const page = await fixtures.page(seed, path, { has_html: true }, options);
  const evaluationId = randomUUID();
  await trx
    .insertInto('site_rule_evaluations')
    .values({
      id: evaluationId,
      workspace_id: seed.workspaceId,
      analysis_id: page.analysisId,
      source_artifact_id: page.artifactId,
      rule_id: RULE,
      dimension: 'technical',
      category: 'mobile',
      severity: 'high',
      weight: 1,
      outcome: options.outcome,
      evidence: '{}',
      analyzer_version: 'v1',
      rule_version: 'v1',
      extractor_version: '',
      finding_class: 'defect',
      scope: 'page',
      display_applicability: true,
      score_applicability: false,
      reason_code: '',
      readiness_dimension: '',
      readiness_weight: 0,
      created_at: options.fetchedAt,
    })
    .execute();
  await trx
    .updateTable('site_page_analyses')
    .set({ source_evaluation_ids: [evaluationId], finalized_at: options.fetchedAt })
    .where('id', '=', page.analysisId)
    .execute();
  if (options.outcome === 'missing')
    await trx
      .insertInto('site_issues')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: page.id,
        analysis_id: page.analysisId,
        evaluation_id: evaluationId,
        source_artifact_id: page.artifactId,
        rule_id: RULE,
        dimension: 'technical',
        category: 'mobile',
        severity: 'high',
        finding_class: 'defect',
        evidence: '{}',
        description: '',
        remediation: 'Add a viewport meta tag.',
        analyzer_version: 'v1',
        rule_version: 'v1',
        // The finalized analysis names its evaluation, so the issue is current.
        is_current: true,
        created_at: options.fetchedAt,
      })
      .execute();
  return page;
}

const path = (index: number) => `/p${String(index).padStart(3, '0')}`;

/** A project whose crawl two hours ago found the viewport missing on `PAGES` pages. */
async function familyProject(): Promise<{ seed: SiteSeed; pages: Page[] }> {
  return db.transaction().execute(async (trx) => {
    const fixtures = new SiteFixtures(trx);
    const seed = await fixtures.crawl();
    seeds.push(seed);
    const crawled = new Date(Date.now() - 2 * HOUR);
    await trx
      .updateTable('site_crawls')
      .set({ completed_at: crawled })
      .where('id', '=', seed.crawlId)
      .execute();
    const pages: Page[] = [];
    for (let index = 0; index < PAGES; index += 1) {
      // NOSONAR -- One transaction: fixture statements run in order.
      const page = await readPage(trx, fixtures, seed, path(index), {
        outcome: 'missing',
        fetchedAt: crawled,
      });
      pages.push({ id: page.id, url: `https://example.test${path(index)}` });
    }
    return { seed, pages };
  });
}

/**
 * A later crawl of the same project: the first `failing` pages still miss the
 * viewport, the last `notApplicable` no longer have the rule apply, the rest
 * pass. `values` override the crawl's defaults.
 */
async function laterCrawl(
  seed: SiteSeed,
  pages: Page[],
  failing: number,
  {
    notApplicable = 0,
    ...values
  }: { rule_catalog_version?: string; status?: string; notApplicable?: number } = {},
) {
  const outcomeAt = (index: number) => {
    if (index < failing) return 'missing';
    return index >= pages.length - notApplicable ? 'not_applicable' : 'satisfied';
  };
  return db.transaction().execute(async (trx) => {
    const fixtures = new SiteFixtures(trx);
    const crawlId = await fixtures.sibling(seed, values);
    const later = { ...seed, crawlId };
    for (const [index, page] of pages.entries())
      // NOSONAR -- One transaction: fixture statements run in order.
      await readPage(trx, fixtures, later, path(index), {
        outcome: outcomeAt(index),
        fetchedAt: new Date(),
        siteUrlId: page.id,
      });
    await enqueueImplementationVerification(trx, {
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      triggerKind: 'site_crawl',
      triggerId: crawlId,
    });
    return crawlId;
  });
}

const scopeOf = (seed: SiteSeed) => ({ workspaceId: seed.workspaceId, projectId: seed.projectId });

async function familyAction(seed: SiteSeed) {
  await recomputeOpportunities(db, scopeOf(seed));
  const page = await listActions(db, scopeOf(seed), {
    status: null,
    target_kind: null,
    group: 'fix_site',
    limit: 50,
    cursor: null,
  });
  return page.items;
}

let own: { seed: SiteSeed; pages: Page[] };
let foreign: { seed: SiteSeed; pages: Page[] };
let fixedLater: { seed: SiteSeed; pages: Page[] };
let partialBeforeDeclaring: { seed: SiteSeed; pages: Page[] };
let sampled: { seed: SiteSeed; pages: Page[] };
let rerunFixed: { seed: SiteSeed; pages: Page[] };

beforeAll(async () => {
  // Six independent tenants, each seeded in its own transaction.
  [own, foreign, fixedLater, partialBeforeDeclaring, sampled, rerunFixed] = await Promise.all([
    familyProject(),
    familyProject(),
    familyProject(),
    familyProject(),
    familyProject(),
    familyProject(),
  ]);
});

/** Declares `project`'s family Action as implemented an hour ago. */
async function declareFamily(project: { seed: SiteSeed }) {
  const [action] = await familyAction(project.seed);
  const { row } = await declareAction(
    db,
    scopeOf(project.seed),
    action!.id,
    project.seed.userId,
    `family-${randomUUID()}`,
    {
      output_revision_id: null,
      declared_implemented_at: new Date(Date.now() - HOUR).toISOString(),
    },
  );
  return { action: action!, row };
}

afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    await db.deleteFrom('users').where('id', '=', seed.userId).execute();
  }
  await db.destroy();
});

describe('an issue family', () => {
  it('is one Action in Fix how AI reads your site, with its cohort and page count', async () => {
    const items = await familyAction(own.seed);
    expect(items.map((item) => [item.target_kind, item.target_label, item.page_count])).toEqual([
      ['issue_family', 'Mobile viewport missing', PAGES],
    ]);
    expect(items[0]).toMatchObject({
      group: 'fix_site',
      approach: 'fix_technical',
      member_count: 1,
      priority_band: 'high',
      handoff: {
        context: 'action',
        message: 'Write one fix that clears "Mobile viewport missing" on every affected page.',
      },
    });

    const detail = await getAction(db, own.seed.workspaceId, items[0]!.id);
    expect(detail.cohort).toMatchObject({
      rule_id: RULE,
      rule_label: 'Mobile viewport missing',
      crawl_id: own.seed.crawlId,
      page_count: PAGES,
    });
    expect(detail.cohort?.pages.map((page) => page.url)).toEqual(own.pages.map((page) => page.url));
    expect(detail.members.map((member) => [member.rule_id, member.title, member.severity])).toEqual(
      [['site_issue_family', 'Mobile viewport missing', 'high']],
    );
  });

  it('is never read from another workspace', async () => {
    const [ownAction] = await familyAction(own.seed);
    const [foreignAction] = await familyAction(foreign.seed);
    expect(foreignAction!.id).not.toBe(ownAction!.id);
    await expect(getAction(db, foreign.seed.workspaceId, ownAction!.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('gives the Agent the rule, the cohort and its count', async () => {
    const [action] = await familyAction(own.seed);
    const manifest = await buildManifest(
      db,
      { ...scopeOf(own.seed), userId: own.seed.userId },
      { refs: {}, request: '', actionId: action!.id, mentionIds: [] },
      // The evidence owners' package is not what this reads.
      () =>
        Promise.resolve({
          version: 'test',
          brand_block: '',
          target_page_block: '',
          issue_block: '',
          related_site_block: '',
          sections: {},
          summary: {},
        }),
    );
    expect(manifest.action?.issue_family).toEqual({
      rule_id: RULE,
      rule: 'Mobile viewport missing',
      crawl_id: own.seed.crawlId,
      page_count: PAGES,
      pages: own.pages
        .slice(0, policy.opportunity.opportunities.SITE_ISSUE_FAMILY.AGENT_PAGES_MAX)
        .map((page) => page.url),
      // No snippet was captured for this rule in this crawl's catalog.
      reference_snippet: null,
    });
  });

  it('declares the whole cohort, and the next comparable crawl names the pages still failing', async () => {
    const { action, row } = await declareFamily(own);
    expect([...(row.target_site_url_ids as string[])].sort()).toEqual(
      own.pages.map((page) => page.id).sort(),
    );
    expect(row.expected_checks).toEqual([
      {
        kind: 'issue_family',
        rule_id: RULE,
        baseline_crawl_id: own.seed.crawlId,
        site_url_ids: own.pages.map((page) => page.id),
        page_count: PAGES,
      },
    ]);

    // A crawl with another rule catalog cannot be compared: inconclusive.
    const other = await laterCrawl(own.seed, own.pages, 0, { rule_catalog_version: 'other' });
    await drainWorkspace(db, own.seed.workspaceId, { owner: `a4-${randomUUID()}` });
    let detail = await getAction(db, own.seed.workspaceId, action.id);
    expect(detail.declaration?.checks).toMatchObject([
      {
        kind: 'issue_family',
        state: 'unavailable',
        reason: 'non_comparable_crawl',
        source_id: other,
      },
    ]);

    // Two pages still fail in the next comparable crawl.
    const next = await laterCrawl(own.seed, own.pages, 2);
    await drainWorkspace(db, own.seed.workspaceId, { owner: `a4-${randomUUID()}` });
    detail = await getAction(db, own.seed.workspaceId, action.id);
    expect(detail.declaration?.state).toBe('contradicted');
    expect(detail.declaration?.checks).toMatchObject([
      {
        kind: 'issue_family',
        state: 'unmet',
        reason: 'partially_resolved',
        source_id: next,
        subject: 'Mobile viewport missing',
        pages: {
          failing: own.pages.slice(0, 2).map((page) => ({ site_url_id: page.id, url: page.url })),
          passing: PAGES - 2,
          not_applicable: 0,
          unread: 0,
        },
      },
    ]);
    // The Action still shows the cohort and crawl that were declared.
    expect(detail.cohort?.crawl_id).toBe(own.seed.crawlId);
    expect(detail.cohort?.page_count).toBe(PAGES);

    // The foreign project's declaration-free Action is untouched by this one's crawls.
    const [foreignAction] = await familyAction(foreign.seed);
    const foreignDetail = await getAction(db, foreign.seed.workspaceId, foreignAction!.id);
    expect(foreignDetail.declaration).toBeNull();
  });

  it('reads still failing until every page passes or no longer applies, then verified', async () => {
    const { seed, pages } = fixedLater;
    const { action } = await declareFamily(fixedLater);

    // Every page still fails: each one is named.
    await laterCrawl(seed, pages, PAGES);
    await drainWorkspace(db, seed.workspaceId, { owner: `a4-${randomUUID()}` });
    let detail = await getAction(db, seed.workspaceId, action.id);
    expect(detail.declaration?.checks).toMatchObject([
      {
        state: 'unmet',
        reason: 'still_failing',
        pages: { passing: 0, not_applicable: 0, unread: 0 },
      },
    ]);
    expect(detail.declaration?.checks[0]?.pages?.failing).toHaveLength(PAGES);

    // Every page passes, or no longer has the rule apply (counted apart): verified.
    const fixed = await laterCrawl(seed, pages, 0, { notApplicable: 1 });
    await drainWorkspace(db, seed.workspaceId, { owner: `a4-${randomUUID()}` });
    detail = await getAction(db, seed.workspaceId, action.id);
    expect(detail.declaration?.state).toBe('verified');
    expect(detail.declaration?.checks).toMatchObject([
      {
        state: 'met',
        reason: null,
        source_id: fixed,
        pages: { failing: [], passing: PAGES - 1, not_applicable: 1, unread: 0, uncovered: 0 },
      },
    ]);
  });

  it('larger than its cohort, counts the pages beyond it and never reads verified', async () => {
    const { seed, pages } = sampled;
    // The family's last two pages fall beyond a cohort cut at the rest.
    const family = policy.opportunity.opportunities.SITE_ISSUE_FAMILY;
    const cohortMax = family.COHORT_PAGES_MAX;
    family.COHORT_PAGES_MAX = PAGES - 2;
    const declared = await declareFamily(sampled).finally(() => {
      family.COHORT_PAGES_MAX = cohortMax;
    });
    expect(declared.row.expected_checks).toMatchObject([
      { kind: 'issue_family', site_url_ids: pages.slice(0, -2).map((page) => page.id) },
    ]);

    // Every page passes, but two were never in the cohort: not verified.
    const fixed = await laterCrawl(seed, pages, 0);
    await drainWorkspace(db, seed.workspaceId, { owner: `a3-${randomUUID()}` });
    const detail = await getAction(db, seed.workspaceId, declared.action.id);
    expect(detail.declaration?.state).not.toBe('verified');
    expect(detail.declaration?.checks).toMatchObject([
      {
        state: 'unavailable',
        reason: 'cohort_sampled',
        source_id: fixed,
        pages: { failing: [], passing: PAGES - 2, not_applicable: 0, unread: 0, uncovered: 2 },
      },
    ]);
  });

  it('is verified when a page rerun clears the last failing tracked page of the crawl it lands in', async () => {
    const { seed, pages } = rerunFixed;
    await new SiteFixtures(db).monitor(
      seed,
      pages.map((page) => page.id),
    );
    const { action } = await declareFamily(rerunFixed);
    const next = await laterCrawl(seed, pages, 1);
    await drainWorkspace(db, seed.workspaceId, { owner: `b3-${randomUUID()}` });
    let detail = await getAction(db, seed.workspaceId, action.id);
    expect(detail.declaration?.checks).toMatchObject([
      { state: 'unmet', reason: 'partially_resolved', source_id: next },
    ]);

    // The rerun reads one page; its reading takes every tracked page's latest audit.
    const rerun = await db.transaction().execute(async (trx) => {
      const fixtures = new SiteFixtures(trx);
      const crawlId = await fixtures.sibling(seed, {
        configuration: JSON.stringify({ page_rerun: true }),
      });
      await readPage(trx, fixtures, { ...seed, crawlId }, path(0), {
        outcome: 'satisfied',
        fetchedAt: new Date(),
        siteUrlId: pages[0]!.id,
      });
      await enqueueImplementationVerification(trx, {
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        triggerKind: 'site_crawl',
        triggerId: crawlId,
      });
      return crawlId;
    });
    await drainWorkspace(db, seed.workspaceId, { owner: `b3-${randomUUID()}` });
    detail = await getAction(db, seed.workspaceId, action.id);
    expect(detail.declaration?.state).toBe('verified');
    expect(detail.declaration?.checks).toMatchObject([
      {
        state: 'met',
        source_id: rerun,
        pages: { failing: [], passing: PAGES, not_applicable: 0, unread: 0, uncovered: 0 },
      },
    ]);
  });

  it('is read now against a partial site crawl that finished after a backdated go-live, never a later rerun', async () => {
    const { seed, pages } = partialBeforeDeclaring;
    // A partial crawl still failing every page finished after the go-live
    // declared below; a one-page rerun after it is newer, but only its own
    // page's evidence.
    const partial = await laterCrawl(seed, pages, PAGES, { status: 'partially_completed' });
    await new SiteFixtures(db).sibling(seed, {
      configuration: JSON.stringify({ page_rerun: true }),
      created_at: new Date(Date.now() + 60_000),
      completed_at: new Date(Date.now() + 60_000),
    });

    const { action } = await declareFamily(partialBeforeDeclaring);
    await drainWorkspace(db, seed.workspaceId, { owner: `a1-${randomUUID()}` });
    const detail = await getAction(db, seed.workspaceId, action.id);
    expect(detail.declaration?.checks).toMatchObject([
      { state: 'unmet', reason: 'still_failing', source_id: partial },
    ]);
  });
});
