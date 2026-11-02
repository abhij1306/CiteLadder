import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { ActionDetailScreen } from './action-detail-screen';
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
  families: ['site_health', 'search_console'],
  approach: 'improve_existing',
  skill_id: 'gsc_optimize',
  member_count: 1,
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const selection = {
  activeProjectId: PROJECT,
  activeProject: { id: PROJECT } as never,
  status: 'ready' as const,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Actions', () => {
  it('lists the work queue by default and filters by status through the API', async () => {
    const searches: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/actions`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        // Every read is recorded: the status counts ride the table's own
        // first page, so the default view is one request, not two.
        searches.push(`${params.get('status') ?? 'queue'}:${params.get('limit')}`);
        const items = params.get('status') === 'dismissed' ? [] : [action];
        return HttpResponse.json({
          items,
          next_cursor: null,
          status_counts: { open: 1, in_progress: 2, dismissed: 0 },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ActionsScreen />, {
      initialEntries: ['/agent/actions'],
      projectSelection: selection,
    });

    const row = await screen.findByRole('link', { name: 'https://acme.test/pricing' });
    expect(row).toHaveAttribute('href', `/agent/actions/${ACTION}?project=${PROJECT}`);
    // The score ranks the queue; the reader sees its band, never the raw number.
    expect(within(row.closest('tr')!).getByText('High')).toBeVisible();
    expect(screen.queryByText('82.5')).not.toBeInTheDocument();

    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(await within(status).findByText('Open and in progress (3)')).toBeVisible();
    await user.click(status);
    await user.click(await screen.findByRole('option', { name: 'Dismissed (0)' }));

    expect(await screen.findByText('No Actions match these filters')).toBeVisible();
    expect(searches).toEqual(['queue:10', 'dismissed:10']);

    // Counts cover every target type, so a target filter drops them.
    await user.click(screen.getByRole('combobox', { name: 'Target type' }));
    await user.click(await screen.findByRole('option', { name: 'Page' }));
    expect(await within(status).findByText('Dismissed')).toBeVisible();
  });

  it('dismisses an Action from its detail and links Work on this to a new chat', async () => {
    const patches: unknown[] = [];
    let current = { ...action };
    mswServer.use(
      http.get(`/api/v1/actions/${ACTION}`, () =>
        HttpResponse.json({
          ...current,
          diagnosis: {
            approach: 'improve_existing',
            donts: ['Do not create another URL for a target that already has a page.'],
            measure_with: ['next_crawl'],
          },
          members: [],
          member_measurement: {},
          declarable_since: '2026-01-01T00:00:00Z',
          declaration: null,
        }),
      ),
      http.patch(`/api/v1/actions/${ACTION}`, async ({ request }) => {
        patches.push(await request.json());
        current = { ...current, status: 'dismissed' };
        return HttpResponse.json(current);
      }),
      http.get(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
        HttpResponse.json({ items: [], next_cursor: null }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/agent/actions/:actionId" element={<ActionDetailScreen />} />
      </Routes>,
      { initialEntries: [`/agent/actions/${ACTION}`], projectSelection: selection },
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'https://acme.test/pricing' }),
    ).toBeVisible();
    // The target opens in a new tab, and its accessible name says so.
    expect(
      screen.getByRole('link', { name: 'https://acme.test/pricing (opens in a new tab)' }),
    ).toBeVisible();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('High')).toBeVisible();
    expect(within(summary).getByText('Site Health, Search Console')).toBeVisible();
    expect(screen.getByText('The next crawl of this page')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Work on this' })).toHaveAttribute(
      'href',
      `/agent?action_id=${ACTION}&project=${PROJECT}`,
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeVisible();
    expect(patches).toEqual([{ status: 'dismissed' }]);
  });
});
