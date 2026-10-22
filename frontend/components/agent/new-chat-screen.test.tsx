import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useParams } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { NewChatScreen } from './new-chat-screen';
import { ChatScreen } from './chat-screen';
import { detail, revision, REV1 } from '@/test/agent-chat-fixture';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CHAT = '22222222-2222-4222-8222-222222222222';
const SIGNAL = '33333333-3333-4333-8333-333333333333';
const PAGE = '44444444-4444-4444-8444-444444444444';

function ChatLanding() {
  return <p>Opened chat {useParams().chatId}</p>;
}

function renderNewChat(search: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/agent" element={<NewChatScreen />} />
      <Route path="/agent/chats/:chatId" element={<ChatLanding />} />
    </Routes>,
    {
      initialEntries: [`/agent${search}`],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: { id: PROJECT } as never,
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
});
afterAll(() => mswServer.close());

const ACCEPTED = {
  chat_id: CHAT,
  run: {
    id: '55555555-5555-4555-8555-555555555555',
    status: 'queued',
    mode: 'turn',
    skill_id: null,
    skill_source: null,
    steps_used: 0,
    error_code: '',
    error_detail: '',
    created_at: '2026-09-25T10:00:00Z',
    completed_at: null,
  },
};

const PRICING = '77777777-7777-4777-8777-777777777771';
const BLOG = '77777777-7777-4777-8777-777777777772';

function actionItem(id: string, label: string) {
  return {
    id,
    project_id: PROJECT,
    target_kind: 'page',
    target_label: label,
    target_url: null,
    target_prompt_id: null,
    origin: 'evidence',
    status: 'open',
    priority_score: 1,
    families: [],
    approach: 'improve_page',
    skill_id: 'gsc_optimize',
    member_count: 1,
    evidence_cleared_at: null,
    created_at: '2026-09-25T10:00:00Z',
    updated_at: '2026-09-25T10:00:00Z',
  };
}

const GROWTH_SKILL = {
  id: 'growth_plan',
  label: 'Growth plan',
  group: 'strategy',
  output_kind: 'plan',
  description: 'Prioritize work.',
};

const WORKFLOW_CATALOG = {
  skills: [GROWTH_SKILL],
  workflow_groups: [{ id: 'social', label: 'Social and video' }],
  workflows: [
    {
      id: 'linkedin_post',
      group: 'social',
      label: 'LinkedIn post',
      description: 'A short professional post.',
      skill_id: 'content_create',
      format_id: 'linkedin',
      prompt: 'Write a LinkedIn post.',
      inputs: [
        { key: 'topic', label: 'Topic', required: true },
        { key: 'tone', label: 'Tone', required: false },
      ],
    },
  ],
  output_kinds: [],
};

function baseHandlers(actions: ReturnType<typeof actionItem>[] = []) {
  return [
    http.get(`/api/v1/agent/chats/${CHAT}`, () =>
      HttpResponse.json({ ...detail(revision(REV1, 1, 'agent', '')), output: null }),
    ),
    http.get('/api/v1/agent/skills', () => HttpResponse.json({ skills: [GROWTH_SKILL] })),
    http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
      HttpResponse.json({ items: actions, next_cursor: null, status_counts: {} }),
    ),
  ];
}

function captureChats(actions: ReturnType<typeof actionItem>[] = []) {
  const bodies: unknown[] = [];
  mswServer.use(
    ...baseHandlers(actions),
    http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(ACCEPTED, { status: 202 });
    }),
  );
  return bodies;
}

