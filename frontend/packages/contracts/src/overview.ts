import { z } from 'zod';

// ---------------------------------------------------------------------------
// Overview layout: one editable widget arrangement per project
// ---------------------------------------------------------------------------

/**
 * Every widget the Overview can show. Each reads an existing persisted
 * projection; none computes its own metric.
 */
export const overviewWidgetKeySchema = z.enum([
  'project_state',
  'citation_share',
  'movement',
  'next_action',
  'missing_prompts',
  'ranked_actions',
  'progress_proof',
  'company_facts',
  'visibility_trend',
  'share_of_voice',
  'top_movers',
  'retrieval',
  'perception',
  'ai_traffic',
  'search_console',
]);
export type OverviewWidgetKey = z.infer<typeof overviewWidgetKeySchema>;

/** Each widget's title, on the Overview and as its section heading in the PDF. */
export const overviewWidgetTitles: Record<OverviewWidgetKey, string> = {
  project_state: 'Project state',
  citation_share: 'Citation share',
  movement: 'Movement',
  next_action: 'Next action',
  missing_prompts: "Where you're missing",
  ranked_actions: 'Ranked actions',
  progress_proof: 'Progress and report proof',
  company_facts: 'Company facts',
  visibility_trend: 'Visibility over time',
  share_of_voice: 'Share of voice',
  top_movers: 'Top movers',
  retrieval: 'Retrieved versus cited',
  perception: 'Perception',
  ai_traffic: 'AI Traffic',
  search_console: 'Search Console',
};

/** Half takes one column of the two-column grid; full spans both. */
const overviewWidgetSizeSchema = z.enum(['half', 'full']);

export const overviewWidgetSchema = z.object({
  key: overviewWidgetKeySchema,
  size: overviewWidgetSizeSchema,
});
export type OverviewWidget = z.infer<typeof overviewWidgetSchema>;

export const overviewLayoutSchema = z.object({
  widgets: z.array(overviewWidgetSchema),
  /** 0 until the layout is first saved; every save advances it by one. */
  version: z.number().int().nonnegative(),
  /** False while the project shows the default layout. */
  customized: z.boolean(),
  updated_at: z.string().nullable(),
});
export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;

/** `widgets: null` resets the project to the default layout. */
export const overviewLayoutUpdateSchema = z.strictObject({
  widgets: z.array(overviewWidgetSchema).min(1).nullable(),
  expected_version: z.number().int().nonnegative(),
});
export type OverviewLayoutUpdate = z.infer<typeof overviewLayoutUpdateSchema>;
