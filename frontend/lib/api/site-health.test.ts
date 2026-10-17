import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { waitFor } from '@testing-library/react';

import { queryKeys } from './query-keys';
import {
  aeoReadinessSchema,
  cursorPageSchema,
  inventoryRowSchema,
  monitoredUrlsResponseSchema,
  pageDetailSchema,
  rerunPageResponseSchema,
  robotsFactsSchema,
  siteCrawlSchema,
  siteHealthErrorSchema,
  siteIssueSchema,
  urlPreviewResponseSchema,
} from '@citeladder/contracts/site-health';
import { strictValidate } from '@citeladder/contracts/validation';
import { siteHealthApi } from './site-health';
import { mswServer } from '@/test/msw-server';
import {
  SITE_HEALTH_CRAWL as crawl,
  SITE_HEALTH_SITE_FACTS as siteFacts,
  SITE_HEALTH_UUID as UUID,
  SITE_HEALTH_UUID_2 as UUID2,
} from '@/test/site-health-api-fixtures';
import { z } from 'zod';

const inventoryRow = {
  site_url_id: UUID,
  normalized_url: 'https://example.com/a',
  display_url: 'https://example.com/a',
  title: null,
  content_type: null,
  source: 'link' as const,
  depth: 1,
  monitored: false,
  first_seen_at: null,
  last_seen_at: null,
  issue_count: null,
  web_fundamentals_score: null,
  web_fundamentals_coverage: null,
  web_fundamentals_state: 'not_measured' as const,
  aeo_readiness_score: null,
  aeo_measurement_coverage: null,
  aeo_measurement_state: 'not_measured' as const,
  aeo_measurement_reason: '',
  main_content_indexable: null,
  last_audited: null,
  page_kind: null,
};

describe('crawl admission and URL preview', () => {
  beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => mswServer.resetHandlers());
  afterAll(() => mswServer.close());
  it('starts execution in the creating workspace without holding up crawl admission', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execution = vi.fn();
    mswServer.use(
      http.post('/api/v1/site-crawls', () => HttpResponse.json(crawl)),
      http.post(`/api/v1/site-crawls/${crawl.id}/run`, async ({ request }) => {
        execution(request.headers.get('x-workspace-id'));
        await pending;
        return HttpResponse.json(crawl);
      }),
    );
    try {
      expect(
        await siteHealthApi.createCrawl({ project_id: UUID }, { workspaceId: UUID2 }),
      ).toMatchObject({ id: crawl.id });
      await waitFor(() => expect(execution).toHaveBeenCalledWith(UUID2));
    } finally {
      release();
    }
  });
  it('uses the same-origin preview endpoint and preserves exclusion reasons', async () => {
    mswServer.use(
      http.post('/api/v1/site-crawls/url-preview', async ({ request }) => {
        expect(await request.json()).toMatchObject({
          project_id: UUID2,
          content: 'https://example.com/login',
        });
        return HttpResponse.json({
          items: [
            {
              row: 1,
              input: 'https://example.com/login',
              accepted: false,
              canonical_url: null,
              reason_code: 'excluded_auth_path',
              value_kind: 'other',
              priority: 0,
            },
          ],
          truncated: false,
          counts: { excluded_auth_path: 1 },
          policy_version: 'admission-v1',
        });
      }),
    );
    const preview = await siteHealthApi.previewUrls({
      project_id: UUID2,
      content: 'https://example.com/login',
    });
    expect(preview.items[0]?.reason_code).toBe('excluded_auth_path');
    expect(strictValidate(urlPreviewResponseSchema, preview, 'preview').policy_version).toBe(
      'admission-v1',
    );
  });
});

describe('siteCrawlSchema (Free redaction / nullable totals)', () => {
  it('accepts a running crawl with a null total (provisional)', () => {
    const parsed = strictValidate(siteCrawlSchema, crawl, 'crawl');
    expect(parsed.total_url_count).toBeNull();
  });

  it('accepts a Free sample crawl with total_url_count null and no leaked total', () => {
    const sample = {
      ...crawl,
      sample_mode: true,
      inventory_complete: true,
      partial_reason: '',
      total_url_count: null,
    };
    expect(strictValidate(siteCrawlSchema, sample, 'crawl').sample_mode).toBe(true);
  });

  it('strips an unexpected count-bearing key on a crawl (no leaked total)', () => {
    // A leaked total must never reach app state — stripped on parse.
    const parsed = strictValidate(siteCrawlSchema, { ...crawl, hidden_full_total: 9999 }, 'crawl');
    expect('hidden_full_total' in parsed).toBe(false);
  });
});

