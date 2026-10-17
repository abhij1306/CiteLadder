import { z } from 'zod';

export const analyticsSelectionSchema = z.strictObject({
  project_id: z.uuid(),
  view: z.enum(['overview', 'trends', 'sources', 'site_health']).default('overview'),
  audit_id: z.uuid().nullish(),
  snapshot_id: z.uuid().nullish(),
  engine: z.string().trim().min(1).nullish(),
  cohort: z.enum(['core', 'comparison', 'all']).default('core'),
  from_at: z.iso.datetime({ offset: true }).nullish(),
  to_at: z.iso.datetime({ offset: true }).nullish(),
  transport_model: z.string().trim().min(1).nullish(),
  retrieval_enabled: z.boolean().nullish(),
  competitor: z.string().trim().min(1).max(200).nullish(),
  level: z.enum(['domain', 'url']).default('domain'),
  domain: z.string().trim().min(1).max(253).nullish(),
  cursor: z.string().max(8192).nullish(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type AnalyticsSelection = z.infer<typeof analyticsSelectionSchema>;

const applicationUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});

export const analyticsResultSchema = z.object({
  surface: z.literal('citeladder_analytics'),
  selection: analyticsSelectionSchema.nullable(),
  evidence: z.record(z.string(), z.json()),
  links: z.object({ application: applicationUrl, onboarding: applicationUrl }),
});
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;
