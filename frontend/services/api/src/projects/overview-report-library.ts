/**
 * Overview PDF sections for the library widgets. Each calls the persisted read
 * its page widget uses, with the page's defaults: the latest run, organic
 * (`core`) prompts and the default market.
 */
import type { commandCenterSchema } from '@citeladder/contracts/opportunities';
import { overviewWidgetTitles, type OverviewWidgetKey } from '@citeladder/contracts/overview';
import type { z } from 'zod';

import { getAiReferrals } from '../analytics/ai-referrals.ts';
import type { PdfReport } from './pdf.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { crawlSummary } from '../crawl-logs/reads.ts';
import { getPerformance } from '../traffic/performance.ts';
import { getVisibility } from '../visibility/dashboard.ts';
import { getPerception } from '../visibility/perception.ts';
import type { PromptMetricItem } from '../visibility/prompts.ts';
import { getSourceMovers } from '../visibility/source-movers.ts';
import { getSourceNearMisses } from '../visibility/source-retrieval.ts';
import type { RunSelection } from '../visibility/selection.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import type { ProjectScope } from './brand-profile.ts';
import {
  count,
  engines,
  figure,
  plural,
  points,
  rate,
  shortDate,
} from './overview-report-format.ts';

export type ReportContext = {
  db: Database;
  scope: ProjectScope;
  view: z.output<typeof commandCenterSchema>;
  report: PdfReport;
  /** The latest run's prompts; null before the first completed run. */
  prompts: PromptMetricItem[] | null;
  /** How many brands the latest run ranked; null before the first completed run. */
  brands: number | null;
  /** The widgets on the saved layout. */
  shown: ReadonlySet<OverviewWidgetKey>;
};
export type Section = (context: ReportContext) => Promise<void> | void;

const ROWS = policy.projects.overview_report_list_rows;
const COHORT = policy.visibility.core_cohort;

export const heading = (report: PdfReport, key: OverviewWidgetKey) =>
  report.heading(overviewWidgetTitles[key]);
/** A quiet line: an empty state or a qualification. */
export const quiet = (report: PdfReport, text: string) =>
  report.text(text, { size: 9, tone: 'muted' });
/** Says how much of a longer list the report printed. */
export function truncated(report: PdfReport, total: number, noun: string) {
  if (total > ROWS) quiet(report, `Showing ${ROWS} of ${plural(total, noun)}.`);
}

function latest({ scope }: ReportContext): RunSelection {
  return {
    ...scope,
    marketId: null,
    auditId: null,
    auditIds: null,
    logicalEngine: null,
    cohort: COHORT,
    fromAt: null,
    toAt: null,
  };
}

const visibilityRead = ({ db, scope }: ReportContext) =>
  getVisibility(
    db,
    { ...scope, marketId: null },
    {
      auditId: null,
      logicalEngine: null,
      baselineId: null,
      selectionMode: 'latest',
      fromAt: null,
      toAt: null,
      configurationKey: null,
      cohort: COHORT,
    },
  );

const missingPrompts: Section = ({ report, prompts }) => {
  heading(report, 'missing_prompts');
  const rows = (prompts ?? []).flatMap((item) => {
    const missed = (item.outcomes ?? [])
      .filter((outcome) => Object.keys(outcome.gap_counts).length > 0)
      .map((outcome) => outcome.logical_engine);
    return missed.length ? [[item.prompt_text, engines(missed)]] : [];
  });
  if (!prompts) quiet(report, 'Not available until the first completed run.');
  else if (!rows.length)
    quiet(report, 'No prompt in the latest run named a competitor without you.');
  else {
    report.table({
      columns: [
        { header: 'Prompt where a competitor was named and you were not', width: 4 },
        { header: 'Engines', width: 2 },
      ],
      rows: rows.slice(0, ROWS),
    });
    truncated(report, rows.length, 'prompt');
  }
};

const visibilityTrend: Section = async ({ db, scope, report }) => {
  heading(report, 'visibility_trend');
  const runs = await getVisibilityTrends(
    db,
    { ...scope, marketId: null },
    {
      logicalEngine: null,
      fromAt: null,
      toAt: null,
      granularity: policy.visibility.trend_default_granularity,
      transportModel: null,
      retrievalEnabled: null,
      cohort: COHORT,
    },
  );
  if (!runs.length) {
    quiet(report, 'No completed runs yet.');
    return;
  }
  report.table({
    columns: [
      { header: 'Run completed', width: 2 },
      { header: 'Visibility', width: 1, align: 'right' },
      { header: 'Citation share', width: 1, align: 'right' },
    ],
    rows: runs
      .slice(-ROWS)
      .map((point) => [
        shortDate(point.completed_at),
        rate(point.visibility_rate),
        rate(point.owned_citation_rate),
      ]),
  });
};