describe('siteHealthApi.getCrawl site_facts (v2 P2 contract)', () => {
  beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => mswServer.resetHandlers());
  afterAll(() => mswServer.close());

  it('validates a real crawl response carrying a populated site_facts', async () => {
    // Regression: the backend ALWAYS serializes `site_facts`, so a strict
    // schema without the field made every crawl read throw
    // "API validation failure in siteHealth.getCrawl".
    mswServer.use(http.get(`/api/v1/site-crawls/${UUID}`, () => HttpResponse.json(crawl)));
    const result = await siteHealthApi.getCrawl(UUID);
    expect(result.site_facts).toEqual(siteFacts);
  });

  it('rejects a crawl response missing site_facts (drift fails loud)', async () => {
    const { site_facts: _omitted, ...withoutSiteFacts } = crawl;
    mswServer.use(
      http.get(`/api/v1/site-crawls/${UUID}`, () => HttpResponse.json(withoutSiteFacts)),
    );
    await expect(siteHealthApi.getCrawl(UUID)).rejects.toThrow(
      /API validation failure in siteHealth\.getCrawl/,
    );
  });
});

describe('siteCrawlSchema site_facts (v2 P2 contract)', () => {
  it('accepts a populated site_facts blob as the worker persists it', () => {
    const parsed = strictValidate(siteCrawlSchema, crawl, 'siteHealth.getCrawl');
    expect(robotsFactsSchema.safeParse(parsed.site_facts?.robots).success).toBe(true);
    expect(parsed.site_facts?.llms_txt).toEqual({
      fetched: true,
      url: 'https://example.com/llms.txt',
      status_code: 200,
      present: true,
    });
  });

  it('accepts a null site_facts (crawl setup has not run yet)', () => {
    const parsed = strictValidate(
      siteCrawlSchema,
      { ...crawl, site_facts: null },
      'siteHealth.getCrawl',
    );
    expect(parsed.site_facts).toBeNull();
  });

  it('rejects a crawl payload that omits site_facts (required, never optional)', () => {
    // The backend response model always serializes the key, so a missing key
    // is real drift — keeping it required is what pins that contract.
    const { site_facts: _omitted, ...withoutSiteFacts } = crawl;
    expect(() =>
      strictValidate(siteCrawlSchema, withoutSiteFacts, 'siteHealth.getCrawl'),
    ).toThrow();
  });
});

describe('inventoryRowSchema (nullable analysis summaries)', () => {
  it('accepts null analysis summaries before analysis completes', () => {
    const parsed = strictValidate(inventoryRowSchema, inventoryRow, 'row');
    expect(parsed.aeo_readiness_score).toBeNull();
    expect(parsed.issue_count).toBeNull();
    expect(parsed.page_kind).toBeNull();
  });

  it('accepts populated analysis summaries after analysis', () => {
    const analysed = {
      ...inventoryRow,
      issue_count: 3,
      web_fundamentals_score: 88.5,
      web_fundamentals_coverage: 1,
      web_fundamentals_state: 'measured',
      aeo_readiness_score: 72,
      aeo_measurement_coverage: 0.8,
      aeo_measurement_state: 'measured',
      aeo_measurement_reason: '',
      main_content_indexable: true,
      last_audited: '2026-07-15T00:00:00Z',
      page_kind: 'article',
    };
    const parsed = strictValidate(inventoryRowSchema, analysed, 'row');
    expect(parsed.issue_count).toBe(3);
    expect(parsed.page_kind).toBe('article');
  });

  it('preserves the unresolved-purpose reason on an Other page projection', () => {
    const parsed = strictValidate(
      inventoryRowSchema,
      {
        ...inventoryRow,
        page_kind: 'other',
        aeo_measurement_reason: 'page_purpose_unresolved',
      },
      'row',
    );

    expect(parsed.aeo_measurement_reason).toBe('page_purpose_unresolved');
  });

  it('accepts the expanded page-kind taxonomy emitted by the classifier', () => {
    const parsed = strictValidate(
      inventoryRowSchema,
      { ...inventoryRow, page_kind: 'service' },
      'row',
    );
    expect(parsed.page_kind).toBe('service');
  });

  it('rejects an unknown page_kind vocabulary value', () => {
    expect(() =>
      strictValidate(inventoryRowSchema, { ...inventoryRow, page_kind: 'landing_page' }, 'row'),
    ).toThrow();
  });

  it('strips an additive key on an inventory row (tolerant-on-unknown)', () => {
    const parsed = strictValidate(inventoryRowSchema, { ...inventoryRow, sort_rank: 1 }, 'row');
    expect('sort_rank' in parsed).toBe(false);
  });
});

