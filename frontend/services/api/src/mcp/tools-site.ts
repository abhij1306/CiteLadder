import { z } from 'zod';
import { policy } from '../config.ts';
import { PAGE_STATUS_FILTERS } from '../site-health/reads/page-rows.ts';
import { mcpPolicy } from './config.ts';
import { crawlability, pageText, siteLinks, sitePages, siteSnapshot } from './evidence-site.ts';
import { crawlSchedule, linkAnalyses, siteIssueGroups } from './evidence-site-controls.ts';
import {
  aeoReadinessView,
  architectureView,
  pageIssueHistory,
  robotsHistoryView,
  siteChangeList,
  siteChanges,
} from './views-site.ts';
import {
  optional,
  uuid,
  page,
  snapshot_id,
  crawl_id,
  project,
  projectTool,
} from './tool-definitions.ts';

export const siteTools = {
  read_site_health: projectTool({
    title: 'Read Site Health',
    description: `Read the Site Health summary of the latest crawl, or a chosen snapshot: the web fundamentals and AI-readiness scores with their measurement state, how many pages were selected and analyzed, and the top ${policy.site_health.reads.snapshot_top_issues} issues, each with its rule_id, severity, description, remediation and how many pages it affects. unavailable no_site_snapshot means no crawl was analyzed yet; this tool never starts one. view changes summarizes what changed between the last two crawls and change_list lists each change; aeo_readiness breaks the AI-readiness score down per dimension and check; architecture is page types, depth, orphans and the page tree. Use read_site_pages with a rule_id to list the affected pages and read_ai_crawlability for robots access. Use render_site_health to show the user the interactive view. view issues lists every issue group of the crawl with its group_id, paged; view schedule is the recurring crawl.`,
    schema: z.strictObject({
      ...project,
      snapshot_id,
      view: z
        .enum([
          'summary',
          'issues',
          'schedule',
          'changes',
          'change_list',
          'aeo_readiness',
          'architecture',
        ])
        .default('summary'),
      ...page,
    }),
    read: (read, args) => {
      switch (args.view) {
        case 'issues':
          return siteIssueGroups(read, args);
        case 'schedule':
          return crawlSchedule(read);
        case 'changes':
          return siteChanges(read);
        case 'change_list':
          return siteChangeList(read, args);
        case 'aeo_readiness':
          return aeoReadinessView(read, args);
        case 'architecture':
          return architectureView(read, args);
        default:
          return siteSnapshot(read, args);
      }
    },
  }),
  read_site_pages: projectTool({
    title: 'Read site pages',
    description:
      "Pages from a crawl, paged: URL, title, page type, status, scores, issue count and the rule ids of each page's issues by finding class. Pass url to find a page by its address, rule_id (from read_site_health top_issues or an issue group) to list exactly the pages affected by that issue, each with rule_evidence: what that check found on that page (a site-level architecture issue is recorded once on the home page, and its rule_evidence names the affected pages), and, when the crawl kept one, a reference_snippet: redacted markup of the failing element and its label context from one affected page (text and attribute values replaced by [text] and [redacted]), to write an exact fix; filter by page_kind or status to find pages by type or status. This returns metadata, not page copy: use read_page_text for a page's words. view issue_history with site_url_id lists the issues that page has resolved. read_site_health gives the totals.",
    schema: z.strictObject({
      ...project,
      crawl_id,
      url: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(2048)
          .describe(
            'A page address or part of one, such as https://example.com/pricing or /pricing; keeps pages whose URL contains it, ignoring scheme, www and a trailing slash.',
          ),
      ),
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
      view: z.enum(['pages', 'issue_history']).default('pages'),
      site_url_id: optional(uuid.describe('With view issue_history: a page id from this tool.')),
      ...page,
    }),
    read: (read, args) =>
      args.view === 'issue_history' ? pageIssueHistory(read, args) : sitePages(read, args),
  }),
  read_page_text: projectTool({
    title: 'Read page text',
    description: `Read the words of one crawled page of the project's site, by URL or by site_url_id from read_site_pages: its title, meta description, h1-h3 headings, then the visible body text (up to ${mcpPolicy.page_text_max_chars} characters in all; text_chars_omitted counts any body text left out), with its URL, page type and when it was fetched. Use it to quote, review or rewrite what a page actually says. It reads the latest crawl, or crawl_id; it never fetches the live page, so the copy is as of fetched_at. unavailable page_not_crawled means the crawl has no page at that address, and crawled_urls lists the nearest crawled addresses to try; no_site_crawl means no crawl exists.`,
    schema: z.strictObject({
      ...project,
      crawl_id,
      url: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(2048)
          .describe(
            'The page address, such as https://example.com/pricing; scheme, www and a trailing slash are ignored.',
          ),
      ),
      site_url_id: optional(
        uuid.describe('A page id (site_url_id) from read_site_pages; pass this or url.'),
      ),
    }),
    read: pageText,
  }),
  read_site_links: projectTool({
    title: 'Read internal links',
    description:
      'Read the internal links of crawled pages: per page, inbound and outbound link counts (overall and in main content) and nofollow inbound links, click depth from the home page, a bounded sample of the pages linking to it and linked from it with their anchors, and anchor diagnostics. Use it to find orphaned or buried pages. Pass up to 10 site_url_ids from read_site_pages to read those pages in one call (with smaller neighbor samples and anchor diagnostics counted by kind); missing_site_url_ids lists any without link metrics in this crawl (for example a page that was not analyzed). Otherwise rows come in pages; pass next_cursor for more. unavailable no_site_crawl means no crawl exists. Use read_site_pages for page scores and issues. view analyses gives the internal-link analyses with their ids and state, latest first.',
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
      view: z
        .enum(['pages', 'analyses'])
        .default('pages')
        .describe('pages (the default) or analyses.'),
      ...page,
    }),
    read: (read, args) => (args.view === 'analyses' ? linkAnalyses(read) : siteLinks(read, args)),
  }),
  read_ai_crawlability: projectTool({
    title: 'Read AI crawler access',
    description:
      "Read whether the site's robots.txt lets each AI crawler in, for the latest or a chosen crawl: whether robots.txt was fetched (and its status), the sitemaps it lists, and per crawler (such as GPTBot or ClaudeBot) its operator, purpose, the matching rule, root access and how many sampled URLs it may not fetch. This is permission, not observed visits: use read_crawl_logs for crawlers that actually came. unavailable no_site_crawl means no crawl exists; robots_not_observed means the crawl could not read robots.txt. view history lists robots.txt as each crawl saw it, newest first.",
    schema: z.strictObject({
      ...project,
      crawl_id,
      view: z.enum(['current', 'history']).default('current'),
      ...page,
    }),
    read: (read, args) =>
      args.view === 'history' ? robotsHistoryView(read, args) : crawlability(read, args),
  }),
};
