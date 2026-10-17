/**
 * The Overview PDF: the project's current layout, widget by widget, from the
 * same persisted reads the page shows. Every section prints unknown as
 * unknown; nothing here computes a metric of its own.
 */
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import type { OverviewWidgetKey } from '@citeladder/contracts/overview';

import { PdfReport } from './pdf.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject, strings } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import { AnalysisNotFoundError } from '../visibility/selection.ts';
import type { ProjectScope } from './brand-profile.ts';
import { commandCenter } from './command-center.ts';
import {
  librarySections,
  metric,
  type ReportContext,
  type Section,
} from './overview-report-library.ts';
import { readOverviewLayout } from './overview-layout.ts';

const ROWS = policy.projects.overview_report_list_rows;

function evidenceCount(value: unknown): string {
  const count = jsonObject(value, 'evidence_summary').count;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? String(count)
    : 'Unknown';
}

const commandCenterSections: Partial<Record<OverviewWidgetKey, Section>> = {
  project_state: ({ view, report }) => {
    report.heading('Project state');
    report.table(
      ['Metric', 'Current', 'Comparable change'],
      [
        [
          'Visibility',
          metric(view.state.visibility.value, '%'),
          metric(view.state.visibility.delta),
        ],
        [
          'Share of voice',
          metric(view.state.share_of_voice.value, '%'),
          metric(view.state.share_of_voice.delta),
        ],
        ['Brand rank', metric(view.state.brand_rank.value), metric(view.state.brand_rank.delta)],
      ],
      [2, 1, 1],
    );
  },
  citation_share: ({ view, report }) => {
    report.heading('Citation share');
    const share = view.track.citation_share;
    report.text(
      `${metric(share.value, '%')} across ${view.track.engine_coverage} engine(s); change ${metric(share.delta)}`,
    );
    for (const limitation of view.track.limitations) report.text(limitation);
  },
  movement: ({ view, report }) => {
    report.heading('Movement');
    if (!view.movements.length) {
      report.text('No comparable run with the same prompts and engines yet.');
      return;
    }
    report.table(
      ['Engine', 'Current', 'Previous', 'Change'],
      view.movements.map((row) => [
        row.label,
        metric(row.current),
        metric(row.previous),
        metric(row.delta),
      ]),
      [2, 1, 1, 1],
    );
  },
  next_action: ({ view, report }) => {
    report.heading('Next action');
    report.text(view.next_action.title);
  },
  ranked_actions: ({ view, report }) => {
    report.heading('Ranked actions');
    if (!view.actions.length) {
      report.text('No open actions.');
      return;
    }
    report.table(
      ['Rank', 'Action', 'Priority', 'Evidence'],
      view.actions
        .slice(0, ROWS)
        .map((action) => [
          String(action.display_rank),
          action.title,
          String(action.priority_score),
          evidenceCount(action.evidence_summary),
        ]),
      [1, 6, 2, 2],
    );
  },
  progress_proof: ({ view, report }) => {
    report.heading('Progress and report proof');
    report.text(
      `${view.resolved_actions.count} action(s) resolved since the comparable run. Movement shown alongside completion does not establish causation.`,
    );
  },
  company_facts: ({ view, report }) => {
    const facts = view.facts;
    report.heading('Company facts');
    report.text(
      `Industry: ${facts.industry || 'Not set'}\nPositioning: ${facts.positioning || facts.description || 'Not set'}\nTarget audience: ${facts.target_audience || 'Not set'}\nOfferings: ${facts.products_services.join(', ') || 'Not set'}\nTracked competitors: ${facts.competitors.length}`,
    );
  },
};

function methodology({ view, report }: ReportContext) {
  const measurement = view.measurement;
  report.heading('Measurement scope and methodology');
  report.text(
    'Visibility, share of voice and rank are deterministic projections of persisted audit artifacts. Changes need matching benchmark mode, engines, frozen prompt identity and processing versions. Unknown means no determinate value or valid comparison; an observed zero stays zero.',
  );
  if (!measurement) {
    report.text('No completed measurement yet.');
    return;
  }
  report.text(
    `Audit: ${measurement.audit_id}\nComparable audit: ${measurement.comparable_audit_id ?? 'Unavailable'}\nBenchmark: ${measurement.benchmark_mode || 'Unknown'}\nEngines: ${measurement.logical_engines.join(', ') || 'Unavailable'}\nAnalyzer: ${measurement.analyzer_version ?? 'Unknown'}\nScoring rules: ${measurement.scoring_rule_version ?? 'Unknown'}`,
  );
  for (const action of view.actions.slice(0, ROWS)) {
    const evidence = jsonObject(action.evidence_summary, 'evidence_summary');
    const factors = jsonObject(action.priority_factors, 'priority_factors');
    report.text(
      `${action.display_rank}. ${action.title}\nEvidence types: ${strings(evidence.kinds).join(', ') || 'Unavailable'}\nFormula: ${scalarText(factors.formula_version ?? 'Unknown')}`,
    );
  }
}

export async function overviewReport(db: Database, scope: ProjectScope) {
  const layout = await readOverviewLayout(db, scope);
  const view = commandCenterSchema.parse(await commandCenter(db, scope, null));
  const name = view.project.brand_name || view.project.name;
  const report = await PdfReport.create(`${name} overview`);
  report.title(`${name} overview`);
  report.text(
    view.measurement
      ? `Latest completed measurement ${view.measurement.completed_at}`
      : 'No completed measurement yet.',
  );
  const context = { db, scope, view, report };
  const sections = { ...commandCenterSections, ...librarySections };
  for (const widget of layout.widgets) {
    try {
      await sections[widget.key]?.(context);
    } catch (error) {
      // Before the first completed run a widget's read has nothing to select.
      if (!(error instanceof AnalysisNotFoundError)) throw error;
      report.text('Not available until the first completed run.');
    }
  }
  report.newPage();
  methodology(context);
  const slug =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-|-$/gu, '') || 'project';
  return {
    bytes: await report.save(),
    filename: `citeladder-${slug}-overview-${new Date().toISOString().slice(0, 10)}.pdf`,
  };
}
