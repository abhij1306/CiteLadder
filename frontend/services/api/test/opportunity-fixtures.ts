/** Persisted evidence for Action, refresh and verification PostgreSQL tests.
 * Reuse native fixtures for ORM-only defaults; never run providers or a worker.
 */
import { randomUUID } from 'node:crypto';
import type { Insertable, RawBuilder } from 'kysely';
import type { Database } from '../src/db/database.ts';
import type { Actions, Opportunities, OpportunitySnapshots } from '../src/generated/db-schema.ts';
import { extractPageFacts, factSettings } from '../src/site-health/analysis/facts.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';

export type OpportunitySeed = {
  user_id: string;
  workspace_id: string;
  project_id: string;
  prompt0_id: string;
  prompt1_id: string;
  audit_id: string;
  analysis0_id: string;
  analysis1_id: string;
  metric_snapshot_id: string;
  crawl_id: string;
  issue_structured_id: string;
  issue_content_id: string;
};

type SiteEvidence = {
  facts: Record<string, unknown>;
  fetchedAt: Date | RawBuilder<Date>;
};

async function issue(
  db: Database,
  fixtures: SiteFixtures,
  seed: SiteSeed,
  path: string,
  rule: string,
  severity: string,
  options: { content: boolean; evidence?: SiteEvidence },
) {
  const names = ['Garden soil guide', 'Soil testing kit', 'Compost for healthy soil'];
  const name = names[['/a', '/b', '/c'].indexOf(path)]!;
  const url = new URL(path, seed.root).href;
  const facts = options.content
    ? extractPageFacts(
        Buffer.from(
          `<html><title>${name} | Acme</title><main><h1>${name}</h1><p>Follow the garden soil guide and use a soil testing kit to understand nutrient levels before planting.</p><p>Add compost for healthy soil to improve moisture retention and support a thriving garden.</p></main></html>`,
        ),
        { finalUrl: url, contentType: 'text/html', statusCode: 200 },
        factSettings({}),
      )
    : { has_html: true };
  const page = await fixtures.page(seed, path, options.evidence?.facts ?? facts, {
    fetchedAt: options.evidence?.fetchedAt,
  });
  const now = new Date();
  const evaluationId = randomUUID();
  const issueId = randomUUID();
  await db
    .insertInto('site_rule_evaluations')
    .values({
      id: evaluationId,
      workspace_id: seed.workspaceId,
      analysis_id: page.analysisId,
      source_artifact_id: page.artifactId,
      rule_id: rule,
      dimension: 'aeo',
      category: 'content',
      severity,
      weight: 1,
      outcome: 'missing',
      evidence: JSON.stringify({ observed: 'missing' }),
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
      created_at: now,
    })
    .execute();
  await db
    .updateTable('site_page_analyses')
    .set({
      analyzer_version: 'v1',
      scoring_version: 'v1',
      page_kind: 'other',
      source_evaluation_ids: [evaluationId],
      source_artifact_ids: [page.artifactId],
      finalized_at: now,
      ...(options.content ? { main_content_indexable: true } : {}),
    })
    .where('id', '=', page.analysisId)
    .execute();
  await db
    .insertInto('site_issues')
    .values({
      id: issueId,
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      crawl_id: seed.crawlId,
      site_url_id: page.id,
      analysis_id: page.analysisId,
      evaluation_id: evaluationId,
      source_artifact_id: page.artifactId,
      rule_id: rule,
      dimension: 'aeo',
      category: 'content',
      severity,
      finding_class: 'defect',
      evidence: JSON.stringify({ observed: 'missing' }),
      description: '',
      remediation: 'Fix it.',
      analyzer_version: 'v1',
      rule_version: 'v1',
      created_at: now,
    })
    .execute();
  return issueId;
}

