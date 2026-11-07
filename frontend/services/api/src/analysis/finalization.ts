import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits, AuditTasks } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { record, numberRecord } from '../db/json.ts';
import { promptTextHash } from '../prompts/normalization.ts';
import { scoringConfig } from './scoring.ts';
import { aggregateRun, promptTrend, type Aggregate, type AggregateExecution } from './aggregate.ts';
import { frozenComparisonKey } from './comparison.ts';
import { persistObservedCompetitors } from './observed-competitors.ts';
import { round } from '../numbers.ts';
import { compareText } from '../text-order.ts';
import { persistSourceAggregates } from '../visibility/source-aggregates.ts';

/** A run task with its prompt snapshot's cohort. */
export type ScopedTask = Selectable<AuditTasks> & { cohort: string };
/** Derives one successful answer inside the caller's transaction. */
type DeriveAnswer = (
  db: Database,
  task: ScopedTask,
  audit: Selectable<Audits>,
  artifactId: string,
) => Promise<void>;
function coverage(tasks: ScopedTask[], completed: number) {
  const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
  return {
    requested: tasks.length,
    completed,
    failed: tasks.filter((t) => t.status === 'failed').length,
    not_run: tasks.filter((t) => !['succeeded', 'failed'].includes(t.status)).length,
    unavailable: Math.max(0, succeeded - completed),
    rate: tasks.length ? completed / tasks.length : null,
  };
}
function cohortMetrics(
  rows: AggregateExecution[],
  tasks: ScopedTask[],
  config: ReturnType<typeof scoringConfig>,
  cohorts: readonly string[],
  name: string,
  engines: string[],
) {
  const eligible = rows.filter((r) => cohorts.includes(r.cohort)),
    eligibleTasks = tasks.filter((t) => cohorts.includes(t.cohort));
  const aggregate = aggregateRun(eligible, config);
  return {
    ...aggregate,
    cohort: name,
    coverage: coverage(eligibleTasks, aggregate.total_completed),
    per_engine: Object.fromEntries(
      engines.map((engine) => {
        const value = aggregateRun(
          eligible.filter((r) => r.logical_engine === engine),
          config,
        );
        return [
          engine,
          {
            ...value,
            coverage: coverage(
              eligibleTasks.filter((t) => t.logical_engine === engine),
              value.total_completed,
            ),
          },
        ];
      }),
    ),
  };
}

type OwnedPage = { url_hash: string; canonical_url: string | null; citation_ids: string[] };
/**
 * The run's owned citations per cited page, for the AI Traffic Pages and URL
 * reads: each identified page's exact citation IDs in the run's citation order. A citation
 * without a page identity has no page to count against.
 */
function ownedPages(
  citations: {
    id: string;
    is_owned: boolean;
    url_hash: string | null;
    canonical_url: string | null;
  }[],
): OwnedPage[] {
  const pages = new Map<string, OwnedPage>();
  for (const c of citations) {
    if (!c.is_owned || !c.url_hash) continue;
    const page = pages.get(c.url_hash) ?? {
      url_hash: c.url_hash,
      canonical_url: null,
      citation_ids: [],
    };
    // The lowest canonical URL, so the fact is independent of answer order.
    if (
      c.canonical_url &&
      (page.canonical_url === null || compareText(c.canonical_url, page.canonical_url) < 0)
    )
      page.canonical_url = c.canonical_url;
    page.citation_ids.push(c.id);
    pages.set(c.url_hash, page);
  }
  return [...pages.values()].sort((a, b) => compareText(a.url_hash, b.url_hash));
}
function artifactsByTask<T extends { task_id: string }>(artifacts: T[]) {
  const byTask = new Map<string, T>();
  for (const artifact of artifacts) {
    if (byTask.has(artifact.task_id)) throw new Error('Multiple immutable artifacts for one task');
    byTask.set(artifact.task_id, artifact);
  }
  return byTask;
}

/**
 * Derives a settled run inside the caller's audit lock: every successful answer, then the
 * run's metric snapshot with its prompt, source and observed-competitor facts. Writes only
 * derived rows; the audit's state transitions and downstream work belong to the caller.
 */
