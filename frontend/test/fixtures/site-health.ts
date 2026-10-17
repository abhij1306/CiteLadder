/**
 * Typed builders for the site-health API shapes.
 *
 * Five suites used to hand-write the same ~48-field `SiteCrawl` literal, and
 * two of them hand-wrote the same `PageSummary` literal byte-for-byte. The
 * copies had already started to disagree about fields nobody was asserting
 * (`site_facts.robots.status` present in one, absent in three), which is how a
 * "fixture" stops describing the backend and starts describing whichever test
 * was edited last.
 *
 * Every builder returns a fully-populated, schema-valid object and takes an
 * overrides bag, so a test states ONLY the fields its assertion depends on.
 * Reach for an override rather than a second builder: a divergent default here
 * is a drift the type checker cannot catch.
 */
import type { PageSummary, SiteCrawl } from '@/lib/api/types';

export const SITE_HEALTH_UUID = '11111111-1111-4111-8111-111111111111';
export const SITE_HEALTH_UUID_2 = '22222222-2222-4222-8222-222222222222';
const SITE_HEALTH_WORKSPACE = '33333333-3333-4333-8333-333333333333';
const SITE_HEALTH_PROFILE = '55555555-5555-4555-8555-555555555555';

/**
 * The bounded site-facts blob the worker persists (the `site_setup` task in
 * frontend/services/api/src/site-health/site-setup-task.ts): robots AI-crawler stance,
 * llms.txt probe, sitemap file list. The backend always emits the key.
 */
export type SiteFactsFixture = {
  robots: Record<string, unknown>;
  llms_txt: Record<string, unknown>;
  sitemap: Record<string, unknown>;
};

export function makeSiteFacts(overrides: Partial<SiteFactsFixture> = {}): SiteFactsFixture {
  return {
    robots: {
      observed_at: '2026-10-03T00:00:00Z',
      fetched: true,
      status: 'fetched',
      url: 'https://acme.com/robots.txt',
      status_code: 200,
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
          evaluated_url_count: 4,
          disallowed_url_count: 4,
        },
        {
          bot_id: 'anthropic_claudebot',
          label: 'ClaudeBot',
          operator: 'anthropic',
          purpose: 'ai_training',
          matched: 'wildcard_group',
          root_access: 'allowed',
          policy: 'all_allowed',
          evaluated_url_count: 4,
          disallowed_url_count: 0,
        },
        {
          bot_id: 'perplexity_bot',
          label: 'PerplexityBot',
          operator: 'perplexity',
          purpose: 'ai_search',
          matched: 'no_rules',
          root_access: 'allowed',
          policy: 'restricted',
          evaluated_url_count: 4,
          disallowed_url_count: 1,
        },
        {
          bot_id: 'google_extended',
          label: 'Google-Extended',
          operator: 'google',
          purpose: 'ai_training',
          matched: 'no_rules',
          root_access: 'unknown',
          policy: 'unknown',
          evaluated_url_count: 0,
          disallowed_url_count: 0,
        },
      ],
      sitemaps: ['https://acme.com/sitemap.xml'],
    },
    llms_txt: {
      fetched: true,
      url: 'https://acme.com/llms.txt',
      status_code: 200,
      present: true,
    },
    sitemap: { fetched: false, files: [] },
    ...overrides,
  };
}

/** A terminal, fully-analyzed crawl of a three-page site. */
export function makeSiteCrawl(overrides: Partial<SiteCrawl> = {}): SiteCrawl {
  return {
    id: SITE_HEALTH_UUID_2,
    workspace_id: SITE_HEALTH_WORKSPACE,
    project_id: SITE_HEALTH_UUID,
    profile_id: SITE_HEALTH_PROFILE,
    status: 'completed',
    discovery_status: 'completed',
    analysis_status: 'completed',
    root_url: 'https://acme.com/',
    sample_mode: false,
    seed: '1',
    inventory_complete: true,
    partial_reason: '',
    visible_url_count: 3,
    analyzed_count: 3,
    failed_count: 0,
    discovery_requested_count: 3,
    analysis_requested_count: 3,
    counters: {
      discovered: 3,
      selected: 3,
      queued: 0,
      running: 0,
      analyzed: 3,
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
    discovered_count: 3,
    total_url_count: 3,
    has_more_site_urls: false,
    score_summary: null,
    failure_summary: null,
    site_facts: makeSiteFacts(),
    extractor_version: 'e1',
    analyzer_version: 'a1',
    rule_version: 'r1',
    scoring_version: 's1',
    error_message: '',
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    started_at: '2026-07-16T00:00:00Z',
    completed_at: '2026-07-16T00:05:00Z',
    ...overrides,
  };
}

/** A completed, monitored page. `page_kind` differs from `title` so that
 * badge-text assertions stay unambiguous. */
export function makePageSummary(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    site_url_id: SITE_HEALTH_UUID,
    crawl_id: SITE_HEALTH_UUID_2,
    normalized_url: 'https://acme.com/',
    display_url: 'https://acme.com/',
    title: 'Homepage',
    monitored: true,
    analysis_status: 'completed',
    error_code: '',
    linked_from: [],
    issue_count: 3,
    web_fundamentals_score: 46,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 64,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    aeo_measurement_reason: '',
    main_content_indexable: true,
    last_audited: '2026-07-16T00:00:00Z',
    page_kind: 'article',
    inbound_count: 12,
    main_content_inbound_count: 4,
    depth_from_home: 1,
    ...overrides,
  };
}
