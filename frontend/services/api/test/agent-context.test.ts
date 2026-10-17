import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { readAgentContext } from '../src/agent/context-adapter.ts';
import { selectContentFragments } from '../src/site-health/reads/content-fragments.ts';
import { policy } from '../src/config.ts';
import { issueGroupId } from '../src/site-health/reads/rules.ts';

describe('Agent persisted context binding', () => {
  const db = testDatabase(),
    fixtures = new SiteFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  it('resolves full issue counts with a labeled sample and exact page scope', async () => {
    const seed = await fixtures.crawl();
    const rule = policy.site_health.rule_catalog.find(
      (item) => item.rule_id === 'technical.title_present',
    )!;
    let firstPage = '';
    for (let index = 0; index < 119; index++) {
      const page = await fixtures.page(seed, `/issue-${index}`, { title: '' });
      firstPage ||= page.id;
      const evaluationId = await fixtures.evaluation(seed, page, rule.rule_id, 'missing');
      await db
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
          rule_id: rule.rule_id,
          rule_version: rule.rule_version,
          dimension: rule.dimension,
          category: rule.category,
          severity: rule.severity,
          finding_class: rule.finding_class,
          description: rule.description,
          remediation: rule.remediation,
          analyzer_version: policy.site_health.versions.analyzer,
          created_at: new Date(),
        })
        .execute();
    }
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: new Date() })
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    const ref = {
      crawl_id: seed.crawlId,
      group_id: issueGroupId(seed.crawlId, rule.rule_id, rule.finding_class),
    };
    const aggregate = await readAgentContext(
      db,
      seed,
      { issue_group_reference: ref },
      'Analyze and plan',
    );
    expect(aggregate.sections?.issue_group).toMatchObject({
      affected_url_count: 119,
      sample: { total_occurrences: 119, supplied_occurrences: 10, complete: false },
      remediation: rule.remediation,
    });
    const page = await readAgentContext(
      db,
      seed,
      { issue_group_reference: { ...ref, site_url_id: firstPage } },
      'Analyze this page',
    );
    expect(page.sections?.issue_group).toMatchObject({
      selected_site_url_id: firstPage,
      occurrences: [{ site_url_id: firstPage }],
    });
    const newerCrawl = await fixtures.sibling(seed);
    await expect(
      readAgentContext(
        db,
        seed,
        {
          issue_group_reference: ref,
          site_facts_reference: { crawl_id: newerCrawl },
        },
        'Analyze',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_conflict' });
    const matching = await readAgentContext(
      db,
      seed,
      {
        issue_group_reference: ref,
        site_facts_reference: { crawl_id: seed.crawlId },
      },
      'Analyze',
    );
    expect(matching.summary.crawl_id).toBe(seed.crawlId);
    const siblingProject = await fixtures.project(seed.workspaceId);
    await expect(
      readAgentContext(
        db,
        { ...seed, projectId: siblingProject },
        { issue_group_reference: ref },
        'Analyze',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
    await expect(
      readAgentContext(
        db,
        seed,
        { issue_group_reference: { ...ref, site_url_id: randomUUID() } },
        'Analyze',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  }, 60000);
  it('retains a selected crawl when a newer crawl arrives, including unavailable robots evidence', async () => {
    const seed = await fixtures.crawl();
    await fixtures.sibling(seed, { created_at: new Date(Date.now() + 1000) });
    const context = await readAgentContext(
      db,
      seed,
      { site_facts_reference: { crawl_id: seed.crawlId } },
      'Explain robots',
    );
    expect(context.sections?.site_facts).toMatchObject({
      crawl_id: seed.crawlId,
      state: 'unavailable',
      reason: 'robots_not_observed',
    });
    expect(context.summary.crawl_id).toBe(seed.crawlId);
    const sibling = await fixtures.project(seed.workspaceId);
    await expect(
      readAgentContext(
        db,
        { ...seed, projectId: sibling },
        { site_facts_reference: { crawl_id: seed.crawlId } },
        'Explain',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  });
  it('falls back past factless terminal crawls and ranks an explicit target before lexical matches and brand background', async () => {
    const seed = await fixtures.crawl();
    const home = await fixtures.page(seed, '/', {
      title: 'Home',
      body: { text: 'Brand background' },
    });
    const relevant = await fixtures.page(seed, '/pricing', {
      title: 'Pricing guide',
      body: { text: 'Costs pricing plans' },
    });
    const target = await fixtures.page(seed, '/product', {
      title: 'Product\u0001 title',
      headings: { h1_texts: ['Product heading'] },
      body: { text: 'Current\nproduct content' },
    });
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: new Date() })
      .where('workspace_id', '=', seed.workspaceId)
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    const emptyId = await fixtures.sibling(seed, { created_at: new Date(Date.now() + 1000) });
    await fixtures.page({ ...seed, crawlId: emptyId }, '/empty', {});
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: new Date() })
      .where('workspace_id', '=', seed.workspaceId)
      .where('crawl_id', '=', emptyId)
      .execute();
    const selection = await selectContentFragments(
      db,
      seed,
      'pricing guide',
      'http://example.test/product/',
    );
    expect(selection.pages.map((page) => page.site_url_id)).toEqual([
      target.id,
      relevant.id,
      home.id,
    ]);
    expect(selection.pages[0]).toMatchObject({
      title: 'Product title',
      body_text: 'Current product content',
    });
    expect(selection.summary).toMatchObject({
      crawl_id: seed.crawlId,
      provenance: [
        { artifact_id: target.artifactId, analysis_id: target.analysisId },
        { artifact_id: relevant.artifactId },
        {},
      ],
    });
    const context = await readAgentContext(
      db,
      { ...seed, userId: seed.userId },
      { target_site_url_id: target.id },
      'pricing guide',
    );
    expect(context.sections?.target_page).toMatchObject({ body_text: 'Current product content' });
    expect(context.summary).toMatchObject({
      target_url: 'https://example.test/product',
      crawl_page_count: 3,
      related_page_count: 2,
    });
  });
  it('refuses explicit origins from a sibling project and records absent crawl evidence', async () => {
    const seed = await fixtures.crawl(),
      foreign = await fixtures.crawl();
    const page = await fixtures.page(foreign, '/foreign', { title: 'Private page' });
    const scope = { ...seed, userId: seed.userId };
    const origins: Record<string, string>[] = [
      { target_site_url_id: page.id },
      { opportunity_id: randomUUID() },
      { demand_signal_id: randomUUID() },
    ];
    for (const refs of origins)
      await expect(readAgentContext(db, scope, refs, 'Write')).rejects.toMatchObject({
        code: 'agent_context_unavailable',
      });
    const context = await readAgentContext(db, scope, {}, 'Write');
    expect(context.summary).toMatchObject({
      omissions: [{ reason: 'no_usable_crawl' }],
      crawl_page_count: 0,
    });
    expect(context.related_site_block).toBe('');
  });
  it('keeps the same highest-ranked pages when the background crawl exceeds its candidate cap', async () => {
    const seed = await fixtures.crawl();
    for (let index = 0; index < policy.agent_context.content_context_max_pages; index++) {
      await fixtures.page(seed, `/pricing-${index}`, {
        title: 'Pricing plans',
        body: { text: 'Costs and plans' },
      });
    }
    const finalize = () =>
      db
        .updateTable('site_page_analyses')
        .set({ finalized_at: new Date() })
        .where('crawl_id', '=', seed.crawlId)
        .execute();
    await finalize();
    const before = await selectContentFragments(db, seed, 'pricing plans');
    for (
      let index = 0;
      index <= policy.agent_context.content_context_background_max_pages;
      index++
    ) {
      await fixtures.page(seed, `/background-${index}`, {
        title: 'Other content',
        body: { text: 'Background' },
      });
    }
    await finalize();
    const after = await selectContentFragments(db, seed, 'pricing plans');
    expect(after.pages).toEqual(before.pages);
    expect(after.summary.omissions).toContainEqual({
      reason: 'background_candidate_limit',
      count: 11,
    });
  });
  it('resolves an exact readiness gap to finalized evidence and refuses a conflicting target', async () => {
    const seed = await fixtures.crawl();
    const page = await fixtures.page(seed, '/product', { title: 'Product' }),
      other = await fixtures.page(seed, '/other', { title: 'Other' });
    const evaluationId = await fixtures.evaluation(
      seed,
      page,
      'technical.title_present',
      'missing',
    );
    await db
      .updateTable('site_rule_evaluations')
      .set({ evidence: JSON.stringify({ title: '', meta_description: 'Captured fallback' }) })
      .where('id', '=', evaluationId)
      .execute();
    await db
      .updateTable('site_page_analyses')
      .set({ finalized_at: new Date(), source_artifact_ids: [page.artifactId] })
      .where('workspace_id', '=', seed.workspaceId)
      .where('id', '=', page.analysisId)
      .execute();
    const ref = {
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      site_url_id: page.id,
      source_analysis_id: page.analysisId,
      dimension: 'metadata',
      checkpoint_ids: ['technical.title_present'],
    };
    const context = await readAgentContext(db, seed, { site_health_reference: ref }, 'Fix title');
    const otherCrawl = await fixtures.sibling(seed);
    await expect(
      readAgentContext(
        db,
        seed,
        {
          site_health_reference: ref,
          site_facts_reference: { crawl_id: otherCrawl },
        },
        'Fix title',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_conflict' });
    expect(context.sections?.site_health).toMatchObject({
      source_analysis_id: page.analysisId,
      source_evaluation_ids: [evaluationId],
      source_artifact_ids: [page.artifactId],
      target_fields: ['title'],
      suggested_skill_id: 'content_page',
      captured_values: ['Captured fallback'],
    });
    await expect(
      readAgentContext(
        db,
        seed,
        { site_health_reference: ref, target_site_url_id: other.id },
        'Fix title',
      ),
    ).rejects.toMatchObject({ code: 'agent_context_conflict' });
    const foreign = await fixtures.crawl();
    await expect(
      readAgentContext(db, foreign, { site_health_reference: ref }, 'Fix title'),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  });
});
