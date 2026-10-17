import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
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

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => ({ saveBlob: mocks.saveBlob }));
import { ChatScreen } from './chat-screen';
import { OutputHistory } from './output-history';
import { queryKeys } from '@/lib/api/query-keys';
import {
  CHAT,
  NOW,
  PROJECT,
  REV1,
  REV2,
  RUN,
  detail,
  revision,
  skills,
} from '@/test/agent-chat-fixture';

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

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() =>
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
      HttpResponse.json({ items: [], next_cursor: null, status_counts: {} }),
    ),
  ),
);
afterEach(() => {
  mswServer.resetHandlers();
  mocks.saveBlob.mockReset();
});
afterAll(() => mswServer.close());

describe('ChatScreen', () => {
  it('selects Automatic when a follow-up has no inherited workflow', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({
          ...detail(revision(REV1, 1, 'agent', 'Body.')),
          output: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByRole('button', { name: 'Skill: Automatic' }));
    expect(screen.getByRole('menuitemradio', { name: 'Automatic' })).toBeChecked();
  });

  it('shows supplied context omissions and approval as an action tied to its revision', async () => {
    const current = {
      ...detail(revision(REV1, 1, 'agent', 'Body.')),
      context: {
        instructions: { revision: 2 },
        prompt: {
          included_sections: ['issue_group'],
          omissions: ['oldest_history_messages'],
          serialized_chars: 5000,
          max_chars: 90000,
        },
      },
    };
    const approval = {
      ...current.messages[0]!,
      event: { kind: 'outline_approved', revision_id: REV1, run_id: RUN },
    };
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({ ...current, messages: [approval, current.messages[1]] }),
      ),
    );
    const user = userEvent.setup();
    renderChat();
    expect(await screen.findByRole('article', { name: 'Outline approval' })).toHaveTextContent(
      'Outline approved',
    );
    await user.click(screen.getByText('Context used'));
    expect(screen.getByText('Selected issue group')).toBeVisible();
    // Omissions are disclosed in plain words, never as internal codes.
    expect(screen.getByText(/left out to fit this turn/)).toBeVisible();
    expect(screen.queryByText(/oldest_history|history messages/)).not.toBeInTheDocument();
    expect(screen.queryByText(current.messages[0]!.content)).not.toBeInTheDocument();
  });
  it('saves an edit as a new revision and shows it inline in the thread', async () => {
    let current = detail(revision(REV1, 1, 'agent', 'Old title tag.'));
    const edits: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
      http.post(`/api/v1/agent/chats/${CHAT}/output/revisions`, async ({ request }) => {
        edits.push(await request.json());
        const saved = revision(REV2, 2, 'user', 'New title tag.');
        current = detail(saved);
        return HttpResponse.json(saved, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    expect(within(pane).getByText('Revision 1')).toBeVisible();
    expect(await screen.findByText('Skill: Search Console optimization')).toBeVisible();

    await user.click(within(pane).getByRole('button', { name: 'Edit' }));
    const body = within(pane).getByLabelText('Output body (Markdown)');
    await user.clear(body);
    await user.type(body, 'New title tag.');
    await user.click(within(pane).getByRole('button', { name: 'Save as new revision' }));

    expect(await within(pane).findByText('Revision 2')).toBeVisible();
    expect(edits).toEqual([
      { base_revision_id: REV1, title: 'Pricing page edits', body: 'New title tag.' },
    ]);
    expect(await within(pane).findByText('New title tag.')).toBeVisible();
  });

  it('sends one section to the agent with a scoped instruction', async () => {
    const body = 'Intro.\n\n## Title tag\nOld title.\n\n## Meta description\nOld meta.';
    const sent: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', body))),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(
          {
            chat_id: CHAT,
            run: { ...detail(revision(REV1, 1, 'agent', body)).latest_run, status: 'queued' },
          },
          { status: 202 },
        );
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(
      await screen.findByRole('button', { name: 'Ask the agent to revise Title tag' }),
    );
    await user.type(screen.getByLabelText('How should the agent revise Title tag?'), 'Shorter.');
    await user.click(screen.getByRole('button', { name: 'Ask agent' }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      message:
        'Revise only the section "Title tag": Shorter. Keep every other section exactly as it is.',
    });
  });

  it('saves an edit to one section and keeps every other section', async () => {
    const body = 'Intro.\n\n## Title tag\nOld title.\n\n## Meta description\nOld meta.';
    const edits: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', body))),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/output/revisions`, async ({ request }) => {
        edits.push(await request.json());
        return HttpResponse.json(revision(REV2, 2, 'user', 'x'), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Edit Title tag' }));
    const text = screen.getByLabelText('Section text (Markdown)');
    await user.clear(text);
    await user.type(text, '## Title tag{enter}New title.');
    await user.click(screen.getByRole('button', { name: 'Save section' }));

    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({
      base_revision_id: REV1,
      title: 'Pricing page edits',
      body: 'Intro.\n\n## Title tag\nNew title.\n\n## Meta description\nOld meta.',
    });
  });

  it('links cited evidence and offers the next workflow in a new chat with this revision', async () => {
    const ACTION = '88888888-8888-4888-8888-888888888888';
    const base = detail(revision(REV1, 1, 'agent', 'Body.'));
    const withEvidence = {
      ...base,
      messages: base.messages.map((message) =>
        message.role === 'agent'
          ? { ...message, evidence_refs: [`citeladder://action/${ACTION}`] }
          : message,
      ),
    };
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(withEvidence)),
    );
    renderChat();

    const cited = within(await screen.findByRole('list', { name: 'Cited evidence' }));
    expect(cited.getByRole('link', { name: 'Action' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/agent/actions/${ACTION}`),
    );
    const next = within(await screen.findByRole('navigation', { name: 'Next steps' }));
    const href = new URL(
      next.getByRole('link', { name: 'Internal links' }).getAttribute('href')!,
      'https://app.test',
    );
    expect(href.searchParams.get('workflow')).toBe('internal_links');
    expect(href.searchParams.get('revision_id')).toBe(REV1);
  });

  it('links the Actions a message mentioned', async () => {
    const ACTION = '88888888-8888-4888-8888-888888888888';
    const base = detail(revision(REV1, 1, 'agent', 'Body.'));
    const withMention = {
      ...base,
      messages: base.messages.map((message) =>
        message.role === 'user'
          ? { ...message, mentions: [{ kind: 'action', id: ACTION, label: 'Pricing page' }] }
          : message,
      ),
    };
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(withMention)),
      http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
        HttpResponse.json({ items: [], next_cursor: null, status_counts: {} }),
      ),
    );
    renderChat();

    const mentioned = within(await screen.findByRole('list', { name: 'Mentioned Actions' }));
    expect(mentioned.getByRole('link', { name: '@Pricing page' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/agent/actions/${ACTION}`),
    );
  });

  it('compares an earlier revision with the current one', async () => {
    mswServer.use(
      http.get(`/api/v1/agent/chats/${CHAT}/output/revisions`, () =>
        HttpResponse.json({
          items: [
            revision(REV1, 1, 'agent', 'Keep.\nOld line.'),
            revision(REV2, 2, 'user', 'Keep.\nNew line.'),
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <OutputHistory
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        chatId={CHAT}
        latestRevisionId={REV2}
        canRestore={false}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Compare with current' }));

    const changes = within(screen.getByRole('list', { name: 'Changes from revision 1' }));
    const changed = changes
      .getAllByRole('listitem')
      .map((item) => item.textContent)
      .filter((text) => text?.includes(':'));
    expect(changed).toEqual(['−Removed:Old line.', '+Added:New line.']);
  });

  it('keeps an unsaved edit when switching output tabs', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Old title tag.'))),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    await user.click(within(pane).getByRole('button', { name: 'Edit' }));
    await user.type(within(pane).getByLabelText('Output body (Markdown)'), ' Draft.');
    await user.click(within(pane).getByRole('tab', { name: 'Sources' }));
    await user.click(within(pane).getByRole('tab', { name: 'Final' }));

    expect(within(pane).getByLabelText('Output body (Markdown)')).toHaveValue(
      'Old title tag. Draft.',
    );
  });

  it('shows the reply as it streams, then the saved reply in its place', async () => {
    const STREAMED_RUN = '99999999-9999-4999-8999-999999999991';
    const base = detail(revision(REV1, 1, 'agent', 'Body.'));
    const question = {
      ...base.messages[0]!,
      id: '77777777-7777-4777-8777-777777777781',
      sequence: 3,
      content: 'Why this order?',
    };
    const running = {
      ...base,
      messages: [...base.messages, question],
      latest_run: { ...base.latest_run, id: STREAMED_RUN, status: 'running' as const },
    };
    const finished = {
      ...running,
      messages: [
        ...running.messages,
        {
          ...base.messages[1]!,
          id: '77777777-7777-4777-8777-777777777782',
          sequence: 4,
          content: 'The saved answer.',
        },
      ],
      latest_run: { ...running.latest_run, status: 'succeeded' as const },
    };
    let phase: 'before' | 'running' | 'done' = 'before';
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let read!: () => void;
    const reading = new Promise<void>((resolve) => {
      read = resolve;
    });
    const frame = (event: unknown) =>
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({ before: base, running, done: finished }[phase]),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, () => {
        phase = 'running';
        return HttpResponse.json(
          { chat_id: CHAT, run: { ...running.latest_run, status: 'queued' } },
          { status: 202 },
        );
      }),
      http.post(`/api/v1/agent/chats/${CHAT}/runs/${STREAMED_RUN}/run`, () => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(frame({ type: 'step', ordinal: 1 }));
            controller.enqueue(frame({ type: 'thinking', ordinal: 1, text: 'Comparing pages' }));
            controller.enqueue(frame({ type: 'reply_delta', ordinal: 1, text: 'Partly ' }));
            controller.enqueue(frame({ type: 'reply_delta', ordinal: 1, text: 'written' }));
            for (const [call_id, tool] of [
              ['a', 'read_site_health'],
              ['b', 'read_performance'],
            ])
              controller.enqueue(
                frame({ type: 'tool', ordinal: 1, call_id, tool, status: 'started' }),
              );
            await reading;
            // A later step never blanks what was already written.
            controller.enqueue(frame({ type: 'step', ordinal: 2 }));
            await held;
            phase = 'done';
            controller.enqueue(frame({ type: 'done', run: finished.latest_run }));
            controller.close();
          },
        });
        return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.type(await screen.findByLabelText('Reply to the agent'), 'Why this order?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const live = await screen.findByRole('article', { name: 'Agent reply in progress' });
    await vi.waitFor(() => expect(live).toHaveTextContent('Partly written'));
    expect(within(live).getByText('Thinking')).toBeVisible();
    // Reads one response asked for run together and are shown together.
    expect(await screen.findByText('Running 2 reads at once…')).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Current reads' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Reading site health…', 'Reading performance…']);
    read();
    expect(await screen.findByText('Deciding the next step…')).toBeVisible();
    expect(live).toHaveTextContent('Partly written');
    release();
    expect(await screen.findByText('The saved answer.')).toBeVisible();
    expect(
      screen.queryByRole('article', { name: 'Agent reply in progress' }),
    ).not.toBeInTheDocument();
  });

  it('regenerates the last reply by sending its request again as a new turn', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Body.'))),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            chat_id: CHAT,
            run: { ...detail(revision(REV1, 1, 'agent', '')).latest_run, status: 'queued' },
          },
          { status: 202 },
        );
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await vi.waitFor(() =>
      expect(bodies).toEqual([{ message: 'Improve our pricing page snippet.' }]),
    );
    // The reader's draft is untouched.
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('');
  });

  it('retries a failed send with the same idempotency key', async () => {
    const keys: (string | null)[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Old title tag.'))),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        if (keys.length === 1)
          return HttpResponse.json({ error: { message: 'Unavailable' } }, { status: 503 });
        return HttpResponse.json(
          {
            chat_id: CHAT,
            run: { ...detail(revision(REV1, 1, 'agent', '')).latest_run, status: 'queued' },
          },
          { status: 202 },
        );
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.type(await screen.findByLabelText('Reply to the agent'), 'Shorten it.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('Shorten it.');
    await user.type(screen.getByLabelText('Reply to the agent'), ' Next draft.');
    await user.click(screen.getByRole('button', { name: 'Retry send' }));

    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('Shorten it. Next draft.');
  });

  it('exports the revision as Markdown', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Body text.'))),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    await user.click(within(pane).getByRole('button', { name: 'Export Markdown' }));

    const [blob, filename] = mocks.saveBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('pricing-page-edits.md');
    expect(await blob.text()).toBe('# Pricing page edits\n\nBody text.\n');
  });

  it('restores Action context for a fresh attempt and explicitly replaces an existing draft', async () => {
    const ACTION = '88888888-8888-4888-8888-888888888888';
    let current = detail(revision(REV1, 1, 'agent', 'Body.'));
    const keys: (string | null)[] = [];
    const bodies: unknown[] = [];
    let accept!: () => void;
    const acceptance = new Promise<void>((resolve) => {
      accept = resolve;
    });
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
      http.get(`/api/v1/projects/${PROJECT}/actions`, () =>
        HttpResponse.json({
          items: [
            {
              id: ACTION,
              project_id: PROJECT,
              target_kind: 'page',
              target_label: 'Pricing page',
              target_url: null,
              target_prompt_id: null,
              origin: 'evidence',
              status: 'open',
              priority_score: 1,
              families: [],
              approach: 'fix_technical',
              skill_id: 'technical_health',
              member_count: 1,
              evidence_cleared_at: null,
              created_at: NOW,
              updated_at: NOW,
            },
          ],
          next_cursor: null,
          status_counts: {},
        }),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        bodies.push(await request.json());
        if (keys.length === 1) await acceptance;
        current = {
          ...detail(revision(REV1, 1, 'agent', 'Body.'), {
            status: 'failed',
            error_code: 'provider_error',
          }),
          messages: [
            ...current.messages,
            {
              ...current.messages[0]!,
              id: `77777777-7777-4777-8777-${String(keys.length + 3).padStart(12, '0')}`,
              sequence: current.messages.length + 1,
              content: '@Pricing page Shorten it.',
              mentions: [{ kind: 'action', id: ACTION, label: 'Pricing page' }],
            },
          ],
        };
        return HttpResponse.json({ chat_id: CHAT, run: current.latest_run }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderChat();
    await user.type(await screen.findByLabelText('Reply to the agent'), '@Pricing');
    await user.click(await screen.findByRole('option', { name: /Pricing page/ }));
    await user.type(screen.getByLabelText('Reply to the agent'), 'Shorten it.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(screen.getByRole('button', { name: 'Remove @Pricing page' }));
    accept();
    await screen.findByRole('button', { name: 'Replace draft with last request' });
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('@Pricing page Shorten it.');
    expect(screen.queryByRole('button', { name: 'Remove @Pricing page' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace draft with last request' }));
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('@Pricing page Shorten it.');
    expect(screen.getByRole('button', { name: 'Remove @Pricing page' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
    expect(bodies).toEqual([
      { message: '@Pricing page Shorten it.', mentions: [ACTION] },
      { message: '@Pricing page Shorten it.', mentions: [ACTION] },
    ]);
  });

  it('explains an older unanswered stop at the step limit and offers to try again', async () => {
    const stopped = detail(revision(REV1, 1, 'agent', 'Body.'), {
      status: 'failed',
      error_code: 'stopped_at_limit',
    });
    // Turns now always end with a reply; an older one may have ended silently.
    stopped.messages = stopped.messages.filter((message) => message.role === 'user');
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(stopped)),
    );
    renderChat();

    expect(await screen.findByText(/stopped at its step limit/i)).toBeVisible();
    expect(screen.queryByText(/could not finish/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('shows what a running turn has done so far', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(
          detail(revision(REV1, 1, 'agent', 'Body.'), {
            status: 'running',
            progress: [
              { ordinal: 1, status: 'unavailable', tool: 'read_site_health' },
              { ordinal: 2, status: 'working', tool: null },
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByText('View activity'));
    const steps = within(screen.getByRole('list', { name: 'Agent progress' }));
    expect(steps.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Read site health · no data yet',
      'Deciding the next step…',
    ]);
  });

  it('refuses edits while a turn is running and offers Stop', async () => {
    const cancels: string[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Body.'), { status: 'running' })),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/runs/${RUN}/cancel`, ({ params }) => {
        cancels.push(String(params.chatId ?? CHAT));
        return HttpResponse.json({ ...detail(revision(REV1, 1, 'agent', 'x')).latest_run });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    expect(within(pane).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByLabelText('Reply to the agent')).toBeEnabled();
    await user.type(screen.getByLabelText('Reply to the agent'), 'Next question');
    // While the turn runs, Stop takes Send's place; drafting continues.
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancels).toHaveLength(1);
  });

  it('prefills a suggestion for review and hides suggestions after discussion', async () => {
    let current = detail(revision(REV1, 1, 'agent', 'Body.'));
    const sends: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        sends.push(await request.json());
        return HttpResponse.json({ chat_id: CHAT, run: current.latest_run }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderChat();
    await user.click(await screen.findByRole('button', { name: 'Make it shorter' }));
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('Make it shorter');
    expect(sends).toHaveLength(0);
    current = {
      ...current,
      messages: [
        ...current.messages,
        {
          ...current.messages[1]!,
          id: '77777777-7777-4777-8777-777777777773',
          content: 'Here is why.',
          sequence: 3,
          created_at: '2026-09-25T11:00:00Z',
        },
      ],
    };
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(CHAT) }));
    await screen.findByText('Here is why.');
    expect(screen.queryByRole('group', { name: 'Suggested follow-ups' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('Make it shorter');
  });

  it('shows the workflow inherited from the chat without promising automatic routing', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({
          ...detail(revision(REV1, 1, 'agent', 'Body.')),
          pinned_skill_id: 'gsc_optimize',
        }),
      ),
    );
    const user = userEvent.setup();
    renderChat();
    await user.click(
      await screen.findByRole('button', {
        name: 'Skill: Continue with Search Console optimization',
      }),
    );
    expect(screen.getByRole('menuitemradio', { name: 'Automatic' })).toBeVisible();
    expect(
      screen.getByRole('menuitemradio', { name: 'Continue with Search Console optimization' }),
    ).toBeChecked();
    await user.click(screen.getByRole('menuitemradio', { name: 'Search Console optimization' }));
    await user.click(screen.getByRole('button', { name: 'Skill: Search Console optimization' }));
    await user.click(
      screen.getByRole('menuitemradio', { name: 'Continue with Search Console optimization' }),
    );
    expect(
      screen.getByRole('button', { name: 'Skill: Continue with Search Console optimization' }),
    ).toBeVisible();
  });

  it.each([0, 2000])(
    'preserves reading position through polling from scroll offset %i',
    async (offset) => {
      let current = detail(revision(REV1, 1, 'agent', 'Body.'));
      mswServer.use(
        http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
        http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
      );
      const scroll = vi.fn();
      vi.stubGlobal('scrollY', offset);
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        value: 4000,
      });
      const oldScroll = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = scroll;
      try {
        const user = userEvent.setup();
        const { queryClient } = renderChat();
        await screen.findByLabelText('Reply to the agent');
        const initialScrolls = scroll.mock.calls.length;
        if (offset > 0) expect(initialScrolls).toBe(0);
        fireEvent.scroll(window);
        current = detail(revision(REV2, 2, 'agent', 'Updated body.'));
        await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(CHAT) }));
        expect(scroll).toHaveBeenCalledTimes(initialScrolls);
        await user.click(screen.getByRole('button', { name: 'Jump to latest' }));
        expect(scroll).toHaveBeenCalledTimes(initialScrolls + 1);
      } finally {
        HTMLElement.prototype.scrollIntoView = oldScroll;
        Reflect.deleteProperty(document.documentElement, 'scrollHeight');
        vi.unstubAllGlobals();
      }
    },
  );
});