describe('NewChatScreen', () => {
  it('keeps one composer during Enter submission and opens the cached conversation without a loading gap', async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading = false;
    mswServer.use(
      ...baseHandlers(),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, () =>
        HttpResponse.json(ACCEPTED, { status: 202 }),
      ),
    );
    mswServer.use(
      http.get(`/api/v1/agent/chats/${CHAT}`, async () => {
        reading = true;
        await ready;
        return HttpResponse.json({ ...detail(revision(REV1, 1, 'agent', '')), output: null });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/agent" element={<NewChatScreen />} />
        <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
      </Routes>,
      {
        initialEntries: ['/agent'],
        projectSelection: {
          activeProjectId: PROJECT,
          activeProject: { id: PROJECT } as never,
          status: 'ready',
        },
      },
    );
    const composer = await screen.findByLabelText('Message the agent');
    await user.type(composer, 'What should I focus on?{Enter}');
    await waitFor(() => expect(reading).toBe(true));
    expect(screen.getAllByRole('combobox')).toEqual([composer]);
    expect(composer).toHaveValue('What should I focus on?');
    release();
    const reply = await screen.findByLabelText('Reply to the agent');
    expect(screen.getAllByRole('combobox')).toEqual([reply]);
    expect(screen.getByRole('list', { name: 'Messages' })).toBeVisible();
  });
  it('opens skills only for a typed slash and marks the automatic default selected', async () => {
    mswServer.use(...baseHandlers());
    const user = userEvent.setup();
    renderNewChat('');
    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, '/');
    expect(await screen.findByRole('menuitemradio', { name: 'Automatic' })).toBeChecked();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(message).toHaveFocus());
    await user.keyboard('g{Backspace}');
    expect(message).toHaveValue('/');
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    await user.clear(message);
    await user.paste('Use /');
    expect(message).toHaveValue('Use /');
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('submits the skill a handoff link selects', async () => {
    const bodies = captureChats();
    const user = userEvent.setup();
    renderNewChat('?skill=earned_authority&prompt=Find+source+opportunities');
    await screen.findByLabelText('Message the agent');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      { message: 'Find source opportunities', skill_id: 'earned_authority', context: {} },
    ]);
  });

  it('starts a workflow from its form only once its required inputs are filled', async () => {
    const bodies = captureChats();
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(WORKFLOW_CATALOG)));
    const user = userEvent.setup();
    renderNewChat('');
    await user.click(await screen.findByRole('button', { name: /LinkedIn post/ }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('textbox', { name: /Topic/ })).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toEqual([]);

    await user.type(screen.getByRole('textbox', { name: /Topic/ }), 'Pricing changes');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({
        message: 'Write a LinkedIn post.\n\nTopic: Pricing changes',
        workflow_id: 'linkedin_post',
      }),
    ]);
  });

  it('sends a next step with its workflow pinned until the reader removes it', async () => {
    const bodies = captureChats();
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(WORKFLOW_CATALOG)));
    const user = userEvent.setup();
    renderNewChat('?workflow=linkedin_post&prompt=Promote+the+guide');
    await screen.findByRole('button', { name: 'Remove workflow LinkedIn post' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({ message: 'Promote the guide', workflow_id: 'linkedin_post' }),
    ]);
  });

  it('starts a chat from an evidence handoff with only the references left attached', async () => {
    const bodies: unknown[] = [];
    const keys: (string | null)[] = [];
    mswServer.use(
      ...baseHandlers(),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(ACCEPTED, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderNewChat(
      `?demand_signal_id=${SIGNAL}&target_site_url_id=${PAGE}&prompt=Why%20did%20clicks%20drop%3F`,
    );

    const message = await screen.findByLabelText('Message the agent');
    expect(message).toHaveValue('Why did clicks drop?');
    await user.click(screen.getByRole('button', { name: 'Remove Selected page' }));
    expect(screen.queryByText('Selected page')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      { message: 'Why did clicks drop?', context: { demand_signal_id: SIGNAL } },
    ]);
    expect(keys[0]).toBeTruthy();
  });

  it('starts without an attached Action that could not be loaded', async () => {
    const action = '66666666-6666-4666-8666-666666666666';
    const bodies: unknown[] = [];
    mswServer.use(
      ...baseHandlers(),
      http.get(`/api/v1/actions/${action}`, () =>
        HttpResponse.json({ error: { message: 'Action not found' } }, { status: 404 }),
      ),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(ACCEPTED, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderNewChat(`?action_id=${action}&prompt=Plan%20this`);

    expect(await screen.findByText(/This Action is unavailable/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([{ message: 'Plan this', context: {} }]);
  });

  it('picks a skill with / and mentions an Action with @', async () => {
    const bodies = captureChats([
      actionItem(PRICING, 'Pricing page'),
      actionItem(BLOG, 'Blog hub'),
    ]);
    const user = userEvent.setup();
    renderNewChat('');

    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, '/');
    await user.click(await screen.findByRole('menuitemradio', { name: 'Growth plan' }));
    expect(screen.getByRole('button', { name: 'Skill: Growth plan' })).toBeVisible();
    // The pick hands focus and the caret back to the field on the next frame;
    // typing before then lands ahead of the restored caret.
    await waitFor(() => expect(message).toHaveFocus());
    await user.type(message, 'Compare @pric');
    await user.click(await screen.findByRole('option', { name: /Pricing page/ }));
    expect(message).toHaveValue('Compare @Pricing page ');
    expect(screen.getByRole('button', { name: 'Remove @Pricing page' })).toBeVisible();
    await user.type(message, 'and last month{Enter}');

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        message: 'Compare @Pricing page and last month',
        skill_id: 'growth_plan',
        context: {},
        mentions: [PRICING],
      },
    ]);
  });

  it('restores the insertion point after a slash skill pick', async () => {
    mswServer.use(...baseHandlers());
    const user = userEvent.setup();
    renderNewChat('');
    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, 'existing text');
    await user.keyboard('{Home}/');
    await user.click(await screen.findByRole('menuitemradio', { name: 'Growth plan' }));
    await waitFor(() => expect(message).toHaveFocus());
    await user.keyboard('prefix ');
    expect(message).toHaveValue('prefix existing text');
  });

  it('preserves an explicit Automatic selection in the create request', async () => {
    const bodies = captureChats();
    const user = userEvent.setup();
    renderNewChat('');
    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, '/');
    await user.click(await screen.findByRole('menuitemradio', { name: 'Growth plan' }));
    await user.click(screen.getByRole('button', { name: 'Skill: Growth plan' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Automatic' }));
    await user.type(message, 'Explain this{Enter}');
    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeVisible();
    expect(bodies).toEqual([{ message: 'Explain this', skill_id: null, context: {} }]);
  });

  it('closes the command menu on Escape so Enter sends the message', async () => {
    const bodies = captureChats();
    const user = userEvent.setup();
    renderNewChat('');

    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, 'Use /');
    expect(await screen.findByRole('menuitemradio', { name: 'Growth plan' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(message).toHaveFocus());
    await user.type(message, 'grow{Enter}');

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([{ message: 'Use /grow', context: {} }]);
  });

  it('briefs on the top open Actions with the growth plan skill', async () => {
    const bodies = captureChats([
      actionItem(PRICING, 'Pricing page'),
      actionItem(BLOG, 'Blog hub'),
    ]);
    const user = userEvent.setup();
    renderNewChat('');

    await user.click(await screen.findByText('Work on an Action'));
    const briefing = await screen.findByRole('region', { name: 'What should I work on?' });
    expect(await within(briefing).findByText(/top 2 open Actions/)).toBeVisible();
    await user.click(within(briefing).getByRole('button', { name: 'Brief me' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({ skill_id: 'growth_plan', mentions: [PRICING, BLOG] }),
    ]);
  });
});
