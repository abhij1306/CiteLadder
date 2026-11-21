import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vite-plus/test';

import { openComposerSubmenu } from '@/test/composer-menu';
import { mswServer } from '@/test/msw-server';
import { actionsPage } from '@/test/fixtures/actions';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => ({ saveBlob: mocks.saveBlob }));
import { OutputHistory } from './output-history';
import { refreshAgentChat } from '@/lib/api/agent';
import {
  CHAT,
  NOW,
  OUTPUT,
  PROJECT,
  REV1,
  REV2,
  detail,
  revision,
  skills,
} from '@/test/agent-chat-fixture';
import { renderChat, serveChatScreen } from '@/test/chat-screen';

serveChatScreen(() => {
  mocks.saveBlob.mockReset();
});

describe('ChatScreen', () => {
  it('selects Automatic when a follow-up has no inherited workflow', async () => {
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json({
          ...detail(revision(REV1, 1, 'agent', 'Body.')),
          outputs: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderChat();
    await openComposerSubmenu(user, /^Skills: Automatic$/);
    expect(await screen.findByRole('menuitemradio', { name: 'Automatic' })).toBeChecked();
  });

  it('shows supplied context and its omissions in plain words', async () => {
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
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
    );
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText('Context used'));
    expect(screen.getByText('Selected issue group')).toBeVisible();
    expect(screen.getByText(/left out to fit this turn/)).toBeVisible();
    expect(screen.queryByText(/oldest_history|history messages/)).not.toBeInTheDocument();
  });

  it('saves an edit as a new revision and shows it inline in the thread', async () => {
    let current = detail(revision(REV1, 1, 'agent', 'Old title tag.'));
    const edits: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(current)),
      http.post(`/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/revisions`, async ({ request }) => {
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
        'In Document 1, revise only the section "Title tag": Shorter. Keep every other section exactly as it is.',
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
      http.post(`/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/revisions`, async ({ request }) => {
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
      expect.stringContaining(`/actions/${ACTION}`),
    );
    const next = within(await screen.findByRole('navigation', { name: 'Next steps' }));
    const href = new URL(
      next.getByRole('link', { name: 'Internal links' }).getAttribute('href')!,
      'https://app.test',
    );
    expect(href.searchParams.get('workflow')).toBe('internal_links');
    expect(href.searchParams.get('revision_id')).toBe(REV1);
  });

  it('compares an earlier revision with the current one', async () => {
    mswServer.use(
      http.get(`/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/revisions`, () =>
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
        outputId={OUTPUT}
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
    await user.click(within(pane).getByRole('tab', { name: 'Document' }));

    expect(within(pane).getByLabelText('Output body (Markdown)')).toHaveValue(
      'Old title tag. Draft.',
    );
  });

  it('regenerates the last reply by sending its request and its paste again as a new turn', async () => {
    const bodies: unknown[] = [];
    const paste = { kind: 'pasted_text' as const, text: 'Current snippet' };
    const chat = detail(revision(REV1, 1, 'agent', 'Body.'));
    chat.messages[0] = { ...chat.messages[0]!, attachments: [paste] };
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(chat)),
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
      expect(bodies).toEqual([{ message: chat.messages[0]!.content, attachments: [paste] }]),
    );
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
    await user.click(screen.getByRole('button', { name: 'Retry send' }));

    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('');
  });

  it('sends an edited draft after a failed send instead of retrying the old message', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(detail(revision(REV1, 1, 'agent', 'Old title tag.'))),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
        bodies.push(await request.json());
        if (bodies.length === 1)
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
    expect(await screen.findByRole('button', { name: 'Retry send' })).toBeEnabled();
    await user.type(screen.getByLabelText('Reply to the agent'), ' Next draft.');
    expect(screen.queryByRole('button', { name: 'Retry send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await vi.waitFor(() =>
      expect(bodies).toEqual([
        expect.objectContaining({ message: 'Shorten it.' }),
        expect.objectContaining({ message: 'Shorten it. Next draft.' }),
      ]),
    );
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
        HttpResponse.json(
          actionsPage([
            {
              id: ACTION,
              project_id: PROJECT,
              target_kind: 'page',
              target_label: 'Pricing page',
              target_url: null,
              target_prompt_id: null,
              origin: 'evidence',
              status: 'open',
              measurement: null,
              priority_score: 1,
              priority_band: 'low',
              families: [],
              approach: 'fix_technical',
              goal: 'read_site',
              grouping: 'seo',
              skill_id: 'technical_health',
              member_count: 1,
              declarable_member_count: 1,
              handoff: { context: 'action', message: 'Work on Pricing page.' },
              evidence_cleared_at: null,
              created_at: NOW,
              updated_at: NOW,
            },
          ]),
        ),
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
    await act(() => refreshAgentChat(queryClient, CHAT));
    await screen.findByText('Here is why.', { selector: 'article p' });
    expect(screen.queryByRole('group', { name: 'Suggested follow-ups' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reply to the agent')).toHaveValue('Make it shorter');
  });

  it('shows the skill inherited from the chat until it is removed for Automatic', async () => {
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
    const continued = 'Continue with Search Console optimization';
    const inherited = `Skill: ${continued}`;
    expect(await screen.findByText(inherited)).toBeVisible();
    await openComposerSubmenu(user, /^Skills: Continue with Search Console optimization$/);
    expect(await screen.findByRole('menuitemradio', { name: continued })).toBeChecked();
    screen.getByRole('menuitemradio', { name: 'Search Console optimization' }).focus();
    await user.keyboard('{Enter}');
    await user.click(
      await screen.findByRole('button', { name: 'Remove Skill: Search Console optimization' }),
    );
    expect(screen.getByText(inherited)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `Remove ${inherited}` }));
    await openComposerSubmenu(user, /^Skills: Automatic$/);
    expect(await screen.findByRole('menuitemradio', { name: 'Automatic' })).toBeChecked();
  });
});
