/** The one read catalogue shared by hosted MCP and the in-app Agent. */
import { z } from 'zod';
import { verificationSchema } from '@citeladder/contracts/ai-traffic';
import { analyticsSelectionSchema } from '@citeladder/contracts/mcp-app';
import { performanceDimensionSchema } from '@citeladder/contracts/performance';
import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import type { Database } from '../db/database.ts';
import { plainJson } from '../db/json.ts';
import { PAGE_STATUS_FILTERS } from '../site-health/reads/page-rows.ts';
import { mcpPolicy } from './config.ts';
import {
  authorizeProject,
  listAccountProjects,
  principalForCall,
  searchBusinessContext,
} from './data.ts';
import {
  actionsRead,
  demandSnapshot,
  differentiationRead,
  integrationStatus,
  promptPortfolio,
  searchDataset,
  searchIntelligence,
  shelfRead,
} from './evidence.ts';
import {
  adsRead,
  perceptionRead,
  factChecksRead,
  renderAnalytics,
  sourceUrl,
  visibilityOverview,
  visibilityResults,
  visibilitySources,
  visibilityTrends,
} from './evidence-analytics.ts';
import { crawlability, siteLinks, sitePages, siteSnapshot } from './evidence-site.ts';
import {
  aiTrafficInsights,
  aiTrafficPages,
  aiTrafficUrl,
  crawlLogsRead,
  performanceRead,
  queryEvidence,
  referrals,
} from './evidence-traffic.ts';
import { businessContext, overviewSections } from './context.ts';
import { fetchRecord } from './retrieval.ts';
import { McpInputError, type Evidence, type EvidencePrincipal, type ProjectRead } from './types.ts';

const optional = <T extends z.ZodType>(schema: T) => schema.nullish();
const uuid = z.uuid();
const limit = optional(z.number().int().min(1).max(mcpPolicy.max_list_limit));
const cursor = optional(z.string().describe('The next_cursor a previous page returned.'));
const page = { cursor, limit };
/** A visibility run, named the way every read returns it. */
const run = uuid.describe('A run id (audit_id) that read_visibility_overview returned.');
const crawl_id = optional(
  uuid.describe('A crawl id that read_site_health returned; omit for the latest crawl.'),
);
const project = { project_id: uuid };
const engine = optional(z.enum(policy.visibility.logical_engines));
const cohort = z.enum(['core', 'comparison', 'all']).default('core');
/** A market id from the project context's markets; omitted is the default market. */
const market_id = optional(uuid);
const analyticsRange = optional(z.enum(Object.keys(policy.analytics.preset_range_days)));
const dates = { start_date: optional(z.iso.date()), end_date: optional(z.iso.date()) };
const crawlPage = {
  cursor: optional(z.string()),
  limit: optional(z.number().int().min(1).max(crawlLogs.max_page_size)),
};
const verification = optional(verificationSchema);

