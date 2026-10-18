/** The one read catalogue shared by hosted MCP and the in-app Agent. */
import { z } from 'zod';
import { verificationSchema } from '@citeladder/contracts/ai-traffic';
import { analyticsSelectionSchema } from '@citeladder/contracts/mcp-app';
import { performanceDimensionSchema } from '@citeladder/contracts/performance';
import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import type { Database } from '../db/database.ts';
import { plainJson } from '../db/json.ts';
import { resolutionOutcome } from '../routes/demand-contracts.ts';
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
const pageSize = 'How many rows to return; omit for the default page size.';
const limit = optional(z.number().int().min(1).max(mcpPolicy.max_list_limit).describe(pageSize));
const cursor = optional(z.string().describe('The next_cursor a previous page returned.'));
const page = { cursor, limit };
/** A visibility run, named the way every read returns it. */
const run = uuid.describe('A run id (audit_id) that read_visibility_overview returned.');
const latestRun = optional(run.describe('A run id (audit_id); omit for the latest run.'));
const snapshot_id = optional(
  uuid.describe('A Site Health snapshot id; omit for the latest crawl.'),
);
const crawl_id = optional(
  uuid.describe('A crawl id that read_site_health returned; omit for the latest crawl.'),
);
const project = { project_id: uuid.describe('A project id that list_projects returned.') };
const engine = optional(
  z
    .enum(policy.visibility.logical_engines)
    .describe('Read one engine only; omit for every engine.'),
);
const cohort = z
  .enum(['core', 'comparison', 'all'])
  .default('core')
  .describe(
    'core is the scored prompts (the default); comparison is the prompts that also name a competitor, reported separately; all is both.',
  );
