import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { detail, revision, REV2, skills } from '@/test/agent-chat-fixture';
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
