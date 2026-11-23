import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { readinessReason } from './analysis/scoring.ts';
import { aeoChecksSql } from './reads/page-rows.ts';
import { classificationState } from './score-summary.ts';
import type { Crawl } from './site-task.ts';
import { compareText } from '../text-order.ts';

const LIVE_STATE = 'limited_evidence';
const TERMINAL = policy.task_queue.terminal;

type KindRow = {
  page_kind: string;
  other_reason: string | null;
  analyzed: number;
  web_sum: number;
  web_scored: number;
  web_applicable: number;
  aeo_sum: number;
  aeo_scored: number;
  aeo_applicable: number;
  web_run: number;
  web_total: number;
  aeo_run: number;
  aeo_total: number;
};

type Totalled = Exclude<keyof KindRow, 'page_kind' | 'other_reason'>;

function currentAnalyses(db: Database, crawl: Crawl) {
  return db
    .selectFrom('site_page_analyses as p')
    .innerJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 'p.site_url_id')
        .onRef('m.workspace_id', '=', 'p.workspace_id')
        .onRef('m.project_id', '=', 'p.project_id'),
    )
    .where('p.workspace_id', '=', crawl.workspace_id)
    .where('p.crawl_id', '=', crawl.id)
    .where('p.is_current', '=', true)
    .where('p.status', '=', 'completed')
    .where('m.active', '=', true);
}

function kindRows(db: Database, crawl: Crawl): Promise<KindRow[]> {
  return currentAnalyses(db, crawl)
    .select([
      'p.page_kind',
      sql<string | null>`case when p.page_kind = 'other'
        then coalesce(nullif(p.page_kind_evidence->>'other_reason', ''), 'page_purpose_unresolved')
        end`.as('other_reason'),
      sql<number>`count(*)::int`.as('analyzed'),
      sql<number>`coalesce(sum(p.web_fundamentals_score), 0)::float8`.as('web_sum'),
      sql<number>`count(p.web_fundamentals_score)::int`.as('web_scored'),
      sql<number>`(count(*) filter (where p.technical_expected_weight > 0
        or p.web_fundamentals_score is not null))::int`.as('web_applicable'),
      sql<number>`coalesce(sum(p.aeo_readiness_score), 0)::float8`.as('aeo_sum'),
      sql<number>`count(p.aeo_readiness_score)::int`.as('aeo_scored'),
      sql<number>`(count(*) filter (where ${aeoChecksSql('p.readiness_dimensions', 'expected_points')} > 0
        or p.aeo_readiness_score is not null))::int`.as('aeo_applicable'),
      sql<number>`coalesce(sum(p.technical_determinate_weight), 0)::int`.as('web_run'),
      sql<number>`coalesce(sum(p.technical_expected_weight), 0)::int`.as('web_total'),
      sql<number>`coalesce(sum(${aeoChecksSql('p.readiness_dimensions', 'determinate_points')}), 0)::int`.as(
        'aeo_run',
      ),
      sql<number>`coalesce(sum(${aeoChecksSql('p.readiness_dimensions', 'expected_points')}), 0)::int`.as(
        'aeo_total',
      ),
    ])
    .groupBy([sql`1`, sql`2`])
    .orderBy('p.page_kind')
    .execute();
}

function scores(rows: KindRow[]) {
  const total = (key: Totalled) => rows.reduce((sum, row) => sum + row[key], 0);
  const checks = (run: Totalled, of: Totalled) =>
    total(of) ? { run: total(run), total: total(of) } : null;
  const analyzed = total('analyzed');
  const mean = (role: 'web' | 'aeo') =>
    total(`${role}_scored`) ? total(`${role}_sum`) / total(`${role}_applicable`) : null;
  const coverage = (scored: number) => (analyzed ? scored / analyzed : null);
  return {
    analyzed,
    web_fundamentals_score: mean('web'),
    web_fundamentals_coverage: coverage(total('web_scored')),
    web_fundamentals_state: LIVE_STATE,
    aeo_readiness_score: mean('aeo'),
    aeo_measurement_coverage: coverage(total('aeo_scored')),
    aeo_measurement_state: LIVE_STATE,
    web_fundamentals_checks: checks('web_run', 'web_total'),
    aeo_readiness_checks: checks('aeo_run', 'aeo_total'),
  };
}

function byPageKind(rows: KindRow[]) {
  const kinds = [...new Set(rows.map((row) => row.page_kind))];
  return Object.fromEntries(
    kinds.map((kind) => {
      const { analyzed, ...measured } = scores(rows.filter((row) => row.page_kind === kind));
      const reason = readinessReason(measured.aeo_readiness_score, 'measured', false, kind);
      return [kind, { ...measured, analyzed_count: analyzed, aeo_measurement_reason: reason }];
    }),
  );
}