export function seedOpportunityScenario(
  db: Database,
  content = false,
  siteEvidence?: SiteEvidence,
): Promise<OpportunitySeed> {
  return db.transaction().execute(async (trx) => {
    const fixtures = new SiteFixtures(trx);
    const created = await fixtures.crawl();
    const seed = { ...created, root: 'https://acme.test/' };
    await trx
      .updateTable('projects')
      .set({
        name: 'Acme Visibility',
        website_url: seed.root,
        country_code: 'AU',
        language_code: 'en-AU',
        benchmark_mode: 'consumer_like',
      })
      .where('id', '=', seed.projectId)
      .execute();
    await trx
      .updateTable('site_health_profiles')
      .set({
        root_url: seed.root,
        root_host: 'acme.test',
        registrable_domain: 'acme.test',
      })
      .where('id', '=', seed.profileId)
      .execute();
    await trx
      .updateTable('site_crawls')
      .set({ root_url: seed.root })
      .where('id', '=', seed.crawlId)
      .execute();
    await trx
      .insertInto('owned_domains')
      .values({
        id: randomUUID(),
        project_id: seed.projectId,
        domain: 'acme.com',
        created_at: new Date(),
      })
      .execute();
    const setId = await promptSet(trx, seed.projectId);
    const texts = ['best crm for small teams', 'what is a crm'];
    const promptIds: string[] = [];
    const analysisIds: string[] = [];
    const auditId = await fixtures.audit(seed);
    await trx
      .updateTable('audits')
      .set({ requested_count: 2, completed_count: 2 })
      .where('id', '=', auditId)
      .execute();
    for (const [index, text] of texts.entries()) {
      const intent = index === 0 ? 'purchase' : 'discovery';
      const promptId = await prompt(trx, setId, text);
      promptIds.push(promptId);
      await trx
        .updateTable('prompts')
        .set({ theme: 'crm', intent })
        .where('id', '=', promptId)
        .execute();
      const execution = await fixtures.execution(seed, {
        auditId,
        promptIndex: index,
        promptText: text,
        theme: 'crm',
        engine: 'gemini',
        transportModel: 'gemini-flash-latest',
        transportProvider: 'google',
        answerText: 'fixture answer',
        analysis: {
          competitorMentions: index === 0 ? ['Globex'] : [],
          citations:
            index === 0
              ? [{ url: 'https://globex.com/crm', title: 'Globex CRM', matched: 'Globex' }]
              : [{ url: 'https://acme.com/guide', title: 'Acme guide', isOwned: true }],
        },
      });
      analysisIds.push(execution.analysisId!);
      await trx
        .updateTable('audit_prompt_snapshots')
        .set({ prompt_id: promptId, intent })
        .where('audit_id', '=', auditId)
        .where('prompt_index', '=', index)
        .execute();
      await trx
        .updateTable('response_analyses')
        .set({
          analyzer_version: 'b6-analysis-1',
          scoring_rule_version: 'scoring-v1',
        })
        .where('id', '=', execution.analysisId!)
        .execute();
      await trx
        .updateTable('citations')
        .set({
          analyzer_version: 'b6-analysis-1',
          classification: index === 0 ? 'competitor' : 'owned',
          ordinal: index === 0 ? 1 : 0,
        })
        .where('analysis_id', '=', execution.analysisId!)
        .execute();
      await trx
        .updateTable('competitor_mentions')
        .set({ analyzer_version: 'b6-analysis-1' })
        .where('analysis_id', '=', execution.analysisId!)
        .execute();
    }
    const metricId = await fixtures.metricSnapshot(seed, auditId, {
      metrics: {},
      visibilityScore: 50,
      analyzerVersion: 'b6-analysis-1',
      scoringRuleVersion: 'scoring-v1',
    });
    await trx
      .updateTable('metric_snapshots')
      .set({ total_completed: 2, source_analysis_ids: JSON.stringify(analysisIds) })
      .where('id', '=', metricId)
      .execute();
    const structuredId = await issue(
      trx,
      fixtures,
      seed,
      '/a',
      'aeo.structured_data_present',
      'medium',
      { content, evidence: siteEvidence },
    );
    const contentId = await issue(trx, fixtures, seed, '/b', 'aeo.answer_first', 'low', {
      content,
    });
    await issue(trx, fixtures, seed, '/c', 'technical.title_missing', 'high', { content });
    return {
      user_id: seed.userId,
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      prompt0_id: promptIds[0]!,
      prompt1_id: promptIds[1]!,
      audit_id: auditId,
      analysis0_id: analysisIds[0]!,
      analysis1_id: analysisIds[1]!,
      metric_snapshot_id: metricId,
      crawl_id: seed.crawlId,
      issue_structured_id: structuredId,
      issue_content_id: contentId,
    };
  });
}

export function snapshotRow(
  scope: { workspace_id: string; project_id: string },
  values: Partial<Insertable<OpportunitySnapshots>> = {},
): Insertable<OpportunitySnapshots> {
  return {
    ...scope,
    id: randomUUID(),
    run_id: randomUUID(),
    total_count: 0,
    analyzer_version: '',
    rule_version: '',
    formula_version: '',
    limitations: '[]',
    created_at: new Date(),
    ...values,
  };
}

export function opportunityRow(
  scope: { workspace_id: string; project_id: string },
  values: Pick<
    Insertable<Opportunities>,
    'rule_id' | 'opportunity_type' | 'severity' | 'target_key'
  > &
    Partial<Insertable<Opportunities>>,
): Insertable<Opportunities> {
  return {
    ...scope,
    id: randomUUID(),
    priority_score: 0,
    title: '',
    remediation: '',
    analyzer_version: '',
    rule_version: '',
    formula_version: '',
    created_at: new Date(),
    updated_at: new Date(),
    ...values,
  };
}

export function actionRow(
  scope: { workspace_id: string; project_id: string },
  values: Pick<Insertable<Actions>, 'group_key' | 'target_kind' | 'target_label'> &
    Partial<Insertable<Actions>>,
): Insertable<Actions> {
  return {
    ...scope,
    id: randomUUID(),
    origin: 'evidence',
    status: 'open',
    families: '[]',
    approach: '',
    skill_id: '',
    diagnosis: '{}',
    member_opportunity_ids: '[]',
    created_at: new Date(),
    updated_at: new Date(),
    ...values,
  };
}
