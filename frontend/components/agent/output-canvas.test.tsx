import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { resetSectionDrafts } from '@/lib/agent/section-drafts';
import type { AgentRevision } from '@/lib/api/agent';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { OutputCanvas } from './output-canvas';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  resetSectionDrafts();
});
afterAll(() => mswServer.close());

const target = {
  chatId: '44444444-4444-4444-8444-444444444444',
  outputId: '11111111-1111-4111-8111-111111111111',
  number: 1,
};

const revision = (id: string, body: string): AgentRevision => ({
  id,
  number: 1,
  parent_revision_id: null,
  author: 'agent',
  title: 'Plan',
  body,
  fields: null,
  source_refs: [],
  web_sources: [],
  created_at: '2026-11-01T00:00:00Z',
});

const first = revision('22222222-2222-4222-8222-222222222222', '## Topics\n\nKeep golf nets.');
const second = revision('55555555-5555-4555-8555-555555555555', '## Topics\n\nAdd simulators.');

function canvas(shown: AgentRevision) {
  return (
    <OutputCanvas
      workspaceId="33333333-3333-4333-8333-333333333333"
      target={target}
      revision={shown}
      locked={false}
      canSend
      onRevise={() => {}}
    />
  );
}

describe('a section draft', () => {
  it('survives switching revision and returning, and is dropped on cancel', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(canvas(first));
    await user.click(screen.getByRole('button', { name: 'Edit Topics' }));
    await user.type(screen.getByRole('textbox', { name: 'Section text (Markdown)' }), ' Unsaved.');

    view.rerender(canvas(second));
    expect(screen.queryByRole('textbox', { name: 'Section text (Markdown)' })).toBeNull();
    expect(screen.getByText('Add simulators.')).toBeVisible();

    view.rerender(canvas(first));
    const editor = screen.getByRole('textbox', { name: 'Section text (Markdown)' });
    expect(editor).toHaveValue('## Topics\n\nKeep golf nets. Unsaved.');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Topics' }));
    expect(screen.getByRole('textbox', { name: 'Section text (Markdown)' })).toHaveValue(
      '## Topics\n\nKeep golf nets.',
    );
  });

  it('is dropped once saved, even when the saved revision replaces the editor first', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    mswServer.use(
      http.post(
        `/api/v1/agent/chats/${target.chatId}/outputs/${target.outputId}/revisions`,
        async ({ request }) => {
          saved.push(await request.json());
          await answered;
          return HttpResponse.json(second);
        },
      ),
    );
    const view = renderWithProviders(canvas(first));
    await user.click(screen.getByRole('button', { name: 'Edit Topics' }));
    await user.type(screen.getByRole('textbox', { name: 'Section text (Markdown)' }), ' Saved.');
    await user.click(screen.getByRole('button', { name: 'Save section' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    // The chat refresh shows the new revision before the save settles.
    view.rerender(canvas(second));
    answer();

    view.rerender(canvas(first));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Section text (Markdown)' })).toBeNull(),
    );
    expect(saved[0]).toMatchObject({
      base_revision_id: first.id,
      body: '## Topics\n\nKeep golf nets. Saved.',
    });
  });
});