type Context = {
  db: Database;
  principal: EvidencePrincipal;
  origin: string;
  maxBytes?: number;
};
type Definition<S extends z.ZodObject> = {
  title: string;
  description: string;
  schema: S;
  read: (context: Context, args: z.output<S>) => Promise<Evidence>;
};
const tool = <S extends z.ZodObject>(definition: Definition<S>) => definition;
type ProjectDefinition<S extends z.ZodObject<{ project_id: typeof uuid }>> = {
  title: string;
  description: string;
  schema: S;
  read: (read: ProjectRead, args: z.output<S>) => Promise<Evidence>;
};
/** The project is authorized on every call, never by its ID alone. */
function projectScoped<S extends z.ZodObject<{ project_id: typeof uuid }>>(
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
/** A project evidence read: unknown availability is a defect, never a silent "available". */
function projectTool<S extends z.ZodObject<{ project_id: typeof uuid }>>(
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

export const definitions = {
  list_projects: tool({
    title: 'List projects',
    description: 'List the projects this connection can read. Start here when no project is known.',
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
    description: `One overview of a project: business profile, competitors, active prompts, latest visibility, top Actions, Site Health and connected data. Pass sections to read fewer; valid sections: ${overviewSections.join(', ')}.`,
    schema: z.strictObject({ ...project, sections: optional(z.array(z.enum(overviewSections))) }),
    read: ({ db, principal, origin }, args) =>
      businessContext(db, principal, args.project_id, origin, args.sections ?? undefined),
  }),
  search: tool({
    title: 'Search',
    description:
      'Find projects, active Actions and prompts by text when you do not know where a record is. Returns matching records with ids; pass one to fetch for the full record.',
    schema: z.strictObject({
      query: z.string().trim().min(1),
      project_id: optional(uuid),
      limit: z
        .number()
        .int()
        .min(1)
        .max(mcpPolicy.max_search_results)
        .default(mcpPolicy.default_search_limit),
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
  read_visibility_overview: projectTool({
    title: 'Read AI visibility',
    description:
      'Mention rate, citation rate, rankings against competitors and run status for the latest or a chosen run. Pass baseline_id to compare two runs. Each market is measured separately: pass market_id for a non-default market, and never pool markets.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: optional(uuid),
      baseline_id: optional(uuid),
      engine,
      cohort,
    }),
    read: visibilityOverview,
  }),
  read_visibility_trends: projectTool({
    title: 'Read visibility trends',
    description:
      'Visibility over time for an explicit window. Points with different comparison keys are not comparable; gaps are missing runs, not zero.',
    schema: z.strictObject({
      ...project,
      market_id,
      from_at: z.iso.datetime({ offset: true }),
      to_at: z.iso.datetime({ offset: true }),
      engine,
      cohort,
      granularity: z.enum(['run', 'day', 'week', 'month']).default('run'),
      transport_model: optional(z.string().trim().min(1)),
      retrieval_enabled: optional(z.boolean()),
    }),
    read: visibilityTrends,
  }),
  read_perception: projectTool({
    title: 'Read answer perception',
    description:
      'How AI answers portray the brand and competitors in the latest or a chosen run: net sentiment (-100 to +100) with its coverage, themes, verified quotes, sources cited alongside criticism and the recommended rate. Always state the coverage; perception_state pending, unavailable or no_mentions means there is no value, never zero. Sources are cited alongside criticism, never its cause.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: optional(uuid),
      engine,
      cohort,
      view: z.enum(['summary', 'quotes']).default('summary'),
      entity: optional(z.string().trim().min(1).max(255)),
      theme: optional(z.enum(policy.perception.themes)),
      polarity: optional(z.enum(['positive', 'negative'])),
      ...page,
    }),
    read: perceptionRead,
  }),
  read_fact_checks: projectTool({
    title: 'Read fact checks',
    description:
      "Factual claims AI answers made about the brand in the latest or a chosen run, checked against the brand's confirmed facts: accuracy (supported of supported plus contradicted) with its coverage, contradicted claims with the fact they contradict, and sources cited alongside them. Always state the coverage and quote the fact. accuracy_state not_enabled, no_facts, no_claims, pending or unavailable means there is no value, never zero; inconclusive and not_covered are not errors in the answer. Sources are cited alongside a contradiction, never its cause.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: optional(uuid),
      engine,
      cohort,
      view: z.enum(['summary', 'claims']).default('summary'),
      topic: optional(z.enum(policy.perception.fact_check.topics)),
      verdict: optional(z.enum(['supported', 'contradicted', 'inconclusive', 'not_covered'])),
      ...page,
    }),
    read: factChecksRead,
  }),
  read_ai_ads: projectTool({
    title: 'Read ads in AI answers',
    description:
      'Paid ads shown in ChatGPT Search answers for the latest or a chosen run: ad presence rate ("N of M ChatGPT answers"), advertisers with share and first/last seen, the ad share and best rank of the brand itself, text creatives (paged) and prompts that surface ads with competitor ads beside organic brand mentions. Only ChatGPT Search shows ads; other engines are not_applicable, never zero. Ads are paid placements: report them separately, never as citations, sources or a cause of visibility.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: optional(uuid),
      engine,
      cohort,
      ...page,
    }),
    read: adsRead,
  }),
  read_visibility_results: projectTool({
    title: 'Read AI answers',
    description:
      'The answers engines gave in one run, with mentions and cited sources, paged. Use it to see what an engine said for a prompt; filter by prompt_id, cited domain or URL to read fewer.',
    schema: z.strictObject({
      ...project,
      audit_id: run,
      engine,
      cohort,
      prompt_id: optional(uuid),
      domain: optional(z.string().trim().min(1).max(253)),
      url: optional(z.url()),
      ...page,
    }),
    read: visibilityResults,
  }),
  read_visibility_sources: projectTool({
    title: 'Read cited sources',
    description:
      'Which domains or URLs engines cited in the latest or a chosen run, how often, and whether you or competitors are listed on them. level is domain (publishers) or url (pages); pass domain for its pages. Use it to find the sources to earn a place on.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: optional(run.describe('A run id (audit_id); omit for the latest run.')),
      engine,
      cohort,
      level: z.enum(['domain', 'url']).default('domain'),
      domain: optional(z.string().trim().min(1).max(253)),
      ...page,
    }),
    read: visibilitySources,
  }),
  read_source_url: projectTool({
    title: 'Read a cited page',
    description:
      'One cited URL: the prompts and engines that cite it, the brands it lists and whether your brand is on it. Omit audit_id for every run.',
    schema: z.strictObject({
      ...project,
      market_id,
      url: z.string().trim().min(1).max(8192),
      audit_id: optional(uuid),
      engine,
      cohort,
    }),
    read: sourceUrl,
  }),
  read_prompt_portfolio: projectTool({
    title: 'Read prompts',
    description:
      'The tracked prompts with topic, intent and status. Core prompts are scored; comparison prompts are reported separately.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: optional(uuid),
      cohort: optional(z.enum(['core', 'comparison'])),
      active_only: z.boolean().default(false),
      ...page,
    }),
    read: promptPortfolio,
  }),
  read_actions: projectTool({
    title: 'Read Actions',
    description:
      'The prioritized Actions to improve visibility, with status. Pass action_id for one Action with its findings, remediation and measured outcome.',
    schema: z.strictObject({
      ...project,
      action_id: optional(uuid),
      status: optional(z.enum(policy.opportunity.actions.ACTION_STATUSES)),
      ...page,
    }),
    read: actionsRead,
  }),
  read_content_differentiation: projectTool({
    title: 'Read content comparisons',
    description:
      'How cited competitor pages differ from yours on the topics they win, from pages CiteLadder has already read. Use it before rewriting a page to compete.',
    schema: z.strictObject(project),
    read: differentiationRead,
  }),
  read_ai_shelf: projectTool({
    title: 'Read the AI Shelf',
    description:
      'Product recommendations in AI answers. Without a target, lists categories and products; with one, its visibility, share of shelf and who holds the shelf.',
    schema: z.strictObject({
      ...project,
      target_kind: optional(z.enum(['category', 'product'])),
      target_id: optional(uuid),
    }),
    read: shelfRead,
  }),
  read_site_health: projectTool({
    title: 'Read Site Health',
    description:
      'Site Health scores, coverage and top issues for the latest crawl, or a chosen snapshot_id.',
    schema: z.strictObject({ ...project, snapshot_id: optional(uuid) }),
    read: siteSnapshot,
  }),
  read_site_pages: projectTool({
    title: 'Read site pages',
    description:
      "Pages from a crawl, paged: URL, title, page type, status, scores, issue count and the rule ids of each page's issues by finding class. Pass rule_id (from read_site_health top_issues or an issue group) to list exactly the pages affected by that issue; filter by page_kind or status to find pages by type or status. read_site_health gives the totals.",
    schema: z.strictObject({
      ...project,
      crawl_id,
      rule_id: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe('A Site Health rule_id; returns only the pages with a current issue of it.'),
      ),
      page_kind: optional(z.enum(policy.site_health.page_analysis.classification.page_kinds)),
      status: optional(z.enum(PAGE_STATUS_FILTERS)),
      ...page,
    }),
    read: sitePages,
  }),
  read_site_links: projectTool({
    title: 'Read internal links',
    description:
      'Internal link counts per page for a crawl, with sampled linking and linked pages and anchor diagnostics. Pass site_url_ids (from read_site_pages) to read several pages in one call.',
    schema: z.strictObject({
      ...project,
      crawl_id,
      site_url_ids: optional(z.array(uuid).min(1).max(mcpPolicy.max_link_pages)),
      ...page,
    }),
    read: siteLinks,
  }),
  read_ai_crawlability: projectTool({
    title: 'Read AI crawler access',
    description:
      'Whether robots.txt lets each AI crawler in, for the latest or a chosen crawl. Permission, not observed visits.',
    schema: z.strictObject({ ...project, crawl_id }),
    read: crawlability,
  }),
  read_crawl_logs: projectTool({
    title: 'Read AI crawler visits',
    description:
      'AI crawler requests from server logs: summary, per crawler, log coverage, or individual requests (view requests). Missing coverage is not zero.',
    schema: z.strictObject({
      ...project,
      view: z.enum(['summary', 'crawlers', 'coverage', 'requests']).default('summary'),
      range: analyticsRange,
      ...dates,
      verification,
      bot_id: optional(z.string()),
      status: optional(z.int().min(100).max(599)),
      folder: optional(z.string().max(2048)),
      resource_class: optional(z.string().max(24)),
      ...crawlPage,
    }),
    read: crawlLogsRead,
  }),
  read_ai_traffic_pages: projectTool({
    title: 'Read AI traffic by page',
    description:
      'Per page: AI crawler requests, AI referral sessions, citations and Site Health findings, each with its own coverage.',
    schema: z.strictObject({
      ...project,
      range: analyticsRange,
      ...dates,
      folder: optional(z.string().max(2048)),
      resource_class: optional(z.string().max(24)),
      verification,
      sort: optional(
        z.enum(['requests_desc', 'sessions_desc', 'key_events_desc', 'citations_desc', 'url_asc']),
      ),
      ...crawlPage,
    }),
    read: aiTrafficPages,
  }),
  read_ai_traffic_url: projectTool({
    title: 'Read AI traffic for a URL',
    description:
      'The AI crawler and referral timeline of one page on the project site, for a range. Use it after read_ai_traffic_pages names the page.',
    schema: z.strictObject({
      ...project,
      url: z.string().trim().min(1).max(4096),
      range: analyticsRange,
      ...dates,
    }),
    read: aiTrafficUrl,
  }),
  read_ai_traffic_insights: projectTool({
    title: 'Read AI traffic insights',
    description:
      'Patterns across AI crawler, referral and citation data. Co-occurrence, not cause.',
    schema: z.strictObject({ ...project, range: analyticsRange, ...dates }),
    read: aiTrafficInsights,
  }),
  read_ai_referrals: projectTool({
    title: 'Read AI referral traffic',
    description:
      'Visits from AI assistants (GA4): sessions, share of traffic, key events, landing pages.',
    schema: z.strictObject({ ...project, range: analyticsRange, ...dates }),
    read: referrals,
  }),
  read_performance: projectTool({
    title: 'Read search performance',
    description: `Search Console and GA4 totals for a range with an optional comparison. range is one of ${policy.traffic.PERFORMANCE_RANGES.join(', ')} (default ${policy.traffic.PERFORMANCE_DEFAULT_RANGE}); custom needs start_date and end_date. Pass dimension for a breakdown by query, page, country, device or day. not_connected means no search data source is connected, which is not zero.`,
    schema: z.strictObject({
      ...project,
      range: optional(z.enum(policy.traffic.PERFORMANCE_RANGES)),
      ...dates,
      granularity: optional(z.enum(policy.traffic.TRAFFIC_SNAPSHOT_GRANULARITIES)),
      compare: optional(z.enum(policy.traffic.PERFORMANCE_COMPARE_MODES)),
      compare_start_date: optional(z.iso.date()),
      compare_end_date: optional(z.iso.date()),
      dimension: optional(performanceDimensionSchema),
      sort: optional(z.string()),
      cursor: optional(z.string()),
      limit: optional(z.literal(policy.traffic.PERFORMANCE_PAGE_SIZE_OPTIONS)),
    }),
    read: performanceRead,
  }),
  read_query_evidence: projectTool({
    title: 'Read queries by page',
    description:
      'Search Console queries matched to site pages for an exact saved window (inclusive dates).',
    schema: z.strictObject({
      ...project,
      window_start: z.iso.date(),
      window_end: z.iso.date(),
      query: optional(z.string()),
      site_url_id: optional(uuid),
      resolution_outcome: optional(z.string()),
      ...page,
    }),
    read: queryEvidence,
  }),
  read_demand: projectTool({
    title: 'Read search demand',
    description:
      'Latest search demand: what people search for in this market, with volumes and how they changed. Volumes are provider estimates.',
    schema: z.strictObject(project),
    read: demandSnapshot,
  }),
  read_integration_status: projectTool({
    title: 'Read connected data',
    description:
      'Which data sources (Search Console, GA4, server logs) are connected and how far their import has got. Read it when a traffic or search read is unavailable, before reading it again.',
    schema: z.strictObject(project),
    read: integrationStatus,
  }),
  read_search_intelligence: projectTool({
    title: 'Read keyword and backlink research',
    description:
      'The keyword, competitor and backlink datasets researched for this project, with their ids. Pass a dataset_id to read_search_dataset for its rows.',
    schema: z.strictObject(project),
    read: searchIntelligence,
  }),
  read_search_dataset: projectTool({
    title: 'Read a research dataset',
    description:
      'Rows of one keyword or backlink dataset. Referring-domain and page totals are aggregates, not individual links.',
    schema: z.strictObject({
      ...project,
      dataset_id: uuid,
      sort: optional(z.string()),
      direction: z.enum(['asc', 'desc']).default('asc'),
      ...page,
    }),
    read: searchDataset,
  }),
  render_visibility: projectScoped({
    title: 'Show AI visibility',
    description:
      'Show an interactive visibility view: overview, trends over a window, or cited sources for one run.',
    schema: analyticsSelectionSchema.extend({
      view: z.enum(['overview', 'trends', 'sources']).default('overview'),
    }),
    read: ({ db, scope, origin }, args) => renderAnalytics(db, scope, args, origin),
  }),
  render_site_health: projectScoped({
    title: 'Show Site Health',
    description: 'Show an interactive Site Health view for the latest or a chosen snapshot.',
    schema: z.strictObject({ ...project, snapshot_id: optional(uuid) }),
    read: ({ db, scope, origin }, args) =>
      renderAnalytics(
        db,
        scope,
        analyticsSelectionSchema.parse({ ...args, view: 'site_health' }),
        origin,
      ),
  }),
  open_analytics: tool({
    title: 'Open CiteLadder',
    description: 'Open the CiteLadder project picker.',
    schema: z.strictObject({}),
    read: ({ origin }) =>
      Promise.resolve({
        surface: 'citeladder_analytics',
        selection: null,
        evidence: {},
        links: { application: origin, onboarding: `${origin}/onboarding` },
      }),
  }),
};
type ToolName = keyof typeof definitions;
export const presentationTools: ReadonlySet<string> = new Set<ToolName>([
  'render_visibility',
  'render_site_health',
  'open_analytics',
]);

