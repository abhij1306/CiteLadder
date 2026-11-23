import { randomUUID } from 'node:crypto';

import { policy } from '../src/config.ts';
import type { Database } from '../src/db/database.ts';
import { refreshIssueCurrency } from '../src/site-health/issue-currency.ts';
import { loadCrawl } from '../src/site-health/reads/crawl.ts';
import type { SiteFixtures, SiteSeed } from './site-health-fixtures.ts';

export type Page = Awaited<ReturnType<SiteFixtures['page']>>;

export function readFixtures(db: Database, fixtures: SiteFixtures) {
  async function observe(seed: SiteSeed, siteUrlId: string, crawlId = seed.crawlId) {
    await db
      .insertInto('site_url_observations')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: crawlId,
        site_url_id: siteUrlId,
        observed_url: seed.root,
        final_url: seed.root,
        depth: 0,
        source_kind: 'link',
        content_type: 'text/html',
        rewrite_reason: '',
        rewrite_version: 'fixture',
        title: '',
        value_kind: 'page',
        value_priority: 0,
        created_at: new Date(),
      })
      .execute();
  }

  async function page(
    seed: SiteSeed,
    path: string,
    { facts = {}, ...options }: { current?: boolean; facts?: Record<string, unknown> } = {},
  ) {
    const row = await fixtures.page(seed, path, facts, options);
    await observe(seed, row.id);
    await db
      .updateTable('site_page_analyses')
      .set({
        finalized_at: new Date(),
        source_evaluation_ids: [],
        web_fundamentals_state: 'measured',
        aeo_measurement_state: 'not_measured',
      })
      .where('id', '=', row.analysisId)
      .execute();
    return row;
  }

  async function issue(
    seed: SiteSeed,
    target: Page,
    ruleId: string,
    evidence: object = {},
    publish = true,
  ) {
    const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === ruleId)!;
    const [analysis] = await db
      .selectFrom('site_page_analyses')
      .select('source_evaluation_ids')
      .where('id', '=', target.analysisId)
      .execute();
    const evaluationId = await fixtures.evaluation(seed, target, ruleId, 'missing');
    await db
      .updateTable('site_page_analyses')
      .set({ source_evaluation_ids: [...(analysis?.source_evaluation_ids ?? []), evaluationId] })
      .where('id', '=', target.analysisId)
      .execute();
    await db
      .insertInto('site_issues')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: target.id,
        analysis_id: target.analysisId,
        evaluation_id: evaluationId,
        source_artifact_id: target.artifactId,
        rule_id: ruleId,
        rule_version: rule.rule_version,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        description: rule.description,
        remediation: rule.remediation,
        evidence: JSON.stringify(evidence),
        analyzer_version: policy.site_health.versions.analyzer,
        created_at: new Date(),
      })
      .execute();
    if (publish)
      await refreshIssueCurrency(db, await loadCrawl(db, seed.workspaceId, seed.crawlId));
    return evaluationId;
  }

  return { observe, page, issue };
}
