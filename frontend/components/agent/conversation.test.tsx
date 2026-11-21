import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
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

import { DISPLAY_TIME_ZONE_COOKIE } from '@/lib/display-timezone';
import { detail, revision, REV2, skills } from '@/test/agent-chat-fixture';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { Conversation } from './conversation';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Conversation order', () => {
  it.each(['linked', 'historical'])(
    'keeps follow-ups after a %s user-edited result',
    async (placement) => {
      const current = detail(revision(REV2, 2, 'user', 'Saved first-turn result.'));
      const [document] = current.outputs;
      const chat = agentChatDetailSchema.parse({
        ...current,
        outputs: [
          { ...document, message_id: placement === 'linked' ? document!.message_id : null },
        ],
        messages: [
          ...current.messages,
          {
            ...current.messages[0]!,
            id: '77777777-7777-4777-8777-777777777773',
            sequence: 3,
            content: 'Why did you recommend this?',
          },
        ],
      });
      mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
      renderWithProviders(
        <Conversation
          workspaceId="workspace"
          detail={chat}
          renderOutput={(output) => (
            <section aria-label={output.latest_revision.title}>
              {output.latest_revision.body}
            </section>
          )}
          onRefine={vi.fn()}
          onRecover={vi.fn()}
          onRetry={vi.fn()}
          canSend
        />,
      );
      const result = await screen.findByText('Saved first-turn result.');
      const followup = screen.getByText('Why did you recommend this?');
      expect(
        result.compareDocumentPosition(followup) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getAllByRole('region', { name: 'Pricing page edits' })).toHaveLength(1);
      expect(screen.queryByRole('group', { name: 'Suggested follow-ups' })).not.toBeInTheDocument();
    },
  );
});

describe('A finished reply’s activity', () => {
  it('summarises what the turn did by verb and lists each visible step without model calls', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    renderWithProviders(
      <Conversation
        workspaceId="workspace"
        detail={agentChatDetailSchema.parse(detail(revision(REV2, 2, 'agent', 'Saved result.')))}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );
    const summary = await screen.findByText('Loaded the method · read connected data');
    expect(
      within(screen.getByRole('list', { name: 'Agent activity', hidden: true }))
        .getAllByRole('listitem', { hidden: true })
        .map((item) => item.textContent),
    ).toEqual(['Loaded the method, Done', 'Read connected data, Done']);
    expect(
      summary.compareDocumentPosition(screen.getByText('Here are the edits.')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows each step’s detail, hides refused reads and lists pages apart from CiteLadder records', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    const current = detail(revision(REV2, 2, 'agent', 'Saved result.'));
    const [request, reply] = current.messages;
    const chat = agentChatDetailSchema.parse({
      ...current,
      messages: [
        request,
        {
          ...reply,
          steps: [
            { kind: 'model', ordinal: 1 },
            {
              kind: 'search',
              ordinal: 1,
              query: 'acme pricing',
              status: 'completed',
              call_id: 's1',
            },
            { kind: 'tool', ordinal: 1, tool: 'fetch', status: 'refused', call_id: 'a' },
            { kind: 'tool', ordinal: 1, tool: 'read_actions', status: 'completed', call_id: 'b' },
            {
              kind: 'tool',
              ordinal: 1,
              tool: 'read_page_text',
              status: 'completed',
              call_id: 'c',
              target: 'https://acme.example/returns',
            },
            { kind: 'model', ordinal: 2 },
            { kind: 'document', action: 'edited', number: 1, title: 'Pricing page edits' },
          ],
          web_sources: [{ url: 'https://acme.example/pricing', title: 'Acme pricing' }],
        },
      ],
    });
    renderWithProviders(
      <Conversation
        workspaceId="workspace"
        detail={chat}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );
    expect(
      await screen.findByText('Searched the web · read Actions and page · edited Document 1'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Agent activity', hidden: true }))
        .getAllByRole('listitem', { hidden: true })
        .map((item) => item.textContent),
    ).toEqual([
      'Searched the web, Doneacme pricing',
      'Read Actions, Done',
      'Read page, Donehttps://acme.example/returns',
      'Edited Document 1, DonePricing page edits',
    ]);
    const sources = screen.getByRole('region', { name: 'Web sources' });
    expect(within(sources).getByRole('link', { name: /Acme pricing/u })).toHaveAttribute(
      'href',
      'https://acme.example/pricing',
    );
  });
});

describe('Actions in a chat', () => {
  it('turn a cited Action’s exact title into a link with its current status, and show it on the mention', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    const cited = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const uncited = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const current = detail(revision(REV2, 2, 'agent', 'Saved result.'));
    const [request, reply] = current.messages;
    const chat = agentChatDetailSchema.parse({
      ...current,
      messages: [
        { ...request, mentions: [{ kind: 'action', id: cited, label: 'Label when sent' }] },
        {
          ...reply,
          content:
            'Start with School uniforms, not School uniforms2 or `School uniforms`. Returns policy can wait.',
          evidence_refs: [`citeladder://action/${cited}`],
        },
      ],
      actions: [
        { id: cited, target_label: 'School uniforms', status: 'done' },
        { id: uncited, target_label: 'Returns policy', status: 'open' },
      ],
    });
    renderWithProviders(
      <Conversation
        workspaceId="workspace"
        detail={chat}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );

    const chips = await screen.findAllByRole('link', { name: 'School uniforms Done' });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('href')).toMatch(new RegExp(`^/actions/${cited}`, 'u'));
    expect(screen.getByText('School uniforms', { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Returns policy/u })).not.toBeInTheDocument();
    const mentions = screen.getByRole('list', { name: 'Mentioned Actions' });
    expect(within(mentions).getByRole('link')).toHaveAccessibleName('@School uniforms Done');
  });
});

