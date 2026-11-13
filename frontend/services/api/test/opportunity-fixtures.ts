/** Persisted evidence for Action, refresh and verification PostgreSQL tests.
 * Reuse native fixtures for ORM-only defaults; never run providers or a worker.
 */
import { randomUUID } from 'node:crypto';
import type { Insertable, RawBuilder } from 'kysely';
import { plannedPageKey } from '../src/opportunities/targets/registry.ts';
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
      // The finalized analysis names its evaluation, so the issue is current.
      is_current: true,
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
        workspace_id: seed.workspaceId,
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

/** One angle of a seeded content-angle run, with the citations its counts rest on. */
export type AngleSeed = {
  label: string;
  /** Reuse a lineage of an earlier run; a new lineage otherwise. */
  lineageId?: string;
  /** The matched owned page; none when absent. */
  siteUrlId?: string;
  ownedCited?: boolean;
  /** The angle's prompts; one id no prompt has when absent. */
  promptIds?: string[];
  /** One cited page per entry; each domain cited `citations` times. */
  members: { url: string; title: string; competitor?: boolean; citations?: number }[];
};

/**
 * A content-angle run as the `content_angle_refresh` task persists it, written
 * directly: the run, any new lineages, its angles, members and owned matches.
 * Returns the run id and each angle's lineage id, in angle order.
 */
export async function angleRun(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  options: {
    outcome?: 'succeeded' | 'failed';
    windowEnd?: Date;
    angles?: AngleSeed[];
    crawlId?: string | null;
  } = {},
) {
  const now = new Date();
  const runId = randomUUID();
  const windowEnd = options.windowEnd ?? now;
  const tenancy = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  await db
    .insertInto('content_angle_runs')
    .values({
      id: runId,
      ...tenancy,
      trigger_kind: 'audit',
      trigger_id: randomUUID(),
      market_country: 'US',
      market_language: 'en',
      window_start: new Date(windowEnd.getTime() - 30 * 86_400_000),
      window_end: windowEnd,
      audit_ids: [],
      crawl_id: options.crawlId ?? null,
      cluster_key: randomUUID(),
      match_key: randomUUID(),
      aggregate_key: randomUUID(),
      model_provider: 'openai_compatible',
      model: 'test',
      methodology_version: 'content-angles-1',
      formula_version: 'content-gaps-1',
      outcome: options.outcome ?? 'succeeded',
      outcome_reason: options.outcome === 'failed' ? 'model_error:fixture' : null,
      limitations: JSON.stringify([{ code: 'topicless_prompts', count: 1, total: 3 }]),
      usage: null,
      created_at: now,
    })
    .execute();
  const lineages: string[] = [];
  for (const angle of options.angles ?? []) {
    const lineageId = angle.lineageId ?? randomUUID();
    lineages.push(lineageId);
    if (!angle.lineageId)
      await db // NOSONAR -- Fixture rows insert in a fixed order.
        .insertInto('content_angle_lineages')
        .values({
          id: lineageId,
          ...tenancy,
          topic_id: null,
          // As the refresh creates a lineage: keyed by its first label.
          planned_page_key: plannedPageKey(angle.label),
          first_run_id: runId,
          created_at: now,
        })
        .execute();
    const angleId = randomUUID();
    const counts = angle.members.map((member) => member.citations ?? 2);
    await db // NOSONAR -- Fixture rows insert in a fixed order.
      .insertInto('content_angles')
      .values({
        id: angleId,
        ...tenancy,
        run_id: runId,
        lineage_id: lineageId,
        topic_id: null,
        label: angle.label,
        citation_count: counts.reduce((sum, count) => sum + count, 0),
        domain_count: new Set(angle.members.map((member) => new URL(member.url).hostname)).size,
        competitor_count: angle.members.filter((member) => member.competitor).length,
        prompt_ids: angle.promptIds ?? [randomUUID()],
        engines: ['chatgpt'],
        created_at: now,
      })
      .execute();
    await db // NOSONAR -- Fixture rows insert in a fixed order.
      .insertInto('content_angle_members')
      .values(
        angle.members.map((member, index) => ({
          id: randomUUID(),
          ...tenancy,
          angle_id: angleId,
          canonical_url: member.url,
          url_hash: randomUUID(),
          title: member.title,
          domain: new URL(member.url).hostname,
          classification: member.competitor ? 'competitor' : 'third_party',
          matched_competitor: member.competitor ? new URL(member.url).hostname : null,
          source_class: member.competitor ? 'competitor_owned' : 'editorial_third_party',
          citation_count: counts[index]!,
          citation_ids: Array.from({ length: counts[index]! }, () => randomUUID()),
          created_at: now,
        })),
      )
      .execute();
    await db // NOSONAR -- Fixture rows insert in a fixed order.
      .insertInto('content_angle_owned_matches')
      .values({
        id: randomUUID(),
        ...tenancy,
        angle_id: angleId,
        site_url_id: angle.siteUrlId ?? null,
        method: angle.siteUrlId ? 'model_pick' : 'none',
        owned_cited: angle.ownedCited ?? false,
        owned_citation_ids: angle.ownedCited ? [randomUUID()] : [],
        created_at: now,
      })
      .execute();
  }
  return { runId, lineages };
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
    // Before any output or declaration, the stored status is the one readers see.
    effective_status: values.status ?? 'open',
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