function classificationErrors(db: Database, crawl: Crawl) {
  const tasks = db
    .selectFrom('site_crawl_tasks as t')
    .innerJoin('monitored_site_urls as m', (join) =>
      join
        .onRef('m.site_url_id', '=', 't.site_url_id')
        .onRef('m.workspace_id', '=', 't.workspace_id'),
    )
    .select(['t.site_url_id', 't.status', 't.error_code', 't.classification_expected'])
    .distinctOn('t.site_url_id')
    .where('t.workspace_id', '=', crawl.workspace_id)
    .where('t.crawl_id', '=', crawl.id)
    .where('t.task_kind', 'in', ['analyze', 'discover'])
    .where('m.project_id', '=', crawl.project_id)
    .where('m.active', '=', true)
    .orderBy('t.site_url_id')
    .orderBy(sql`t.task_kind = 'analyze'`, 'desc')
    .orderBy('t.generation', 'desc')
    .orderBy('t.id', 'desc');
  const analyzed = currentAnalyses(db, crawl)
    .select('p.id')
    .where(sql<boolean>`p.site_url_id = x.site_url_id`);
  return db
    .selectFrom(tasks.as('x'))
    .select([
      sql<string | null>`case when x.status in (${sql.join(TERMINAL.map((s) => sql.lit(s)))})
        and not exists (${analyzed})
        then coalesce(nullif(x.error_code, ''), 'classification_failed') end`.as('error'),
      sql<number>`count(*)::int`.as('pages'),
    ])
    .where('x.classification_expected', '=', true)
    .groupBy(sql`1`)
    .execute();
}

async function counts(db: Database, crawl: Crawl) {
  const issues = await db
    .selectFrom('site_issues as i')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('i.workspace_id', '=', crawl.workspace_id)
    .where('i.crawl_id', '=', crawl.id)
    .where('i.is_current', '=', true)
    .where(
      sql<boolean>`exists (select 1 from monitored_site_urls m
        where m.workspace_id = i.workspace_id and m.project_id = ${crawl.project_id}
          and m.site_url_id = i.site_url_id and m.active)`,
    )
    .executeTakeFirstOrThrow();
  const selected = await db
    .selectFrom('monitored_site_urls')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  return { issues: issues.count, selected: selected.count };
}

function classification(rows: KindRow[], errors: { error: string | null; pages: number }[]) {
  const reasons: Record<string, number> = {};
  const add = (reason: string, count: number) => {
    reasons[reason] = (reasons[reason] ?? 0) + count;
  };
  for (const row of rows) if (row.other_reason) add(row.other_reason, row.analyzed);
  for (const row of errors) if (row.error) add(row.error, row.pages);
  const of = (kind: (row: KindRow) => boolean) =>
    rows.filter(kind).reduce((sum, row) => sum + row.analyzed, 0);
  const classified = of((row) => row.page_kind !== 'other');
  const expected = errors.reduce((sum, row) => sum + row.pages, 0);
  const byKind: Record<string, number> = {};
  for (const row of rows) byKind[row.page_kind] = (byKind[row.page_kind] ?? 0) + row.analyzed;
  return {
    classified_page_count: classified,
    other_page_count: of((row) => row.page_kind === 'other'),
    classification_error_page_count: errors
      .filter((row) => row.error)
      .reduce((sum, row) => sum + row.pages, 0),
    classification_expected_page_count: expected,
    classification_coverage: expected ? Math.round((classified / expected) * 10000) / 10000 : null,
    classification_state: classificationState(classified, expected),
    classification_reason_groups: reasons,
    classification_formula_version: policy.site_health.reads.classification_formula_version,
    scored_page_kind_set: Object.keys(byKind).toSorted(compareText),
    scored_page_count_by_kind: byKind,
  };
}

export async function liveScoreSummary(db: Database, crawl: Crawl) {
  const rows = await kindRows(db, crawl);
  if (!rows.length) return null;
  const { analyzed, ...measured } = scores(rows);
  const { issues, selected } = await counts(db, crawl);
  return {
    ...measured,
    scoring_version: policy.site_health.reads.scoring_version,
    search_eligibility: 'unknown',
    analyzed_count: analyzed,
    selected_count: selected,
    issue_count: issues,
    ...classification(rows, await classificationErrors(db, crawl)),
    presentation_version: policy.site_health.reads.measurement_versions.presentation,
    by_page_kind: byPageKind(rows),
  };
}
