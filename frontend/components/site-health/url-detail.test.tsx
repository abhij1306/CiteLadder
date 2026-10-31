import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders as raw } from '@/test/render';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import type { PageDetail } from '@/lib/api/types';

import { UrlDetail } from './url-detail';

const CRAWL = '44444444-4444-4444-8444-444444444444';
const NEW_CRAWL = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const URL_ID = 'cccccccc-1111-4111-8111-111111111111';
const ISSUE_H = 'aaaaaaaa-1111-4111-8111-111111111111';
const ISSUE_L = 'bbbbbbbb-1111-4111-8111-111111111111';

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function renderUrlDetail(
  ui: ReactElement,
  initialLocation = `/site/crawls/${CRAWL}/pages/${URL_ID}`,
) {
  window.history.replaceState(null, '', initialLocation);
  return raw(
    <>
      {ui}
      <LocationDisplay />
    </>,
  );
}

function detail(overrides: Partial<PageDetail> = {}): PageDetail {
  return {
    site_url_id: URL_ID,
    crawl_id: CRAWL,
    normalized_url: 'https://acme.com/',
    display_url: 'https://acme.com/',
    title: 'Acme Retail Online',
    analysis_status: 'completed',
    error_code: '',
    linked_from: [],
    field_cwv_available: false,
    web_fundamentals_score: 46,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 64,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    aeo_measurement_reason: '',
    main_content_indexable: true,
    issue_count: 2,
    last_audited: '2026-07-16T00:00:00Z',
    page_kind: 'product',
    // A product page that also carries an FAQ: exactly the hybrid a single
    // exclusive page_kind could not express.
    page_traits: ['has_faq', 'has_variants'],
    // Persisted classifier evidence (v2 P1) — a schema-conflict scenario:
    // the path pattern chose Product while the markup declares Article.
    page_kind_evidence: {
      classifier_version: 'sh-classifier-1',
      classified_by: 'path_pattern',
      schema_suggested_type: 'article',
      confidence: 'medium',
      tier: 'route',
      signals: [
        {
          signal: 'path_pattern',
          page_kind: 'product',
          tier: 'route',
          detail: '^/(products?|p|shop)(/|$)',
        },
        {
          signal: 'structured_data',
          page_kind: 'article',
          tier: 'semantic',
          detail: 'Article',
        },
      ],
    },
    facts: {
      title: 'Acme Retail Online',
      meta_description: null,
      canonical_url: null,
      robots_directives: [],
      h1_count: 1,
      heading_count: 4,
      image_count: 3,
      image_missing_alt_count: 0,
      word_count: 500,
      internal_link_count: 10,
      external_link_count: 2,
      structured_data_types: [],
    },
    delivery: {
      field_cwv_available: false,
      status_code: 200,
      ttfb_ms: 840,
      wire_bytes: 40000,
      decoded_bytes: 145408,
      html_bytes: 145408,
      http_version: 'HTTP/2',
      compression: 'gzip',
      cache_control: 'no-cache',
      blocking_resource_count: 0,
    },
    internal_links: {
      inbound_count: 12,
      outbound_count: 30,
      main_content_inbound_count: 4,
      main_content_outbound_count: 9,
      nofollow_inbound_count: 1,
      depth_from_home: 2,
      source_page_count: 7,
      authority_share: 0.1275,
      authority_rank: 3,
      authority_scope: 'observed_crawl',
      observed_crawl_incomplete: false,
      anchor_diagnostics: [],
      top_inbound: [
        {
          site_url_id: 'dddddddd-1111-4111-8111-111111111111',
          url: 'https://acme.com/collections/bags',
          anchor_count: 3,
          main_content: true,
          nofollow: false,
          rel: [],
        },
      ],
      top_outbound: [],
      formula_version: 'sh-link-metrics-1',
    },
    issues: [
      {
        occurrence_id: ISSUE_L,
        evaluation_id: 'eeeeeeee-1111-4111-8111-111111111111',
        crawl_id: CRAWL,
        rule_id: 'aeo.faq',
        site_url_id: URL_ID,
        normalized_url: 'https://acme.com/',
        display_url: 'https://acme.com/',
        title: 'Acme Retail Online',
        page_kind: 'article',
        dimension: 'aeo',
        category: 'schema',
        severity: 'low',
        finding_class: 'defect',
        issue_title: 'FAQ schema not present',
        description: 'FAQ structured data is not present.',
        remediation: '',
        reason_code: 'expected_schema_absent',
        evidence: { expected_types: ['FAQPage'], found_types: [] },
        analyzer_version: 'a1',
        rule_version: 'r1',
        created_at: '2026-07-16T00:00:00Z',
      },
      {
        occurrence_id: ISSUE_H,
        evaluation_id: 'eeeeeeee-2222-4111-8111-111111111111',
        crawl_id: CRAWL,
        rule_id: 'aeo.website_schema',
        site_url_id: URL_ID,
        normalized_url: 'https://acme.com/',
        display_url: 'https://acme.com/',
        title: 'Acme Retail Online',
        page_kind: 'homepage',
        dimension: 'aeo',
        category: 'schema',
        severity: 'high',
        finding_class: 'defect',
        issue_title: 'WebSite schema is missing',
        description: 'WebSite structured data is not present.',
        remediation: '',
        reason_code: 'expected_schema_absent',
        evidence: { expected_types: ['WebSite'], found_types: ['Organization'] },
        analyzer_version: 'a1',
        rule_version: 'r1',
        created_at: '2026-07-16T00:00:00Z',
      },
    ],
    evaluations: [],
    artifact_id: null,
    extractor_version: 'e1',
    analyzer_version: 'a1',
    rule_version: 'r1',
    scoring_version: 's1',
    ...overrides,
  };
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => mswServer.close());

