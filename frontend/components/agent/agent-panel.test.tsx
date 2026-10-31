import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useEffect, useState } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentPanelProvider, useAgentPanelSeed } from '@/lib/agent/panel-context';
import { queryKeys } from '@/lib/api/query-keys';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AgentPanel } from './agent-panel';
import { AgentPanelTrigger } from './agent-panel-host';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CHAT = '22222222-2222-4222-8222-222222222222';
const PAGE = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-26T10:00:00Z';

const RUN = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'succeeded',
  mode: 'turn',
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
    target_label: null,
    title: 'Missing meta description',
    turn_count: 1,
    output_kind: null,
    output_phase: null,
    last_activity_at: NOW,
    created_at: NOW,
    running: false,
  },
  pinned_skill_id: null,
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
      steps: [],
      created_at: NOW,
    },
  ],
  latest_run: RUN,
  output: null,
};

/** Lets a test change the screen's context, as a background refetch would. */
const screenPrompt = { set: (_prompt: string) => {} };

/** A Dashboard screen offering the typed page it is showing. */
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
      <TooltipProvider>
        <AgentPanelTrigger />
        <Routes>
          <Route path="/site" element={<IssueScreen />} />
          <Route path="/agent/chats/:chatId" element={<ChatLanding />} />
        </Routes>
        <AgentPanel />
      </TooltipProvider>
    </AgentPanelProvider>,
    {
      initialEntries: [path],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: { id: PROJECT } as never,
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() =>
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
      HttpResponse.json({ items: [], next_cursor: null, status_counts: {} }),
    ),
  ),
);
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('AgentPanel', () => {
  it('starts a chat from the screen context and continues it in the Agent workspace', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json({ skills: [] })),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ chat_id: CHAT, run: RUN }, { status: 202 });
      }),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(DETAIL)),
    );
    const user = userEvent.setup();
    renderShell('/site');

    await user.click(await screen.findByRole('button', { name: 'Open agent' }));
    const panel = await screen.findByRole('dialog', { name: 'Agent' });
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

    await user.click(within(panel).getByRole('link', { name: 'Open in Agent' }));
    expect(await screen.findByText(`Workspace chat ${CHAT}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps an unsent draft when the screen context changes while open', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json({ skills: [] })));
    const user = userEvent.setup();
    renderShell('/site');

    await user.click(await screen.findByRole('button', { name: 'Open agent' }));
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
    expect(screen.queryByRole('button', { name: 'Open agent' })).not.toBeInTheDocument();
  });

  it('keeps the drawer reading position while the persisted chat updates', async () => {
    let current = DETAIL;
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json({ skills: [] })),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
        HttpResponse.json({ chat_id: CHAT, run: RUN }, { status: 202 }),
      ),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
    );
    const scroll = vi.fn();
    const oldScroll = HTMLElement.prototype.scrollIntoView;
    const oldStyle = window.getComputedStyle;
    let scrollRoot: HTMLElement | null = null;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
      element === scrollRoot ? ({ overflowY: 'auto' } as CSSStyleDeclaration) : oldStyle(element),
    );
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const user = userEvent.setup();
      const { queryClient } = renderShell('/site');
      await user.click(await screen.findByRole('button', { name: 'Open agent' }));
      const panel = await screen.findByRole('dialog', { name: 'Agent' });
      scrollRoot = within(panel).getByRole('region', { name: 'Agent conversation' });
      Object.defineProperties(scrollRoot, {
        scrollHeight: { configurable: true, value: 3000 },
        clientHeight: { configurable: true, value: 600 },
        scrollTop: { configurable: true, writable: true, value: 0 },
      });
      await user.click(within(panel).getByRole('button', { name: 'Send' }));
      await within(panel).findByLabelText('Reply to the agent');
      const initialScrolls = scroll.mock.calls.length;
      fireEvent.scroll(scrollRoot!);
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
      await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(CHAT) }));
      await within(panel).findByText('More detail.');
      expect(scroll).toHaveBeenCalledTimes(initialScrolls);
      await user.click(within(panel).getByRole('button', { name: 'Jump to latest' }));
      expect(scroll).toHaveBeenCalledTimes(initialScrolls + 1);
    } finally {
      HTMLElement.prototype.scrollIntoView = oldScroll;
      vi.restoreAllMocks();
    }
  });
});
