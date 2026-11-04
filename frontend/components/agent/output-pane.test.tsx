import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { AgentOutput } from '@/lib/api/agent';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { OutputPane } from './output-pane';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const output = (kind: string): AgentOutput => ({
  id: '11111111-1111-4111-8111-111111111111',
  number: 1,
  message_id: null,
  action_id: null,
  kind,
  skill_id: 'prompt_discovery',
  format_id: null,
  target_kind: null,
  target_label: null,
  latest_revision: {
    id: '22222222-2222-4222-8222-222222222222',
    number: 1,
    parent_revision_id: null,
    author: 'agent',
    title: 'Prompt plan',
    body: '## Topics\n\nKeep "Golf nets"; add "Golf simulator enclosures".',
    source_refs: [],
    web_sources: [],
    created_at: '2026-11-01T00:00:00Z',
  },
});

function renderPane(kind: string) {
  renderWithProviders(
    <OutputPane
      workspaceId="33333333-3333-4333-8333-333333333333"
      chatId="44444444-4444-4444-8444-444444444444"
      output={output(kind)}
      runActive={false}
      canEdit
      canSend
      onRevise={() => {}}
    />,
  );
}

describe('a prompt plan', () => {
  it('hands off to the Prompt Builder instead of staging prompts itself', () => {
    renderPane('prompt_plan');
    expect(screen.getByRole('link', { name: 'Open Prompt Builder' })).toHaveAttribute(
      'href',
      expect.stringContaining('/prompts?generate=1'),
    );
    expect(screen.queryByRole('button', { name: 'Review in Prompts' })).not.toBeInTheDocument();
  });

  it('is the only deliverable that offers the handoff', () => {
    renderPane('plan');
    expect(screen.queryByRole('link', { name: 'Open Prompt Builder' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prompt plan' })).toBeVisible();
  });
});

describe('a document’s sources', () => {
  it('lists searched web pages apart from CiteLadder records', async () => {
    const searched = output('plan');
    renderWithProviders(
      <OutputPane
        workspaceId="33333333-3333-4333-8333-333333333333"
        chatId="44444444-4444-4444-8444-444444444444"
        output={{
          ...searched,
          number: 2,
          latest_revision: {
            ...searched.latest_revision,
            web_sources: [{ url: 'https://rival.example/golf', title: '' }],
          },
        }}
        runActive={false}
        canEdit
        canSend
        onRevise={() => {}}
      />,
    );
    expect(screen.getByText('Document 2')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getByText('This revision cites no CiteLadder records.')).toBeVisible();
    const web = screen.getByRole('region', { name: 'Web sources' });
    expect(within(web).getByRole('link', { name: /rival\.example/u })).toHaveAttribute(
      'href',
      'https://rival.example/golf',
    );
  });
});
