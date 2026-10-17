/**
 * Raw API payloads for the site-health SCHEMA-CONTRACT tests
 * (lib/api/site-health*.test.ts). These are deliberately untyped literals: the
 * point is to feed the zod parser something shaped like a real response, and
 * `SITE_HEALTH_CRAWL` deliberately OMITS the optional `discovered_count` /
 * `has_more_site_urls` keys to exercise the Free-redaction path where the
 * backend drops them entirely.
 *
 * Component tests want typed builders with overrides instead — use
 * `@/test/fixtures/site-health` (makeSiteCrawl / makePageSummary / ...).
 */
export const SITE_HEALTH_UUID = '11111111-1111-4111-8111-111111111111';
export const SITE_HEALTH_UUID_2 = '22222222-2222-4222-8222-222222222222';

export const SITE_HEALTH_SITE_FACTS = {
  robots: {
    observed_at: '2026-10-03T00:00:00Z',
    fetched: true,
    url: 'https://example.com/robots.txt',
    status_code: 200,
    status: 'fetched',
    catalog_version: '1',
    robots_snapshot_id: SITE_HEALTH_UUID_2,
    bots: [
      {
        bot_id: 'openai_gptbot',
        label: 'GPTBot',
        operator: 'openai',
        purpose: 'ai_training',
        matched: 'specific_group',
        root_access: 'disallowed',
        policy: 'all_disallowed',
        evaluated_url_count: 1,
        disallowed_url_count: 1,
      },
    ],
    sitemaps: ['https://example.com/sitemap.xml'],
  },
  llms_txt: {
    fetched: true,
    url: 'https://example.com/llms.txt',
    status_code: 200,
    present: true,
  },
  sitemap: { fetched: false, files: [] },
};

export const SITE_HEALTH_CRAWL = {
  id: SITE_HEALTH_UUID,
  workspace_id: SITE_HEALTH_UUID,
  project_id: SITE_HEALTH_UUID_2,
  profile_id: SITE_HEALTH_UUID_2,
  status: 'running' as const,
  discovery_status: 'running' as const,
  analysis_status: 'pending' as const,
  root_url: 'https://example.com/',
  sample_mode: false,
  seed: '12345',
  inventory_complete: false,
  partial_reason: '',
  visible_url_count: 42,
  analyzed_count: 0,
  failed_count: 0,
  discovery_requested_count: 42,
  analysis_requested_count: 0,
  counters: {
    discovered: 42,
    selected: 0,
    queued: 0,
    running: 0,
    analyzed: 0,
    errors: 0,
    blocked: 0,
    failure_breakdown: {
      robots_denied: 0,
      http_4xx: 0,
      http_5xx: 0,
      timeout: 0,
    },
    activity: {
      state: 'terminal',
      reason: 'terminal',
      queue_depth: 0,
      next_available_at: null,
    },
    by_page_kind: {},
  },
  total_url_count: null,
  score_summary: null,
  failure_summary: null,
  site_facts: SITE_HEALTH_SITE_FACTS,
  extractor_version: 'x1',
  analyzer_version: 'a1',
  rule_version: 'r1',
  scoring_version: 's1',
  error_message: '',
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
  started_at: null,
  completed_at: null,
};
