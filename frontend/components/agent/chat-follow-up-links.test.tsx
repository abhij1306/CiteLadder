import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { AGENT_PASTE_ATTACHMENT_MIN_CHARS } from '@/lib/config/agent';
import { mswServer } from '@/test/msw-server';
import { actionDetail, actionsPage } from '@/test/fixtures/actions';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import { CHAT, PROJECT, REV1, detail, revision, skills } from '@/test/agent-chat-fixture';

vi.mock('@/lib/billing/entitlement-context', () => ({
  useManagedPlan: () => false,
  useEntitlement: () => ({ hasCapability: () => true }),
}));

import { ChatScreen } from './chat-screen';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('A follow-up with an Action link', () => {
  it('is sent with the link as a mention, keeping what was typed while it resolved', async () => {
    const ACTION = '88888888-8888-4888-8888-888888888888';
    const link = `${window.location.origin}/actions/${ACTION}`;
    const bodies: unknown[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/actions`, () => HttpResponse.json(actionsPage())),
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Old title tag.'))),
      ),
      http.get(`/api/v1/actions/${ACTION}`, async () => {
        await held;
        return HttpResponse.json(actionDetail(ACTION, 'Pricing page'));
      }),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        bodies.push(await request.json());
        const run = { ...detail(revision(REV1, 1, 'agent', '')).latest_run, status: 'queued' };
        return HttpResponse.json({ chat_id: CHAT, run }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
      </Routes>,
      {
        initialEntries: [`/agent/chats/${CHAT}`],
        projectSelection: {
          activeProjectId: PROJECT,
          activeProject: makeProject({ id: PROJECT }),
          status: 'ready',
        },
      },
    );

    const reply = await screen.findByLabelText('Reply to the agent');
    await screen.findByRole('button', { name: 'Make it shorter' });
    await user.click(reply);
    await user.paste('x'.repeat(AGENT_PASTE_ATTACHMENT_MIN_CHARS));
    await user.type(reply, `See ${link}`);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.type(reply, ' Also');
    await user.click(screen.getByRole('button', { name: 'Remove Pasted text, 1 line' }));
    release();

    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ message: 'See @Pricing page', mentions: [ACTION] });
    expect(reply).toHaveValue(`See ${link} Also`);
  });
});
