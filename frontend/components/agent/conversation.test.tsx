import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { screen } from '@testing-library/react';
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
      const chat = agentChatDetailSchema.parse({
        ...current,
        output: {
          ...current.output,
          message_id: placement === 'linked' ? current.output.message_id : null,
        },
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
          output={<section aria-label="Pricing page edits">Saved first-turn result.</section>}
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
});
