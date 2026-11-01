import { screen } from '@testing-library/react';
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
  message_id: null,
  action_id: null,
  kind,
  skill_id: 'prompt_discovery',
  format_id: null,
  target_kind: null,
  target_label: null,
  phase: 'draft',
  latest_revision: {
    id: '22222222-2222-4222-8222-222222222222',
    number: 1,
    parent_revision_id: null,
    author: 'agent',
    phase: 'draft',
    title: 'Prompt plan',
    body: '## Topics\n\nKeep "Golf nets"; add "Golf simulator enclosures".',
    source_refs: [],
    approved_at: null,
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
