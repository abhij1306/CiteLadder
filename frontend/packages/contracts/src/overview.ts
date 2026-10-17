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
