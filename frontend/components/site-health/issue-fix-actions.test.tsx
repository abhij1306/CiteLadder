import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { SITE_HEALTH_CRAWL } from '@/test/site-health-api-fixtures';
import { renderWithProviders, selectionAs } from '@/test/render';
import {
  CRAWL,
  ISSUE_A,
  IssuesCatalog,
  issue,
  issueDetail,
  renderIssues,
  summary,
} from './issues-catalog.test-support';

const ISSUES = `/api/v1/site-crawls/${CRAWL}/issues`;
const FIXES = `/api/v1/site-crawls/${CRAWL}/issue-fixes`;
/** The Issues screen with issue A open, as a link to it opens it. */
const OPEN = `/issues?issue=${ISSUE_A}`;
const TITLE = 'WebSite schema is missing';
const RERUN = 'ffffffff-1111-4111-8111-111111111111';

/** Issue A's fix progress: `fixed` of its 32 pages fixed, `rerun` tracked pages still open. */
const progress = (fixed: number, rerun: number | null) => ({
  group_id: ISSUE_A,
  affected_url_count: 32,
  fixed_url_count: fixed,
  verified_url_count: 0,
  rerun_url_count: rerun,
});

const serveFixes = (rerun: number | null, fixed = 0) =>
  mswServer.use(
    http.get(FIXES, () => HttpResponse.json({ crawl_id: CRAWL, items: [progress(fixed, rerun)] })),
  );

async function openDialog() {
  renderIssues(<IssuesCatalog crawlId={CRAWL} />, OPEN);
  return screen.findByRole('dialog', { name: TITLE });
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  window.history.replaceState(null, '', '/issues');
  mswServer.use(
    http.get(ISSUES, () => HttpResponse.json({ items: [issue()], next_cursor: null, summary })),
    http.get(`${ISSUES}/${ISSUE_A}`, () => HttpResponse.json(issueDetail())),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Mark fixed and Re-run all in the issue dialog', () => {
  it('marks an issue fixed and shows how many of its pages are fixed, in the dialog and the summary', async () => {
    let marked = false;
    mswServer.use(
      http.get(FIXES, () =>
        HttpResponse.json({ crawl_id: CRAWL, items: [progress(marked ? 32 : 0, 3)] }),
      ),
      http.post(`${ISSUES}/${ISSUE_A}/mark-fixed`, () => {
        marked = true;
        return HttpResponse.json(progress(32, 3));
      }),
    );
    const user = userEvent.setup();

    const dialog = await openDialog();
    expect(await within(dialog).findByText('0 of 32 pages fixed')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mark fixed' }));

    expect(await within(dialog).findByText('32 of 32 pages fixed')).toBeInTheDocument();
    expect(within(dialog).getByText('32 awaiting a re-audit')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Mark fixed' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    const fixFirst = await screen.findByRole('region', { name: 'Fix these first' });
    expect(within(fixFirst).getByText('32 of 32 pages fixed')).toBeInTheDocument();
  });

  it('re-runs an issue’s open tracked pages, refreshes its progress once the re-audit lands, and says why when a crawl is running', async () => {
    let running = false;
    let landed = false;
    mswServer.use(
      http.get(FIXES, () =>
        HttpResponse.json({ crawl_id: CRAWL, items: [progress(landed ? 3 : 0, 3)] }),
      ),
      // The re-audit has already ended when it is first read: its pages verified fixed.
      http.get(`/api/v1/site-crawls/${RERUN}`, () => {
        landed = true;
        return HttpResponse.json({ ...SITE_HEALTH_CRAWL, id: RERUN, status: 'completed' });
      }),
      http.post(`${ISSUES}/${ISSUE_A}/rerun`, () => {
        if (running)
          return HttpResponse.json(
            {
              error: {
                code: 'crawl_already_active',
                message: 'Project already has an active crawl',
              },
            },
            { status: 409 },
          );
        running = true;
        return HttpResponse.json({ crawl_id: RERUN, page_count: 3 }, { status: 202 });
      }),
    );
    const user = userEvent.setup();

    const dialog = await openDialog();
    expect(
      await within(dialog).findByText('Re-run all re-audits 3 pages, one page fetch each.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Re-run all' }));
    expect(
      await within(dialog).findByText(
        'Re-auditing 3 pages. The progress updates when the audit finishes.',
      ),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText('3 of 32 pages fixed')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Re-run all' }));
    expect(
      await within(dialog).findByText('A crawl is running. Re-run this issue when it finishes.'),
    ).toBeInTheDocument();
  });

  it('offers no Re-run all for a site-wide issue, and a disabled one when no page is left', async () => {
    serveFixes(null);
    const { unmount } = renderIssues(<IssuesCatalog crawlId={CRAWL} />, OPEN);
    let dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(
      await within(dialog).findByText('A full crawl re-checks this site-wide issue.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Re-run all' })).toBeNull();
    unmount();

    serveFixes(0, 4);
    dialog = await openDialog();
    expect(
      await within(dialog).findByText('No tracked page with this issue is left to re-audit.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Re-run all' })).toBeDisabled();
  });

  it('shows a viewer how many pages are fixed without Mark fixed or Re-run all', async () => {
    serveFixes(3, 5);
    window.history.replaceState(null, '', OPEN);
    renderWithProviders(<IssuesCatalog crawlId={CRAWL} />, {
      projectSelection: selectionAs('viewer'),
    });

    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(await within(dialog).findByText('5 of 32 pages fixed')).toBeInTheDocument();
    for (const name of ['Mark fixed', 'Re-run all'])
      expect(within(dialog).queryByRole('button', { name })).toBeNull();
  });

  it('says the fix progress could not load instead of hiding the actions', async () => {
    // A refusal the client does not retry on its own, so the error shows at once.
    mswServer.use(
      http.get(FIXES, () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Crawl not found' } },
          { status: 404 },
        ),
      ),
    );

    const dialog = await openDialog();

    expect(await within(dialog).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mark fixed' })).toBeNull();
  });
});
