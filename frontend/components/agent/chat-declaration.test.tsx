import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { ChatScreen } from './chat-screen';
import { CHAT, NOW, PROJECT, REV1, RUN, detail, revision, skills } from '@/test/agent-chat-fixture';

function renderChat() {
  return renderWithProviders(
    <Routes>
      <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
    </Routes>,
    {
      initialEntries: [`/agent/chats/${CHAT}`],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: { id: PROJECT } as never,
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('ChatScreen implementation declaration', () => {
  it('declares the revision on screen implemented and shows what it waits for', async () => {
    const ACTION = '88888888-8888-4888-8888-888888888888';
    const attached = detail(revision(REV1, 1, 'agent', 'Body.'));
    attached.chat.action_id = ACTION as never;
    attached.output.action_id = ACTION as never;
    const declaration = {
      id: '99999999-9999-4999-8999-999999999999',
      action_id: ACTION,
      output_revision_id: REV1,
      member_opportunity_ids: [],
      opportunity_snapshot_id: RUN,
      target_site_url_ids: [],
      target_external_url: null,
      declared_implemented_at: NOW,
      expected_checks: [],
      state: 'declared',
      limitations: [],
      verification_events: [],
      legs: [
        {
          leg: 'next_crawl',
          state: 'not_scheduled',
          due_at: null,
          last_evidence_at: null,
          source_id: null,
        },
      ],
      checks: [],
      measured_until: NOW,
      created_at: NOW,
    };
    let declared: typeof declaration | null = null;
    const posted: unknown[] = [];
    const action = () => ({
      id: ACTION,
      project_id: PROJECT,
      target_kind: 'page',
      target_label: 'https://acme.test/pricing',
      target_url: 'https://acme.test/pricing',
      target_prompt_id: null,
      origin: 'evidence',
      status: declared ? 'implemented' : 'in_progress',
      priority_score: 40,
      families: ['site_health'],
      approach: 'fix_technical',
      skill_id: 'technical_health',
      member_count: 1,
      evidence_cleared_at: null,
      created_at: NOW,
      updated_at: NOW,
      diagnosis: {},
      members: [],
      member_measurement: {},
      declarable_since: '2026-01-01T00:00:00Z',
      declaration: declared,
    });
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(attached)),
      http.get(`/api/v1/actions/${ACTION}`, () => HttpResponse.json(action())),
      http.post(`/api/v1/actions/${ACTION}/declaration`, async ({ request }) => {
        posted.push(await request.json());
        declared = declaration;
        return HttpResponse.json(declaration, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    await user.click(await within(pane).findByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    await user.click(within(dialog).getByRole('button', { name: 'Declare implemented' }));

    expect(await within(pane).findByText(/Crawls run when you start one/)).toBeVisible();
    // The dialog's trigger is gone; focus lands on what replaced it.
    expect(within(pane).getByRole('heading', { name: 'Measurement' })).toHaveFocus();
    expect(
      within(pane).queryByRole('button', { name: 'Mark implemented' }),
    ).not.toBeInTheDocument();
    expect(posted).toEqual([
      { output_revision_id: REV1, declared_implemented_at: expect.any(String) },
    ]);
  });
});
