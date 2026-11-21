import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useParams } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { AGENT_PASTE_ATTACHMENT_MIN_CHARS } from '@/lib/config/agent';
import { openComposerSubmenu, pickFromComposerMenu } from '@/test/composer-menu';
import { mswServer } from '@/test/msw-server';
import { actionDetail, actionItem, actionsPage } from '@/test/fixtures/actions';
import { makeProject } from '@/test/fixtures/project';
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
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
});
afterAll(() => mswServer.close());

const ACCEPTED = {
  chat_id: CHAT,
  run: {
    id: '55555555-5555-4555-8555-555555555555',
    status: 'queued',
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

const GROWTH_SKILL = {
  id: 'growth_plan',
  label: 'Growth plan',
  group: 'strategy',
  output_kind: 'plan',
  description: 'Prioritize work.',
};

const WORKFLOW_CATALOG = {
  skills: [GROWTH_SKILL],
  workflows: [{ id: 'linkedin_post', label: 'LinkedIn post' }],
  output_kinds: [],
  limits: { mentions_max: 5, attachments_max: 3, attachment_max_chars: 40000 },
};

function baseHandlers(actions: ReturnType<typeof actionItem>[] = []) {
  return [
    http.get(`/api/v1/agent/chats/${CHAT}`, () =>
      HttpResponse.json({ ...detail(revision(REV1, 1, 'agent', '')), outputs: [] }),
    ),
    http.get('/api/v1/agent/skills', () =>
      HttpResponse.json({
        skills: [GROWTH_SKILL],
        limits: {
          mentions_max: 5,
          attachments_max: 3,
          attachment_max_chars: 40000,
        },
      }),
    ),
    http.get(`/api/v1/projects/${PROJECT}/actions`, () => HttpResponse.json(actionsPage(actions))),
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
        return HttpResponse.json({ ...detail(revision(REV1, 1, 'agent', '')), outputs: [] });
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
          activeProject: makeProject({ id: PROJECT }),
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

  it('sets the skill from the + menu as a removable chip', async () => {
    const bodies = captureChats();
    const user = userEvent.setup();
    renderNewChat('');
    const message = await screen.findByLabelText('Message the agent');
    await pickFromComposerMenu(user, /^Skills: Automatic$/, {
      role: 'menuitemradio',
      name: 'Growth plan',
    });
    const context = within(screen.getByRole('list', { name: 'Context for this request' }));
    expect(context.getByText('Skill: Growth plan')).toBeVisible();
    await user.type(message, 'Plan the quarter{Enter}');

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([{ message: 'Plan the quarter', skill_id: 'growth_plan', context: {} }]);
  });

  it('sends a next step with its workflow pinned', async () => {
    const bodies = captureChats();
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(WORKFLOW_CATALOG)));
    const user = userEvent.setup();
    renderNewChat('?workflow=linkedin_post&prompt=Promote+the+guide');
    await screen.findByRole('button', { name: 'Remove Skill: LinkedIn post' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({ message: 'Promote the guide', workflow_id: 'linkedin_post' }),
    ]);
  });

  it('replaces a pinned workflow with a skill picked from the + menu', async () => {
    const bodies = captureChats();
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(WORKFLOW_CATALOG)));
    const user = userEvent.setup();
    renderNewChat('?workflow=linkedin_post&prompt=Promote+the+guide');
    await screen.findByRole('button', { name: 'Remove Skill: LinkedIn post' });
    await openComposerSubmenu(user, /^Skills: LinkedIn post$/);
    expect(await screen.findByRole('menuitemradio', { name: 'LinkedIn post' })).toBeChecked();
    screen.getByRole('menuitemradio', { name: 'Growth plan' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Remove Skill: LinkedIn post' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Skill: Growth plan' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      { message: 'Promote the guide', skill_id: 'growth_plan', context: {} },
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

  it('reports a failed catalog read instead of showing no skills', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () =>
        HttpResponse.json({ detail: 'Bad request' }, { status: 400 }),
      ),
      ...baseHandlers(),
    );
    const user = userEvent.setup();
    renderNewChat('');

    expect(await screen.findByText("Couldn't load skills")).toBeVisible();
    await openComposerSubmenu(user, /^Skills: Automatic$/);
    expect(await screen.findByRole('menuitem', { name: "Couldn't load skills" })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
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
    expect(screen.getByText('Skill: Growth plan')).toBeVisible();
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

  it('takes a long paste as a viewable, removable attachment and sends it apart from the text', async () => {
    const bodies = captureChats();
    const user = userEvent.setup();
    renderNewChat('');
    const brief = `Brief line\n${'x'.repeat(AGENT_PASTE_ATTACHMENT_MIN_CHARS)}`;
    const message = await screen.findByLabelText('Message the agent');
    await user.click(message);
    await user.paste('Short ');
    await user.paste(brief);
    await user.paste(`Other\n${brief}`);
    expect(message).toHaveValue('Short ');
    expect(screen.getAllByRole('button', { name: 'View Pasted text, 2 lines' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove Pasted text, 3 lines' }));
    await user.click(screen.getByRole('button', { name: 'View Pasted text, 2 lines' }));
    const viewer = await screen.findByRole('dialog', { name: 'Pasted text' });
    expect(within(viewer).getByText(/^Brief line/).textContent).toBe(brief);
    await user.click(within(viewer).getByRole('button', { name: 'Close dialog' }));
    await user.type(message, 'summarize this{Enter}');

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        message: 'Short summarize this',
        context: {},
        attachments: [{ kind: 'pasted_text', text: brief }],
      },
    ]);
  });

  it('offers no further mention once the catalog-listed bound is reached', async () => {
    captureChats([actionItem(PRICING, 'Pricing page'), actionItem(BLOG, 'Blog hub')]);
    mswServer.use(
      http.get('/api/v1/agent/skills', () =>
        HttpResponse.json({
          skills: [GROWTH_SKILL],
          limits: {
            mentions_max: 1,
            attachments_max: 3,
            attachment_max_chars: 40000,
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderNewChat('');

    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, '@pric');
    await user.click(await screen.findByRole('option', { name: /Pricing page/ }));
    await user.type(message, '@blo');
    expect(message).toHaveValue('@Pricing page @blo');
    expect(screen.queryByRole('option', { name: /Blog hub/ })).not.toBeInTheDocument();
  });

  it('searches every status by the typed text once @ is typed, and shows each status', async () => {
    const measuring = { ...actionItem(PRICING, 'School uniforms'), status: 'done' };
    const reads: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/actions`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        reads.push(params.toString());
        const q = params.get('q')?.toLowerCase() ?? '';
        const found = params.get('status') === 'any' && measuring.target_label.toLowerCase();
        return HttpResponse.json(actionsPage(found && found.includes(q) ? [measuring] : []));
      }),
      ...baseHandlers(),
    );
    const user = userEvent.setup();
    renderNewChat('');

    const message = await screen.findByLabelText('Message the agent');
    await user.type(message, 'Compare ');
    await vi.waitFor(() => expect(reads).toEqual(['limit=10']));

    await user.type(message, '@uniform');
    expect(await screen.findByRole('option', { name: /School uniforms\s*Done/u })).toBeVisible();
    expect(reads.at(-1)).toBe('status=any&q=uniform&limit=20');
  });

  it('turns a pasted link to an Action of this project into a mention', async () => {
    const bodies = captureChats();
    serveAction();
    const user = userEvent.setup();
    renderNewChat('');

    const message = await screen.findByLabelText('Message the agent');
    await user.click(message);
    await user.paste(`Find ${window.location.origin}/actions/${PRICING}?project=${PROJECT}`);
    await waitFor(() => expect(message).toHaveValue('Find @Pricing page'));
    expect(screen.getByRole('button', { name: 'Remove @Pricing page' })).toBeVisible();
    await user.type(message, '{Enter}');

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({ message: 'Find @Pricing page', mentions: [PRICING] }),
    ]);
  });

  it('resolves Action links at send once, and leaves one from another project as written', async () => {
    const bodies = captureChats();
    serveAction();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let create!: () => void;
    const creating = new Promise<void>((resolve) => {
      create = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/actions/${BLOG}`, async () => {
        await held;
        return HttpResponse.json(actionDetail(BLOG, 'Blog hub', SIGNAL));
      }),
      http.post(`/api/v1/projects/${PROJECT}/agent/chats`, async ({ request }) => {
        bodies.push(await request.json());
        await creating;
        return HttpResponse.json(ACCEPTED, { status: 202 });
      }),
    );
    const own = `${window.location.origin}/actions/${PRICING}`;
    const foreign = `${window.location.origin}/actions/${BLOG}`;
    const user = userEvent.setup();
    renderNewChat(`?prompt=${encodeURIComponent(`Compare ${own} with ${foreign}`)}`);

    const message = await screen.findByDisplayValue(`Compare ${own} with ${foreign}`);
    await user.type(message, '{Enter}');
    await user.type(message, '{Enter}');
    release();
    await waitFor(() => expect(message).toHaveValue(`Compare @Pricing page with ${foreign}`));
    expect(screen.getByRole('button', { name: 'Remove @Pricing page' })).toBeVisible();
    create();

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({
        message: `Compare @Pricing page with ${foreign}`,
        mentions: [PRICING],
      }),
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
    await pickFromComposerMenu(user, /^Skills: Growth plan$/, {
      role: 'menuitemradio',
      name: 'Automatic',
    });
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

  it('offers the top Actions in the + menu, each starting a chat on it', async () => {
    mswServer.use(
      ...baseHandlers([
        actionItem(PRICING, 'Pricing page'),
        actionItem(BLOG, 'Blog hub'),
        actionItem('77777777-7777-4777-8777-777777777773', 'Docs'),
        actionItem('77777777-7777-4777-8777-777777777774', 'Careers'),
      ]),
    );
    const user = userEvent.setup();
    renderNewChat('');

    await openComposerSubmenu(user, /^Actions$/);
    const start = await screen.findByRole('menuitem', { name: 'Work on Pricing page' });
    expect(screen.getByRole('menuitem', { name: 'Work on Docs' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Work on Careers' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'All Actions' })).toHaveAttribute(
      'href',
      `/actions?project=${PROJECT}`,
    );
    expect(start).toHaveAttribute('href', `/agent?action_id=${PRICING}&project=${PROJECT}`);
    expect(screen.getByText('Type / to pick a skill or @ to mention an Action.')).toBeVisible();
  });

  function serveAction() {
    mswServer.use(
      http.get(`/api/v1/actions/${PRICING}`, () =>
        HttpResponse.json({ ...actionDetail(PRICING, 'Pricing page'), approach: 'create_new' }),
      ),
    );
  }

  it('keeps an explicit prompt over the attached Action message', async () => {
    captureChats([actionItem(PRICING, 'Pricing page')]);
    serveAction();
    renderNewChat(`?action_id=${PRICING}&prompt=Plan%20this`);

    const context = within(await screen.findByRole('list', { name: 'Context for this request' }));
    expect(await context.findByText('Action: Create a new page: Pricing page')).toBeVisible();
    expect(screen.getByLabelText('Message the agent')).toHaveValue('Plan this');
  });

  it('is about the attached Action alone until the reader removes it', async () => {
    const bodies = captureChats([actionItem(PRICING, 'Pricing page')]);
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(WORKFLOW_CATALOG)));
    serveAction();
    const user = userEvent.setup();
    renderNewChat(`?action_id=${PRICING}`);

    await screen.findByDisplayValue('Work on Pricing page.');
    expect(screen.getByText('Action: Create a new page: Pricing page')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'What should I work on?' })).toBeNull();
    expect(screen.queryByText('Type / to pick a skill or @ to mention an Action.')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Remove Action: Create a new page: Pricing page' }),
    );
    expect(screen.getByLabelText('Message the agent')).toHaveValue('Work on Pricing page.');
    expect(await screen.findByRole('region', { name: 'What should I work on?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([{ message: 'Work on Pricing page.', context: {} }]);
  });

  it('names what an Actions page hands over: one URL with its Actions and crawl, or an issue group’s URLs', async () => {
    captureChats();
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/urls/${PAGE}/actions`, () =>
        HttpResponse.json({
          site_url_id: PAGE,
          url: 'https://acme.test/shop/baby/bb0556',
          page_kind: 'product',
          last_crawled_at: '2026-11-14T10:00:00Z',
          items: [actionItem(PRICING, 'Pricing page'), actionItem(BLOG, 'Blog')],
        }),
      ),
      http.get(`/api/v1/actions/${PRICING}`, () =>
        HttpResponse.json({
          ...actionDetail(PRICING, 'Form controls missing accessible names'),
          target_kind: 'issue_family',
          page_count: 201,
        }),
      ),
    );
    const chips = async (first: string) => {
      const list = within(await screen.findByRole('list', { name: 'Context for this request' }));
      await list.findByText(first);
      return list.getAllByRole('listitem').map((chip) => chip.firstChild?.textContent);
    };

    const { unmount } = renderNewChat(`?url_actions_id=${PAGE}`);
    expect(await chips('URL: …/bb0556')).toEqual([
      'URL: …/bb0556',
      '2 actions on this URL',
      'Crawl of Nov 14, 2026',
    ]);
    unmount();
    renderNewChat(`?action_id=${PRICING}`);
    expect(await chips('201 URLs (first 50 sent)')).toEqual([
      'Action: Form controls missing accessible names · Issue across pages',
      '201 URLs (first 50 sent)',
      'Skill: From attached Action',
    ]);
  });

  it('attaches an Action picked from the + menu, its message written to edit or send', async () => {
    const bodies = captureChats([actionItem(PRICING, 'Pricing page')]);
    serveAction();
    const user = userEvent.setup();
    renderNewChat('');

    await screen.findByLabelText('Message the agent');
    await pickFromComposerMenu(user, /^Actions$/, {
      role: 'menuitem',
      name: 'Work on Pricing page',
    });

    const message = await screen.findByDisplayValue('Work on Pricing page.');
    expect(message).toHaveAccessibleName('Message the agent');
    expect(screen.getByText('Action: Create a new page: Pricing page')).toBeVisible();
    await user.type(message, ' Start with the title.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        message: 'Work on Pricing page. Start with the title.',
        action_id: PRICING,
        context: {},
      },
    ]);
  });

  it('briefs on the top open Actions with the growth plan skill', async () => {
    const bodies = captureChats([
      actionItem(PRICING, 'Pricing page'),
      actionItem(BLOG, 'Blog hub'),
    ]);
    const user = userEvent.setup();
    renderNewChat('');

    const briefing = await screen.findByRole('region', { name: 'What should I work on?' });
    expect(await within(briefing).findByText(/top 2 open Actions/)).toBeVisible();
    await user.click(within(briefing).getByRole('button', { name: 'Brief me' }));

    expect(await screen.findByText(`Opened chat ${CHAT}`)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({ skill_id: 'growth_plan', mentions: [PRICING, BLOG] }),
    ]);
  });
});