function handlers(pageDetail: PageDetail) {
  return [
    http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, () => HttpResponse.json(pageDetail)),
  ];
}

describe('UrlDetail', () => {
  it('recovers a failed page read with its request reference and exact retry', async () => {
    let reads = 0;
    let available = false;
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, () => {
        reads += 1;
        return available
          ? HttpResponse.json(detail())
          : HttpResponse.json(
              { error: { message: 'Page temporarily unavailable' } },
              { status: 503, headers: { 'X-Request-ID': 'page-read-reference' } },
            );
      }),
      ...handlers(detail()),
    );
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
    expect(
      await screen.findByText('Reference: page-read-reference', {}, { timeout: 4500 }),
    ).toBeInTheDocument();
    const beforeRetry = reads;
    available = true;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 }),
    ).toBeInTheDocument();
    expect(reads).toBe(beforeRetry + 1);
  });

  it('reports access failures without implying the page is missing or exposing retry', async () => {
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, () =>
        HttpResponse.json({ error: { message: 'Workspace access denied' } }, { status: 403 }),
      ),
    );
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
    expect(await screen.findByText('Workspace access denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/may not exist/)).not.toBeInTheDocument();
  });
  it('opens resolved issue history in a drawer instead of inline', async () => {
    let historyReads = 0;
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, () => HttpResponse.json(detail())),
      http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/issue-history`, () => {
        historyReads += 1;
        return HttpResponse.json({
          items: [
            {
              id: ISSUE_L,
              crawl_id: CRAWL,
              rule_id: 'technical.title_present',
              dimension: 'technical',
              category: 'metadata',
              severity: 'medium',
              finding_class: 'defect',
              title: 'Page title is missing',
              description: 'The page has no title.',
              remediation: 'Add a title.',
              analyzer_version: 'a1',
              rule_version: 'r1',
              created_at: '2026-07-01T00:00:00Z',
            },
          ],
          next_cursor: null,
          current_analysis_finalized: true,
        });
      }),
    );
    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.queryByText('Issue history')).not.toBeInTheDocument();
    expect(historyReads).toBe(0);

    await user.click(screen.getByRole('button', { name: 'History' }));
    const drawer = await screen.findByRole('dialog', { name: 'Issue history' });
    expect(await within(drawer).findByText('Page title is missing')).toBeInTheDocument();
    expect(within(drawer).getByText(/^Last found/)).toBeInTheDocument();
  });

  it('renders scores, delivery metrics, and severity-ordered issues', async () => {
    mswServer.use(...handlers(detail()));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    expect(
      await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    // Delivery metric: TTFB rendered with ms suffix.
    expect(screen.getByText('840ms')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    // High-severity issue is ordered before the low-severity one.
    const high = screen.getByText('WebSite schema is missing');
    const low = screen.getByText('FAQ schema not present');
    expect(high.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByText('expected types WebSite, found types Organization'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Observed evidence')).not.toBeInTheDocument();
  });

  it('renders a persisted unresolved-purpose state simply as not measured', async () => {
    mswServer.use(
      ...handlers(
        detail({
          page_kind: 'other',
          aeo_readiness_score: null,
          aeo_measurement_coverage: null,
          aeo_measurement_state: 'not_measured',
          aeo_measurement_reason: 'page_purpose_unresolved',
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.queryByText(/purpose unresolved/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^AEO Readiness score:/ })).not.toBeInTheDocument();
  });

  it('renders the not-measured state for a missing score, never a zero', async () => {
    mswServer.use(
      ...handlers(
        detail({
          web_fundamentals_score: null,
          web_fundamentals_coverage: null,
          web_fundamentals_state: 'not_measured',
          aeo_readiness_score: null,
          aeo_measurement_coverage: null,
          aeo_measurement_state: 'not_measured',
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    // No score ring at all: a missing measurement never renders as 0.
    expect(
      screen.queryByRole('img', { name: /^(Web Fundamentals|AEO Readiness) score:/ }),
    ).toBeNull();
  });

  it.each(['page_purpose_unresolved', 'unsupported_purpose_checklist'])(
    'distinguishes unavailable purpose: %s',
    async (reason) => {
      mswServer.use(
        ...handlers(
          detail({
            aeo_readiness_score: null,
            aeo_measurement_coverage: null,
            aeo_measurement_state: 'not_measured',
            aeo_measurement_reason: reason,
          }),
        ),
      );
      renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
      await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
      const unsupported = screen.queryAllByText(/Unsupported purpose checklist/);
      expect(unsupported).toHaveLength(reason === 'unsupported_purpose_checklist' ? 2 : 0);
    },
  );

  it('renders partial scores with checklist completion', async () => {
    mswServer.use(
      ...handlers(
        detail({
          web_fundamentals_score: 46,
          web_fundamentals_coverage: 0.5,
          web_fundamentals_state: 'limited_evidence',
          aeo_readiness_score: 64,
          aeo_measurement_coverage: 0.75,
          aeo_measurement_state: 'limited_evidence',
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getByRole('img', { name: 'Web Fundamentals score: 46' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Readiness score: 64' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AEO Checklist Completion: 75%' })).toBeInTheDocument();
  });

  it('preserves the AEO state when measurement coverage is unavailable', async () => {
    mswServer.use(
      ...handlers(
        detail({
          aeo_readiness_score: null,
          aeo_measurement_coverage: null,
          aeo_measurement_state: 'excluded',
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getAllByText('Excluded')).toHaveLength(2);
  });

  it('renders the placeholder (not "no-cache") for a missing Cache-Control header', async () => {
    mswServer.use(
      ...handlers(
        detail({
          delivery: {
            field_cwv_available: false,
            status_code: 200,
            ttfb_ms: 840,
            wire_bytes: 40000,
            decoded_bytes: 145408,
            html_bytes: 145408,
            http_version: 'HTTP/2',
            compression: 'gzip',
            cache_control: null,
            blocking_resource_count: 0,
          },
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.queryByText('no-cache')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
  });

  it('renders the placeholder (not "0ms") for an unmeasured TTFB', async () => {
    mswServer.use(
      ...handlers(
        detail({
          delivery: {
            field_cwv_available: false,
            status_code: 200,
            ttfb_ms: 0,
            wire_bytes: 40000,
            decoded_bytes: 145408,
            html_bytes: 145408,
            http_version: 'HTTP/2',
            compression: 'gzip',
            cache_control: 'no-cache',
            blocking_resource_count: 0,
          },
        }),
      ),
    );

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    // A 0 ms reading is an unmeasured hop, never an instant response.
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    // Byte counts do NOT share the zero rule — they still render normally.
    expect(screen.getByText('39.1 KB')).toBeInTheDocument();
  });

  it('same-active-crawl rerun: polls in place through completed → pending → running → completed without navigating', async () => {
    // The rerun response points at the SAME crawl/URL (created_new_crawl
    // false), so the component must poll in place — never navigate.
    //
    // Sequence of `analysis_status` snapshots the GET handler serves on
    // each successive request. The first GET (initial render) sees
    // 'completed'. The rerun POST enqueues a fresh task, after which the
    // *next* GETs must walk through 'pending' then 'running' before
    // landing on a new 'completed' — proving polling doesn't stop on the
    // stale cached terminal status right after the mutation resolves.
    const statuses: PageDetail['analysis_status'][] = [
      'completed',
      'pending',
      'running',
      'completed',
    ];
    let getCallCount = 0;

    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, async () => {
        const status = statuses[Math.min(getCallCount, statuses.length - 1)];
        getCallCount += 1;
        // Small artificial network delay so the mutation's own
        // `invalidateQueries` refetch (triggered inside `onSuccess`) does
        // not resolve synchronously before the next render — this
        // reproduces the real race where React re-renders with
        // `rerunPolling` newly `true` while the query cache still holds
        // the *previous* terminal snapshot.
        await new Promise((resolve) => {
          setTimeout(resolve, 15);
        });
        return HttpResponse.json(detail({ analysis_status: status }));
      }),
      http.post(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/rerun`, () =>
        HttpResponse.json(
          {
            crawl_id: CRAWL,
            site_url_id: URL_ID,
            task_id: TASK_ID,
            created_new_crawl: false,
            analysis_status: 'pending',
          },
          { status: 202 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    // Initial fetch observes the prior run's terminal 'completed' snapshot.
    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getByRole('button', { name: 'Re-audit this page' })).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Re-audit this page' }));

    // The status badge must actually be observed to reach 'Running' at
    // some point (not just eventually land back on 'Completed', which the
    // stale pre-rerun cache would already show without ever polling
    // further).
    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument(), {
      timeout: 15_000,
    });

    // Polling continues past 'running' until the freshly-enqueued task
    // reaches its own terminal 'completed' snapshot.
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument(), {
      timeout: 15_000,
    });

    await waitFor(() => expect(getCallCount).toBeGreaterThanOrEqual(statuses.length), {
      timeout: 15_000,
    });

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Re-audit queued' })).toBeInTheDocument(),
      { timeout: 15_000 },
    );

    // A same-crawl rerun never navigates.
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/site/crawls/${CRAWL}/pages/${URL_ID}`,
    );
  }, 20_000);

  it('created_new_crawl rerun: navigates to the fresh crawl identity detail route with ?rerun=1', async () => {
    mswServer.use(
      ...handlers(detail({ analysis_status: 'completed' })),
      http.post(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/rerun`, () =>
        HttpResponse.json(
          {
            crawl_id: NEW_CRAWL,
            site_url_id: URL_ID,
            task_id: TASK_ID,
            created_new_crawl: true,
            analysis_status: 'pending',
          },
          { status: 202 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Re-audit this page' }));

    // The rerun ran in a NEW crawl, so the client routes to that fresh
    // identity's canonical detail route (with ?rerun=1 to auto-start polling
    // on the new mount) rather than continuing to poll the terminal source.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/site/crawls/${NEW_CRAWL}/pages/${URL_ID}?rerun=1`,
      ),
    );
  });

  it('shows a helpful alert when rerun is rejected for an unmonitored page', async () => {
    mswServer.use(
      ...handlers(detail({ analysis_status: 'completed' })),
      http.post(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/rerun`, () =>
        HttpResponse.json({ error: { message: 'rerun_not_allowed' } }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Re-audit this page' }));

    // `role="alert"` does not take its accessible name from its contents, so
    // find the alert and assert on its text.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This page is not in your monitored set — add it before re-auditing.',
    );
  });

  it('landing on a fresh rerun crawl with ?rerun=1 begins polling immediately', async () => {
    const statuses: PageDetail['analysis_status'][] = ['pending', 'running', 'completed'];
    let getCallCount = 0;

    mswServer.use(
      http.get(`/api/v1/site-crawls/${NEW_CRAWL}/pages/${URL_ID}`, () => {
        const status = statuses[Math.min(getCallCount, statuses.length - 1)];
        getCallCount += 1;
        return HttpResponse.json(detail({ crawl_id: NEW_CRAWL, analysis_status: status }));
      }),
    );

    renderUrlDetail(
      <UrlDetail crawlId={NEW_CRAWL} siteUrlId={URL_ID} />,
      `/site/crawls/${NEW_CRAWL}/pages/${URL_ID}?rerun=1`,
    );

    // No button click: `?rerun=1` seeds polling on mount, so the fresh run's
    // progress advances to its terminal snapshot on its own.
    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument(), {
      timeout: 15_000,
    });
    expect(getCallCount).toBeGreaterThanOrEqual(statuses.length);
  }, 20_000);

  it('switches page measurements without losing internal-link evidence', async () => {
    mswServer.use(...handlers(detail()));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    const user = userEvent.setup();
    const delivery = screen.getByRole('tab', { name: 'Delivery Metrics' });
    const links = screen.getByRole('tab', { name: 'Internal Links' });
    expect(delivery).toHaveAttribute('aria-selected', 'true');
    await user.click(links);
    expect(links).toHaveAttribute('aria-selected', 'true');
    // Inbound and main-content inbound are different facts and both are shown.
    expect(screen.getByText('Main-content inbound')).toBeInTheDocument();
    expect(screen.getByText('Modelled over 7 observed crawl pages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://acme.com/collections/bags' })).toHaveAttribute(
      'href',
      `/site/crawls/${CRAWL}/pages/dddddddd-1111-4111-8111-111111111111`,
    );
    expect(screen.getByText('This page links to no other crawled page.')).toBeInTheDocument();
    links.focus();
    await user.keyboard('{ArrowLeft}');
    expect(delivery).toHaveAttribute('aria-selected', 'true');
  });

  it('shows both measurement sections on a phone without requiring a tab switch', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 980px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mswServer.use(...handlers(detail()));
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getByRole('heading', { name: 'Delivery Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Internal Links' })).toBeInTheDocument();
    expect(screen.getByText('Main-content inbound')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Internal Links' })).not.toBeInTheDocument();
  });

  it('distinguishes unmeasured internal links from an observed zero', async () => {
    mswServer.use(...handlers(detail({ internal_links: null })));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Internal Links' }));
    expect(screen.getByText('Internal links not measured for this page.')).toBeInTheDocument();
  });

  it('explains unavailable internal links in the phone layout', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 980px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mswServer.use(...handlers(detail({ internal_links: null })));
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getByRole('heading', { name: 'Internal Links' })).toBeInTheDocument();
    expect(screen.getByText('Internal links not measured for this page.')).toBeVisible();
  });
});
