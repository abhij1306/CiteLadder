import type { OverviewWidget } from '@citeladder/contracts/overview';

/** Bounds for persisted dashboard/report measurement history. */
export const projectReads = {
  default_benchmark_mode: 'controlled_localized',
  /** The industry a project carries until someone names one; reports leave it out. */
  default_industry: 'General',
  default_repetitions: 1,
  command_center_max_audits: 100,
  /** The Overview a project shows until someone edits it, and what Reset restores. */
  overview_default_layout: [
    { key: 'project_state', size: 'half' },
    { key: 'citation_share', size: 'half' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'half' },
    { key: 'progress_proof', size: 'half' },
    { key: 'company_facts', size: 'full' },
  ] satisfies OverviewWidget[] as OverviewWidget[],
  CODE_OVERVIEW_LAYOUT_CONFLICT: 'overview_layout_conflict',
  /** Rows a list widget prints in the Overview PDF. */
  overview_report_list_rows: 10,
};