describe('Links in a reply', () => {
  it('open directly to the project’s site and the turn’s sources, and confirm anywhere else', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    const current = detail(revision(REV2, 2, 'agent', 'Saved result.'));
    const [request, reply] = current.messages;
    const chat = agentChatDetailSchema.parse({
      ...current,
      messages: [
        request,
        {
          ...reply,
          content:
            '[Our pricing](https://www.acme.com/pricing), [the review](https://reviews.example/acme) and [more](https://evil.example/?notes=private)',
          web_sources: [{ url: 'https://reviews.example/acme', title: 'Acme review' }],
        },
      ],
    });
    renderWithProviders(
      <Conversation
        workspaceId="workspace"
        detail={chat}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
      { projectSelection: { activeProject: makeProject({ website_url: 'https://acme.com' }) } },
    );

    // `fireEvent` returns false when a handler cancelled the browser's navigation.
    expect(fireEvent.click(await screen.findByRole('link', { name: 'Our pricing' }))).toBe(true);
    expect(fireEvent.click(screen.getByRole('link', { name: 'the review' }))).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(fireEvent.click(screen.getByRole('link', { name: 'more' }))).toBe(false);
    expect(screen.getByRole('dialog', { name: 'You’re leaving CiteLadder' })).toHaveTextContent(
      'https://evil.example/?notes=private',
    );
  });
});

const PROVIDER_ERROR =
  'The AI model did not respond after several attempts. Nothing was saved; try again in a moment.';

function chatWith(
  run: { status: string; error_code?: string },
  messages: (
    | { role: 'user'; at: string; content?: string }
    | { role: 'agent'; at: string; content: string; answered: boolean }
  )[],
) {
  const base = detail(revision(REV2, 2, 'agent', 'Saved result.'), run);
  const [request, reply] = base.messages;
  return agentChatDetailSchema.parse({
    ...base,
    outputs: [],
    messages: messages.map((message, index) => ({
      ...(message.role === 'user' ? request : reply),
      id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
      sequence: index + 1,
      created_at: message.at,
      ...(message.role === 'user'
        ? { content: message.content ?? request!.content }
        : { content: message.content, steps: message.answered ? reply!.steps : [] }),
    })),
  });
}

