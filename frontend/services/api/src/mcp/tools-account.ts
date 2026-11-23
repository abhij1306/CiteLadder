import { z } from 'zod';
import { mcpPolicy } from './config.ts';
import { listAccountProjects, searchBusinessContext } from './data.ts';
import { businessContext, overviewSections } from './context.ts';
import { fetchRecord } from './retrieval.ts';
import { optional, uuid, page, project, tool } from './tool-definitions.ts';

export const accountTools = {
  list_projects: tool({
    title: 'List projects',
    description:
      'List the projects this connection can read. Start here when no project is known: every other project tool needs the id it returns. Each project has its id, name, brand, website, industry, primary market and the workspace it belongs to. Projects come oldest first, 50 per page by default; pass next_cursor for more. An empty list means no workspace was approved for this connection. To find a project by name use search; for one project in depth use get_project_business_context.',
    schema: z.strictObject(page),
    read: ({ db, principal }, args) =>
      listAccountProjects(
        db,
        principal,
        args.limit ?? mcpPolicy.default_list_limit,
        args.cursor ?? null,
      ),
  }),
  get_project_business_context: tool({
    title: 'Get project overview',
    description:
      "Read one overview of a project in a single call: its identity and markets (with the market ids other tools take), then a short summary per section: business profile with owned domains and tracked competitors, latest visibility, the top 10 Actions, active prompts, Site Health, AI crawler access, demand, search performance, AI referrals, crawler logs, connected data and keyword research. Use it first to orient yourself, then the matching read_* tool for depth or paging (each section is that tool's default read). Omit sections for all of them; pass a few to keep the response small. A section can be unavailable on its own, such as visibility with no completed run (no_completed_run) or with the latest run's results still being written (metrics_pending, try again later).",
    schema: z.strictObject({
      ...project,
      sections: optional(
        z
          .array(z.enum(overviewSections))
          .describe(
            'The sections to read; omit for all. profile also returns owned domains and competitors.',
          ),
      ),
    }),
    read: ({ db, principal, origin }, args) =>
      businessContext(db, principal, args.project_id, origin, args.sections ?? undefined),
  }),
  search: tool({
    title: 'Search',
    description:
      'Find projects, Actions (every status, open and in-progress first; each result states its status) and prompts by text when you do not know where a record is. Returns matching records with ids; pass one to fetch for the full record.',
    schema: z.strictObject({
      query: z.string().trim().min(1).describe('Words to look for, such as a prompt or brand.'),
      project_id: optional(uuid.describe('Search one project only; omit to search every project.')),
      limit: z
        .number()
        .int()
        .min(1)
        .max(mcpPolicy.max_search_results)
        .default(mcpPolicy.default_search_limit)
        .describe('How many matches to return.'),
    }),
    read: ({ db, principal, origin }, args) =>
      searchBusinessContext(db, principal, args.query, args.project_id ?? null, args.limit, origin),
  }),
  fetch: tool({
    title: 'Fetch a record',
    description:
      'Read one full record (an answer, Action, prompt or page) by the citeladder:// id another read returned. Never construct an id.',
    schema: z.strictObject({
      id: z.string().describe('A citeladder:// id exactly as a read returned it.'),
    }),
    read: ({ db, principal, origin, maxBytes }, args) =>
      fetchRecord(db, principal, args.id, origin, maxBytes),
  }),
};
