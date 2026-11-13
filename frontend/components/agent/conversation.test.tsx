import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { fireEvent, screen, within } from '@testing-library/react';
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

describe('A finished reply’s run summary', () => {
  it('counts model calls and data reads and lists what each step did', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)));
    renderWithProviders(
      <Conversation
        detail={agentChatDetailSchema.parse(detail(revision(REV2, 2, 'agent', 'Saved result.')))}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );
    const summary = await screen.findByText(/^Run complete/u);
    expect(summary).toHaveTextContent('Run complete · 2 model calls · 1 data read');
    expect(
      Array.from(summary.parentElement?.querySelectorAll('li') ?? [], (item) => item.textContent),
    ).toEqual(['Model call 1', 'Loaded the method', 'Read integration status', 'Model call 2']);
  });

  it('counts web searches and lists their pages apart from CiteLadder records', async () => {
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
            { kind: 'search', ordinal: 1, query: 'acme pricing', status: 'completed' },
            { kind: 'model', ordinal: 2 },
          ],
          web_sources: [{ url: 'https://acme.example/pricing', title: 'Acme pricing' }],
        },
      ],
    });
    renderWithProviders(
      <Conversation
        detail={chat}
        onRefine={vi.fn()}
        onRecover={vi.fn()}
        onRetry={vi.fn()}
        canSend
      />,
    );
    const summary = await screen.findByText(/^Run complete/u);
    expect(summary).toHaveTextContent('Run complete · 2 model calls · 1 web search');
    expect(
      Array.from(summary.parentElement?.querySelectorAll('li') ?? [], (item) => item.textContent),
    ).toEqual(['Model call 1', 'Searched the web: acme pricing', 'Model call 2']);
    const sources = screen.getByRole('region', { name: 'Web sources' });
    expect(within(sources).getByRole('link', { name: /Acme pricing/u })).toHaveAttribute(
      'href',
      'https://acme.example/pricing',
    );
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

/**
 * A chat whose latest run ended with `run`, holding `messages` built from the
 * fixture's request and reply. An unanswered turn's reply, as the server
 * writes it, records no model call, evidence or document.
 */
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
    <Conversation detail={chat} onRefine={vi.fn()} onRecover={vi.fn()} onRetry={vi.fn()} canSend />,
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
    expect(within(alert).getByText('10:01 AM')).toBeVisible();
    expect(alert).toHaveTextContent(PROVIDER_ERROR);
    expect(screen.queryByRole('article', { name: 'Agent reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit last request' })).toBeEnabled();
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
    expect(within(alert).getByText('10:05 AM')).toBeVisible();
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
    // Only the latest run's outcome is known: the earlier turn is a quiet note.
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
      `Note: Did not finish at 10:01 AMSep 25, 2026, 10:01 AM UTC${PROVIDER_ERROR}`,
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

  it.each([
    ['today', '2026-09-25T18:00:00Z', '10:01 AM'],
    ['on another day', '2026-10-02T12:00:00Z', 'Sep 25, 10:01 AM'],
    ['in another year', '2027-01-04T12:00:00Z', 'Sep 25, 2026, 10:01 AM'],
  ])('is short %s and reads in full', async (_when, now, short) => {
    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=UTC; Path=/`;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
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
    expect(time).toHaveTextContent(`${short}Sep 25, 2026, 10:01 AM UTC`);
    expect(within(time!).getByText('Sep 25, 2026, 10:01 AM UTC')).toHaveClass('sr-only');
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
