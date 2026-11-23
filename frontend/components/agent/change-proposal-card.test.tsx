import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { projectScope, renderWithProviders, type TestRole } from '@/test/render';

import { ChatScreen } from './chat-screen';
import { CHAT, PROJECT, REV1, detail, revision, skills } from '@/test/agent-chat-fixture';

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function proposedChat(outcome: 'open' | 'executed' | 'dismissed', refusal: string | null = null) {
  const chat = detail(revision(REV1, 1, 'agent', 'Body.'));
  chat.messages[1]!.proposals = [
    {
      kind: 'change',
      index: 0,
      title: 'Launch an audit',
      rows: [{ label: 'Engines', value: 'chatgpt, perplexity' }],
      spend: 'Up to 40 prompt runs, in at most 80 provider attempts',
      opens: { label: 'Open Runs', path: '/runs' },
      outcome,
      refusal,
    },
  ];
  return chat;
}

function renderChat(role: TestRole) {
  return renderWithProviders(
    <Routes>
      <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
    </Routes>,
    {
      initialEntries: [`/agent/chats/${CHAT}`],
      projectSelection: {
        ...projectScope(makeProject({ id: PROJECT }), role),
        activeProjectId: PROJECT,
        status: 'ready',
      },
    },
  );
}

it('confirms a proposed change once through its message and index, keeping it confirmable after a refusal', async () => {
  const open = proposedChat('open');
  const message = open.messages[1]!.id;
  const confirms: string[] = [];
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/agent/chats/${CHAT}`, () =>
      HttpResponse.json(confirms.length === 2 ? proposedChat('executed') : open),
    ),
    http.post(`/api/v1/agent/chats/${CHAT}/messages/:message/proposals/:index/confirm`, (info) => {
      confirms.push(`${String(info.params.message)}/${String(info.params.index)}`);
      return confirms.length === 1
        ? HttpResponse.json(
            {
              error: {
                message: 'Every enabled prompt here is beyond your plan’s prompt limit',
                code: 'validation_error',
              },
            },
            { status: 422 },
          )
        : HttpResponse.json(proposedChat('executed'));
    }),
  );
  const user = userEvent.setup();
  renderChat('member');

  const card = await screen.findByRole('region', { name: 'Launch an audit' });
  expect(card).toHaveTextContent('Up to 40 prompt runs, in at most 80 provider attempts');
  await user.click(within(card).getByRole('button', { name: 'Confirm' }));
  expect(await within(card).findByText(/beyond your plan’s prompt limit/u)).toBeVisible();
  await user.click(within(card).getByRole('button', { name: 'Confirm' }));

  const done = await screen.findByText('Done');
  expect(done.closest('section')).toHaveTextContent('Launch an audit');
  expect(done.closest('section')).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Open Runs' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  expect(confirms).toEqual([`${message}/0`, `${message}/0`]);
});

it('shows a Viewer the proposed change without Confirm', async () => {
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(proposedChat('open'))),
  );
  renderChat('viewer');

  const card = await screen.findByRole('region', { name: 'Launch an audit' });
  expect(card).toHaveTextContent('Editors only.');
  expect(within(card).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
});

it('shows the last refused confirm after a reload, and moves focus to the dismissed card', async () => {
  const reason = 'Add at least one offering before generating prompts';
  let dismissed = false;
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/agent/chats/${CHAT}`, () =>
      HttpResponse.json(dismissed ? proposedChat('dismissed') : proposedChat('open', reason)),
    ),
    http.post(`/api/v1/agent/chats/${CHAT}/messages/:message/proposals/:index/dismiss`, () => {
      dismissed = true;
      return HttpResponse.json(proposedChat('dismissed'));
    }),
  );
  const user = userEvent.setup();
  renderChat('member');

  const card = await screen.findByRole('region', { name: 'Launch an audit' });
  expect(card).toHaveTextContent(`The last confirm was refused: ${reason}`);
  await user.click(within(card).getByRole('button', { name: 'Dismiss' }));

  const declined = await screen.findByText('Dismissed');
  const sheet = declined.closest('section');
  expect(sheet).toHaveFocus();
  expect(sheet).not.toHaveTextContent('Up to 40 prompt runs');
  expect(within(sheet!).queryByRole('button')).not.toBeInTheDocument();
});

it('marks a card whose proposal is gone as no longer available', async () => {
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(proposedChat('open'))),
    http.post(`/api/v1/agent/chats/${CHAT}/messages/:message/proposals/:index/confirm`, () =>
      HttpResponse.json({ error: { message: 'Not found', code: 'not_found' } }, { status: 404 }),
    ),
  );
  const user = userEvent.setup();
  renderChat('member');

  const card = await screen.findByRole('region', { name: 'Launch an audit' });
  expect(card).not.toHaveTextContent('No longer available');
  await user.click(within(card).getByRole('button', { name: 'Confirm' }));

  expect(await within(card).findByText('No longer available')).toBeVisible();
  expect(within(card).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
});
