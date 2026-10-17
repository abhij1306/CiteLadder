/**
 * Overview PDF sections for the library widgets. Each calls the persisted read
 * its page widget uses, with the page's defaults: the latest run, organic
 * (`core`) prompts and the default market.
 */
import type { commandCenterSchema } from '@citeladder/contracts/opportunities';
import type { OverviewWidgetKey } from '@citeladder/contracts/overview';
import type { z } from 'zod';

import { getAiReferrals } from '../analytics/ai-referrals.ts';
import type { PdfReport } from './pdf.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { crawlSummary } from '../crawl-logs/reads.ts';
import { getPerformance } from '../traffic/performance.ts';
import { getVisibility } from '../visibility/dashboard.ts';
import { getPerception } from '../visibility/perception.ts';
import { getPromptMetrics } from '../visibility/prompts.ts';
import { getSourceMovers } from '../visibility/source-movers.ts';
import { getSourceNearMisses } from '../visibility/source-retrieval.ts';
import type { RunSelection } from '../visibility/selection.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import type { ProjectScope } from './brand-profile.ts';

export type ReportContext = {
  db: Database;
  scope: ProjectScope;
  view: z.output<typeof commandCenterSchema>;
  report: PdfReport;
};
export type Section = (context: ReportContext) => Promise<void> | void;

const ROWS = policy.projects.overview_report_list_rows;
const COHORT = policy.visibility.core_cohort;

export const metric = (value: number | null | undefined, suffix = '') =>
  value == null ? 'Unknown' : `${value}${suffix}`;
/** A 0-1 rate as a whole percent. */
const rate = (value: number | null | undefined) =>
  value == null ? 'Unknown' : `${Math.round(value * 100)}%`;

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

const missingPrompts: Section = async (context) => {
  const { db, scope, report } = context;
  report.heading("Where you're missing");
  const items = await getPromptMetrics(
    db,
    { ...scope, marketId: null },
    {
      auditId: null,
      auditIds: null,
      baselineAuditIds: null,
      logicalEngine: null,
      baselineId: null,
      cohort: COHORT,
    },
  );
  const rows = items.flatMap((item) => {
    const engines = (item.outcomes ?? [])
      .filter((outcome) => Object.keys(outcome.gap_counts).length > 0)
      .map((outcome) => outcome.logical_engine);
    return engines.length ? [[item.prompt_text, [...new Set(engines)].join(', ')]] : [];
  });
  if (!rows.length) report.text('No prompt in the latest run named a competitor without you.');
  else report.table(['Prompt', 'Engines'], rows.slice(0, ROWS), [4, 2]);
};

const visibilityTrend: Section = async ({ db, scope, report }) => {
  report.heading('Visibility over time');
  const points = await getVisibilityTrends(
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
  if (!points.length) {
    report.text('No completed runs yet.');
    return;
  }
  report.table(
    ['Completed', 'Visibility', 'Owned citation rate'],
    points
      .slice(-ROWS)
      .map((point) => [
        point.completed_at.slice(0, 10),
        rate(point.visibility_rate),
        rate(point.owned_citation_rate),
      ]),
    [2, 1, 1],
  );
};

const shareOfVoice: Section = async (context) => {
  context.report.heading('Share of voice');
  const rankings = (await visibilityRead(context)).rankings;
  if (!rankings.length) {
    context.report.text('No brands measured in the latest run.');
    return;
  }
  context.report.table(
    ['Brand', 'Share of voice', 'Mention rate'],
    rankings
      .slice(0, ROWS)
      .map((row) => [row.name, rate(row.share_of_voice), rate(row.mention_rate)]),
    [3, 1, 1],
  );
};

const topMovers: Section = async (context) => {
  const { db, report } = context;
  report.heading('Top movers');
  const comparison = (await visibilityRead(context)).comparison;
  if (comparison?.status !== 'comparable') {
    report.text('No comparable earlier period to compare this one with yet.');
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
    `${mover.delta > 0 ? '+' : ''}${mover.delta} pp`,
  ]);
  if (!rows.length) report.text('No source changed its citation share.');
  else report.table(['Domain', 'Before', 'Now', 'Change'], rows, [3, 1, 1, 1]);
};

const retrieval: Section = async (context) => {
  const { db, report } = context;
  report.heading('Retrieved versus cited');
  const misses = await getSourceNearMisses(db, latest(context), {
    asOf: new Date().toISOString(),
    limit: ROWS,
  });
  report.text(
    `${misses.responses} answer(s) exposed what the engine read.${misses.unavailable_engines.length ? ` Not available for ${misses.unavailable_engines.join(', ')}.` : ''}`,
  );
  if (misses.items.length)
    report.table(
      ['Your page read but not cited', 'Read in', 'Cited in'],
      misses.items.map((item) => [item.url, String(item.retrieved), String(item.cited)]),
      [4, 1, 1],
    );
};

const perception: Section = async (context) => {
  context.report.heading('Perception');
  const read = await getPerception(context.db, latest(context));
  const score = read.brand?.score;
  if (read.state !== 'value' || !score) {
    context.report.text('Perception is not available for the latest run.');
    return;
  }
  context.report.table(
    ['Net sentiment', 'Positive', 'Negative', 'Classified mentions'],
    [
      [
        metric(score.net_sentiment === null ? null : Math.round(score.net_sentiment)),
        rate(score.positive_share),
        rate(score.negative_share),
        String(score.classified),
      ],
    ],
    [1, 1, 1, 1],
  );
};

const aiTraffic: Section = async ({ db, scope, report }) => {
  report.heading('AI Traffic');
  const crawl = await crawlSummary(db, scope);
  const referrals = await getAiReferrals(db, {
    ...scope,
    fromDate: null,
    toDate: null,
    rangeToken: null,
    granularity: 'day',
  });
  const visits = referrals.referral_volume.at(-1)?.value ?? null;
  report.table(
    ['AI crawler requests', 'Pages crawled', 'Active bots', 'Latest AI referrals'],
    [[metric(crawl.requests), metric(crawl.pages), metric(crawl.active_bots), metric(visits)]],
    [1, 1, 1, 1],
  );
};

const searchConsole: Section = async ({ db, scope, report }) => {
  report.heading('Search Console');
  const performance = await getPerformance(db, scope);
  const totals = performance.selected.totals;
  // An observed zero is a measurement, so only a window never synced reads as unavailable.
  if (performance.selected.evidence_state === 'not_run') {
    report.text('Search Console data is not available for this window.');
    return;
  }
  report.table(
    ['Clicks', 'Impressions', 'CTR', 'Average position'],
    [
      [
        metric(totals.clicks),
        metric(totals.impressions),
        rate(totals.ctr),
        metric(totals.position),
      ],
    ],
    [1, 1, 1, 1],
  );
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
