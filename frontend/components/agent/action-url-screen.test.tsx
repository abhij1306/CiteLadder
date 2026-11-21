import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { Action } from '@/lib/api/actions';
import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ActionUrlScreen } from './action-url-screen';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const URL_ID = '55555555-5555-4555-8555-000000000001';
const FROM = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-10T10:00:00Z';

const item = (id: string, label: string, status: Action['status']): Action => ({
  id,
  project_id: PROJECT,
  target_kind: 'issue_family',
  target_label: label,
  target_url: null,
  target_prompt_id: null,
  origin: 'evidence',
  status,
  measurement: null,
  priority_score: 50,
  priority_band: 'high',
  families: ['site_health'],
  approach: 'fix_technical',
  goal: 'read_site',
  grouping: 'aeo',
  skill_id: 'technical_health',
  member_count: 1,
  declarable_member_count: 1,
  page_count: 3,
  finding_class: 'defect',
  summary: null,
  handoff: { context: 'action', message: 'Fix it.' },
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
});

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function renderUrl(state?: unknown, found = true) {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/urls/${URL_ID}/actions`, () =>
      found
        ? HttpResponse.json({
            site_url_id: URL_ID,
            url: 'https://acme.test/shop/baby/bb0556',
            page_kind: 'product',
            last_crawled_at: NOW,
            items: [
              item(FROM, 'Form controls missing accessible names', 'open'),
              item(
                '33333333-3333-4333-8333-333333333333',
                'Meta description too long',
                'dismissed',
              ),
            ],
          })
        : HttpResponse.json({ error: { message: 'Not found' } }, { status: 404 }),
    ),
  );
  renderWithProviders(
    <Routes>
      <Route path="/actions/urls/:siteUrlId" element={<ActionUrlScreen />} />
    </Routes>,
    {
      initialEntries: [{ pathname: `/actions/urls/${URL_ID}`, state }],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

describe('A URL page', () => {
  it('lists its Actions and hands the one URL with every Action on it to the Agent', async () => {
    renderUrl({
      fromAction: {
        id: FROM,
        title: 'Form controls missing accessible names',
        status: 'open',
        goal: 'read_site',
        grouping: 'aeo',
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: /\/shop\/…\/bb0556/ }),
    ).toBeVisible();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(
      within(details)
        .getAllByRole('definition')
        .map((d) => d.textContent),
    ).toEqual(['Product', 'Nov 10, 2026', '1 on this URL']);
    expect(
      within(screen.getByRole('list', { name: 'Actions on this URL' }))
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Form controls missing accessible namesAEOHigh',
      'Meta description too longAEOHigh',
    ]);
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(trail).getByRole('link', { name: 'Form controls missing accessible names' }),
    ).toHaveAttribute('href', `/actions/${FROM}?project=${PROJECT}`);
    expect(
      within(trail)
        .getAllByRole('listitem')
        .map((step) => step.textContent)
        .filter((text) => text !== '›'),
    ).toEqual([
      'Actions',
      'Let AI read your site',
      'AEO',
      'Form controls missing accessible names',
      '…/bb0556',
    ]);
    const agent = screen.getByRole('link', { name: 'Fix this URL with Agent' });
    const target = new URL(agent.getAttribute('href')!, 'https://app.test');
    expect([target.pathname, Object.fromEntries(target.searchParams)]).toEqual([
      '/agent',
      {
        url_actions_id: URL_ID,
        prompt: 'Fix every action on this URL, starting with the shared ones.',
        project: PROJECT,
      },
    ]);
  });

  it('trails straight to the list when not opened from an Action', async () => {
    renderUrl();
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([`/actions?project=${PROJECT}`]);
    expect(await screen.findByRole('link', { name: 'Fix this URL with Agent' })).toBeVisible();
  });

  it('hands nothing to the Agent when the URL cannot be read', async () => {
    renderUrl(undefined, false);
    expect(await screen.findByText("Couldn't load this URL")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fix this URL with Agent' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Fix this URL with Agent' })).toBeNull();
  });
});