function renderChat(chat: ReturnType<typeof chatWith>) {
  mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
  return renderWithProviders(
    <Conversation
      workspaceId="workspace"
      detail={chat}
      onRefine={vi.fn()}
      onRecover={vi.fn()}
      onRetry={vi.fn()}
      canSend
    />,
  );
}

describe('An unanswered turn', () => {
  beforeEach(() => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=UTC; Path=/`;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=; Path=/; Max-Age=0`;
  });

  it('shows a failed run’s reply as an error with no reply actions', async () => {
    renderChat(
      chatWith({ status: 'failed', error_code: 'provider_error' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: PROVIDER_ERROR, answered: false },
      ]),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Error: Failed at`);
    expect(within(alert).getByText('Sep 25, 2026, 10:01 AM')).toBeVisible();
    expect(alert).toHaveTextContent(PROVIDER_ERROR);
    expect(screen.queryByRole('article', { name: 'Agent reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit last request' })).toBeEnabled();
    expect(screen.queryAllByRole('heading').map((heading) => heading.tagName)).toEqual([]);
  });

  it('shows a run stopped at its step limit as a warning', async () => {
    renderChat(
      chatWith({ status: 'failed', error_code: 'stopped_at_limit' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: 'Step limit.', answered: false },
      ]),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Warning: Hit the step limit at');
    expect(alert).toHaveTextContent('Step limit.');
  });

  it('shows a failure’s contact address once, as an email link', async () => {
    renderChat(
      chatWith({ status: 'failed', error_code: 'funding_unavailable' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        {
          role: 'agent',
          at: '2026-09-25T10:01:00Z',
          content:
            'This workspace has no AI credits available right now. Nothing was saved. To get more, email [contact@citeladder.com](mailto:contact@citeladder.com).',
          answered: false,
        },
      ]),
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'contact@citeladder.com' })).toHaveAttribute(
      'href',
      'mailto:contact@citeladder.com',
    );
    expect(alert.textContent?.match(/contact@citeladder\.com/gu)).toHaveLength(1);
  });

  it('collapses the same request failing the same way into one count', async () => {
    renderChat(
      chatWith({ status: 'failed', error_code: 'provider_error' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: PROVIDER_ERROR, answered: false },
        { role: 'user', at: '2026-09-25T10:04:00Z' },
        { role: 'agent', at: '2026-09-25T10:05:00Z', content: PROVIDER_ERROR, answered: false },
      ]),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error: Failed 2 times, last at');
    expect(within(alert).getByText('Sep 25, 2026, 10:05 AM')).toBeVisible();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText('Improve our pricing page snippet.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('keeps different requests apart', async () => {
    renderChat(
      chatWith({ status: 'failed', error_code: 'provider_error' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: PROVIDER_ERROR, answered: false },
        { role: 'user', at: '2026-09-25T10:04:00Z', content: 'Shorten the title.' },
        { role: 'agent', at: '2026-09-25T10:05:00Z', content: PROVIDER_ERROR, answered: false },
      ]),
    );

    expect(await screen.findByText('Shorten the title.')).toBeVisible();
    expect(screen.getByText('Improve our pricing page snippet.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Failed at');
    expect(screen.getByRole('status')).toHaveTextContent('Note: Did not finish at');
  });

  it('shows an earlier unanswered turn as a note before a written reply', async () => {
    renderChat(
      chatWith({ status: 'succeeded' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: PROVIDER_ERROR, answered: false },
        { role: 'user', at: '2026-09-25T10:04:00Z' },
        {
          role: 'agent',
          at: '2026-09-25T10:05:00Z',
          content: 'Here are the edits.',
          answered: true,
        },
      ]),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      `Note: Did not finish at Sep 25, 2026, 10:01 AM${PROVIDER_ERROR}`,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const reply = screen.getByRole('article', { name: 'Agent reply' });
    expect(reply).toHaveTextContent('Here are the edits.');
    expect(screen.getAllByRole('button', { name: 'Copy reply' })).toHaveLength(1);
  });
});

describe('A reply’s time', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=; Path=/; Max-Age=0`;
  });

  it('reads in full today', async () => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=UTC; Path=/`;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T18:00:00Z'));
    renderChat(
      chatWith({ status: 'succeeded' }, [
        { role: 'user', at: '2026-09-25T10:00:00Z' },
        { role: 'agent', at: '2026-09-25T10:01:00Z', content: 'Done.', answered: true },
      ]),
    );

    const time = (await screen.findByRole('article', { name: 'Agent reply' })).querySelector(
      'time',
    );
    expect(time).toHaveAttribute('datetime', '2026-09-25T10:01:00Z');
    expect(time?.textContent).toBe('Sep 25, 2026, 10:01 AM');
  });
});

describe('A chat with several documents', () => {
  it('shows each document after the reply that wrote it and lists them all', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    const current = detail(revision(REV2, 2, 'agent', 'First document body.'));
    const [request, reply] = current.messages;
    const [first] = current.outputs;
    const laterReply = {
      ...reply!,
      id: '77777777-7777-4777-8777-777777777774',
      sequence: 4,
      content: 'Here is the outline.',
    };
    const chat = agentChatDetailSchema.parse({
      ...current,
      messages: [
        request,
        reply,
        { ...request!, id: '77777777-7777-4777-8777-777777777773', sequence: 3 },
        laterReply,
      ],
      outputs: [
        first,
        {
          ...first,
          id: '33333333-3333-4333-8333-333333333334',
          number: 2,
          message_id: laterReply.id,
          latest_revision: {
            ...first!.latest_revision,
            title: 'Content outline',
            body: 'Outline.',
          },
        },
      ],
    });
    renderWithProviders(
      <Conversation
        workspaceId="workspace"
        detail={chat}
        renderOutput={(output) => <p>{output.latest_revision.body}</p>}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );
    const list = await screen.findByRole('navigation', { name: 'Documents' });
    expect(Array.from(list.querySelectorAll('li'), (item) => item.textContent)).toEqual([
      'Document 1: Pricing page edits',
      'Document 2: Content outline',
    ]);
    const firstBody = screen.getByText('First document body.');
    const outline = screen.getByText('Outline.');
    const laterText = screen.getByText('Here is the outline.');
    expect(
      firstBody.compareDocumentPosition(laterText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      laterText.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('A message with a paste', () => {
  it('shows each paste as a chip that opens its text as pasted', async () => {
    const chat = detail(revision(REV2, 2, 'agent', 'Saved result.'));
    const text = 'Line one\nLine two';
    chat.messages[0] = { ...chat.messages[0]!, attachments: [{ kind: 'pasted_text', text }] };
    renderChat(agentChatDetailSchema.parse(chat));

    const attachments = within(await screen.findByRole('list', { name: 'Attachments' }));
    fireEvent.click(attachments.getByRole('button', { name: 'View Pasted text, 2 lines' }));
    const viewer = await screen.findByRole('dialog', { name: 'Pasted text' });
    expect(within(viewer).getByText(/^Line one/).textContent).toBe(text);
  });
});

describe('The reply announcement', () => {
  it('reads a reply saved while the chat is open, then empties so it is not met twice', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    const opened = detail(revision(REV2, 2, 'agent', 'Body.'));
    const answered = {
      ...opened,
      messages: [
        ...opened.messages,
        {
          ...opened.messages[1]!,
          id: '77777777-7777-4777-8777-777777777774',
          sequence: 3,
          content: 'The **saved** answer.',
        },
      ],
    };
    const view = (chat: unknown) => (
      <Conversation
        workspaceId="workspace"
        detail={agentChatDetailSchema.parse(chat)}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />
    );
    const { rerender, queryClient } = renderWithProviders(view(opened));
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const region = document.querySelector('[aria-live="polite"][aria-busy]')!;
      expect(screen.getByText('Here are the edits.')).toBeInTheDocument();
      expect(region).toBeEmptyDOMElement();
      rerender(view(answered));
      expect(region).toHaveTextContent('The saved answer.');
      act(() => vi.advanceTimersByTime(5000));
      expect(region).toBeEmptyDOMElement();
      expect(screen.getAllByText('saved')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