export async function deriveRunMetrics(
  trx: Database,
  audit: Selectable<Audits>,
  tasks: ScopedTask[],
  derive: DeriveAnswer,
  at: Date,
) {
  const workspaceId = audit.workspace_id,
    auditId = audit.id;
  for (const task of tasks.filter((t) => t.status === 'succeeded')) {
    if (!task.result_artifact_id) throw new Error('Successful task has no immutable artifact');
    await derive(trx, task, audit, task.result_artifact_id); // NOSONAR -- One transaction: derivations run in order.
  }
  const analyses = await trx
    .selectFrom('response_analyses')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .orderBy('prompt_index')
    .orderBy('logical_engine')
    .orderBy('repetition')
    .execute();
  const artifacts = await trx
    .selectFrom('raw_response_artifacts as r')
    .innerJoin('audits as a', 'a.id', 'r.audit_id')
    .selectAll('r')
    .where('a.workspace_id', '=', workspaceId)
    .where('r.audit_id', '=', auditId)
    .execute();
  const byTask = artifactsByTask(artifacts);
  const snapshots = await trx
    .selectFrom('audit_prompt_snapshots')
    .selectAll()
    .where('audit_id', '=', auditId)
    .orderBy('prompt_index')
    .execute();
  const promptByIndex = new Map(snapshots.map((p) => [p.prompt_index, p]));
  const citations = await trx
    .selectFrom('citations')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .orderBy('ordinal')
    .execute();
  const rows: AggregateExecution[] = analyses.map((a) => {
    const prompt = promptByIndex.get(a.prompt_index),
      artifact = byTask.get(a.task_id);
    if (!prompt || artifact?.id !== a.artifact_id)
      throw new Error('Analysis source provenance mismatch');
    return {
      prompt_index: a.prompt_index,
      prompt_text_snapshot: prompt.text,
      prompt_theme_snapshot: prompt.theme,
      cohort: prompt.cohort,
      logical_engine: a.logical_engine,
      score: record(a.score),
      usage: record(artifact.usage),
      citations: citations
        .filter((c) => c.analysis_id === a.id)
        .map((c) => ({
          url: c.url,
          domain: c.domain,
          is_owned: c.is_owned,
          is_unintended: c.is_unintended,
          matched_competitor: c.matched_competitor,
        })),
    };
  });
  const config = scoringConfig(audit.configuration),
    engines = [...new Set(tasks.map((t) => t.logical_engine))].sort(compareText);
  const organic = cohortMetrics(
    rows,
    tasks,
    config,
    policy.visibility.organic_cohorts,
    'market_visibility',
    engines,
  );
  const comparison = cohortMetrics(rows, tasks, config, ['comparison'], 'comparison', engines);
  const diagnostic: Aggregate & { cohort: string; coverage: ReturnType<typeof coverage> } = {
    ...aggregateRun(
      rows.filter((r) => r.cohort === 'brand_diagnostic'),
      config,
    ),
    cohort: 'brand_diagnostic',
    coverage: coverage(
      tasks.filter((t) => t.cohort === 'brand_diagnostic'),
      rows.filter((r) => r.cohort === 'brand_diagnostic').length,
    ),
  };
  // Unbranded and branded prompts together: its own block, never a blend of
  // the other two, so its rates are counted over the answers they share.
  const all = cohortMetrics(
    rows,
    tasks,
    config,
    policy.visibility.all_cohorts,
    policy.visibility.all_cohort,
    engines,
  );
  const metrics = { ...organic, comparison, brand_diagnostic: diagnostic, all };
  const visibility = organic.per_prompt.length
    ? round(
        organic.per_prompt.reduce((sum, p) => sum + p.composite_score, 0) /
          organic.per_prompt.length,
        2,
      )
    : 0;
  const versions = policy.audits.analysis;
  // The run's owned-citation fact for AI Traffic: the exact citation rows,
  // all cohorts, so readers select it and never count citations themselves.
  const ownedCitationIds = citations.filter((c) => c.is_owned).map((c) => c.id);
  const ownedCitationPages = ownedPages(citations);
  const metric = await trx
    .insertInto('metric_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: audit.project_id,
      audit_id: auditId,
      analyzer_version: versions.analyzer_version,
      scoring_rule_version: versions.scoring_rule_version,
      total_completed: analyses.length,
      total_failed: Math.max(0, audit.requested_count - analyses.length),
      visibility_score: visibility,
      metrics: JSON.stringify(metrics),
      source_analysis_ids: JSON.stringify(analyses.map((a) => a.id)),
      source_artifact_ids: JSON.stringify(analyses.map((a) => a.artifact_id)),
      owned_citation_count: ownedCitationIds.length,
      owned_citation_ids: JSON.stringify(ownedCitationIds),
      owned_citation_pages: JSON.stringify(ownedCitationPages),
      created_at: at,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  // The run's Sources facts, beside its metric snapshot, so the Sources
  // table reads them instead of re-joining answers and citations.
  await persistSourceAggregates(trx, { workspaceId, auditId, at });
  await persistPromptMetrics(
    trx,
    audit,
    [...organic.per_prompt, ...comparison.per_prompt, ...diagnostic.per_prompt],
    snapshots,
    analyses,
    engines.length,
    at,
  );
  await persistObservedCompetitors(trx, audit, analyses, config, at);
  return { metric, metrics, visibility, completed: analyses.length };
}

async function persistPromptMetrics(
  db: Database,
  audit: Selectable<Audits>,
  rows: Aggregate['per_prompt'],
  snapshots: Selectable<import('../generated/db-schema.ts').AuditPromptSnapshots>[],
  analyses: Selectable<import('../generated/db-schema.ts').ResponseAnalyses>[],
  engineCount: number,
  at: Date,
) {
  const rules = policy.audits.analysis,
    context = frozenComparisonKey(audit.configuration, null, false);
  const prepared = rows.map((row) => ({
    row,
    prompt: snapshots.find((p) => p.prompt_index === row.prompt_index)!,
  }));
  const histories = prepared.length
    ? await db
        .selectFrom('prompt_metric_snapshots as p')
        .innerJoin('audits as a', 'a.id', 'p.audit_id')
        .selectAll('p')
        .select('a.configuration as configuration')
        .where('p.workspace_id', '=', audit.workspace_id)
        .where('a.workspace_id', '=', audit.workspace_id)
        .where('p.project_id', '=', audit.project_id)
        .where('p.audit_id', '!=', audit.id)
        .where('p.analyzer_version', '=', rules.analyzer_version)
        .where('p.scoring_rule_version', '=', rules.scoring_rule_version)
        .where('a.benchmark_mode', '=', audit.benchmark_mode)
        .where('a.audit_scope', '=', audit.audit_scope)
        .where('a.completed_at', 'is not', null)
        .where((eb) =>
          eb.or(
            prepared.map(({ prompt }) =>
              eb.and([
                eb('p.prompt_identity', '=', promptTextHash(prompt.text)),
                eb('p.cohort', '=', prompt.cohort),
              ]),
            ),
          ),
        )
        .orderBy('a.completed_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(rules.prompt_decline_history_candidate_limit * prepared.length)
        .execute()
    : [];
  const metrics = prepared.map(({ row, prompt }) => {
    const identity = promptTextHash(prompt.text);
    const previous = histories
      .filter(
        (p) =>
          p.prompt_identity === identity &&
          p.cohort === prompt.cohort &&
          context !== null &&
          frozenComparisonKey(p.configuration, null, false) === context &&
          Object.keys(row.per_engine_scores).filter((e) =>
            Object.hasOwn(numberRecord(p.per_engine_scores), e),
          ).length >= rules.prompt_decline_min_engines,
      )
      .slice(0, rules.prompt_decline_window_movements);
    const trend = promptTrend(row, previous, audit.repetitions, engineCount),
      sources = analyses.filter((a) => a.prompt_index === prompt.prompt_index);
    return {
      id: randomUUID(),
      workspace_id: audit.workspace_id,
      project_id: audit.project_id,
      audit_id: audit.id,
      prompt_id: prompt.prompt_id,
      prompt_identity: identity,
      prompt_index: prompt.prompt_index,
      prompt_text: prompt.text,
      cohort: prompt.cohort,
      analyzer_version: rules.analyzer_version,
      scoring_rule_version: rules.scoring_rule_version,
      ...trend,
      rolling_four: JSON.stringify(trend.rolling_four),
      per_engine_scores: JSON.stringify(trend.per_engine_scores),
      components: JSON.stringify(row.score_components),
      source_analysis_ids: JSON.stringify(sources.map((a) => a.id)),
      source_artifact_ids: JSON.stringify(sources.map((a) => a.artifact_id)),
      created_at: at,
    };
  });
  if (metrics.length) await db.insertInto('prompt_metric_snapshots').values(metrics).execute();
}
