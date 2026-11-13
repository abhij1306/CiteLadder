import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';

import { actionsPage } from '@/test/fixtures/actions';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ActionsScreen } from './actions-screen';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-25T10:00:00Z';

const action = {
  id: ACTION,
  project_id: PROJECT,
  target_kind: 'page',
  target_label: 'https://acme.test/pricing',
  target_url: 'https://acme.test/pricing',
  target_prompt_id: null,
  origin: 'evidence',
  status: 'open',
  priority_score: 82.5,
  priority_band: 'high',
  families: ['site_health', 'search_console'],
  approach: 'improve_existing',
  group: 'own_pages',
  skill_id: 'gsc_optimize',
  member_count: 1,
  declarable_member_count: 1,
  page_count: null,
  handoff: { context: 'action', message: 'Work on https://acme.test/pricing.' },
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
};

/** `count` own-page Actions after the first, each a page of its own. */
const ownPages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...action,
    id: `33333333-3333-4333-8333-33333333333${index}`,
    target_label: `acme.test/page-${index}`,
    target_url: `https://acme.test/page-${index}`,
    status: index === 0 ? 'in_progress' : 'open',
    priority_score: 10,
    priority_band: 'low',
  }));

/** One Site Health defect across 179 pages: one Action, not 179. */
const fix = {
  ...action,
  id: '44444444-4444-4444-8444-444444444444',
  target_kind: 'issue_family',
  target_label: 'Missing viewport meta tag',
  target_url: null,
  page_count: 179,
  approach: 'fix_technical',
  group: 'fix_site',
  priority_band: 'medium',
  families: ['site_health'],
};

const selection = {
  activeProjectId: PROJECT,
  activeProject: makeProject({ id: PROJECT }),
  status: 'ready' as const,
};

/**
 * The project's Actions as the API answers each read: seven own-page Actions
 * and one site fix, under every status but Dismissed (none). Every read is
 * recorded as its query string.
 */
function serveActions(reads: string[]) {
  const own = [action, ...ownPages(6)];
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/actions`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      reads.push(params.toString());
      const dismissed = params.get('status') === 'dismissed';
      const rows = dismissed ? [] : [...own, fix];
      const counts = {
        status_counts: { open: 7, in_progress: 1, dismissed: 0 },
        group_counts: dismissed ? {} : { own_pages: own.length, fix_site: 1 },
      };
      const group = params.get('group');
      const limit = Number(params.get('limit'));
      const matching = rows.filter((row) => !group || row.group === group);
      return HttpResponse.json(actionsPage(matching.slice(0, limit), counts));
    }),
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => window.history.replaceState(null, '', '/agent/actions'));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const renderActions = () =>
  renderWithProviders(
    <Routes>
      <Route path="/agent/actions" element={<ActionsScreen />} />
      <Route path="/agent/actions/:actionId" element={<p>Action detail</p>} />
    </Routes>,
    { initialEntries: ['/agent/actions'], projectSelection: selection },
  );

describe('Actions', () => {
  it('groups the work queue, top five per group by priority, then Show all narrows to the group', async () => {
    const reads: string[] = [];
    serveActions(reads);
    const user = userEvent.setup();
    renderActions();

    const own = await screen.findByRole('button', { name: 'Improve your own pages, 7' });
    expect(own).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Fix how AI reads your site, 1' })).toBeVisible();
    // A group with nothing in it is left out.
    expect(screen.queryByRole('button', { name: /Get mentioned elsewhere/ })).toBeNull();
    // One read per group, at the preview size, in the list's order.
    expect(reads).toEqual([
      'group=fix_site&limit=5',
      'group=own_pages&limit=5',
      'group=earned&limit=5',
      'group=products&limit=5',
    ]);

    const row = screen.getByRole('link', { name: 'https://acme.test/pricing' });
    expect(row).toHaveAttribute('href', `/agent/actions/${ACTION}?project=${PROJECT}`);
    const cells = within(row.closest('tr')!);
    // The band, never the raw score; priority is an order, not the error red.
    expect(cells.getByText('High')).toHaveAttribute('data-badge-tone', 'accent');
    expect(screen.queryByText('82.5')).not.toBeInTheDocument();
    expect(cells.getByText('Page · 1 finding in Site Health, Search Console')).toBeVisible();
    expect(cells.getByText('Improve the existing page')).toBeVisible();
    expect(cells.getByText('Site Health, Search Console')).toBeVisible();
    // An Open row in the queue names no status; one in progress does.
    expect(cells.queryByText('Open')).not.toBeInTheDocument();
    const started = screen.getByRole('link', { name: 'acme.test/page-0' });
    expect(within(started.closest('tr')!).getByText('In progress')).toBeVisible();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Action',
      'Priority',
      'Action type',
      'Source',
    ]);
    // Five of the seven, then the way to the rest.
    expect(screen.queryByRole('link', { name: 'acme.test/page-4' })).toBeNull();

    // A header folds its group's rows.
    await user.click(own);
    expect(own).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'https://acme.test/pricing' })).toBeNull();
    await user.click(own);

    await user.click(screen.getByRole('button', { name: 'Show all 7 in Improve your own pages' }));
    expect(await screen.findByRole('link', { name: 'acme.test/page-5' })).toBeVisible();
    expect(window.location.search).toBe('?group=own_pages');
    expect(reads.at(-1)).toBe('group=own_pages&limit=10');
    expect(screen.queryByRole('link', { name: 'Missing viewport meta tag' })).toBeNull();
  });

  it('lists an issue family in Fix how AI reads your site with its page count', async () => {
    serveActions([]);
    renderActions();
    const row = (await screen.findByRole('link', { name: 'Missing viewport meta tag' })).closest(
      'tr',
    )!;
    expect(
      within(row).getByText('Issue across pages · 179 pages · 1 finding in Site Health'),
    ).toBeVisible();
  });

  it('sets every filter from All filters as URL state and reads the list through it', async () => {
    const reads: string[] = [];
    serveActions(reads);
    const user = userEvent.setup();
    renderActions();
    await screen.findByRole('button', { name: 'Improve your own pages, 7' });
    // The separate selects are gone: one menu holds every filter.
    expect(screen.queryByRole('combobox')).toBeNull();

    const pick = async (filterIndex: number, optionIndex: number) => {
      await user.click(screen.getByRole('button', { name: /^All filters/ }));
      await user.keyboard(
        `${'{ArrowDown}'.repeat(filterIndex + 1)}{ArrowRight}${'{ArrowDown}'.repeat(optionIndex)}{Enter}`,
      );
    };
    // Priority (the fourth filter): High.
    await pick(3, 1);
    expect(await screen.findByRole('button', { name: 'All filters (1)' })).toBeVisible();
    expect(window.location.search).toBe('?priority=high');
    expect(reads.at(-1)).toBe('priority=high&group=products&limit=5');

    // Status (the first): Dismissed, which holds nothing here.
    await pick(0, 6);
    expect(await screen.findByText('No Actions match these filters')).toBeVisible();
    expect(window.location.search).toBe('?priority=high&status=dismissed');
    expect(screen.getByRole('button', { name: 'All filters (2)' })).toBeVisible();
  });

  it('opens the Action detail from anywhere on its row', async () => {
    serveActions([]);
    const user = userEvent.setup();
    renderActions();
    const row = (await screen.findByRole('link', { name: 'Missing viewport meta tag' })).closest(
      'tr',
    )!;
    await user.click(within(row).getByText('Fix a technical issue'));
    expect(await screen.findByText('Action detail')).toBeVisible();
  });
});
