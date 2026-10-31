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
    description:
      'List the projects this connection can read. Start here when no project is known: every other project tool needs the id it returns. Each project has its id, name, brand, website, industry, primary market and the workspace it belongs to. Projects come oldest first, 50 per page by default; pass next_cursor for more. An empty list means the workspace has no projects yet. To find a project by name use search; for one project in depth use get_project_business_context.',
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
      "Read one overview of a project in a single call: its identity and markets (with the market ids other tools take), then a short summary per section: business profile with owned domains and tracked competitors, latest visibility, the top 10 Actions, active prompts, Site Health, AI crawler access, demand, search performance, AI referrals, crawler logs, connected data and keyword research. Use it first to orient yourself, then the matching read_* tool for depth or paging (each section is that tool's default read). Omit sections for all of them; pass a few to keep the response small. A section can be unavailable on its own, such as a project with no completed run.",
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
      "Read the headline AI visibility of one run: how often answers mention the brand and cite its site, the visibility score, rankings of the brand against each competitor (mention rate, citation rate, share of voice, average position), a breakdown per engine, and the run's status and answer counts. It defaults to the latest completed run in the default market; pass baseline_id to compare two runs. Each market is measured separately: pass market_id for another market, and never pool markets. unavailable no_completed_run means no run has finished yet. Use read_visibility_trends for change over time, read_visibility_results for the answers themselves, and read_visibility_sources for what was cited.",
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
      'Read how visibility changed over an explicit window of at most 366 days, as points per run or per day, week or month. Each point has the visibility score, brand mention and citation rates, share of voice, competitor rankings, the model and whether web search was on, and a comparison_key. Points with different comparison keys were measured differently and are not comparable; gaps are missing runs, not zero. At most the newest 100 points are returned. unavailable no_measured_runs means no run fell in the window. Use read_visibility_overview for one run in depth, or with baseline_id to compare exactly two runs.',
    schema: z.strictObject({
      ...project,
      market_id,
      from_at: z.iso
        .datetime({ offset: true })
        .describe('Start of the window, with a UTC offset, such as 2026-09-01T00:00:00Z.'),
      to_at: z.iso
        .datetime({ offset: true })
        .describe('End of the window, after from_at and at most 366 days later.'),
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
      'Read how AI answers portray the brand and competitors in the latest or a chosen run: net sentiment (-100 to +100) per brand, engine, topic and prompt, each with its coverage; praise and criticism by theme; how often answers recommend or advise against the brand; and the sources cited alongside criticism. The summary view returns all of that; the quotes view lists the verified quotes behind it, paged (50 by default, pass next_cursor). The response is always available: read perception_state, where pending, unavailable or no_mentions means there is no value, never zero. Always state the coverage. Sources are cited alongside criticism, never its cause. Use read_fact_checks for whether answers are factually right, and read_visibility_overview for how often the brand is mentioned at all.',
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
      "Read whether AI answers state the brand's facts correctly. Factual claims answers made about the brand in the latest or a chosen run are checked against the brand's confirmed facts. The summary view gives accuracy (supported out of supported plus contradicted) with its coverage, by topic and engine, the contradicted claims with the fact they contradict, and sources cited alongside them. The claims view lists every checked claim with its quote, verdict and the facts used, paged (50 by default, pass next_cursor). Use read_perception for tone rather than accuracy. Always state the coverage and quote the fact. accuracy_state no_facts, no_claims, pending or unavailable means there is no value, never zero; inconclusive and not_covered are not errors in the answer. Sources are cited alongside a contradiction, never its cause.",
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
      "Read the answers engines gave in one run, to see exactly what an engine said for a prompt. Each answer has the prompt text, engine, model, repetition, whether web search was used, the brands mentioned (with first position) and every citation (URL, domain, whether it is your site or a competitor's), plus a citeladder:// id for fetch. audit_id is required: take it from read_visibility_overview. Answers come 50 per page by default; pass next_cursor for more. Only core prompts are included unless cohort is comparison or all. Filters (prompt_id, domain, url, engine) combine. Use read_visibility_overview for rates and read_visibility_sources for citation totals.",
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
      "Rank the domains or pages AI answers cited in one run, to find the sources worth earning a place on. Each row has how many answers and prompts cited it, its citation share and rate, ownership (yours, a competitor's or third party) and category; page rows also list up to 3 brands named on the page and whether there is an Action for it. It defaults to the latest run; unavailable no_completed_run means none has finished. Rows come 50 per page by default; pass next_cursor for more. level domain lists publishers; level url, or passing domain, lists pages. Use read_source_url for one page in depth, and read_visibility_results for the answers that cite it.",
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
      'Read one cited page in depth, after read_visibility_sources or an answer names it: how often it was retrieved and cited, when first and last seen, the engines and models that cite it, the prompts it is cited for (up to 50), the brands it names (up to 12, including whether yours is there), and what CiteLadder read on the page itself. Omit audit_id to cover every run in the market, not just the latest. The URL must match the cited URL exactly; unavailable url_not_cited_in_selection means it was not cited in that selection.',
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
      'List the prompts the project tracks, so you know what is measured before reading results or changing prompts. Each row has the prompt id, text, topic, intent, buyer stage, cohort (core prompts are scored; comparison prompts name a competitor and are reported separately), status and whether audits measure it now, plus its prompt set and topic_id. topics lists every project topic (id, name, description), including topics with no prompts yet; topics_truncated says the list is partial. Rows come oldest first, 50 per page by default; pass next_cursor for more. To find one prompt by its wording use search; to see what engines answered for a prompt use read_visibility_results with its prompt_id. Prompt ids feed update_prompt_text, prepare_archive_prompts and prepare_launch_audit.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: optional(
        uuid.describe(
          'A prompt set id from an earlier row of this tool; omit for every set in the project.',
        ),
      ),
      cohort: optional(
        z
          .enum(['core', 'comparison'])
          .describe(
            'Keep only scored or only comparison prompts; combines with the other filters.',
          ),
      ),
      active_only: z
        .boolean()
        .default(false)
        .describe(
          'true keeps only prompts audits measure now; false (the default) also lists disabled and archived ones.',
        ),
      ...page,
    }),
    read: promptPortfolio,
  }),
  read_actions: projectTool({
    title: 'Read Actions',
    description:
      'List the work CiteLadder recommends to improve visibility, highest priority first. Without a status filter it lists open and in-progress Actions; each item has its id, target (page, prompt or source), status, priority score, approach and link, and status_counts counts every status. Items come 50 per page by default; pass next_cursor for more. Pass action_id for one Action in full: its diagnosis, each finding with its remediation, the measured outcome and any declaration. Use update_action_status to dismiss or reopen one, and prepare_declare_implemented when its work is done.',
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
      'Read how the competitor pages AI answers cite differ from your own page on the topics they win. Use it before rewriting a page to compete. It returns up to the 10 newest comparison reports, each with its query, the owned page compared, the features both have (parity), those only competitors have (gaps) and those only you have, each with the share of inspected pages showing it. A report with state insufficient_evidence had fewer than 3 readable competitor pages or no matching owned page. An empty list means no comparison was made yet; this tool never reads new pages. Use read_visibility_sources to find the competing pages first.',
    schema: z.strictObject(project),
    read: differentiationRead,
  }),
  read_ai_shelf: projectTool({
    title: 'Read the AI Shelf',
    description: `Read how AI answers recommend products for an ecommerce project: which products and merchants hold the "shelf" when buyers ask for a product category. Call it first with no target to get the catalog: categories with product counts, and up to ${mcpPolicy.max_list_limit} products with their category ids (products_omitted counts the rest). Then call it again with target_kind and target_id for one category or product: product visibility, share of shelf, average position, first-position win rate, the answer counts they rest on, when it was measured, and the holders (your products, competitors, merchants) with their best rank. unavailable no_product_catalog means the project has no product catalog, which is normal for non-ecommerce brands; use read_visibility_overview for brand mentions instead.`,
    schema: z.strictObject({
      ...project,
      target_kind: optional(
        z
          .enum(['category', 'product'])
          .describe('Pass together with target_id: whether it names a category or a product.'),
      ),
      target_id: optional(
        uuid.describe(
          'A category or product id from the catalog this tool returns without a target; pass together with target_kind.',
        ),
      ),
    }),
    read: shelfRead,
  }),
  read_site_health: projectTool({
    title: 'Read Site Health',
    description:
      'Read the Site Health summary of the latest crawl, or a chosen snapshot: the web fundamentals and AI-readiness scores with their measurement state, how many pages were selected and analyzed, and the top 10 issues, each with its rule_id, severity, description, remediation and how many pages it affects. unavailable no_site_snapshot means no crawl was analyzed yet; this tool never starts one. Use read_site_pages with a rule_id to list the affected pages, read_ai_crawlability for robots access, and render_site_health to show the user the interactive view.',
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
      'Read the internal links of crawled pages: per page, inbound and outbound link counts (overall and in main content) and nofollow inbound links, click depth from the home page, a bounded sample of the pages linking to it and linked from it with their anchors, and anchor diagnostics. Use it to find orphaned or buried pages. Pass up to 10 site_url_ids from read_site_pages to read those pages in one call; missing_site_url_ids lists any not found. Otherwise rows come 50 per page; pass next_cursor for more. unavailable no_site_crawl means no crawl exists. Use read_site_pages for page scores and issues.',
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
      "Read whether the site's robots.txt lets each AI crawler in, for the latest or a chosen crawl: whether robots.txt was fetched (and its status), the sitemaps it lists, and per crawler (such as GPTBot or ClaudeBot) its operator, purpose, the matching rule, root access and how many sampled URLs it may not fetch. This is permission, not observed visits: use read_crawl_logs for crawlers that actually came. unavailable no_site_crawl means no crawl exists; robots_not_observed means the crawl could not read robots.txt.",
    schema: z.strictObject({ ...project, crawl_id }),
    read: crawlability,
  }),
  read_crawl_logs: projectTool({
    title: 'Read AI crawler visits',
    description: `Read the AI crawler requests your server logs recorded, to see which crawlers actually visited, what they fetched and what they got back. View summary (the default) gives totals: requests, pages, active crawlers, error share and a daily series by purpose. View crawlers gives one row per crawler with status codes and verification. View coverage says how complete each day of logs is. View requests lists individual requests. The window defaults to the last ${crawlLogs.default_range}, except that requests without range or dates reads every retained day. The paged views return ${crawlLogs.default_page_size} rows by default (up to ${crawlLogs.max_page_size}) with a top-level next_cursor; changing a filter needs a new first page, while a continuation may change limit. Failed-verification requests are left out unless verification asks for them. connection not_connected or missing coverage means unknown, not zero. Use read_ai_crawlability for robots permission and read_ai_traffic_pages for activity per page.`,
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
    description: `Rank the project's own pages by AI activity, to find which pages AI crawlers fetch, AI assistants send visitors to and AI answers cite. Each row is one page (URL, path, folder, resource class) with four measures, each carrying its own coverage: AI crawler requests (server logs), AI referral sessions and key events (GA4), citations in AI answers, and Site Health findings, plus its last crawl. The window defaults to the last ${crawlLogs.default_range}; rows come ${crawlLogs.default_page_size} per page (up to ${crawlLogs.max_page_size}); pass next_cursor for more. observed_crawl_coverage says how complete the logs are, and a measure without a connected source is missing, not zero. Use read_ai_traffic_url for one page's timeline, read_crawl_logs for crawler-level detail, read_ai_referrals for site-wide referral totals, and read_site_pages for crawl data such as titles and scores.`,
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
          .describe(
            'Row order by one measure, highest first, or by URL; omit for the default. Filters (folder, resource_class, verification) apply first.',
          ),
      ),
      ...crawlPage,
    }),
    read: aiTrafficPages,
  }),
  read_ai_traffic_url: projectTool({
    title: 'Read AI traffic for a URL',
    description: `Read the timeline of AI activity on one page of the project site, after read_ai_traffic_pages names it: the page's four measures (crawler requests, referral sessions, citations, Site Health findings) with their coverage and 4xx/5xx errors, then each crawler's first and last visit and request count, each AI source's first referral and sessions, and each citation by date and run. The window defaults to the last ${crawlLogs.default_range}. Each timeline is capped, and provenance.bounded is true when a cap was hit. The URL must be on the project's own site. unavailable url_not_joinable means the path cannot be matched (for example a redacted path); unavailable with no reason means no activity was recorded for that page in the window.`,
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
      'Read the patterns CiteLadder found by joining AI crawler, referral and citation data for one saved window: pages crawled but never visited from AI, pages getting AI referrals but not crawled recently, crawler errors on valuable pages, and key events concentrated on few pages. Each pattern has a short explanation, the numbers behind it and the pages involved, with coverage. These are co-occurrence, not cause. It reads the newest saved 30-day window by default; custom dates must match a saved window exactly. unavailable means no insight snapshot exists yet, and coverage.notice says why, such as GA4 not being connected. Use read_ai_traffic_pages for the per-page numbers.',
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
    description: `Read the site's organic search performance from Search Console and GA4: clicks, impressions, CTR, average position, sessions and key events for a window, with a series over time and an optional comparison window. Without dimension it returns totals, the series, data coverage and how many rows each breakdown has; with dimension it returns one page of rows by query, page, country, device or day (${policy.traffic.PERFORMANCE_DEFAULT_PAGE_SIZE} by default, pass next_cursor for more). The range defaults to ${policy.traffic.PERFORMANCE_DEFAULT_RANGE}, all imported data; most custom windows have no saved snapshot and return performance_range_not_projected, so prefer the preset ranges. not_connected means no search source is connected, which is not zero; read_integration_status says why. Use read_query_evidence for queries matched to crawled pages, and read_ai_referrals for traffic from AI assistants.`,
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
      'Read the Search Console queries that bring searchers to each site page, matched to pages CiteLadder crawled, for one saved window. Use it to see which queries a page ranks for, or which page answers a query; for totals and trends use read_performance, and for the search signals found in the same window use read_demand. The window must exactly match a saved one: read_demand returns it. Any other window returns unavailable exact_query_evidence_window_not_projected, which is not zero. Each row is one query, page and day: the query, the page Search Console reported, the crawled page it was matched to (site_url_id), how the match was made (resolution_outcome), and impressions, clicks and CTR. Rows come 50 per page by default; pass next_cursor for more. Country, device and search type are not broken out.',
    schema: z.strictObject({
      ...project,
      window_start: z.iso
        .date()
        .describe("First day of a saved window, inclusive: read_demand's window.start."),
      window_end: z.iso
        .date()
        .describe("Last day of the same saved window, inclusive: read_demand's window.end."),
      query: optional(
        z
          .string()
          .describe('One search query, matched exactly ignoring case and spacing, not a search.'),
      ),
      site_url_id: optional(
        uuid.describe(
          'A page id (site_url_id) from read_site_pages or an earlier row; keep only its queries.',
        ),
      ),
      resolution_outcome: optional(
        resolutionOutcome.describe(
          'Keep only queries whose page match was exact, resolved (for example through a redirect or canonical), ambiguous or unresolved. All filters combine.',
        ),
      ),
      ...page,
    }),
    read: queryEvidence,
  }),
  read_demand: projectTool({
    title: 'Read search demand',
    description:
      "Read the latest search-demand snapshot: the opportunities CiteLadder found in the project's own Search Console data for one window, such as queries in striking distance of page one, pages competing for the same query, click-through below the site's norm and rising or falling queries. It returns the window (pass it to read_query_evidence for the query rows behind it), the signal count by type, each detector's state, coverage (whether search data and query evidence were observed) and the change in signal count against the previous snapshot, which is not a cause. unavailable no_demand_snapshot means no snapshot was built yet, usually because Search Console is not connected or still importing; read_integration_status says which. The signals become Actions: use read_actions for the prioritized work. Keyword volumes from research live in read_search_intelligence.",
    schema: z.strictObject(project),
    read: demandSnapshot,
  }),
  read_integration_status: projectTool({
    title: 'Read connected data',
    description:
      'Read which data sources (Search Console, GA4, server logs) are connected to the project and how far their import has got, to explain why a traffic or search read is unavailable. It returns the overall stage (not_connected, connected, importing, core_data_ready, analysis_ready or import_failed), the backfill state and the date data is imported through, whether performance and demand snapshots exist, and each connection with its provider, property and last sync. Read it when another read returns unavailable or not_connected, before reading that again. Connecting a source happens in CiteLadder, not through this tool.',
    schema: z.strictObject(project),
    read: integrationStatus,
  }),
  read_search_intelligence: projectTool({
    title: 'Read keyword and backlink research',
    description:
      "List the keyword, competitor and backlink research datasets saved for this project, and whether the research provider is connected. Each dataset has its id, kind, target domain, market (location and language), status and whether its totals are aggregates rather than individual links, plus the project's owned targets, tracked competitors and latest research run. It lists datasets only: pass a dataset id to read_search_dataset for its rows. unavailable with no datasets means no research was run yet; this tool never starts research, which happens in CiteLadder. For the project's own Search Console queries use read_query_evidence instead.",
    schema: z.strictObject(project),
    read: searchIntelligence,
  }),
  read_search_dataset: projectTool({
    title: 'Read a research dataset',
    description:
      "Read the rows of one saved keyword or backlink research dataset, after read_search_intelligence has named it. Use it for keyword volumes, rankings, competitor keywords or referring domains; use read_search_intelligence to choose the dataset and read_query_evidence for the project's own Search Console queries. It returns the dataset (kind, target, market, saved row count) and a page of rows (50 by default; pass next_cursor for more, with the same sort), each with a citeladder:// id for fetch. Columns depend on the dataset kind. Referring-domain and page totals are provider aggregates, not individual links: never report them as a link list. Rows are as saved at research time and are never refreshed by this read.",
    schema: z.strictObject({
      ...project,
      dataset_id: uuid.describe(
        'A dataset id from read_search_intelligence; a dataset of another project is refused.',
      ),
      sort: optional(
        z
          .string()
          .describe(
            `The column to order by, which must exist for the dataset kind: one of ${[...policy.search_intelligence.row_sort_fields, ...policy.search_intelligence.auxiliary_sort_fields].join(', ')}. Omit to order by row id. Rows with no value sort last.`,
          ),
      ),
      direction: z
        .enum(['asc', 'desc'])
        .default('asc')
        .describe(
          'asc (the default) or desc; desc with a volume or rank column puts the largest first.',
        ),
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
