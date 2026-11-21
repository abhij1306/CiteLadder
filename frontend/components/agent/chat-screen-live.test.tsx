import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { expectThreadFollowsLatest } from '@/test/chat-follow';

vi.mock('@/lib/billing/entitlement-context', () => ({
  useManagedPlan: () => false,
  useEntitlement: () => ({ hasCapability: () => true }),
}));

import { refreshAgentChat } from '@/lib/api/agent';
import {
  CHAT,
  REV1,
  REV2,
  RUN,
  detail,
  pageChatPhases,
  revision,
  skills,
} from '@/test/agent-chat-fixture';
import { renderChat, serveChatScreen } from '@/test/chat-screen';

serveChatScreen();

describe('ChatScreen running turn', () => {
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
    let save!: () => void;
    const saved = new Promise<void>((resolve) => {
      save = resolve;
    });
    const frame = (event: unknown) =>
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, async () => {
        if (phase !== 'before') await saved;
        return HttpResponse.json({ before: base, running, done: finished }[phase]);
      }),
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
            controller.enqueue(frame({ type: 'step', ordinal: 2 }));
            controller.enqueue(frame({ type: 'reply_delta', ordinal: 2, text: 'Then more.' }));
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

    const field = await screen.findByLabelText('Reply to the agent');
    const announced = document.querySelector('[aria-live="polite"][aria-busy]')!;
    expect(screen.getByText('Here are the edits.')).toBeVisible();
    expect(announced).toBeEmptyDOMElement();
    await user.type(field, 'Why this order?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const live = await screen.findByRole('article', { name: 'Agent reply in progress' });
    expect(screen.getByText('Why this order?')).toBeVisible();
    save();
    await vi.waitFor(() => expect(live).toHaveTextContent('Partly written'));
    expect(announced).toHaveAttribute('aria-busy', 'true');
    expect(announced).toBeEmptyDOMElement();
    expect(within(live).getByText('Thinking')).toBeVisible();
    const status = (
      await within(live).findByText('Running 2 reads at once…', { selector: 'summary *' })
    ).closest('summary')!;
    expect(within(live).getByRole('status')).toHaveTextContent('Running 2 reads at once…');
    expect(status.querySelector('output')).toBeNull();
    expect(live.textContent!.indexOf('Running 2 reads')).toBeLessThan(
      live.textContent!.indexOf('Partly written'),
    );
    await user.click(status);
    expect(
      within(within(live).getByRole('list', { name: 'Agent activity' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Reading Website, Running', 'Reading search performance, Running']);
    read();
    await vi.waitFor(() => expect(status).toHaveTextContent('Deciding the next step…'));
    expect(live).toContainElement(status);
    await vi.waitFor(() => expect(live).toHaveTextContent('Partly writtenThen more.'));
    expect(screen.getAllByText('Why this order?')).toHaveLength(1);
    release();
    await vi.waitFor(() => {
      expect(screen.getByText('The saved answer.', { selector: 'article p' })).toBeVisible();
      expect(
        screen.queryByRole('article', { name: 'Agent reply in progress' }),
      ).not.toBeInTheDocument();
    });
    expect(announced).toHaveTextContent('The saved answer.');
    expect(announced).toHaveAttribute('aria-busy', 'false');
    expect(announced).toBeInTheDocument();
  });

  it('waits while the page is read, then runs the turn the fetch queued', async () => {
    const { reading, fetched, answered } = pageChatPhases('Here is what to change.');
    let phase: 'reading' | 'fetched' | 'answered' = 'reading';
    const streamed: string[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({ reading, fetched, answered }[phase]),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/runs/:runId/run`, ({ params }) => {
        streamed.push(String(params.runId));
        phase = 'answered';
        const done = `data: ${JSON.stringify({ type: 'done', run: answered.latest_run })}\n\n`;
        return new HttpResponse(done, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    expect(await screen.findByText('Reading your page…')).toBeVisible();
    await user.type(screen.getByLabelText('Reply to the agent'), 'Also the title');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    phase = 'fetched';
    expect(await screen.findByText('Here is what to change.', {}, { timeout: 5000 })).toBeVisible();
    expect(streamed).toEqual([fetched.latest_run.id]);
    expect(screen.queryByText('Reading your page…')).not.toBeInTheDocument();
  });

  it('explains an older unanswered stop at the step limit and offers to try again', async () => {
    const stopped = detail(revision(REV1, 1, 'agent', 'Body.'), {
      status: 'failed',
      error_code: 'stopped_at_limit',
    });
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
              { ordinal: 1, status: 'completed', tool: 'read_actions', run_attempt: 1 },
              { ordinal: 1, status: 'unavailable', tool: 'read_site_health', run_attempt: 2 },
              { ordinal: 2, status: 'working', tool: null, run_attempt: 2 },
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    const status = (
      await screen.findByText('Deciding the next step…', { selector: 'summary *' })
    ).closest('summary')!;
    await user.click(status);
    const steps = within(status.parentElement!).getByRole('list', { name: 'Agent activity' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Read Website, Unavailableno data yet']);
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
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancels).toHaveLength(1);
  });

  it('follows the thread in its own region until the reader scrolls up', async () => {
    let current = detail(revision(REV1, 1, 'agent', 'Body.'));
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
    );
    const user = userEvent.setup();
    const { queryClient } = renderChat();
    await screen.findByLabelText('Reply to the agent');
    await expectThreadFollowsLatest({
      scope: document.body,
      user,
      newerReply: async () => {
        current = detail(revision(REV2, 2, 'agent', 'Updated body.'));
        await act(() => refreshAgentChat(queryClient, CHAT));
        await screen.findByText('Updated body.');
      },
    });
  });
});