describe('cursorPageSchema', () => {
  const page = cursorPageSchema(inventoryRowSchema);

  it('accepts a page with a null next_cursor (last page)', () => {
    const parsed = strictValidate(page, { items: [inventoryRow], next_cursor: null }, 'page');
    expect(parsed.next_cursor).toBeNull();
  });

  it('accepts a page with a cursor', () => {
    const parsed = strictValidate(page, { items: [], next_cursor: 'opaque==' }, 'page');
    expect(parsed.next_cursor).toBe('opaque==');
  });

  it('strips an offset / page-total field (no count side channel)', () => {
    // No count side channel: a leaked total is stripped from parsed output.
    const parsed = strictValidate(page, { items: [], next_cursor: null, total: 25000 }, 'page');
    expect('total' in parsed).toBe(false);
  });
});

describe('monitoredUrlSchema', () => {
  it('accepts bootstrap selections created during onboarding', () => {
    const parsed = strictValidate(
      monitoredUrlsResponseSchema,
      {
        project_id: UUID,
        selection_version: 1,
        monitored_urls: [
          {
            site_url_id: UUID2,
            normalized_url: 'https://example.com/',
            display_url: 'https://example.com/',
            title: null,
            active: true,
            selection_source: 'bootstrap',
            selected_at: null,
            deselected_at: null,
          },
        ],
        quota: { used: 1, limit: 50 },
      },
      'monitored',
    );
    expect(parsed.monitored_urls[0]?.selection_source).toBe('bootstrap');
  });
});

describe('monitoredUrlsResponseSchema', () => {
  const response = {
    project_id: UUID,
    selection_version: 4,
    monitored_urls: [
      {
        site_url_id: UUID2,
        normalized_url: 'https://example.com/',
        display_url: 'https://example.com/',
        title: 'Home',
        active: true,
        selection_source: 'user' as const,
        selected_at: '2026-07-15T00:00:00Z',
        deselected_at: null,
      },
    ],
    quota: { used: 1, limit: 50 },
  };

  it('accepts a monitored set with quota + version', () => {
    const parsed = strictValidate(monitoredUrlsResponseSchema, response, 'mon');
    expect(parsed.quota.limit).toBe(50);
    expect(parsed.selection_version).toBe(4);
  });

  it('rejects an invalid selection_source', () => {
    const bad = {
      ...response,
      monitored_urls: [{ ...response.monitored_urls[0], selection_source: 'admin' }],
    };
    expect(() => strictValidate(monitoredUrlsResponseSchema, bad, 'mon')).toThrow();
  });
});

