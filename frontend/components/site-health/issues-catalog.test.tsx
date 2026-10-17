import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import type { IssueOccurrence, SiteIssue } from '@/lib/api/types';
import { parseAgentHandoff } from '@/lib/agent/handoff';
import { IssuesCatalog as ScopedIssuesCatalog } from './issues-catalog';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function IssuesCatalog(props: Readonly<{ crawlId: string }>) {
  return <ScopedIssuesCatalog workspaceId={WORKSPACE} {...props} />;
}

/**
 * The catalog's filters live in the address bar through
 * `lib/navigation/url-state.ts`. No router is registered in this file, so it
 * takes its `window.history` fallback — which is why the URL contract is
 * asserted against `window.location` and browser history is driven with the
 * real `history.back()`/`forward()`.
 */
function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

function renderIssues(
  ui: ReactElement,
  initialLocation = window.location.pathname + window.location.search,
) {
  window.history.replaceState(null, '', initialLocation);
  return renderWithProviders(ui);
}

const CRAWL = '44444444-4444-4444-8444-444444444444';
const ISSUE_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const URL_A = 'cccccccc-1111-4111-8111-111111111111';

function issue(overrides: Partial<SiteIssue> = {}): SiteIssue {
  return {
    group_id: ISSUE_A,
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    page_kinds: [],
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    finding_class: 'defect',
    title: 'WebSite schema is missing',
    description: 'Search engines cannot find WebSite structured data on this page.',
    remediation: 'Add a JSON-LD WebSite schema.',
    remediation_route: 'code',
    affected_url_count: 32,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function occurrence(overrides: Partial<IssueOccurrence> = {}): IssueOccurrence {
  return {
    occurrence_id: 'dddddddd-1111-4111-8111-111111111111',
    evaluation_id: 'eeeeeeee-1111-4111-8111-111111111111',
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    site_url_id: URL_A,
    normalized_url: 'https://acme.com/',
    display_url: 'https://acme.com/',
    title: 'Homepage',
    page_kind: 'article',
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    finding_class: 'defect',
    issue_title: 'WebSite schema is missing',
    description: 'Expected WebSite structured data is absent.',
    remediation: 'Add a JSON-LD WebSite schema.',
    reason_code: 'expected_schema_absent',
    evidence: { expected_types: ['WebSite'], found_types: ['Organization'] },
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function issueDetail(overrides: Record<string, unknown> = {}) {
  return {
    group_id: ISSUE_A,
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    finding_class: 'defect',
    title: 'WebSite schema is missing',
    description: 'Search engines cannot find WebSite structured data on this page.',
    remediation: 'Add a JSON-LD WebSite schema.',
    remediation_route: 'code',
    occurrences: [occurrence()],
    occurrence_count: 1,
    affected_url_count: 1,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    next_cursor: null,
    ...overrides,
  };
}

const summary = {
  issue_count: 47,
  defect_issue_type_count: 47,
  advisory_issue_type_count: 2,
  occurrence_count: 94,
  severity_counts: { high: 12, medium: 23, low: 12 },
  dimension_counts: { technical: 30, aeo: 17 },
  affected_url_count: 50,
  monitored_affected_url_count: 38,
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  window.history.replaceState(null, '', '/issues');

  mswServer.use(
    http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, () =>
      HttpResponse.json(issueDetail()),
    ),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('IssuesCatalog', () => {
  /**
   * The occurrences of the auto-selected issue are a THIRD request, and it
   * cannot start until the second one names an issue to ask about. Holding the
   * screen for it meant a reader waited three sequential round trips to see a
   * list the second had already answered in full.
   *
   * So the list opens on its own and the rail carries its own wait. What the
   * rail must not do is grow under the reader when it lands, which is what the
   * reserved height and its placeholder rows are for.
   */
  it('opens the list as soon as it lands, with the rail still resolving', async () => {
    let releaseDetail!: () => void;
    const detailSettled = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, async () => {
        await detailSettled;
        return HttpResponse.json(issueDetail());
      }),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    // Readable and interactive while the occurrences are still in flight.
    expect(
      await screen.findByRole('heading', { name: 'WebSite schema is missing' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading issues…' })).toBeNull();
    // "none" must not be claimed while the answer is "not yet".
    expect(screen.queryByText('No affected URLs found.')).toBeNull();

    act(() => releaseDetail());

    expect(await screen.findByRole('link', { name: /Homepage/ })).toBeInTheDocument();
  });

  /** The screen still waits for the list itself — there is nothing to show without it. */
  it('holds the screen-shaped loading presentation until the list lands', async () => {
    let releaseIssues!: () => void;
    const issuesSettled = new Promise<void>((resolve) => {
      releaseIssues = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, async () => {
        await issuesSettled;
        return HttpResponse.json({ items: [issue()], next_cursor: null, summary });
      }),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, () =>
        HttpResponse.json(issueDetail()),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const loadingStatus = await screen.findByRole('status', { name: 'Loading issues…' });
    expect(loadingStatus.closest('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WebSite schema is missing' })).toBeNull();

    act(() => releaseIssues());

    expect(
      await screen.findByRole('heading', { name: 'WebSite schema is missing' }),
    ).toBeInTheDocument();
  });

  /**
   * The counterpart to the gate above: it must close only ONCE. Selecting a
   * second issue re-keys the detail query, and `siteHealthQueries.issue`
   * retains the previous crawl-scoped occurrences across that change, so the
   * catalog stays on screen and the rail marks itself busy instead of the
   * whole view dropping back to its loading presentation. The rail keeps the
   * previous issue AND its pages together until the new pair arrives — a new
   * title over the old issue's URLs would be a caption for pages it does not
   * describe.
   */
  it('keeps the catalog drawn, and the rail coherent, while a later selection loads', async () => {
    const user = userEvent.setup();
    const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222';
    let holdSecond = false;
    let releaseSecond!: () => void;
    const secondSettled = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({
          items: [issue(), issue({ group_id: OTHER, title: 'Canonical tag is missing' })],
          next_cursor: null,
          summary,
        }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${OTHER}`, async () => {
        holdSecond = true;
        await secondSettled;
        return HttpResponse.json(
          issueDetail({ group_id: OTHER, title: 'Canonical tag is missing' }),
        );
      }),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('link', { name: /Homepage/ });

    await user.click(screen.getByRole('button', { name: /Canonical tag is missing/ }));

    await waitFor(() => expect(holdSecond).toBe(true));
    expect(screen.queryByRole('status', { name: 'Loading issues…' })).toBeNull();
    expect(screen.getByRole('link', { name: /Homepage/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'WebSite schema is missing', level: 2 }),
    ).toBeInTheDocument();

    act(() => releaseSecond());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Canonical tag is missing' })).toBeInTheDocument(),
    );
  });

  it('shows no pagination when everything already fits on one page', async () => {
    // Both pagers used to key off "are there rows" and then disable themselves
    // when there was nowhere to go, so a five-issue crawl rendered two dead
    // controls in the catalog and two more in the detail panel.
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, () =>
        HttpResponse.json(issueDetail({ next_cursor: null })),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    // Anchor on the DETAIL response, not the catalog row: the row renders
    // first, so asserting here would pass even if the detail pager arrived.
    await screen.findByRole('link', { name: /Homepage/ });

    expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('seeds the server query from an Overview rule deep link', async () => {
    const seen: URLSearchParams[] = [];
    window.history.replaceState(
      null,
      '',
      '/issues?rule=aeo.website_schema&dimension=aeo&query=schema&page_kind=article&cursor=page-two&campaign=overview',
    );
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [issue()], next_cursor: null, summary });
      }),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    expect(await screen.findAllByText('WebSite schema is missing')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'First page' })).not.toBeDisabled();
    expect(seen.at(-1)?.get('rule')).toBe('aeo.website_schema');
    expect(seen.at(-1)?.get('dimension')).toBe('aeo');
    expect(seen.at(-1)?.get('query')).toBe('schema');
    expect(seen.at(-1)?.get('page_kind')).toBe('article');
    expect(seen.at(-1)?.get('cursor')).toBe('page-two');
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveValue('schema');
    expect(screen.getByRole('radio', { name: 'AEO (17)' })).toHaveAttribute('aria-checked', 'true');
  });

  it('writes filters to history and reflects back/forward navigation', async () => {
    window.history.replaceState(null, '', '/issues?rule=aeo.website_schema&campaign=overview');
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findAllByText('WebSite schema is missing');

    await user.click(screen.getByRole('radio', { name: 'Medium (23)' }));
    await waitFor(() => expect(currentUrl()).toContain('severity=medium'));
    expect(currentUrl()).toContain('rule=aeo.website_schema');
    expect(currentUrl()).toContain('campaign=overview');

    window.history.back();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'All (47)' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(currentUrl()).not.toContain('severity=medium');

    window.history.forward();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Medium (23)' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('drops a filter-bound cursor while preserving unknown URL params', async () => {
    window.history.replaceState(null, '', '/issues?cursor=page-two&campaign=overview');
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    const trigger = await screen.findByRole('button', { name: 'Filter by page kind' });

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Article' }));

    await waitFor(() => expect(currentUrl()).toContain('page_kind=article'));
    expect(currentUrl()).not.toContain('cursor=');
    expect(currentUrl()).toContain('campaign=overview');
  });

  it('renders the API-owned summary and grouped issue rows', async () => {
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    expect(await screen.findAllByText('WebSite schema is missing')).not.toHaveLength(0);
    // Chip counts (tiles removed): All (47), Medium (23), AEO (17). The counts
    // come from the API-owned summary, not a client re-count.
    expect(screen.getByRole('radio', { name: 'All (47)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Medium (23)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'AEO (17)' })).toBeInTheDocument();
    // Evidence is the notation of the fix, with no "Observed evidence" label
    // and no restatement of the title above it.
    expect(
      await screen.findByText('expected types WebSite, found types Organization'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Observed evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Reason: expected_schema_absent')).not.toBeInTheDocument();
    expect(screen.getByText('Add a JSON-LD WebSite schema.')).toBeInTheDocument();
  });

  it('applies a severity filter as a server param (not a client filter)', async () => {
    const seen: string[] = [];
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.searchParams.get('severity') ?? '');
        return HttpResponse.json({ items: [issue()], next_cursor: null, summary });
      }),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findAllByText('WebSite schema is missing');

    await user.click(screen.getByRole('radio', { name: 'Medium (23)' }));
    await waitFor(() => expect(seen).toContain('medium'));
  });

  it('keeps advisories in their own server-backed view and labels all quantities', async () => {
    const seen: Array<string | null> = [];
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, ({ request }) => {
        const findingClass = new URL(request.url).searchParams.get('finding_class');
        seen.push(findingClass);
        return HttpResponse.json({
          items:
            findingClass === 'advisory'
              ? [
                  issue({
                    rule_id: 'technical.title_length_band',
                    title: 'Title length outside recommended band',
                    finding_class: 'advisory',
                    severity: 'low',
                  }),
                ]
              : [issue()],
          next_cursor: null,
          summary,
        });
      }),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    expect(
      await screen.findByText((_, element) => element?.textContent === '47 defect issue types'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '94 defect occurrences'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '50 affected URLs'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Advisories (2)' }));
    expect(await screen.findAllByText('Title length outside recommended band')).not.toHaveLength(0);
    expect(screen.getAllByText('Advisory')).toHaveLength(2);
    expect(
      screen.getByText((_, element) => element?.textContent === '2 advisory issue types'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /High/ })).not.toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '94 advisory occurrences'),
    ).toBeInTheDocument();
    expect(seen).toContain('advisory');
  });

  it('wires the page-kind filter as a server param, set and cleared', async () => {
    const seen: Array<string | null> = [];
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('page_kind'));
        return HttpResponse.json({ items: [issue()], next_cursor: null, summary });
      }),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    const trigger = await screen.findByRole('button', { name: 'Filter by page kind' });
    // The initial unfiltered request carries no page-kind param.
    await screen.findAllByText('WebSite schema is missing');
    expect(seen.at(-1)).toBeNull();

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Article' }));
    await waitFor(() => expect(seen.at(-1)).toBe('article'));

    // Clearing back to "All page kinds" drops the param entirely. The
    // unfiltered combination is already cached (no new request), so force a
    // fresh combination via a chip and assert THAT request omits page_kind.
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'All page kinds' }));
    await user.click(screen.getByRole('radio', { name: 'Medium (23)' }));
    await waitFor(() => expect(seen.at(-1)).toBeNull());
  });

  it('uses the selected issue right rail and links each occurrence to page detail', async () => {
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: null, summary }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, () =>
        HttpResponse.json(issueDetail()),
      ),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findAllByText('WebSite schema is missing');

    await user.click(screen.getByRole('button', { name: /WebSite schema is missing/ }));
    await waitFor(() => expect(currentUrl()).toContain(`issue=${ISSUE_A}`));

    expect(await screen.findByText('Add a JSON-LD WebSite schema.')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Homepage/ });
    expect(link).toHaveAttribute('href', `/site/crawls/${CRAWL}/pages/${URL_A}`);
    // The affected page's v2 P1 type badge renders inside the row (scoped —
    // the filter <select> also lists the type label as an option).
    expect(within(link).getByText('Article')).toBeInTheDocument();
    // Ask agent hands the Agent the page's id, never its evidence.
    const ask = screen.getByRole('link', { name: 'Ask agent about this page' });
    const handoff = parseAgentHandoff(new URL(ask.getAttribute('href')!, 'http://x').searchParams);
    expect(handoff.context).toEqual({
      issue_group_reference: { crawl_id: CRAWL, group_id: issue().group_id, site_url_id: URL_A },
    });
    expect(handoff.prompt).toContain('https://acme.com/');
    // The technical methodology is chosen up front, not left to the model.
    expect(handoff.skillId).toBe('technical_health');
  });

  it('pages occurrences with a cursor-aware Next/Previous control', async () => {
    const seenCursors: (string | null)[] = [];
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue()], next_cursor: 'catalog-page-2', summary }),
      ),
      http.get(`/api/v1/site-crawls/${CRAWL}/issues/${ISSUE_A}`, ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        seenCursors.push(cursor);
        const onFirstPage = cursor === null;
        return HttpResponse.json(
          issueDetail({
            occurrences: [
              occurrence({
                occurrence_id: onFirstPage
                  ? 'dddddddd-1111-4111-8111-111111111111'
                  : 'dddddddd-2222-4111-8111-111111111111',
                site_url_id: onFirstPage ? URL_A : 'cccccccc-2222-4111-8111-111111111111',
                normalized_url: onFirstPage ? 'https://acme.com/' : 'https://acme.com/page-2',
                display_url: onFirstPage ? 'https://acme.com/' : 'https://acme.com/page-2',
                title: onFirstPage ? 'Homepage' : 'Page Two',
              }),
            ],
            occurrence_count: 2,
            affected_url_count: 2,
            next_cursor: onFirstPage ? 'cursor-page-2' : null,
          }),
        );
      }),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findAllByText('WebSite schema is missing');

    await screen.findByRole('link', { name: /Homepage/ });

    // The rail's pager renders before the catalog's, so index 0 is the rail.
    const innerPrev = screen.getAllByRole('button', { name: 'Previous page' })[0]!;
    const innerNext = screen.getAllByRole('button', { name: 'Next page' })[0]!;
    expect(innerPrev).toBeDisabled();
    expect(innerNext).not.toBeDisabled();

    await user.click(innerNext);
    await screen.findByRole('link', { name: /Page Two/ });
    expect(seenCursors).toEqual([null, 'cursor-page-2']);
    const innerPrevAfterNext = screen.getAllByRole('button', { name: 'Previous page' })[0]!;
    const [innerNextAfterNext] = screen.getAllByRole('button', { name: 'Next page' });
    expect(innerPrevAfterNext).not.toBeDisabled();
    expect(innerNextAfterNext).toBeDisabled();

    await user.click(innerPrevAfterNext);
    await screen.findByRole('link', { name: /Homepage/ });
    // Going back to cursor=null is served from the TanStack Query cache
    // (already fetched above), so no new request is issued — seenCursors
    // stays at the two requests already made.
    expect(seenCursors).toEqual([null, 'cursor-page-2']);

    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]!);
    await screen.findByRole('link', { name: /Page Two/ });
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[1]!);
    await waitFor(() => expect(currentUrl()).toContain('cursor=catalog-page-2'));
    expect(screen.getAllByRole('button', { name: 'Previous page' })[0]!).toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]!);
    await screen.findByRole('link', { name: /Page Two/ });
    await user.click(screen.getByRole('button', { name: 'First page' }));
    await waitFor(() => expect(currentUrl()).not.toContain('cursor='));
    expect(screen.getAllByRole('button', { name: 'Previous page' })[0]!).toBeDisabled();

    // The catalog steps back along the cursors it followed.
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[1]!);
    await waitFor(() => expect(currentUrl()).toContain('cursor=catalog-page-2'));
    await user.click(screen.getAllByRole('button', { name: 'Previous page' })[1]!);
    await waitFor(() => expect(currentUrl()).not.toContain('cursor='));
  });

  it('shows which page types an issue affects, and says nothing when it spans none', async () => {
    // The product question this answers: a Product/offers finding scoped to
    // product pages is different work from a title finding that touches every
    // page, and the affected-page COUNT alone cannot tell them apart.
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({
          items: [issue({ page_kinds: ['product', 'category'] })],
          next_cursor: null,
          summary,
        }),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    // Scoped to the badge row: the page-kind filter <select> also lists every
    // type label as an <option>.
    const affects = (await screen.findByText('Affects')).parentElement!;
    expect(within(affects).getByText('Product')).toBeInTheDocument();
    expect(within(affects).getByText('Category')).toBeInTheDocument();
  });

  it('omits the page-type row for an issue with no classified pages', async () => {
    mswServer.use(
      http.get(`/api/v1/site-crawls/${CRAWL}/issues`, () =>
        HttpResponse.json({ items: [issue({ page_kinds: [] })], next_cursor: null, summary }),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    expect(await screen.findAllByText('WebSite schema is missing')).not.toHaveLength(0);
    expect(screen.queryByText('Affects')).not.toBeInTheDocument();
  });
});
