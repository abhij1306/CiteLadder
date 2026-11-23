import { delay, http, HttpResponse, type HttpResponseResolver } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { figureText } from '@/test/figures';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders as raw, selectionAs, type TestRole } from '@/test/render';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import type { PageDetail } from '@citeladder/contracts';

import { parseAgentHandoff, type AgentHandoff } from '@/lib/agent/handoff';
import { AgentPanelProvider, useAgentPanel } from '@/lib/agent/panel-context';
import { UrlDetail } from './url-detail';
import {
  CRAWL,
  GROUP_H,
  ISSUE_H,
  ISSUE_L,
  URL_ID,
  pageDetail as detail,
} from './url-detail.test-support';

const NEW_CRAWL = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';

function resolvedIssue(id: string, title: string) {
  return {
    id,
    crawl_id: CRAWL,
    rule_id: 'technical.title_present',
    dimension: 'technical',
    category: 'metadata',
    severity: 'medium',
    title,
    description: 'The page has no title.',
    remediation: 'Add a title.',
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-01T00:00:00Z',
  };
}

async function openHistory(history: HttpResponseResolver) {
  mswServer.use(
    http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}`, () => HttpResponse.json(detail())),
    http.get(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/issue-history`, history),
  );
  const user = userEvent.setup();
  renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
  await user.click(await screen.findByRole('button', { name: 'History' }));
  return { user, drawer: await screen.findByRole('dialog', { name: 'Issue history' }) };
}

function allIssues(heading: string): HTMLElement {
  return screen.getByRole('heading', { name: heading }).closest('section')!;
}

function handoffOf(link: HTMLElement) {
  return parseAgentHandoff(new URL(link.getAttribute('href')!, 'http://x').searchParams);
}

function PanelSeedProbe() {
  const panel = useAgentPanel();
  return (
    <>
      <button type="button" onClick={() => panel?.setOpen(true)}>
        Open agent panel
      </button>
      <output data-testid="panel-seed">{JSON.stringify(panel?.seed ?? null)}</output>
    </>
  );
}

