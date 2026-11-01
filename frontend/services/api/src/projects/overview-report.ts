/**
 * The Overview PDF: a branded cover, then the project's saved layout, widget
 * by widget, from the same persisted reads the page shows, then a plain
 * reading guide. Every section prints a missing value as missing; nothing here
 * computes a metric of its own, and no internal identifier reaches the page.
 */
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import type { OverviewWidgetKey } from '@citeladder/contracts/overview';

import { PdfReport, type Stat, type Tag } from './pdf.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getRunVisibility } from '../visibility/dashboard.ts';
import { getPromptMetrics } from '../visibility/prompts.ts';
import { AnalysisNotFoundError } from '../visibility/selection.ts';
import type { ProjectScope } from './brand-profile.ts';
import { commandCenter } from './command-center.ts';
import {
  dateTime,
  engines,
  figure,
  longDate,
  MISSING,
  ordinal,
  plural,
  points,
} from './overview-report-format.ts';
import {
  heading,
  librarySections,
  quiet,
  type ReportContext,
  type Section,
  truncated,
} from './overview-report-library.ts';
import { readOverviewLayout } from './overview-layout.ts';

const ROWS = policy.projects.overview_report_list_rows;
const COHORT = policy.visibility.core_cohort;
const NO_COMPARISON = 'No comparison yet';

type View = ReportContext['view'];
type Action = View['actions'][number];
type Metric = View['state']['visibility'];

const SEVERITY: Record<Action['severity'], Tag> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High priority', tone: 'warning' },
  medium: { label: 'Medium priority', tone: 'neutral' },
  low: { label: 'Low priority', tone: 'neutral' },
  info: { label: 'Informational', tone: 'neutral' },
};

/** What an action is about, from the target the backend presents (a theme label names itself). */
function target(action: Action): string {
  const label = action.target_label;
  if (!label) return 'Across the project';
  if (action.target_url) return `Page: ${label}`;
  if (action.target_prompt_id) return `Prompt: “${label}”`;
  return label;
}

/**
 * A figure's note: what it measures, then its change. Without a comparable run
 * the cover's notice says so once, so a cell carries no change line of its own.
 */
function note(view: View, meaning: string, change: string | null): string {
  if (!view.measurement?.comparable_audit_id) return meaning;
  return `${meaning} · ${change ?? NO_COMPARISON}`;
}

function percentStat(view: View, label: string, metric: Metric, meaning: string): Stat {
  const change = metric.delta === null ? null : `${points(metric.delta)} vs previous run`;
  return {
    label,
    value: figure(metric.value, '%'),
    note: metric.value === null ? 'Not measured' : note(view, meaning, change),
  };
}

function rankStat({ view, brands }: ReportContext): Stat {
  const { value, delta } = view.state.brand_rank;
  if (value === null) return { label: 'Brand rank', value: MISSING, note: 'Not measured' };
  // A lower rank is better, so a negative change is a gain.
  let change: string | null = null;
  if (delta !== null && delta !== 0)
    change = `${delta < 0 ? 'Up' : 'Down'} ${plural(Math.abs(delta), 'place')}`;
  else if (delta === 0) change = 'No change';
  const meaning = brands === null ? 'by share of voice' : `of ${plural(brands, 'brand')}`;
  return { label: 'Brand rank', value: ordinal(value), note: note(view, meaning, change) };
}

function citationStat({ view }: ReportContext): Stat {
  return percentStat(
    view,
    'Citation share',
    view.track.citation_share,
    `of answers cite you · ${plural(view.track.engine_coverage, 'engine')}`,
  );
}

const commandCenterSections: Partial<Record<OverviewWidgetKey, Section>> = {
  project_state: (context) => {
    const { view, report, shown } = context;
    heading(report, 'project_state');
    // Citation share joins the headline figures when both widgets are shown.
    report.stats([
      percentStat(view, 'Visibility', view.state.visibility, 'of answers name you'),
      percentStat(view, 'Share of voice', view.state.share_of_voice, 'of brand mentions'),
      ...(shown.has('citation_share') ? [citationStat(context)] : []),
      rankStat(context),
    ]);
  },
  citation_share: (context) => {
    if (context.shown.has('project_state')) return;
    heading(context.report, 'citation_share');
    context.report.stats([citationStat(context)]);
  },
  movement: ({ view, report }) => {
    heading(report, 'movement');
    if (!view.movements.length) {
      quiet(report, 'No comparable run with the same prompts and engines yet.');
      return;
    }
    report.table({
      columns: [
        { header: 'Engine (share of answers naming you)', width: 3 },
        { header: 'Previous', width: 1, align: 'right' },
        { header: 'Current', width: 1, align: 'right' },
        { header: 'Change', width: 1, align: 'right' },
      ],
      rows: view.movements.map((row) => [
        engines([row.label]),
        figure(row.previous, '%'),
        figure(row.current, '%'),
        row.delta === null ? MISSING : points(row.delta),
      ]),
    });
  },
  next_action: ({ view, report }) => {
    const step = view.next_action;
    const action = view.actions.find((item) => item.id === step.opportunity_id);
    report.callout(
      action
        ? {
            eyebrow: `Next action · ${SEVERITY[action.severity].label}`,
            title: action.title,
            detail: target(action),
          }
        : { eyebrow: 'Next action', title: step.title, detail: null },
    );
  },
  ranked_actions: ({ view, report }) => {
    heading(report, 'ranked_actions');
    if (!view.actions.length) {
      quiet(report, 'No open actions. Run another audit to look for new opportunities.');
      return;
    }
    report.ranked(
      view.actions.slice(0, ROWS).map((action) => ({
        rank: String(action.display_rank),
        title: action.title,
        detail: target(action),
        tag: SEVERITY[action.severity],
      })),
    );
    truncated(report, view.actions.length, 'open action');
  },
  progress_proof: ({ view, report }) => {
    heading(report, 'progress_proof');
    const resolved = view.resolved_actions;
    const since = resolved.since_audit_id ? 'since the previous comparable run' : 'so far';
    report.text(`${plural(resolved.count, 'action')} resolved ${since}.`);
    for (const title of resolved.titles) report.text(`•  ${title}`, { size: 9 });
    quiet(
      report,
      'Movement shown alongside resolved actions does not establish that the actions caused it.',
    );
  },
  company_facts: ({ view, report }) => {
    heading(report, 'company_facts');
    const facts = view.facts;
    const industry = facts.industry.trim();
    const positioning = (facts.positioning || facts.description).trim();
    const offerings = facts.products_services.map((item) => item.trim()).filter(Boolean);
    const rows = [
      ...(industry && industry !== policy.projects.default_industry
        ? [{ label: 'Industry', value: industry }]
        : []),
      ...(positioning ? [{ label: 'Positioning', value: positioning }] : []),
      ...(facts.target_audience.trim()
        ? [{ label: 'Target audience', value: facts.target_audience.trim() }]
        : []),
      ...(offerings.length ? [{ label: 'Offerings', value: offerings }] : []),
      ...(facts.competitors.length
        ? [{ label: 'Tracked competitors', value: facts.competitors.map((row) => row.name) }]
        : []),
    ];
    if (rows.length) report.facts(rows);
    else quiet(report, 'No company facts are set yet.');
  },
};