/** A market id from the project context's markets; omitted is the default market. */
const market_id = optional(
  uuid.describe(
    'A market id from get_project_business_context; omit for the default market. Markets are never pooled.',
  ),
);
const analyticsRange = optional(
  z
    .enum(Object.keys(policy.analytics.preset_range_days))
    .describe('A preset window ending today; or pass start_date and end_date instead.'),
);
const dates = {
  start_date: optional(z.iso.date().describe('First day of a custom window, inclusive.')),
  end_date: optional(z.iso.date().describe('Last day of a custom window, inclusive.')),
};
const crawlPage = {
  cursor,
  limit: optional(z.number().int().min(1).max(crawlLogs.max_page_size).describe(pageSize)),
};
const verification = optional(
  verificationSchema.describe(
    'Keep only crawler requests whose claimed identity was verified, could not be verified, or failed verification.',
  ),
);
const folder = optional(
  z.string().max(2048).describe('A site path prefix such as /blog/ to read only pages under it.'),
);
const resource_class = optional(
  z
    .string()
    .max(24)
    .describe('A resource_class a previous row returned, such as page, to read only that kind.'),
);
const url_filter = optional(z.url().describe('Keep only answers that cite this exact URL.'));
const domain_filter = optional(
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
    schema: z.strictObject({
      ...project,
      sections: optional(
        z.array(z.enum(overviewSections)).describe('The sections to read; omit for all of them.'),
      ),
    }),
    read: ({ db, principal, origin }, args) =>
      businessContext(db, principal, args.project_id, origin, args.sections ?? undefined),
  }),
  search: tool({
    title: 'Search',
    description:
      'Find projects, active Actions and prompts by text when you do not know where a record is. Returns matching records with ids; pass one to fetch for the full record.',
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
  read_visibility_overview: projectTool({
    title: 'Read AI visibility',
    description:
      'Mention rate, citation rate, rankings against competitors and run status for the latest or a chosen run. Pass baseline_id to compare two runs. Each market is measured separately: pass market_id for a non-default market, and never pool markets.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      baseline_id: optional(
        uuid.describe('An earlier run id (audit_id) to compare audit_id against.'),
      ),
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
      from_at: z.iso.datetime({ offset: true }).describe('Start of the window, with an offset.'),
      to_at: z.iso.datetime({ offset: true }).describe('End of the window, with an offset.'),
      engine,
      cohort,
      granularity: z
        .enum(['run', 'day', 'week', 'month'])
        .default('run')
        .describe('One point per run (the default), or per day, week or month.'),
      transport_model: optional(
        z
          .string()
          .trim()
          .min(1)
          .describe('Keep only runs answered by this model, as a previous point named it.'),
      ),
      retrieval_enabled: optional(
        z
          .boolean()
          .describe('true keeps only runs with web search on; false only runs without it.'),
      ),
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
      audit_id: latestRun,
      engine,
      cohort,
      view: z
        .enum(['summary', 'quotes'])
        .default('summary')
        .describe(
          'summary is sentiment and themes per brand; quotes lists the verified quotes, paged.',
        ),
      entity: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('With view quotes: a brand exactly as the summary names it, to quote only it.'),
      ),
      theme: optional(
        z
          .enum(policy.perception.themes)
          .describe('With view quotes: keep only quotes about this theme.'),
      ),
      polarity: optional(
        z
          .enum(['positive', 'negative'])
          .describe('With view quotes: keep only praise or only criticism.'),
      ),
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
      audit_id: latestRun,
      engine,
      cohort,
      view: z
        .enum(['summary', 'claims'])
        .default('summary')
        .describe('summary is accuracy and its coverage; claims lists the checked claims, paged.'),
      topic: optional(
        z
          .enum(policy.perception.fact_check.topics)
          .describe('With view claims: keep only claims about this kind of fact.'),
      ),
      verdict: optional(
        z
          .enum(['supported', 'contradicted', 'inconclusive', 'not_covered'])
          .describe('With view claims: keep only this verdict; contradicted finds the errors.'),
      ),
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
      audit_id: latestRun,
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
      prompt_id: optional(
        uuid.describe('A prompt id from read_prompt_portfolio; keep only its answers.'),
      ),
      domain: domain_filter,
      url: url_filter,
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
      audit_id: latestRun,
      engine,
      cohort,
      level: z
        .enum(['domain', 'url'])
        .default('domain')
        .describe('domain counts publishers (the default); url counts individual pages.'),
      domain: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(253)
          .describe('A cited domain such as example.com; with level url, lists its pages.'),
      ),
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
      url: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .describe('A cited URL exactly as read_visibility_sources or an answer listed it.'),
      audit_id: optional(uuid.describe('A run id (audit_id); omit for every run.')),
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
      prompt_set_id: optional(
        uuid.describe('Read one prompt set only; omit for every set in the project.'),
      ),
      cohort: optional(
        z.enum(['core', 'comparison']).describe('Keep only scored or only comparison prompts.'),
      ),
      active_only: z
        .boolean()
        .default(false)
        .describe('true keeps only the prompts audits measure now.'),
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
      action_id: optional(
        uuid.describe('An Action id from a previous list, to read that one Action in full.'),
      ),
      status: optional(
        z
          .enum(policy.opportunity.actions.ACTION_STATUSES)
          .describe('Keep only Actions with this status.'),
      ),
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
      target_kind: optional(
        z.enum(['category', 'product']).describe('Whether target_id is a category or a product.'),
      ),
      target_id: optional(
        uuid.describe('A category or product id from the list this tool returns without one.'),
      ),
    }),
    read: shelfRead,
  }),
  read_site_health: projectTool({
    title: 'Read Site Health',
    description:
      'Site Health scores, coverage and top issues for the latest crawl, or a chosen snapshot_id.',
    schema: z.strictObject({ ...project, snapshot_id }),
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
      page_kind: optional(
        z
          .enum(policy.site_health.page_analysis.classification.page_kinds)
          .describe('Keep only pages of this type.'),
      ),
      status: optional(z.enum(PAGE_STATUS_FILTERS).describe('Keep only pages in this state.')),
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
      site_url_ids: optional(
        z
          .array(uuid)
          .min(1)
          .max(mcpPolicy.max_link_pages)
          .describe(
            'Page ids (site_url_id) from read_site_pages; omit to page through every page.',
          ),
      ),
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
      view: z
        .enum(['summary', 'crawlers', 'coverage', 'requests'])
        .default('summary')
        .describe(
          'summary is totals; crawlers is one row per AI crawler; coverage is how complete each day of logs is; requests lists individual requests, paged.',
        ),
      range: analyticsRange,
      ...dates,
      verification,
      bot_id: optional(
        z.string().describe('A bot_id the crawlers view returned; keep only that crawler.'),
      ),
      status: optional(
        z
          .int()
          .min(100)
          .max(599)
          .describe('An HTTP status code; keep only requests answered with it.'),
      ),
      folder,
      resource_class,
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
      folder,
      resource_class,
      verification,
      sort: optional(
        z
          .enum(['requests_desc', 'sessions_desc', 'key_events_desc', 'citations_desc', 'url_asc'])
          .describe('Row order; omit for the default.'),
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
      url: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .describe('A page URL on the project site, as read_ai_traffic_pages listed it.'),
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
      'Visits that arrived from AI assistants such as ChatGPT, from GA4: sessions, share of all traffic, key events and top landing pages for a range. These are people clicking through; read_crawl_logs has crawler requests. An unavailable state means no referral data has been imported, which is not zero; read_integration_status says why.',
    schema: z.strictObject({ ...project, range: analyticsRange, ...dates }),
    read: referrals,
  }),
  read_performance: projectTool({
    title: 'Read search performance',
    description: `Search Console and GA4 totals for a range with an optional comparison. range is one of ${policy.traffic.PERFORMANCE_RANGES.join(', ')} (default ${policy.traffic.PERFORMANCE_DEFAULT_RANGE}); custom needs start_date and end_date. Pass dimension for a breakdown by query, page, country, device or day. not_connected means no search data source is connected, which is not zero.`,
    schema: z.strictObject({
      ...project,
      range: optional(z.enum(policy.traffic.PERFORMANCE_RANGES).describe('The reporting window.')),
      ...dates,
      granularity: optional(
        z
          .enum(policy.traffic.TRAFFIC_SNAPSHOT_GRANULARITIES)
          .describe('The bucket size of the totals over time.'),
      ),
      compare: optional(
        z
          .enum(policy.traffic.PERFORMANCE_COMPARE_MODES)
          .describe('The window to compare against; custom needs the compare dates.'),
      ),
      compare_start_date: optional(
        z.iso.date().describe('First day of a custom comparison window, inclusive.'),
      ),
      compare_end_date: optional(
        z.iso.date().describe('Last day of a custom comparison window, inclusive.'),
      ),
      dimension: optional(
        performanceDimensionSchema.describe('Break the totals down by this dimension, paged.'),
      ),
      sort: optional(
        z
          .string()
          .describe(
            `With dimension: one of ${policy.traffic.PERFORMANCE_SORT_WHITELIST.join(', ')}; prefix - for descending, such as -clicks.`,
          ),
      ),
      cursor,
      limit: optional(
        z
          .literal(policy.traffic.PERFORMANCE_PAGE_SIZE_OPTIONS)
          .describe('With dimension: rows per page.'),
      ),
    }),
    read: performanceRead,
  }),
  read_query_evidence: projectTool({
    title: 'Read queries by page',
    description:
      'Search Console queries matched to site pages for an exact saved window (inclusive dates).',
    schema: z.strictObject({
      ...project,
      window_start: z.iso.date().describe('First day of the saved window, inclusive.'),
      window_end: z.iso.date().describe('Last day of the saved window, inclusive.'),
      query: optional(
        z.string().describe('One search query, matched exactly ignoring case and spacing.'),
      ),
      site_url_id: optional(
        uuid.describe('A page id from read_site_pages; keep only its queries.'),
      ),
      resolution_outcome: optional(
        resolutionOutcome.describe('Keep only queries matched to a page in this way.'),
      ),
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
      dataset_id: uuid.describe('A dataset id that read_search_intelligence returned.'),
      sort: optional(
        z
          .string()
          .describe(
            `The column to order by: one of ${[...policy.search_intelligence.row_sort_fields, ...policy.search_intelligence.auxiliary_sort_fields].join(', ')}.`,
          ),
      ),
      direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction.'),
      ...page,
    }),
    read: searchDataset,
  }),
  render_visibility: projectScoped({
    title: 'Show AI visibility',
    description:
      'Show the user an interactive visibility view, in clients that display apps: overview, trends over a window, or cited sources for one run. To reason over the numbers yourself, use read_visibility_overview, read_visibility_trends or read_visibility_sources.',
    schema: analyticsSelectionSchema.extend({
      view: z
        .enum(['overview', 'trends', 'sources'])
        .default('overview')
        .describe('Which view to show; each other field says the views it applies to.'),
    }),
    read: ({ db, scope, origin }, args) => renderAnalytics(db, scope, args, origin),
  }),
  render_site_health: projectScoped({
    title: 'Show Site Health',
    description:
      'Show the user an interactive Site Health view (scores, coverage and top issues) for the latest or a chosen snapshot, in clients that display apps. To reason over the data yourself, use read_site_health.',
    schema: z.strictObject({ ...project, snapshot_id }),
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
    description:
      'Show the user the CiteLadder project picker, in clients that display apps, so they can choose a project to view. Use list_projects to find projects yourself.',
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
