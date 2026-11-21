import type { OverviewWidget } from '@citeladder/contracts/overview';

export const projectReads = {
  default_benchmark_mode: 'controlled_localized',
  default_industry: 'General',
  default_repetitions: 1,
  overview_default_layout: [
    { key: 'project_state', size: 'full' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'full' },
    { key: 'company_facts', size: 'full' },
  ] satisfies OverviewWidget[] as OverviewWidget[],
  CODE_OVERVIEW_LAYOUT_CONFLICT: 'overview_layout_conflict',
  overview_opportunity_rows: 8,
  overview_report_list_rows: 10,
};