const shareOfVoice: Section = async (context) => {
  heading(context.report, 'share_of_voice');
  const rankings = (await visibilityRead(context)).rankings;
  if (!rankings.length) {
    quiet(context.report, 'No brands measured in the latest run.');
    return;
  }
  context.report.table({
    columns: [
      { header: 'Brand', width: 3 },
      { header: 'Share of voice', width: 1, align: 'right' },
      { header: 'Visibility', width: 1, align: 'right' },
    ],
    rows: rankings
      .slice(0, ROWS)
      .map((row) => [
        row.is_brand ? `${row.name} (you)` : row.name,
        rate(row.share_of_voice),
        rate(row.mention_rate),
      ]),
  });
  truncated(context.report, rankings.length, 'brand');
};

const topMovers: Section = async (context) => {
  const { db, report } = context;
  heading(report, 'top_movers');
  const comparison = (await visibilityRead(context)).comparison;
  if (comparison?.status !== 'comparable') {
    quiet(report, 'No comparable earlier period to compare this one with yet.');
    return;
  }
  const movers = await getSourceMovers(db, latest(context), {
    dimension: 'domain',
    baselineAuditIds: comparison.baseline_audit_ids,
    limit: ROWS,
  });
  const rows = [...movers.risers, ...movers.fallers].map((mover) => [
    mover.key,
    rate(mover.previous_share),
    rate(mover.current_share),
    points(mover.delta),
  ]);
  if (!rows.length) quiet(report, 'No source changed its citation share.');
  else
    report.table({
      columns: [
        { header: 'Cited domain', width: 3 },
        { header: 'Before', width: 1, align: 'right' },
        { header: 'Now', width: 1, align: 'right' },
        { header: 'Change', width: 1, align: 'right' },
      ],
      rows,
    });
};

const retrieval: Section = async (context) => {
  const { db, report } = context;
  heading(report, 'retrieval');
  const misses = await getSourceNearMisses(db, latest(context), {
    asOf: new Date().toISOString(),
    limit: ROWS,
  });
  const unavailable = misses.unavailable_engines.length
    ? ` ${engines(misses.unavailable_engines)} ${misses.unavailable_engines.length === 1 ? 'does' : 'do'} not show what was read.`
    : '';
  report.text(
    `${plural(misses.responses, 'answer')} showed which pages the engine read.${unavailable}`,
  );
  if (misses.items.length)
    report.table({
      columns: [
        { header: 'Your page, read but not cited', width: 4 },
        { header: 'Read in', width: 1, align: 'right' },
        { header: 'Cited in', width: 1, align: 'right' },
      ],
      rows: misses.items.map((item) => [item.url, count(item.retrieved), count(item.cited)]),
    });
};

const perception: Section = async (context) => {
  heading(context.report, 'perception');
  const read = await getPerception(context.db, latest(context));
  const score = read.brand?.score;
  if (read.state !== 'value' || !score) {
    quiet(context.report, 'Perception is not available for the latest run.');
    return;
  }
  context.report.table({
    columns: [
      { header: 'Net sentiment', width: 1, align: 'right' },
      { header: 'Positive', width: 1, align: 'right' },
      { header: 'Negative', width: 1, align: 'right' },
      { header: 'Classified mentions', width: 1, align: 'right' },
    ],
    rows: [
      [
        figure(score.net_sentiment === null ? null : Math.round(score.net_sentiment)),
        rate(score.positive_share),
        rate(score.negative_share),
        count(score.classified),
      ],
    ],
  });
};

const aiTraffic: Section = async ({ db, scope, report }) => {
  heading(report, 'ai_traffic');
  const crawl = await crawlSummary(db, scope);
  const referrals = await getAiReferrals(db, {
    ...scope,
    fromDate: null,
    toDate: null,
    rangeToken: null,
    granularity: 'day',
  });
  const visits = referrals.referral_volume.at(-1)?.value ?? null;
  report.table({
    columns: [
      { header: 'AI crawler requests', width: 1, align: 'right' },
      { header: 'Pages crawled', width: 1, align: 'right' },
      { header: 'Active bots', width: 1, align: 'right' },
      { header: 'Latest AI referrals', width: 1, align: 'right' },
    ],
    rows: [[count(crawl.requests), count(crawl.pages), count(crawl.active_bots), count(visits)]],
  });
};

const searchConsole: Section = async ({ db, scope, report }) => {
  heading(report, 'search_console');
  const performance = await getPerformance(db, scope);
  const totals = performance.selected.totals;
  // An observed zero is a measurement, so only a window never synced reads as unavailable.
  if (performance.selected.evidence_state === 'not_run') {
    quiet(report, 'Search Console data is not available for this window.');
    return;
  }
  report.table({
    columns: [
      { header: 'Clicks', width: 1, align: 'right' },
      { header: 'Impressions', width: 1, align: 'right' },
      { header: 'CTR', width: 1, align: 'right' },
      { header: 'Average position', width: 1, align: 'right' },
    ],
    rows: [
      [count(totals.clicks), count(totals.impressions), rate(totals.ctr), figure(totals.position)],
    ],
  });
};

export const librarySections: Partial<Record<OverviewWidgetKey, Section>> = {
  missing_prompts: missingPrompts,
  visibility_trend: visibilityTrend,
  share_of_voice: shareOfVoice,
  top_movers: topMovers,
  retrieval,
  perception,
  ai_traffic: aiTraffic,
  search_console: searchConsole,
};
