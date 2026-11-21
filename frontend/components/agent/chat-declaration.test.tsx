import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ChatScreen } from './chat-screen';
import {
  CHAT,
  NOW,
  OUTPUT,
  PROJECT,
  REV1,
  RUN,
  detail,
  revision,
  skills,
} from '@/test/agent-chat-fixture';

function renderChat() {
  return renderWithProviders(
    <Routes>
      <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
    </Routes>,
    {
      initialEntries: [`/agent/chats/${CHAT}`],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const ACTION = '88888888-8888-4888-8888-888888888888';

function actionApi(loaded: Promise<void> = Promise.resolve()) {
  const posted: unknown[] = [];
  const declaration = {
    id: '99999999-9999-4999-8999-999999999999',
    action_id: ACTION,
    output_revision_id: REV1,
    member_opportunity_ids: [],
    opportunity_snapshot_id: RUN,
    resolved_before_snapshot_id: null,
    target_site_url_ids: [],
    target_external_url: null,
    declared_implemented_at: NOW,
    expected_checks: [],
    state: 'declared',
    limitations: [],
    verification_events: [],
    legs: [
      {
        leg: 'next_crawl',
        state: 'not_scheduled',
        due_at: null,
        last_evidence_at: null,
        source_id: null,
      },
    ],
    checks: [],
    measured_until: NOW,
    created_at: NOW,
  };
  const action = () => ({
    id: ACTION,
    project_id: PROJECT,
    target_kind: 'page',
    target_label: 'https://acme.test/pricing',
    target_url: 'https://acme.test/pricing',
    target_prompt_id: null,
    origin: 'evidence',
    status: posted.length ? 'done' : 'in_progress',
    measurement: posted.length ? 'measuring' : null,
    priority_score: 40,
    priority_band: 'high',
    families: ['site_health'],
    approach: 'fix_technical',
    group: 'fix_site',
    goal: 'read_site',
    grouping: 'seo',
    skill_id: 'technical_health',
    member_count: 1,
    declarable_member_count: 1,
    handoff: { context: 'action', message: 'Work on https://acme.test/pricing.' },
    evidence_cleared_at: null,
    created_at: NOW,
    updated_at: NOW,
    diagnosis: {},
    members: [],
    member_measurement: {},
    declarable_since: '2026-01-01T00:00:00Z',
    declaration: posted.length ? declaration : null,
  });
  return {
    posted,
    handlers: [
      http.get(`/api/v1/actions/${ACTION}`, async () => {
        await loaded;
        return HttpResponse.json(action());
      }),
      http.post(`/api/v1/actions/${ACTION}/declaration`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json(declaration, { status: 201 });
      }),
    ],
  };
}

describe('ChatScreen implementation declaration', () => {
  it('declares the revision on screen implemented and shows what it waits for', async () => {
    const attached = detail(revision(REV1, 1, 'agent', 'Body.'));
    attached.chat.action_id = ACTION as never;
    attached.outputs[0]!.action_id = ACTION;
    const { posted, handlers } = actionApi();
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(attached)),
      ...handlers,
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    await user.click(await within(pane).findByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    await user.click(within(dialog).getByRole('button', { name: 'Declare implemented' }));

    expect(await within(pane).findByText(/Measured on your next crawl/)).toBeVisible();
    expect(within(pane).getByRole('heading', { name: 'Measurement' })).toHaveFocus();
    expect(
      within(pane).queryByRole('button', { name: 'Mark implemented' }),
    ).not.toBeInTheDocument();
    expect(posted).toEqual([
      {
        output_revision_id: REV1,
        declared_implemented_at: expect.any(String),
        deployment_reference: null,
      },
    ]);
  });

  it('declares a proposal from its card through the declaration API, then shows the stored declaration', async () => {
    const proposed = detail(revision(REV1, 1, 'agent', 'Body.'));
    proposed.messages[1]!.proposals = [
      {
        kind: 'declaration',
        action_id: ACTION,
        revision: null,
        go_live_day: '2026-09-24',
        deployment_reference: 'PR 12',
      },
    ];
    const projected = {
      ...proposed,
      actions: [{ id: ACTION, target_label: 'https://acme.test/pricing', status: 'in_progress' }],
    };
    let load = () => {};
    const loaded = new Promise<void>((resolve) => {
      load = resolve;
    });
    const { posted, handlers } = actionApi(loaded);
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () => HttpResponse.json(projected)),
      ...handlers,
    );
    const user = userEvent.setup();
    renderChat();

    const card = await screen.findByRole('region', {
      name: 'Mark https://acme.test/pricing implemented?',
    });
    expect(card).toHaveTextContent('Work done outside CiteLadder, live since 2026-09-24');
    expect(within(card).queryByRole('button', { name: 'Mark implemented' })).toBeNull();
    load();
    await user.click(await within(card).findByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    expect(within(dialog).getByRole('textbox', { name: 'What shipped it?' })).toHaveValue('PR 12');
    await user.click(within(dialog).getByRole('button', { name: 'Declare implemented' }));

    expect(
      await screen.findByRole('region', {
        name: 'https://acme.test/pricing is marked implemented',
      }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark implemented' })).not.toBeInTheDocument();
    expect(posted).toEqual([
      {
        output_revision_id: null,
        declared_implemented_at: new Date(2026, 8, 24, 12).toISOString(),
        deployment_reference: 'PR 12',
      },
    ]);
  });

  it('links a document naming another page there, then offers its declaration', async () => {
    const CHAT_ACTION = '88888888-8888-4888-8888-888888888888';
    const LINKED = '77777777-7777-4777-8777-777777777777';
    const named = detail(revision(REV1, 1, 'agent', 'Body.'));
    named.chat.action_id = CHAT_ACTION as never;
    named.outputs[0]!.action_id = CHAT_ACTION;
    named.outputs[0]!.named_target = { kind: 'page', target: 'https://acme.test/pricing?plan=pro' };
    const linked = structuredClone(named);
    linked.outputs[0]!.action_id = LINKED;
    linked.outputs[0]!.named_target = null;
    const posted: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
      http.get(`/api/v1/agent/chats/${CHAT}`, () =>
        HttpResponse.json(posted.length ? linked : named),
      ),
      http.post(`/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/target`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json(linked);
      }),
      http.get(`/api/v1/actions/${LINKED}`, () =>
        HttpResponse.json({
          id: LINKED,
          project_id: PROJECT,
          target_kind: 'page',
          target_label: 'https://acme.test/pricing?plan=pro',
          target_url: 'https://acme.test/pricing?plan=pro',
          target_prompt_id: null,
          origin: 'evidence',
          status: 'in_progress',
          measurement: null,
          priority_score: 40,
          priority_band: 'high',
          families: ['site_health'],
          approach: 'fix_technical',
          group: 'fix_site',
          goal: 'read_site',
          grouping: 'seo',
          skill_id: 'technical_health',
          member_count: 1,
          declarable_member_count: 1,
          handoff: { context: 'action', message: 'Work on https://acme.test/pricing.' },
          evidence_cleared_at: null,
          created_at: NOW,
          updated_at: NOW,
          diagnosis: {},
          members: [],
          member_measurement: {},
          declarable_since: '2026-01-01T00:00:00Z',
          declaration: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    const pane = await screen.findByRole('region', { name: 'Pricing page edits' });
    expect(
      within(pane).queryByRole('button', { name: 'Mark implemented' }),
    ).not.toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Keep with this Action' })).toBeEnabled();
    await user.click(within(pane).getByRole('button', { name: 'Link to /pricing?plan=pro' }));

    expect(await within(pane).findByRole('button', { name: 'Mark implemented' })).toBeVisible();
    expect(
      within(pane).queryByRole('button', { name: 'Keep with this Action' }),
    ).not.toBeInTheDocument();
    expect(posted).toEqual([{ decision: 'link' }]);
  });
});