function guide({ view, report, prompts }: ReportContext, brand: string) {
  report.heading('How to read this report');
  report.text(
    `Visibility is the share of AI answers to your tracked prompts that name ${brand}. Share of voice is ${brand}'s share of all brand mentions in those answers, competitors included, and brand rank orders the tracked brands by it. Citation share is the share of answers that cite a page on your website.`,
  );
  const measurement = view.measurement;
  if (!measurement) {
    report.text('No run has completed yet, so there are no figures to report.');
    return;
  }
  // Prompt scores exist only for prompts the run measured, so the count says "measured".
  const scope = prompts ? `${measuredPrompts(prompts.length)} across` : 'answers from';
  report.text(
    `This report covers the run completed ${dateTime(measurement.completed_at)}: ${scope} ${engines(measurement.logical_engines)}. Changes compare it with the previous run that used the same prompts and engines. A dash (${MISSING}) means there is no value or no comparison yet; it never stands for zero.`,
  );
}

const measuredPrompts = (count: number) => `${plural(count, 'prompt')} measured`;

/** Reads a run-scoped projection, or null before the first completed run. */
async function beforeFirstRun<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AnalysisNotFoundError) return null;
    throw error;
  }
}

export async function overviewReport(db: Database, scope: ProjectScope) {
  const layout = await readOverviewLayout(db, scope);
  const view = commandCenterSchema.parse(await commandCenter(db, scope, null));
  const name = view.project.brand_name || view.project.name;
  const measurement = view.measurement;
  const [prompts, ranked] = measurement
    ? await Promise.all([
        beforeFirstRun(() =>
          getPromptMetrics(
            db,
            { ...scope, marketId: null },
            {
              // The command center's run, so every section describes the same audit.
              auditId: measurement.audit_id,
              auditIds: null,
              baselineAuditIds: null,
              logicalEngine: null,
              baselineId: null,
              cohort: COHORT,
            },
          ),
        ),
        beforeFirstRun(() => getRunVisibility(db, scope, measurement.audit_id, COHORT)),
      ])
    : [null, null];
  const today = new Date();
  const report = await PdfReport.create({
    title: `${name} AI visibility overview`,
    footer: `${name} · AI visibility overview · ${longDate(today)}`,
  });
  const website = view.project.website_url.replace(/^https?:\/\//iu, '').replace(/\/$/u, '');
  report.cover({
    eyebrow: 'AI visibility overview',
    title: name,
    lines: measurement
      ? [
          [website, `Measured ${dateTime(measurement.completed_at)}`].filter(Boolean).join('  ·  '),
          [engines(measurement.logical_engines), prompts ? measuredPrompts(prompts.length) : null]
            .filter(Boolean)
            .join('  ·  '),
        ]
      : [website, 'No completed measurement yet.'].filter(Boolean),
  });
  if (measurement && !measurement.comparable_audit_id)
    report.note(
      'No comparison yet: changes appear once a second run uses the same prompts and engines.',
    );
  const context: ReportContext = {
    db,
    scope,
    view,
    report,
    prompts,
    brands: ranked?.rankings.length ?? null,
    shown: new Set(layout.widgets.map((widget) => widget.key)),
  };
  const sections = { ...commandCenterSections, ...librarySections };
  for (const widget of layout.widgets) {
    try {
      await sections[widget.key]?.(context);
    } catch (error) {
      // Before the first completed run a widget's read has nothing to select.
      if (!(error instanceof AnalysisNotFoundError)) throw error;
      quiet(report, 'Not available until the first completed run.');
    }
  }
  guide(context, name);
  const slug =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-|-$/gu, '') || 'project';
  return {
    bytes: await report.save(),
    filename: `citeladder-${slug}-overview-${today.toISOString().slice(0, 10)}.pdf`,
  };
}