async function openedSeed(user: ReturnType<typeof userEvent.setup>): Promise<AgentHandoff> {
  await user.click(screen.getByRole('button', { name: 'Open agent panel' }));
  return JSON.parse(screen.getByTestId('panel-seed').textContent!) as AgentHandoff;
}

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function renderUrlDetail(
  ui: ReactElement,
  initialLocation = `/site/crawls/${CRAWL}/pages/${URL_ID}`,
  role: TestRole = 'owner',
) {
  window.history.replaceState(null, '', initialLocation);
  return raw(
    <>
      {ui}
      <LocationDisplay />
    </>,
    { projectSelection: { ...selectionAs(role), activeProject: makeProject() } },
  );
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
      await screen.findByText(
        "Couldn't load this page. It may not exist in this crawl.",
        {},
        { timeout: 4500 },
      ),
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
          items: [resolvedIssue(ISSUE_L, 'Page title is missing')],
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
    expect(within(drawer).getByRole('columnheader', { name: 'Last found' })).toBeInTheDocument();
  });

  it('keeps the resolved issues and the pager in place while the next history page loads', async () => {
    const { user, drawer } = await openHistory(async ({ request }) => {
      const next = new URL(request.url).searchParams.has('cursor');
      if (next) await delay(300);
      return HttpResponse.json({
        items: [
          next ? resolvedIssue(ISSUE_H, 'Older issue') : resolvedIssue(ISSUE_L, 'Newer issue'),
        ],
        next_cursor: next ? null : 'page-2',
        current_analysis_finalized: true,
      });
    });
    const table = within(drawer).getByRole('region', { name: 'Resolved issues' });
    await user.click(await within(drawer).findByRole('button', { name: 'Next page' }));
    expect(within(drawer).getByText('Newer issue')).toBeInTheDocument();
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(within(drawer).getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(await within(drawer).findByText('Older issue')).toBeInTheDocument();
    expect(within(drawer).queryByText('Newer issue')).not.toBeInTheDocument();
  });

  it('says inside the history table that resolved issues wait for the current analysis', async () => {
    const { drawer } = await openHistory(() =>
      HttpResponse.json({ items: [], next_cursor: null, current_analysis_finalized: false }),
    );
    const table = within(drawer).getByRole('region', { name: 'Resolved issues' });
    expect(
      await within(table).findByRole('heading', { name: 'Analysis not finished' }),
    ).toBeInTheDocument();
  });

  it('renders scores, delivery metrics, and severity-ordered issues', async () => {
    mswServer.use(...handlers(detail()));
    const user = userEvent.setup();

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    expect(
      await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 }),
    ).toBeInTheDocument();
    await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(
      screen
        .getAllByText('Acme Retail Online')
        .filter((node) => !node.closest('dl[aria-label="Page facts"]'))
        .map((node) => (node.closest('nav') ? 'trail' : node.tagName)),
    ).toEqual(['trail', 'H1']);
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('840ms')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    const list = allIssues('All issues (2)');
    const high = within(list).getByText('WebSite schema is missing');
    const low = within(list).getByText('FAQ schema not present');
    expect(high.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('expected types WebSite, found types Organization')).toBeNull();
    await user.click(within(list).getByRole('button', { name: /WebSite schema is missing/ }));
    expect(
      screen.getByText('expected types WebSite, found types Organization'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Observed evidence')).not.toBeInTheDocument();
  });

  it('offers re-audits only to a role that may run one', async () => {
    mswServer.use(...handlers(detail()));
    const { unmount } = renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
    expect(await screen.findAllByRole('button', { name: /^Re-audit/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Re-audit this page' })).toBeVisible();
    unmount();

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />, undefined, 'viewer');
    expect(
      await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Re-audit/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'History' })).toBeVisible();
  });

  it('opens as a page detail trailed through Pages, with no back link', async () => {
    mswServer.use(...handlers(detail()));
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Pages' }).getAttribute('href')).toMatch(
      /^\/site\?tab=pages/,
    );
    expect(within(trail).getByText('Acme Retail Online').closest('li')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('link', { name: /^Back to/ })).not.toBeInTheDocument();
  });

  it('lists every shown check as passed, failed or not checked under its score', async () => {
    const check = (
      id: string,
      title: string,
      fields: Partial<PageDetail['evaluations'][number]>,
    ): PageDetail['evaluations'][number] => ({
      id,
      rule_id: `rule.${id.slice(0, 4)}`,
      title,
      dimension: 'technical',
      category: 'metadata',
      severity: 'medium',
      finding_class: 'defect',
      outcome: 'satisfied',
      display_applicability: true,
      score_applicability: true,
      checklist_membership: true,
      reason_code: '',
      score_roles: [],
      aeo_pillar: '',
      weight: 1,
      evidence: {},
      analyzer_version: 'a1',
      rule_version: 'r1',
      created_at: '2026-07-16T00:00:00Z',
      ...fields,
    });
    mswServer.use(
      ...handlers(
        detail({
          evaluations: [
            check('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Title present', {
              score_roles: ['web_fundamentals'],
            }),
            check('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Schema matches content', {
              outcome: 'missing',
              score_roles: ['aeo_readiness'],
              aeo_pillar: 'machine-readability',
            }),
            check('33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sitemap lists page', {
              outcome: 'unknown',
            }),
            check('44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Product price shown', {
              outcome: 'not_applicable',
              display_applicability: false,
            }),
          ],
        }),
      ),
    );
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    const rows = (name: string) =>
      within(screen.getByRole('table', { name }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);
    await screen.findByRole('heading', { name: 'Checks' });
    expect(rows('Web fundamentals (1)')).toEqual(['Title presentPassed']);
    expect(rows('AEO readiness · Machine readability (1)')).toEqual([
      'Schema matches contentFailed',
    ]);
    expect(rows('Site (1)')).toEqual(['Sitemap lists pageNot checked']);
    expect(screen.queryByText('Product price shown')).not.toBeInTheDocument();
  });

  it('says an unknown compression is not measured rather than "none"', async () => {
    const known = detail().delivery;
    mswServer.use(...handlers(detail({ delivery: { ...known, compression: null } })));
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    const compression = screen.getByText('Compression').closest('div');
    expect(compression).toHaveTextContent('Not measured');
    expect(compression).not.toHaveTextContent('none');
    expect(screen.getByText('Response size').closest('div')).toHaveTextContent('142 KB');
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
    expect(screen.queryByRole('img', { name: /^AEO readiness score:/ })).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole('img', { name: /^(Web fundamentals|AEO readiness) score:/ }),
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
      const unsupported = screen.queryAllByText('No AEO checklist for this page kind');
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
    expect(figureText('Web fundamentals')).toBe('46');
    expect(figureText('AEO readiness')).toBe('64');
    expect(figureText('AEO checklist completion')).toBe('75%');
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
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.getByText('39.1 KB')).toBeInTheDocument();
  });

  it('tells the person to wait when a crawl is running, and stays on the page', async () => {
    mswServer.use(
      ...handlers(detail({ analysis_status: 'completed' })),
      http.post(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/rerun`, () =>
        HttpResponse.json(
          {
            error: { code: 'crawl_already_active', message: 'Project already has an active crawl' },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Re-audit this page' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A crawl is running. Re-audit this page when it finishes.');
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/site/crawls/${CRAWL}/pages/${URL_ID}`,
    );
  });

  it('a rerun navigates to its own one-page crawl identity detail route with ?rerun=1', async () => {
    mswServer.use(
      ...handlers(detail({ analysis_status: 'completed' })),
      http.post(`/api/v1/site-crawls/${CRAWL}/pages/${URL_ID}/rerun`, () =>
        HttpResponse.json(
          {
            crawl_id: NEW_CRAWL,
            site_url_id: URL_ID,
            task_id: TASK_ID,
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

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This page is not in your monitored set, so it can’t be re-audited.',
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

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    expect(screen.getByText('Pending')).toBeInTheDocument();
    await waitFor(() => expect(getCallCount).toBeGreaterThanOrEqual(statuses.length), {
      timeout: 15_000,
    });
    await waitFor(() => expect(screen.queryByText('Running')).not.toBeInTheDocument());
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  }, 20_000);

  it('keeps delivery and internal-link measurements collapsed under Technical details', async () => {
    mswServer.use(...handlers(detail()));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    const user = userEvent.setup();
    const summary = screen.getByText('Technical details');
    const disclosure = summary.closest('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    await user.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(within(disclosure).getByText('840ms')).toBeVisible();
    expect(within(disclosure).getByText('Main-content inbound')).toBeVisible();
    expect(screen.getByText('7 pages crawled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://acme.com/collections/bags' })).toHaveAttribute(
      'href',
      `/site/crawls/${CRAWL}/pages/dddddddd-1111-4111-8111-111111111111`,
    );
    expect(screen.getByText('This page links to no other crawled page.')).toBeInTheDocument();
  });

  it('distinguishes unmeasured internal links from an observed zero', async () => {
    mswServer.use(...handlers(detail({ internal_links: null })));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });
    await userEvent.setup().click(screen.getByText('Technical details'));
    expect(screen.getByText("Internal links weren't counted for this page.")).toBeVisible();
  });

  it('lists every issue once in one list, worst first, with its severity, each row opening its fix', async () => {
    const [low, high] = detail().issues;
    mswServer.use(
      ...handlers(
        detail({
          issues: [
            { ...low!, remediation: 'Add FAQPage markup to the questions.' },
            high!,
            {
              ...low!,
              occurrence_id: 'ffffffff-1111-4111-8111-111111111111',
              rule_id: 'technical.meta_description_present',
              issue_title: 'Missing meta description',
              severity: 'medium',
              evidence: { present: false },
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    await screen.findByRole('heading', { name: 'All issues (3)' });
    const list = allIssues('All issues (3)');
    const rows = within(list).getAllByRole('button', { expanded: false });
    expect(rows.map((row) => row.textContent)).toEqual([
      'WebSite schema is missingHighAEO',
      'Missing meta descriptionMediumAEO',
      'FAQ schema not presentLowAEO',
    ]);
    await user.click(rows[2]!);
    await user.click(rows[0]!);
    for (const title of ['WebSite schema is missing', 'FAQ schema not present'])
      expect(screen.getAllByText(title)).toHaveLength(1);
    const faq = document.getElementById(rows[2]!.getAttribute('aria-controls')!)!;
    expect(within(faq).getByText('Add FAQPage markup to the questions.')).toBeInTheDocument();
    const website = document.getElementById(rows[0]!.getAttribute('aria-controls')!)!;
    expect(
      within(website)
        .getAllByText(/^(AEO readiness|Web fundamentals)$/)
        .map((badge) => badge.textContent),
    ).toEqual(['AEO readiness', 'Web fundamentals']);
    expect(screen.queryByText(/^Advisories/)).toBeNull();
    expect(figureText('Web fundamentals')).toBe('46');
    const score = document.querySelector('[data-figure-strip]')!;
    expect(score.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hands the agent the page, or one issue on it, by id and never by evidence', async () => {
    mswServer.use(...handlers(detail()));
    const user = userEvent.setup();
    renderUrlDetail(
      <AgentPanelProvider>
        <UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />
        <PanelSeedProbe />
      </AgentPanelProvider>,
    );
    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });

    expect(screen.queryByRole('link', { name: 'Ask agent about this page' })).toBeNull();
    const page = await openedSeed(user);
    expect(page.context).toEqual({ target_site_url_id: URL_ID, target_url: 'https://acme.com/' });
    expect(page.prompt).toBe(
      'Review the 2 Website issues on https://acme.com/, worst first, and propose exact page edits for each.',
    );
    expect(page.skillId).toBe('technical_health');
    const row = screen.getByRole('button', { name: /WebSite schema is missing/ });
    await user.click(row);
    const body = document.getElementById(row.getAttribute('aria-controls')!)!;
    const issue = handoffOf(within(body).getByRole('link', { name: 'Ask agent' }));
    expect(issue.context).toEqual({
      issue_group_reference: { crawl_id: CRAWL, group_id: GROUP_H, site_url_id: URL_ID },
    });
    expect(issue.skillId).toBe('technical_health');
  });

  it('asks the agent why a page’s audit did not finish, rather than how ready the page is', async () => {
    mswServer.use(...handlers(detail({ analysis_status: 'error', issues: [] })));
    const user = userEvent.setup();
    renderUrlDetail(
      <AgentPanelProvider>
        <UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />
        <PanelSeedProbe />
      </AgentPanelProvider>,
    );
    await screen.findByRole('heading', { name: 'Acme Retail Online', level: 1 });

    const page = await openedSeed(user);
    expect(page.prompt).toMatch(/^The Website audit of https:\/\/acme\.com\/ did not complete/);
  });

  it('shows five issues until asked for all, and opens the one chosen in place', async () => {
    const [base] = detail().issues;
    const issues = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'].map(
      (name, index) => ({
        ...base!,
        occurrence_id: `ffffffff-${String(index).padStart(4, '0')}-4111-8111-111111111111`,
        issue_title: `${name} issue`,
      }),
    );
    mswServer.use(...handlers(detail({ issues })));
    const user = userEvent.setup();
    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);
    await screen.findByRole('heading', { name: 'All issues (7)' });

    const list = allIssues('All issues (7)');
    expect(within(list).getByText('Fifth issue')).toBeInTheDocument();
    expect(within(list).queryByText('Sixth issue')).toBeNull();
    await user.click(within(list).getByRole('button', { name: 'View all 7 issues' }));
    const seventh = within(list).getByRole('button', { name: /Seventh issue/ });
    await user.click(seventh);
    expect(seventh).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(seventh.getAttribute('aria-controls')!)!;
    expect(within(body).getByRole('button', { name: 'Copy fix prompt' })).toBeVisible();
    expect(within(list).getAllByRole('button', { expanded: true })).toEqual([seventh]);
  });

  it('says so plainly when a page has nothing to fix', async () => {
    mswServer.use(...handlers(detail({ issues: [] })));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    expect(await screen.findByRole('heading', { name: 'All issues (0)' })).toBeInTheDocument();
    expect(screen.getByText('No issues found.')).toBeInTheDocument();
  });

  it('does not call a page clean before its audit finishes', async () => {
    mswServer.use(...handlers(detail({ issues: [], analysis_status: 'pending' })));

    renderUrlDetail(<UrlDetail crawlId={CRAWL} siteUrlId={URL_ID} />);

    expect(await screen.findByText('Audit not finished.')).toBeInTheDocument();
    expect(screen.queryByText('No issues found.')).not.toBeInTheDocument();
  });
});
