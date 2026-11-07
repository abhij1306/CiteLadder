import { z } from 'zod';
import { actionItemSchema } from './actions.ts';
import {
  visibilityExecutionEvidenceSchema,
  visibilitySourcesSchema,
} from './visibility-evidence.ts';

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

// ---------------------------------------------------------------------------
// The MCP read-tool results the App renders. Each lists the fields the App
// reads; the tools return more, for the model.
// ---------------------------------------------------------------------------

const nextCursor = z.object({ next_cursor: z.string().nullable() });

/** A read whose evidence does not exist yet: never zero. */
export const mcpUnavailableSchema = z.object({
  state: z.literal('unavailable'),
  reason: z.string(),
});

/** `list_projects`. */
export const mcpProjectsSchema = z.object({
  projects: z.array(z.object({ id: z.uuid(), name: z.string(), workspace_name: z.string() })),
  pagination: nextCursor,
});

/** `read_visibility_sources`, available. */
export const mcpVisibilitySourcesSchema = z.object({
  state: z.literal('available'),
  items: z.array(
    visibilitySourcesSchema.shape.items.element.pick({
      key: true,
      responses: true,
      annotations: true,
      citation_rate: true,
      citation_share: true,
    }),
  ),
  coverage: z.object({ responses: z.number(), prompts: z.number(), citations: z.number() }),
  pagination: nextCursor,
});
export type McpVisibilitySources = z.input<typeof mcpVisibilitySourcesSchema>;

/** One answer `read_visibility_results` lists, with the id `fetch` resolves. */
const mcpVisibilityResultSchema = visibilityExecutionEvidenceSchema
  .pick({ task_id: true, prompt_text: true, logical_engine: true, completed_at: true })
  .extend({ record_uri: z.string() });
export type McpVisibilityResult = z.infer<typeof mcpVisibilityResultSchema>;

/** `read_visibility_results`, available. */
export const mcpVisibilityResultsSchema = z.object({
  state: z.literal('available'),
  items: z.array(mcpVisibilityResultSchema),
});
export type McpVisibilityResults = z.input<typeof mcpVisibilityResultsSchema>;

/** `fetch`: one record as document text. */
export const mcpFetchedRecordSchema = z.object({ text: z.string() });

/** `read_site_health`, available. */
export const mcpSiteSnapshotSchema = z.object({
  state: z.literal('available'),
  snapshot_id: z.string(),
  crawl_id: z.string(),
  observed_at: z.string(),
  scores: z.object({
    web_fundamentals: z.number().nullable(),
    aeo_readiness: z.number().nullable(),
    aeo_measurement_coverage: z.number().nullable(),
  }),
  coverage: z.object({ selected_urls: z.number(), analyzed_urls: z.number() }),
  measurement_states: z.record(z.string(), z.string()),
  versions: z.record(z.string(), z.string().nullable()),
});
export type McpSiteSnapshot = z.input<typeof mcpSiteSnapshotSchema>;

/** `read_site_pages`: the crawl's pages, one page of them. */
export const mcpSitePagesSchema = z.object({
  items: z.array(
    z.object({ site_url_id: z.string(), url: z.string(), title: z.string().nullable() }),
  ),
});
export type McpSitePages = z.input<typeof mcpSitePagesSchema>;
export type McpSitePage = z.infer<typeof mcpSitePagesSchema>['items'][number];

/** `read_actions` without an Action id. */
export const mcpActionsSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    items: z.array(
      actionItemSchema.pick({
        id: true,
        target_label: true,
        target_url: true,
        approach: true,
        status: true,
      }),
    ),
  }),
  mcpUnavailableSchema,
]);
export type McpActions = z.infer<typeof mcpActionsSchema>;
