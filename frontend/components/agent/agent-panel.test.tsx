import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Profiler, useEffect, useState } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { AgentPanelProvider, useAgentPanelSeed } from '@/lib/agent/panel-context';
import { refreshAgentChat } from '@/lib/api/agent';
import { AGENT_PASTE_ATTACHMENT_MIN_CHARS } from '@/lib/config/agent';
import { mswServer } from '@/test/msw-server';
import { actionsPage } from '@/test/fixtures/actions';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import { expectThreadFollowsLatest } from '@/test/chat-follow';

import { AgentPanel } from './agent-panel';
import { AgentPanelTrigger } from './agent-panel-host';
import { AGENT_MODELS, CHAT_MODEL } from '@/test/agent-chat-fixture';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CHAT = '22222222-2222-4222-8222-222222222222';
const PAGE = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-26T10:00:00Z';

const RUN = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'succeeded',
  skill_id: null,
  skill_source: null,
  steps_used: 1,
  error_code: '',
  error_detail: '',
  created_at: NOW,
  completed_at: NOW,
};

const DETAIL = {
  chat: {
    id: CHAT,
    project_id: PROJECT,
    action_id: null,
    origin: 'chat',
    target_label: null,
    title: 'Missing meta description',
    turn_count: 1,
    output_kind: null,
    last_activity_at: NOW,
    created_at: NOW,
    running: false,
  },
  pinned_skill_id: null,
  model: CHAT_MODEL,
  context: {},
  messages: [
    {
      id: '77777777-7777-4777-8777-777777777771',
      sequence: 1,
      role: 'user',
      content: 'Fix the missing meta description.',
      skill_id: null,
      skill_source: null,
      evidence_refs: [],
      steps: [],
      created_at: NOW,
    },
    {
      id: '77777777-7777-4777-8777-777777777772',
      sequence: 2,
      role: 'agent',
      content: 'Write a 150-character summary of the page.',
      skill_id: null,
      skill_source: null,
      evidence_refs: [],
      steps: [{ kind: 'model', ordinal: 1 }],
      created_at: NOW,
    },
  ],
  latest_run: RUN,
  outputs: [],
};

const screenPrompt = { set: (_prompt: string) => {} };

const issueRenders = { count: 0 };
const countIssueRender = () => {
  issueRenders.count += 1;
};

function IssueScreen() {
  const [prompt, setPrompt] = useState('Fix the missing meta description.');
  useEffect(() => {
    screenPrompt.set = setPrompt;
  }, []);
  useAgentPanelSeed({ siteUrlId: PAGE, prompt });
  return <p>Issue screen</p>;
}

function ChatLanding() {
  return <p>Workspace chat {useParams().chatId}</p>;
}

