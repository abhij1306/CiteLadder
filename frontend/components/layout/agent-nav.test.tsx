import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import { NOW, PROJECT, skills } from '@/test/agent-chat-fixture';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AgentNav } from './agent-nav';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function chat(id: string, title: string, running: boolean) {
  return {
    id,
    project_id: PROJECT,
    action_id: null,
    target_label: null,
    title,
    turn_count: 1,
    output_kind: null,
    output_phase: null,
    last_activity_at: NOW,
    created_at: NOW,
    running,
  };
}

it('marks every chat whose turn is still running', async () => {
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
      HttpResponse.json({ items: [], next_cursor: null, status_counts: {} }),
    ),
    http.get(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
      HttpResponse.json({
        items: [
          chat('33333333-3333-4333-8333-333333333331', 'Fix mixed content', true),
          chat('33333333-3333-4333-8333-333333333332', 'Plan the quarter', true),
          chat('33333333-3333-4333-8333-333333333333', 'Earlier question', false),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderWithProviders(<AgentNav />, { projectSelection: { activeProjectId: PROJECT } });

  const running = await screen.findByRole('link', { name: /Fix mixed content/ });
  expect(within(running).getByText('Working…')).toBeVisible();
  expect(
    within(screen.getByRole('link', { name: /Plan the quarter/ })).getByText('Working…'),
  ).toBeVisible();
  expect(
    within(screen.getByRole('link', { name: /Earlier question/ })).queryByText('Working…'),
  ).not.toBeInTheDocument();
});
