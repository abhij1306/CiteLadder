import { z } from 'zod';

export const overviewWidgetKeySchema = z.enum([
  'project_state',
  'movement',
  'next_action',
  'missing_prompts',
  'ranked_actions',
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

export const overviewWidgetTitles: Record<OverviewWidgetKey, string> = {
  project_state: 'Project state',
  movement: 'Movement',
  next_action: 'Next action',
  missing_prompts: "Where you're missing",
  ranked_actions: 'Ranked actions',
  company_facts: 'Company facts',
  visibility_trend: 'Visibility over time',
  share_of_voice: 'Share of voice',
  top_movers: 'Top movers',
  retrieval: 'Retrieved versus cited',
  perception: 'Perception',
  ai_traffic: 'AI traffic',
  search_console: 'Search Console',
};

const overviewWidgetSizeSchema = z.enum(['half', 'full']);

export const overviewWidgetSchema = z.object({
  key: overviewWidgetKeySchema,
  size: overviewWidgetSizeSchema,
});
export type OverviewWidget = z.infer<typeof overviewWidgetSchema>;

export const overviewLayoutSchema = z.object({
  widgets: z.array(overviewWidgetSchema),
  version: z.number().int().nonnegative(),
  customized: z.boolean(),
  updated_at: z.string().nullable(),
});
export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;

export const overviewLayoutUpdateSchema = z.strictObject({
  widgets: z.array(overviewWidgetSchema).min(1).nullable(),
  expected_version: z.number().int().nonnegative(),
});
export type OverviewLayoutUpdate = z.infer<typeof overviewLayoutUpdateSchema>;