function renderShell(path: string) {
  return renderWithProviders(
    <AgentPanelProvider>
      <ToastProvider>
        <TooltipProvider>
          <AgentPanelTrigger />
          <Routes>
            <Route
              path="/site"
              element={
                <Profiler id="issue-screen" onRender={countIssueRender}>
                  <IssueScreen />
                </Profiler>
              }
            />
            <Route path="/agent/chats/:chatId" element={<ChatLanding />} />
          </Routes>
          <AgentPanel />
        </TooltipProvider>
      </ToastProvider>
    </AgentPanelProvider>,
    {
      initialEntries: [path],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() =>
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/actions`, () => HttpResponse.json(actionsPage())),
  ),
);
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const EMPTY_CATALOG = {
  skills: [],
  models: AGENT_MODELS,
  limits: {
    message_max_chars: 50000,
    mentions_max: 5,
    attachments_max: 3,
    attachment_max_chars: 40000,
    attachments_total_max_chars: 40000,
  },
};

describe('AgentPanel', () => {
  it('starts a chat from the screen context and continues it in the Agent workspace', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(EMPTY_CATALOG)),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ chat_id: CHAT, run: RUN }, { status: 202 });
      }),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(DETAIL)),
    );
    const user = userEvent.setup();
    renderShell('/site');

    const trigger = await screen.findByRole('button', { name: 'Ask agent' });
    const rendersBeforeOpen = issueRenders.count;
    await user.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Agent' });
    expect(issueRenders.count).toBe(rendersBeforeOpen);
    expect(within(panel).getByLabelText('Message the agent')).toHaveValue(
      'Fix the missing meta description.',
    );
    expect(within(panel).getByText('Selected page')).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Send' }));

    expect(
      await within(panel).findByText('Write a 150-character summary of the page.'),
    ).toBeVisible();
    expect(bodies).toEqual([
      {
        message: 'Fix the missing meta description.',
        context: { target_site_url_id: PAGE },
      },
    ]);
    expect(within(panel).getByRole('button', { name: 'Edit last request' })).toBeVisible();
    await user.click(within(panel).getByLabelText('Reply to the agent'));
    await user.paste('y'.repeat(AGENT_PASTE_ATTACHMENT_MIN_CHARS));
    expect(
      within(panel).getByRole('button', { name: 'Replace draft with last request' }),
    ).toBeVisible();

    await user.click(within(panel).getByRole('link', { name: 'Open in Agent' }));
    expect(await screen.findByText(`Workspace chat ${CHAT}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refuses a message over the catalog limit with a plain limit notice and sends nothing', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () =>
        HttpResponse.json({
          ...EMPTY_CATALOG,
          limits: { ...EMPTY_CATALOG.limits, message_max_chars: 12 },
        }),
      ),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ chat_id: CHAT, run: RUN }, { status: 202 });
      }),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(DETAIL)),
    );
    const user = userEvent.setup();
    renderShell('/site');
    await user.click(await screen.findByRole('button', { name: 'Ask agent' }));
    const panel = await screen.findByRole('dialog', { name: 'Agent' });
    await user.click(within(panel).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Messages hold up to 12 characters')).toBeInTheDocument();
    expect(
      screen.getByText('This one has 33. Shorten it, or attach the text as a file.'),
    ).toBeInTheDocument();
    const message = within(panel).getByLabelText('Message the agent');
    await user.clear(message);
    await user.type(message, 'Fix it');
    await user.click(within(panel).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ message: 'Fix it', context: { target_site_url_id: PAGE } }]),
    );
  });

  it('keeps an unsent draft when the screen context changes while open', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(EMPTY_CATALOG)));
    const user = userEvent.setup();
    renderShell('/site');

    await user.click(await screen.findByRole('button', { name: 'Ask agent' }));
    const message = within(await screen.findByRole('dialog', { name: 'Agent' })).getByLabelText(
      'Message the agent',
    );
    await user.clear(message);
    await user.type(message, 'My own question');
    act(() => screenPrompt.set('A refreshed prompt'));

    expect(screen.getByLabelText('Message the agent')).toHaveValue('My own question');
  });

  it('is offered on Dashboard screens only', async () => {
    renderShell(`/agent/chats/${CHAT}`);

    expect(await screen.findByText(`Workspace chat ${CHAT}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask agent' })).not.toBeInTheDocument();
  });

  it('follows the drawer thread in its own region until the reader scrolls up', async () => {
    let current = DETAIL;
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(EMPTY_CATALOG)),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
        HttpResponse.json({ chat_id: CHAT, run: RUN }, { status: 202 }),
      ),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
    );
    const user = userEvent.setup();
    const { queryClient } = renderShell('/site');
    await user.click(await screen.findByRole('button', { name: 'Ask agent' }));
    const panel = await screen.findByRole('dialog', { name: 'Agent' });
    await user.click(within(panel).getByRole('button', { name: 'Send' }));
    await within(panel).findByLabelText('Reply to the agent');
    await expectThreadFollowsLatest({
      scope: panel,
      user,
      newerReply: async () => {
        current = {
          ...DETAIL,
          messages: [
            ...DETAIL.messages,
            {
              ...DETAIL.messages[1]!,
              id: '77777777-7777-4777-8777-777777777773',
              sequence: 3,
              content: 'More detail.',
            },
          ],
        };
        await act(() => refreshAgentChat(queryClient, CHAT));
        await within(panel).findByText('More detail.', { selector: 'article p' });
      },
    });
  });
});
