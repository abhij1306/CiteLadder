import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { chooseFilterOption } from '@/test/all-filters';
import { mswServer } from '@/test/msw-server';
import { parseAgentHandoff } from '@/lib/agent/handoff';
import {
  CRAWL,
  ISSUE_A,
  IssuesCatalog,
  URL_A,
  isSummaryRequest,
  issue,
  issueDetail,
  occurrence,
  renderIssues,
  summary,
} from './issues-catalog.test-support';

type User = ReturnType<typeof userEvent.setup>;

const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222';
const ISSUES = `/api/v1/site-crawls/${CRAWL}/issues`;

async function findSetFilter(label: string, value: string) {
  const remove = await screen.findByRole('button', { name: `Remove ${label} filter` });
  expect(remove.parentElement).toHaveTextContent(value);
  return remove;
}

async function chooseFilter(user: User, label: string, choice: string) {
  await chooseFilterOption(user, label, choice);
}

async function openIssue(user: User, title: string) {
  await user.click(await screen.findByRole('button', { name: title }));
  return screen.findByRole('dialog', { name: title });
}

function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

function serveIssues(items = [issue()], seen: URLSearchParams[] = [], nextCursor?: string) {
  mswServer.use(
    http.get(ISSUES, ({ request }) => {
      if (!isSummaryRequest(request)) seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        items,
        next_cursor: isSummaryRequest(request) ? null : (nextCursor ?? null),
        summary,
      });
    }),
  );
  return seen;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  window.history.replaceState(null, '', '/issues');
  mswServer.use(
    http.get(`${ISSUES}/${ISSUE_A}`, () => HttpResponse.json(issueDetail())),
    http.get(`/api/v1/site-crawls/${CRAWL}/issue-fixes`, () =>
      HttpResponse.json({ crawl_id: CRAWL, items: [] }),
    ),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('IssuesCatalog', () => {
  it('opens on the crawl summary, the issues to fix first, and the Technical tab', async () => {
    const seen = serveIssues([
      issue(),
      issue({
        group_id: OTHER,
        title: 'Canonical tag is missing',
        remediation: 'Add a canonical link. Point it at this page.',
      }),
    ]);

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const strip = await screen.findByRole('group', { name: 'Issue summary' });
    expect(
      within(strip)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Issue types', 'Advisories', 'Pages affected', 'High', 'Medium', 'Low']);
    expect(
      within(strip)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual(['47', '2', '50', '12', '23', '12']);
    const fixFirst = screen.getByRole('region', { name: 'Fix these first' });
    const [first, second] = within(fixFirst).getAllByRole('listitem');
    expect(within(first!).getByText('Add a JSON-LD WebSite schema.')).toBeInTheDocument();
    expect(within(second!).getByText('Add a canonical link.')).toBeInTheDocument();
    expect(within(fixFirst).queryByText(/Point it at this page/)).toBeNull();
    expect(
      screen.getAllByRole('radio').map((tab) => tab.textContent?.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['Technical (24)', 'Content (9)', 'AEO (14)']);
    expect(screen.getByRole('radio', { name: /^Technical/ })).toBeChecked();
    const table = screen.getByRole('region', { name: 'Issues' });
    expect(within(table).getByRole('button', { name: 'Canonical tag is missing' })).toBeVisible();
    expect(seen.at(-1)?.get('section')).toBe('technical');
    expect(seen.at(-1)?.get('sort')).toBe('severity');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('holds the table in its loading state until the list lands', async () => {
    let releaseIssues!: () => void;
    const issuesSettled = new Promise<void>((resolve) => {
      releaseIssues = resolve;
    });
    mswServer.use(
      http.get(ISSUES, async () => {
        await issuesSettled;
        return HttpResponse.json({ items: [issue()], next_cursor: null, summary });
      }),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    expect(await screen.findByRole('status', { name: 'Loading issues…' })).toBeInTheDocument();
    act(() => releaseIssues());
    expect(
      await screen.findByRole('button', { name: 'WebSite schema is missing' }),
    ).toBeInTheDocument();
  });

  it('opens an issue over the list, links each page to its detail, and closes it again', async () => {
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'WebSite schema is missing');
    await waitFor(() => expect(currentUrl()).toContain(`issue=${ISSUE_A}`));

    expect(within(dialog).getByText('How to fix')).toBeInTheDocument();
    expect(within(dialog).getByText('Add a JSON-LD WebSite schema.')).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        'Search engines cannot find WebSite structured data on this page.',
      ),
    ).toBeNull();
    expect(
      await within(dialog).findByText('expected types WebSite, found types Organization'),
    ).toBeInTheDocument();
    const link = within(dialog).getByRole('link', { name: /Homepage/ });
    expect(link).toHaveAttribute('href', `/site/crawls/${CRAWL}/pages/${URL_A}`);
    expect(within(link).getByText('Article')).toBeInTheDocument();

    const ask = within(dialog).getByRole('link', { name: 'Ask agent' });
    const handoff = parseAgentHandoff(new URL(ask.getAttribute('href')!, 'http://x').searchParams);
    expect(handoff.context).toEqual({
      issue_group_reference: { crawl_id: CRAWL, group_id: ISSUE_A },
    });
    expect(handoff.skillId).toBe('technical_health');
    const askPage = within(dialog).getByRole('link', { name: 'Ask agent about this page' });
    const pageHandoff = parseAgentHandoff(
      new URL(askPage.getAttribute('href')!, 'http://x').searchParams,
    );
    expect(pageHandoff.context).toEqual({
      issue_group_reference: { crawl_id: CRAWL, group_id: ISSUE_A, site_url_id: URL_A },
    });
    expect(pageHandoff.prompt).toContain('https://acme.com/');

    await user.click(within(dialog).getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentUrl()).not.toContain('issue=');
  });

  it('opens an issue from the summary’s fix-first list', async () => {
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const fixFirst = await screen.findByRole('region', { name: 'Fix these first' });
    await user.click(within(fixFirst).getByRole('button', { name: /WebSite schema is missing/ }));
    expect(
      await screen.findByRole('dialog', { name: 'WebSite schema is missing' }),
    ).toBeInTheDocument();
  });

  it('opens an addressed issue on load, even one the listed page does not hold', async () => {
    serveIssues();
    mswServer.use(
      http.get(`${ISSUES}/${OTHER}`, () =>
        HttpResponse.json(
          issueDetail({
            group_id: OTHER,
            title: 'Canonical tag is missing',
            occurrences: [occurrence({ title: 'Pricing page' })],
          }),
        ),
      ),
    );

    renderIssues(<IssuesCatalog crawlId={CRAWL} />, `/issues?issue=${OTHER}`);

    const dialog = await screen.findByRole('dialog', { name: 'Canonical tag is missing' });
    expect(await within(dialog).findByRole('link', { name: /Pricing page/ })).toBeInTheDocument();
  });

  it('says when an addressed issue cannot load, retries it, and closes it', async () => {
    serveIssues();
    let attempts = 0;
    mswServer.use(
      http.get(`${ISSUES}/${OTHER}`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ error: { message: 'Issue not found' } }, { status: 404 })
          : HttpResponse.json(issueDetail({ group_id: OTHER, title: 'Canonical tag is missing' }));
      }),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />, `/issues?issue=${OTHER}`);

    const pending = await screen.findByRole('dialog', { name: 'Issue' });
    await user.click(await within(pending).findByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('dialog', { name: 'Canonical tag is missing' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentUrl()).not.toContain('issue=');
  });

  it('never shows one issue’s pages under another issue’s title', async () => {
    serveIssues([issue(), issue({ group_id: OTHER, title: 'Canonical tag is missing' })]);
    let releaseOther!: () => void;
    const otherSettled = new Promise<void>((resolve) => {
      releaseOther = resolve;
    });
    mswServer.use(
      http.get(`${ISSUES}/${OTHER}`, async () => {
        await otherSettled;
        return HttpResponse.json(
          issueDetail({
            group_id: OTHER,
            title: 'Canonical tag is missing',
            occurrences: [occurrence({ title: 'Pricing page' })],
          }),
        );
      }),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const first = await openIssue(user, 'WebSite schema is missing');
    await within(first).findByRole('link', { name: /Homepage/ });
    await user.click(within(first).getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const second = await openIssue(user, 'Canonical tag is missing');
    expect(within(second).queryByRole('link', { name: /Homepage/ })).toBeNull();
    act(() => releaseOther());
    expect(await within(second).findByRole('link', { name: /Pricing page/ })).toBeInTheDocument();
  });

  it('shows no pagination when everything already fits on one page', async () => {
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    const dialog = await openIssue(user, 'WebSite schema is missing');
    await within(dialog).findByRole('link', { name: /Homepage/ });

    expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    const table = screen.getByRole('region', { name: 'Issues', hidden: true });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.querySelector('tbody + tbody')).toBeNull();
  });

  it('switches tabs and ordering as server params, from the first page', async () => {
    window.history.replaceState(null, '', '/issues?cursor=page-two&campaign=overview');
    const seen = serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });

    await user.click(screen.getByRole('radio', { name: /^Content/ }));
    await waitFor(() => expect(seen.at(-1)?.get('section')).toBe('content'));
    expect(seen.at(-1)?.get('cursor')).toBeNull();
    expect(currentUrl()).toContain('section=content');
    expect(currentUrl()).toContain('campaign=overview');

    await user.click(screen.getByRole('button', { name: /^Pages/ }));
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('pages'));
    expect(seen.at(-1)?.get('section')).toBe('content');
  });

  it('seeds the server query from an Overview rule deep link', async () => {
    window.history.replaceState(
      null,
      '',
      '/issues?rule=aeo.website_schema&section=aeo&query=schema&page_kind=article&cursor=page-two&campaign=overview',
    );
    const seen = serveIssues();

    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    await screen.findByRole('button', { name: 'WebSite schema is missing' });
    expect(screen.getByRole('button', { name: 'First page' })).not.toBeDisabled();
    const sent = seen.at(-1)!;
    expect(sent.get('rule')).toBe('aeo.website_schema');
    expect(sent.get('section')).toBe('aeo');
    expect(sent.get('query')).toBe('schema');
    expect(sent.get('page_kind')).toBe('article');
    expect(sent.get('cursor')).toBe('page-two');
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveValue('schema');
    expect(screen.getByRole('radio', { name: /^AEO/ })).toBeChecked();
  });

  it('writes filters to history and reflects back/forward navigation', async () => {
    window.history.replaceState(null, '', '/issues?rule=aeo.website_schema&campaign=overview');
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });

    await findSetFilter('Issue', 'WebSite schema is missing');
    await chooseFilter(user, 'Severity', 'Medium');
    await waitFor(() => expect(currentUrl()).toContain('severity=medium'));
    expect(currentUrl()).not.toContain('rule=');
    expect(currentUrl()).toContain('campaign=overview');
    await findSetFilter('Severity', 'Medium');
    expect(screen.queryByRole('button', { name: 'Remove Issue filter' })).toBeNull();

    window.history.back();
    await waitFor(() => expect(currentUrl()).not.toContain('severity=medium'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Severity filter' })).toBeNull(),
    );

    window.history.forward();
    await waitFor(() => expect(currentUrl()).toContain('severity=medium'));
    await findSetFilter('Severity', 'Medium');
  });

  it('drops a filter-bound cursor while preserving unknown URL params', async () => {
    window.history.replaceState(null, '', '/issues?cursor=page-two&campaign=overview');
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });

    await chooseFilter(user, 'Page kind', 'Article');

    await waitFor(() => expect(currentUrl()).toContain('page_kind=article'));
    expect(currentUrl()).not.toContain('cursor=');
    expect(currentUrl()).toContain('campaign=overview');
  });

  it('clears a deep-linked issue filter from its value chip', async () => {
    window.history.replaceState(null, '', '/issues?rule=aeo.website_schema');
    serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });

    await user.click(await findSetFilter('Issue', 'WebSite schema is missing'));
    await waitFor(() => expect(currentUrl()).not.toContain('rule='));
  });

  it('narrows an issue’s pages to the page kind the list is filtered to', async () => {
    window.history.replaceState(null, '', '/issues?page_kind=product');
    serveIssues();
    const detailKinds: Array<string | null> = [];
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, ({ request }) => {
        detailKinds.push(new URL(request.url).searchParams.get('page_kind'));
        return HttpResponse.json(issueDetail());
      }),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'WebSite schema is missing');
    await within(dialog).findByRole('link', { name: /Homepage/ });
    expect(detailKinds).toEqual(['product']);
  });

  it('lists the pages a site-level architecture finding names, not the homepage it is filed on', async () => {
    const depth = issue({
      rule_id: 'architecture.excessive_depth',
      title: 'Pages buried too deeply',
      dimension: 'technical',
      severity: 'medium',
      affected_url_count: 3,
    });
    const deep = (id: string, path: string, title: string, clicks: number) => ({
      url: `https://acme.com${path}`,
      title,
      page_kind: 'article',
      site_url_id: id,
      depth_from_home: clicks,
      parent_site_url_id: URL_A,
    });
    serveIssues([depth]);
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, () =>
        HttpResponse.json(
          issueDetail({
            rule_id: 'architecture.excessive_depth',
            affected_url_count: 3,
            occurrences: [
              occurrence({
                rule_id: 'architecture.excessive_depth',
                page_kind: 'homepage',
                evidence: {
                  count: 3,
                  pages: [
                    deep(
                      'dddddddd-2222-4111-8111-111111111111',
                      '/blogs/news/winner',
                      'Winner announced',
                      7,
                    ),
                    deep('dddddddd-3333-4111-8111-111111111111', '/blogs/news/old', '', 5),
                  ],
                  page_kind_counts: { article: 3 },
                  coverage_state: 'unknown',
                },
              }),
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'Pages buried too deeply');
    const winner = await within(dialog).findByRole('link', { name: /Winner announced/ });
    expect(winner).toHaveAttribute(
      'href',
      `/site/crawls/${CRAWL}/pages/dddddddd-2222-4111-8111-111111111111`,
    );
    expect(within(dialog).getByText('7 clicks from the homepage')).toBeInTheDocument();
    expect(within(dialog).getByText('5 clicks from the homepage')).toBeInTheDocument();
    expect(within(dialog).getByText('Showing 2 of 3 pages.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /Homepage/ })).not.toBeInTheDocument();
  });

  it('lists a sitewide link finding by the link, with how many pages carry it', async () => {
    serveIssues([issue({ rule_id: 'technical.sitewide_link_redirect', affected_url_count: 438 })]);
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, () =>
        HttpResponse.json(
          issueDetail({
            rule_id: 'technical.sitewide_link_redirect',
            affected_url_count: 438,
            occurrences: [
              occurrence({
                rule_id: 'technical.sitewide_link_redirect',
                evidence: {
                  count: 438,
                  linking_page_kinds: ['article'],
                  page_kind_counts: { article: 438 },
                  resolution_source_ids: [],
                  targets: [
                    {
                      url: 'https://acme.com/collections/screens',
                      final_url: 'https://acme.com/collections/simulation/',
                      hops: 1,
                      linking_page_count: 438,
                      pages: [
                        {
                          site_url_id: 'dddddddd-2222-4111-8111-111111111111',
                          url: 'https://acme.com/blogs/news/winner',
                          title: 'Winner announced',
                          page_kind: 'article',
                          artifact_id: 'eeeeeeee-2222-4111-8111-111111111111',
                        },
                      ],
                    },
                  ],
                },
              }),
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'WebSite schema is missing');
    const link = '/collections/screens → /collections/simulation/';
    expect(await within(dialog).findByText(link)).toBeInTheDocument();
    expect(within(dialog).getByText('On 438 pages, including:')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Winner announced/ })).toHaveAttribute(
      'href',
      `/site/crawls/${CRAWL}/pages/dddddddd-2222-4111-8111-111111111111`,
    );
  });

  it('lists duplicate metadata by the pages sharing it, each linking to its page', async () => {
    const rule = 'architecture.duplicate_titles';
    const contact = (id: string, path: string) => ({
      site_url_id: id,
      url: `https://acme.com${path}`,
      title: 'Contact us | Acme',
      page_kind: 'about_contact',
    });
    serveIssues([issue({ rule_id: rule, affected_url_count: 3 })]);
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, () =>
        HttpResponse.json(
          issueDetail({
            rule_id: rule,
            affected_url_count: 3,
            occurrences: [
              occurrence({
                rule_id: rule,
                evidence: {
                  count: 3,
                  page_kind_counts: { about_contact: 3 },
                  coverage_state: 'complete',
                  duplicate_set_count: 1,
                  duplicate_sets: [
                    {
                      text: 'Contact us | Acme',
                      page_count: 3,
                      pages: [
                        contact('dddddddd-2222-4111-8111-111111111111', '/contact'),
                        contact('dddddddd-3333-4111-8111-111111111111', '/pages/contact'),
                      ],
                    },
                  ],
                },
              }),
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'WebSite schema is missing');
    expect(
      await within(dialog).findByText('These 3 pages share “Contact us | Acme”'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Including:')).toBeInTheDocument();
    const links = within(dialog).getAllByRole('link', { name: /Contact us \| Acme/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/site/crawls/${CRAWL}/pages/dddddddd-2222-4111-8111-111111111111`,
      `/site/crawls/${CRAWL}/pages/dddddddd-3333-4111-8111-111111111111`,
    ]);
    expect(within(dialog).getByText('Showing 2 of 3 pages.')).toBeInTheDocument();
  });

  it('applies a severity filter as a server param (not a client filter)', async () => {
    const seen = serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });

    await chooseFilter(user, 'Severity', 'Medium');
    await waitFor(() => expect(seen.at(-1)?.get('severity')).toBe('medium'));
  });

  it('lists advisories beside defects, and the Severity filter narrows to either', async () => {
    const seen: Array<string | null> = [];
    mswServer.use(
      http.get(ISSUES, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (!isSummaryRequest(request)) seen.push(params.toString());
        return HttpResponse.json({
          items: [
            issue(),
            issue({
              group_id: OTHER,
              rule_id: 'technical.title_length_band',
              title: 'Title length outside recommended band',
              finding_class: 'advisory',
              severity: 'low',
            }),
          ],
          next_cursor: null,
          summary,
        });
      }),
    );

    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    const table = screen.getByRole('region', { name: 'Issues' });
    expect(
      await within(table).findByRole('button', { name: 'Title length outside recommended band' }),
    ).toBeInTheDocument();
    expect(within(table).getByText('Advisory')).toBeInTheDocument();
    expect(seen.at(-1)).not.toContain('finding_class');

    await chooseFilter(user, 'Severity', 'Advisory');
    await waitFor(() => expect(seen.at(-1)).toContain('finding_class=advisory'));
    await chooseFilter(user, 'Severity', 'High');
    await waitFor(() => expect(seen.at(-1)).toContain('severity=high&finding_class=defect'));
  });

  it('wires the page-kind filter as a server param, set and cleared', async () => {
    const seen = serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });
    expect(seen.at(-1)?.get('page_kind')).toBeNull();

    await chooseFilter(user, 'Page kind', 'Article');
    await waitFor(() => expect(seen.at(-1)?.get('page_kind')).toBe('article'));

    await chooseFilter(user, 'Page kind', 'All page kinds');
    await chooseFilter(user, 'Severity', 'Medium');
    await waitFor(() => expect(seen.at(-1)?.get('severity')).toBe('medium'));
    expect(seen.at(-1)?.get('page_kind')).toBeNull();
  });

  it('lists every issue again once the search box is cleared', async () => {
    window.history.replaceState(null, '', '/issues?query=schema');
    const seen = serveIssues();
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);
    await screen.findByRole('button', { name: 'WebSite schema is missing' });
    expect(seen.at(-1)?.get('query')).toBe('schema');

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => expect(currentUrl()).not.toContain('query='));
    await waitFor(() => expect(seen.at(-1)?.get('query')).toBeNull());
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveValue('');
  });

  it('keeps the way back when a later page of an issue’s occurrences fails', async () => {
    serveIssues();
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? HttpResponse.json(
              issueDetail({
                occurrence_count: 2,
                affected_url_count: 2,
                next_cursor: 'cursor-page-2',
              }),
            )
          : HttpResponse.json({ error: { message: 'Bad cursor' } }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const dialog = await openIssue(user, 'WebSite schema is missing');
    await within(dialog).findByRole('link', { name: /Homepage/ });
    await user.click(within(dialog).getByRole('button', { name: 'Next page' }));
    expect(await within(dialog).findByText('Bad cursor')).toBeInTheDocument();

    const previous = within(dialog).getByRole('button', { name: 'Previous page' });
    expect(within(dialog).getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(previous);
    expect(await within(dialog).findByRole('link', { name: /Homepage/ })).toBeInTheDocument();
  });

  it('pages an issue’s occurrences in the dialog and the list beneath it', async () => {
    serveIssues([issue()], [], 'catalog-page-2');
    const seenCursors: (string | null)[] = [];
    mswServer.use(
      http.get(`${ISSUES}/${ISSUE_A}`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
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

    const dialog = await openIssue(user, 'WebSite schema is missing');
    await within(dialog).findByRole('link', { name: /Homepage/ });
    expect(within(dialog).getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Next page' }));
    await within(dialog).findByRole('link', { name: /Page Two/ });
    expect(seenCursors).toEqual([null, 'cursor-page-2']);
    await user.click(within(dialog).getByRole('button', { name: 'Previous page' }));
    await within(dialog).findByRole('link', { name: /Homepage/ });
    await user.click(within(dialog).getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(currentUrl()).toContain('cursor=catalog-page-2'));
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(currentUrl()).not.toContain('cursor='));
  });

  it('says which page types an issue affects, and nothing when it spans none', async () => {
    serveIssues([
      issue({ page_kinds: ['product', 'category'] }),
      issue({ group_id: OTHER, title: 'Canonical tag is missing', page_kinds: [] }),
    ]);
    mswServer.use(
      http.get(`${ISSUES}/${OTHER}`, () =>
        HttpResponse.json(issueDetail({ group_id: OTHER, title: 'Canonical tag is missing' })),
      ),
    );
    const user = userEvent.setup();
    renderIssues(<IssuesCatalog crawlId={CRAWL} />);

    const typed = await openIssue(user, 'WebSite schema is missing');
    expect(within(typed).getByText('Page kinds').nextElementSibling?.textContent).toBe(
      'Product, Category',
    );
    expect(within(typed).queryByText('32 pages affected')).toBeNull();
    expect(within(typed).queryByText('High')).toBeNull();
    await user.click(within(typed).getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const untyped = await openIssue(user, 'Canonical tag is missing');
    expect(within(untyped).queryByText('Page kinds')).toBeNull();
  });
});