describe('pageDetailSchema (field_cwv_available literal false)', () => {
  const detail = {
    site_url_id: UUID,
    crawl_id: UUID2,
    normalized_url: 'https://example.com/',
    display_url: 'https://example.com/',
    title: 'Home',
    analysis_status: 'completed' as const,
    error_code: '',
    linked_from: [],
    field_cwv_available: false as const,
    web_fundamentals_score: 90,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 80,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    aeo_measurement_reason: '',
    main_content_indexable: true,
    issue_count: 2,
    last_audited: '2026-07-15T00:00:00Z',
    page_kind: 'homepage',
    // T5 contract: the backend page-detail serializer always carries this key
    // (null until the URL has an analysis) — the fixture must include it.

    page_kind_evidence: null,
    page_traits: [],
    facts: {
      title: 'Home',
      meta_description: null,
      canonical_url: null,
      robots_directives: [],
      h1_count: 1,
      heading_count: 5,
      image_count: 3,
      image_missing_alt_count: 0,
      word_count: 500,
      internal_link_count: 10,
      external_link_count: 2,
      structured_data_types: ['Organization'],
    },
    delivery: {
      field_cwv_available: false as const,
      status_code: 200,
      ttfb_ms: 120,
      wire_bytes: 4096,
      decoded_bytes: 8192,
      html_bytes: 8192,
      http_version: 'HTTP/2',
      compression: 'gzip',
      cache_control: 'max-age=3600',
      blocking_resource_count: 1,
    },
    internal_links: null,
    issues: [],
    evaluations: [],
    artifact_id: UUID,
    extractor_version: 'x1',
    analyzer_version: 'a1',
    rule_version: 'r1',
    scoring_version: 's1',
  };

  it('accepts a full page detail with field_cwv_available false', () => {
    expect(strictValidate(pageDetailSchema, detail, 'page').field_cwv_available).toBe(false);
  });

  it('rejects a page detail that omits the required measurement reason', () => {
    const { aeo_measurement_reason: _omitted, ...withoutReason } = detail;
    expect(() => strictValidate(pageDetailSchema, withoutReason, 'page')).toThrow();
  });

  it('preserves the exact unresolved-purpose reason for an Other page', () => {
    const parsed = strictValidate(
      pageDetailSchema,
      {
        ...detail,
        page_kind: 'other',
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'not_measured',
        aeo_measurement_reason: 'page_purpose_unresolved',
      },
      'page',
    );

    expect(parsed.aeo_measurement_reason).toBe('page_purpose_unresolved');
    expect(parsed.aeo_readiness_score).toBeNull();
  });

  it('rejects retired rule outcomes outside the six-outcome vocabulary', () => {
    const evaluation = {
      id: UUID,
      rule_id: 'aeo.answer_first',
      title: 'Answer first',
      dimension: 'aeo',
      category: 'answerability',
      severity: 'medium',
      finding_class: 'defect',
      outcome: 'unavailable',
      display_applicability: true,
      score_applicability: true,
      checklist_membership: true,
      reason_code: 'provider_unavailable',
      score_roles: ['aeo_readiness'],
      aeo_pillar: 'answerability',
      weight: 1,
      evidence: {},
      analyzer_version: '1',
      rule_version: '1',
      created_at: '2026-07-15T00:00:00Z',
    };

    expect(() =>
      strictValidate(pageDetailSchema, { ...detail, evaluations: [evaluation] }, 'page'),
    ).toThrow();
  });

  it('rejects field_cwv_available true (crawler never fabricates field CWV)', () => {
    expect(() =>
      strictValidate(pageDetailSchema, { ...detail, field_cwv_available: true }, 'page'),
    ).toThrow();
  });

  it('strips a leaked LCP field (crawler never fabricates field CWV)', () => {
    const parsed = strictValidate(pageDetailSchema, { ...detail, lcp_ms: 1200 }, 'page');
    expect('lcp_ms' in parsed).toBe(false);
  });
});

describe('rerunPageResponseSchema (rerun identity/status)', () => {
  const base = {
    crawl_id: UUID,
    site_url_id: UUID2,
    task_id: UUID,
    created_new_crawl: true,
    analysis_status: 'pending' as const,
  };

  it('accepts a fresh-crawl rerun response', () => {
    const parsed = strictValidate(rerunPageResponseSchema, base, 'rerun');
    expect(parsed.created_new_crawl).toBe(true);
    expect(parsed.crawl_id).toBe(UUID);
  });

  it('accepts a same-active-crawl rerun response', () => {
    const parsed = strictValidate(
      rerunPageResponseSchema,
      { ...base, created_new_crawl: false, analysis_status: 'running' },
      'rerun',
    );
    expect(parsed.created_new_crawl).toBe(false);
  });

  it('rejects an unknown analysis_status', () => {
    expect(() =>
      strictValidate(rerunPageResponseSchema, { ...base, analysis_status: 'queued' }, 'rerun'),
    ).toThrow();
  });

  it('strips an additive field (tolerant-on-unknown)', () => {
    const parsed = strictValidate(
      rerunPageResponseSchema,
      { ...base, new_crawl_id: UUID },
      'rerun',
    );
    expect('new_crawl_id' in parsed).toBe(false);
  });
});