/**
 * JSON Schema without the noise models pay for: no $schema, patterns a format
 * already names, safe-integer bounds or null branches.
 */
const FORMATS = new Set(['uuid', 'date', 'date-time']);
function compact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compact);
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      key === '$schema' ||
      (key === 'pattern' && FORMATS.has(String(source.format))) ||
      (['minimum', 'maximum'].includes(key) && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER)
    )
      continue;
    out[key] = compact(value);
  }
  const options = out.anyOf;
  if (Array.isArray(options) && Object.keys(out).length === 1) {
    const kept = options.filter(
      (option) =>
        !(option && typeof option === 'object' && 'type' in option && option.type === 'null'),
    );
    if (kept.length === 1) return kept[0];
  }
  return out;
}
export function inputSchema(schema: z.ZodType) {
  return compact(z.toJSONSchema(schema, { io: 'input' }));
}
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const tools = Object.entries(definitions).map(([name, definition]) => ({
  name,
  title: definition.title,
  description: definition.description,
  inputSchema: inputSchema(definition.schema),
  annotations,
}));

const output = z.record(z.string(), z.json());
function isToolName(name: string): name is ToolName {
  return Object.hasOwn(definitions, name);
}
/** Names each invalid field so the model can correct its call. */
export function argumentProblem(error: z.ZodError) {
  return `Invalid arguments: ${error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ')}`;
}

export async function dispatchTool(
  db: Database,
  principal: EvidencePrincipal,
  name: string,
  input: unknown,
  origin: string,
  maxBytes?: number,
): Promise<Evidence> {
  if (!isToolName(name)) throw new McpInputError(`Unknown tool: ${name}`);
  const definition: Definition<z.ZodObject> = definitions[name];
  const parsed = definition.schema.safeParse(input);
  if (!parsed.success) throw new McpInputError(argumentProblem(parsed.error));
  const call = principalForCall(principal);
  const result = await definition.read({ db, principal: call, origin, maxBytes }, parsed.data);
  // Dates serialize as ISO instants; an invalid persisted projection fails here.
  return output.parse(plainJson(result));
}
