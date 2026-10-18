import { z } from 'zod';

export const analyticsSelectionSchema = z.strictObject({
  project_id: z.uuid().describe('A project id that list_projects returned.'),
  view: z.enum(['overview', 'trends', 'sources', 'site_health']).default('overview'),
  audit_id: z
    .uuid()
    .describe('Overview or sources: a run id (audit_id); omit for the latest run.')
    .nullish(),
  snapshot_id: z
    .uuid()
    .describe('Site Health only: a snapshot id; omit for the latest crawl.')
    .nullish(),
  engine: z
    .string()
    .trim()
    .min(1)
    .describe('Show one engine only, such as chatgpt; omit for every engine.')
    .nullish(),
  cohort: z
    .enum(['core', 'comparison', 'all'])
    .default('core')
    .describe('core is the scored prompts (the default); comparison is reported separately.'),
  from_at: z.iso
    .datetime({ offset: true })
    .describe('Trends only, required there: start of the window.')
    .nullish(),
  to_at: z.iso
    .datetime({ offset: true })
    .describe('Trends only, required there: end of the window.')
    .nullish(),
  transport_model: z
    .string()
    .trim()
    .min(1)
    .describe('Trends only: keep only runs answered by this model.')
    .nullish(),
  retrieval_enabled: z
    .boolean()
    .describe('Trends only: true keeps runs with web search on, false runs without it.')
    .nullish(),
  competitor: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Overview or trends: a competitor exactly as the rankings name it, to highlight.')
    .nullish(),
  level: z
    .enum(['domain', 'url'])
    .default('domain')
    .describe('Sources only: domain lists publishers (the default); url lists pages.'),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .describe('Sources only: a cited domain such as example.com, to list its pages.')
    .nullish(),
  cursor: z
    .string()
    .max(8192)
    .describe('Sources only: the next_cursor a previous page returned.')
    .nullish(),
  limit: z.number().int().min(1).max(200).default(50).describe('Sources only: rows per page.'),
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
