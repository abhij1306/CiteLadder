import { z } from 'zod';
import { performanceDimensionSchema } from '@citeladder/contracts/performance';
import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { resolutionOutcome } from '../routes/demand-contracts.ts';
import {
  aiTrafficInsights,
  aiTrafficPages,
  aiTrafficUrl,
  crawlLogsRead,
  performanceRead,
  queryEvidence,
  referrals,
} from './evidence-traffic.ts';
import { withCsvExport, sameNames } from './views-exports.ts';
import {
  optional,
  uuid,
  cursor,
  page,
  project,
  analyticsRange,
  dates,
  crawlPage,
  verification,
  folder,
  resource_class,
  projectTool,
} from './tool-definitions.ts';

export const trafficTools = {
  read_crawl_logs: projectTool({
    title: 'Read AI crawler visits',
    description: `Read the AI crawler requests your server logs recorded, to see which crawlers actually visited, what they fetched and what they got back. View summary (the default) gives totals: requests, pages, active crawlers, error share and a daily series by purpose. View crawlers gives one row per crawler with status codes and verification. View coverage says how complete each day of logs is. View requests lists individual requests. The window defaults to the last ${crawlLogs.default_range}, except that requests without range or dates reads every retained day. The paged views return ${crawlLogs.default_page_size} rows by default (up to ${crawlLogs.max_page_size}) with a top-level next_cursor; changing a filter needs a new first page, while a continuation may change limit. Failed-verification requests are left out unless verification asks for them. unavailable not_connected means no crawl-log source is connected and no logs are retained for the window; connection awaiting_data or missing coverage means unknown, not zero. Use read_ai_crawlability for robots permission and read_ai_traffic_pages for activity per page.`,
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
    read: async (read, args) => {
      const evidence = await crawlLogsRead(read, args);
      if (args.view !== 'crawlers' && args.view !== 'requests') return evidence;
      return withCsvExport(read, evidence, {
        path: `/ai-traffic/${args.view === 'crawlers' ? 'crawlers' : 'activity'}/export`,
        args,
        params: sameNames(
          'range',
          'start_date',
          'end_date',
          'verification',
          'bot_id',
          'status',
          'folder',
          'resource_class',
        ),
      });
    },
  }),
  read_ai_traffic_pages: projectTool({
    title: 'Read AI traffic by page',
    description: `Rank the project's own pages by AI activity, to find which pages AI crawlers fetch, AI assistants send visitors to and AI answers cite. Each row is one page (URL, path, folder, resource class) with four measures, each carrying its own coverage: AI crawler requests (server logs), AI referral sessions and key events (GA4), citations in AI answers, and Site Health findings, plus its last crawl. The window defaults to the last ${crawlLogs.default_range}; rows come ${crawlLogs.default_page_size} per page (up to ${crawlLogs.max_page_size}); pass next_cursor for more. observed_crawl_coverage says how complete the logs are, and a measure without a connected source is missing, not zero. unavailable not_connected means no crawl logs, no GA4 and no completed visibility run in the window. Use read_ai_traffic_url for one page's timeline, read_crawl_logs for crawler-level detail, read_ai_referrals for site-wide referral totals, and read_site_pages for crawl data such as titles and scores.`,
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
    read: async (read, args) =>
      withCsvExport(read, await aiTrafficPages(read, args), {
        path: '/ai-traffic/pages/export',
        args,
        params: sameNames(
          'range',
          'start_date',
          'end_date',
          'folder',
          'resource_class',
          'verification',
          'sort',
        ),
      }),
  }),
  read_ai_traffic_url: projectTool({
    title: 'Read AI traffic for a URL',
    description: `Read the timeline of AI activity on one page of the project site, after read_ai_traffic_pages names it: the page's four measures (crawler requests, referral sessions, citations, Site Health findings) with their coverage and 4xx/5xx errors, then each crawler's first and last visit and request count, each AI source's first referral and sessions, and each citation by date and run. The window defaults to the last ${crawlLogs.default_range}. Each timeline is capped, and provenance.bounded is true when a cap was hit. The URL must be on the project's own site. unavailable url_not_joinable means the path cannot be matched (for example a redacted path); unavailable not_connected means no crawl logs, no GA4 and no completed visibility run in the window; unavailable with no reason means no activity was recorded for that page in the window.`,
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
      'Read the Search Console queries that bring searchers to each site page, matched to pages CiteLadder crawled, for one saved window. Use it to see which queries a page ranks for, or which page answers a query; for totals and trends use read_performance, and for the search signals found in the same window use read_demand. The window must exactly match a saved one: read_demand returns it. Any other window returns unavailable exact_query_evidence_window_not_projected, which is not zero. Each row is one query, page and day: the query, the page Search Console reported, the crawled page it was matched to (site_url_id), how the match was made (resolution_outcome), and impressions, clicks and CTR. Rows come in pages; pass next_cursor for more. Country, device and search type are not broken out.',
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
};
