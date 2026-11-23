import { z } from 'zod';
import { verificationSchema } from '@citeladder/contracts/ai-traffic';
import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { logicalEngines } from '../config/providers.ts';
import type { Database } from '../db/database.ts';
import { mcpPolicy } from './config.ts';
import { authorizeProject } from './data.ts';
import { type Evidence, type EvidencePrincipal, type ProjectRead } from './types.ts';

export const optional = <T extends z.ZodType>(schema: T) => schema.nullish();
export const uuid = z.uuid();
const pageSize = 'How many rows to return; omit for the default page size.';
const limit = optional(z.number().int().min(1).max(mcpPolicy.max_list_limit).describe(pageSize));
export const cursor = optional(z.string().describe('The next_cursor a previous page returned.'));
export const page = { cursor, limit };
export const run = uuid.describe('A run id (audit_id) that read_visibility_overview returned.');
export const latestRun = optional(run.describe('A run id (audit_id); omit for the latest run.'));
export const snapshot_id = optional(
  uuid.describe(
    'A Site Health snapshot id, or the crawl id it was built from; omit for the latest crawl.',
  ),
);
export const crawl_id = optional(
  uuid.describe('A crawl id that read_site_health returned; omit for the latest crawl.'),
);
export const project = { project_id: uuid.describe('A project id that list_projects returned.') };
export const engine = optional(
  z.enum(logicalEngines).describe('Read one engine only; omit for every engine.'),
);
export const cohort = z
  .enum(['core', 'comparison', 'all'])
  .default('core')
  .describe(
    'core is the scored prompts (the default); comparison is the prompts that also name a competitor, reported separately; all is both.',
  );
export const market_id = optional(
  uuid.describe(
    'A market id from get_project_business_context; omit for the default market. Markets are never pooled.',
  ),
);
export const topic_id = optional(
  uuid.describe(
    'A topic id from read_prompt_portfolio; keep only answers to prompts filed under it when their run was measured. unavailable topic_not_measured means the run asked no prompt in it.',
  ),
);
export const prompt_id = optional(
  uuid.describe('A prompt id from read_prompt_portfolio or read_prompt_metrics.'),
);
export const analyticsRange = optional(
  z
    .enum(Object.keys(policy.analytics.preset_range_days))
    .describe('A preset window ending today; or pass start_date and end_date instead.'),
);
export const dates = {
  start_date: optional(z.iso.date().describe('First day of a custom window, inclusive.')),
  end_date: optional(z.iso.date().describe('Last day of a custom window, inclusive.')),
};
export const crawlPage = {
  cursor,
  limit: optional(z.number().int().min(1).max(crawlLogs.max_page_size).describe(pageSize)),
};
export const verification = optional(
  verificationSchema.describe(
    'Keep only crawler requests whose claimed identity was verified, could not be verified, or failed verification.',
  ),
);
export const folder = optional(
  z.string().max(2048).describe('A site path prefix such as /blog/ to read only pages under it.'),
);
export const resource_class = optional(
  z
    .string()
    .max(24)
    .describe('A resource_class a previous row returned, such as page, to read only that kind.'),
);
export const url_filter = optional(z.url().describe('Keep only answers that cite this exact URL.'));
export const domain_filter = optional(
  z
    .string()
    .trim()
    .min(1)
    .max(253)
    .describe('A domain such as example.com; keep only rows citing it.'),
);

type Context = {
  db: Database;
  principal: EvidencePrincipal;
  origin: string;
  maxBytes?: number;
};
export type Definition<S extends z.ZodObject> = {
  title: string;
  description: string;
  schema: S;
  read: (context: Context, args: z.output<S>) => Promise<Evidence>;
};
export const tool = <S extends z.ZodObject>(definition: Definition<S>) => definition;
type ProjectDefinition<S extends z.ZodObject<{ project_id: typeof uuid }>> = {
  title: string;
  description: string;
  schema: S;
  read: (read: ProjectRead, args: z.output<S>) => Promise<Evidence>;
};
export function projectScoped<S extends z.ZodObject<{ project_id: typeof uuid }>>(
  definition: ProjectDefinition<S>,
): Definition<S> {
  return {
    ...definition,
    read: async ({ db, principal, origin }, args) => {
      const row = await authorizeProject(db, principal, args.project_id);
      return definition.read(
        { db, origin, scope: { workspaceId: row.workspace_id, projectId: row.id } },
        args,
      );
    },
  };
}
export function projectTool<S extends z.ZodObject<{ project_id: typeof uuid }>>(
  definition: ProjectDefinition<S>,
): Definition<S> {
  return projectScoped({
    ...definition,
    read: async (read, args) => {
      const evidence = await definition.read(read, args);
      if (typeof evidence.state !== 'string') throw new Error('Project read returned no state');
      return evidence;
    },
  });
}