describe('siteIssueSchema + siteHealthErrorSchema', () => {
  it('accepts a valid issue row', () => {
    const issue = {
      group_id: UUID,
      crawl_id: UUID2,
      rule_id: 'meta.title.missing',
      page_kinds: ['article', 'guide'],
      dimension: 'aeo' as const,
      category: 'metadata',
      severity: 'high' as const,
      finding_class: 'defect' as const,
      title: 'Missing title',
      description: 'The page has no title.',
      remediation: 'Add a <title>.',
      remediation_route: 'content',
      affected_url_count: 4,
      analyzer_version: 'a1',
      rule_version: 'r1',
      created_at: '2026-07-15T00:00:00Z',
    };
    const parsed = strictValidate(siteIssueSchema, issue, 'issue');
    expect(parsed.severity).toBe('high');
    // The page types a grouped issue reaches ride the list row: "which of my
    // page types does this actually affect" is the first question on the
    // Issues screen, and the affected COUNT cannot answer it.
    expect(parsed.page_kinds).toEqual(['article', 'guide']);
  });

  it('accepts a quota error carrying limit + currently_used', () => {
    const err = {
      code: 'site_health_quota_exceeded' as const,
      message: 'over',
      limit: 50,
      currently_used: 50,
    };
    expect(strictValidate(siteHealthErrorSchema, err, 'err').limit).toBe(50);
  });

  it('accepts a stale-selection error carrying versions', () => {
    const err = {
      code: 'stale_selection_version' as const,
      message: 'stale',
      expected_selection_version: 3,
      current_selection_version: 5,
    };
    expect(strictValidate(siteHealthErrorSchema, err, 'err').current_selection_version).toBe(5);
  });

  it('rejects an unknown error code', () => {
    expect(() =>
      strictValidate(siteHealthErrorSchema, { code: 'kaboom', message: 'x' }, 'err'),
    ).toThrow();
  });
});

describe('query key isolation (project / crawl / filter)', () => {
  it('isolates inventory by crawl', () => {
    expect(queryKeys.siteHealth.inventory('c1')).not.toEqual(queryKeys.siteHealth.inventory('c2'));
  });

  it('isolates inventory by filter', () => {
    const a = queryKeys.siteHealth.inventory('c1', { query: 'foo' });
    const b = queryKeys.siteHealth.inventory('c1', { query: 'bar' });
    expect(a).not.toEqual(b);
  });

  it('isolates dashboard by project and crawl', () => {
    expect(queryKeys.siteHealth.dashboard('p1')).toEqual([
      'site-health',
      'dashboard',
      'p1',
      'latest',
    ]);
    expect(queryKeys.siteHealth.dashboard('p1', 'c1')).not.toEqual(
      queryKeys.siteHealth.dashboard('p1'),
    );
  });

  it('isolates issues by crawl and filter', () => {
    const a = queryKeys.siteHealth.issues('c1', { severity: 'high' });
    const b = queryKeys.siteHealth.issues('c1', { severity: 'low' });
    const c = queryKeys.siteHealth.issues('c2', { severity: 'high' });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('keeps monitored keyed per project', () => {
    expect(queryKeys.siteHealth.monitored('p1')).not.toEqual(queryKeys.siteHealth.monitored('p2'));
  });
});

describe('AEO Readiness contract', () => {
  it('keeps not-applicable distinct from a null readiness score', () => {
    const parsed = strictValidate(
      aeoReadinessSchema,
      {
        state: 'limited_evidence',
        crawl_id: UUID,
        score: null,
        coverage: 0,
        profile_version: 'sh-profiles-1',
        schema_contract_version: 'sh-schema-1',
        scoring_version: '1',
        presentation_version: 'sh-presentation-1',
        analyzer_version: 'page-v1',
        source_analysis_ids: [UUID2],
        analysis_count: 1,
        affected_page_count: 0,
        dimensions: [
          {
            key: 'freshness',
            label: 'Freshness',
            description: 'Whether the page says when it was written or updated.',
            dimension_applicability: 'applicable',
            dimension_measurement_state: 'not_measured',
            score: null,
            reason: 'no_expected_checkpoint_evaluator',
            checkpoint_ids: [],
            determinate_checkpoint_ids: [],
            unresolved_count: 0,
            earned_points: 0,
            determinate_points: 0,
            expected_points: 1,
            satisfied_count: 0,
            partial_count: 0,
            missing_count: 0,
            unknown_count: 0,
            not_applicable_count: 1,
            error_count: 0,
            coverage: 0,
            checked_page_count: 0,
            failing_page_count: 0,
            checks: [],
            evidence_pages: [],
            evidence_truncated: false,
          },
        ],
        limitations: [],
      },
      'readiness',
    );
    expect(parsed.dimensions[0]?.not_applicable_count).toBe(1);
    expect(parsed.score).toBeNull();
  });
});

// Sanity: cursorPageSchema is generic and composes with any item schema.
describe('cursorPageSchema generics', () => {
  it('composes with a trivial item schema', () => {
    const page = cursorPageSchema(z.strictObject({ x: z.number() }));
    expect(strictValidate(page, { items: [{ x: 1 }], next_cursor: null }, 'p').items[0]?.x).toBe(1);
  });
});
