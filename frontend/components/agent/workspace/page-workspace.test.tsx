import { EditorView } from '@codemirror/view';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentSuggestion } from '@/lib/api/agent';
import {
  CHAT,
  OUTPUT,
  PROJECT,
  REV1,
  REV2,
  detail,
  revision,
  skills,
} from '@/test/agent-chat-fixture';
import { mswServer } from '@/test/msw-server';
import { actionsPage } from '@/test/fixtures/actions';
import { makeProject } from '@/test/fixtures/project';
import {
  pageChat as sharedPageChat,
  spanSuggestion,
  suggestionsPage,
} from '@/test/page-suggestions-fixture';
import { renderWithProviders, selectionAs, type TestRole } from '@/test/render';

import { ChatScreen } from '../chat-screen';

const BODY =
  '# Pricing\n\nOur plans start at ten dollars. Teams pay more.\n\n## Support\n\nEmail us any time.';
const READY = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEEDS = 'aaaaaaaa-0000-4000-8000-000000000002';
const SUGGESTIONS = `/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/suggestions`;

const ready = (overrides: Partial<AgentSuggestion> = {}) =>
  spanSuggestion(READY, BODY, 'ten dollars', { replacement: '$10', ...overrides });
const needsInput = spanSuggestion(NEEDS, BODY, 'Teams pay more', {
  readiness: 'needs_input',
  replacement: null,
  needs_input: 'What does the Teams plan cost?',
});

const pageChat = (body = BODY, revisionId = REV1, number = 1) =>
  sharedPageChat(body, { revisionId, number });

/** Serves a page chat and its suggestions; `state` changes what later reads return. */
function serve(initial: { chat: Record<string, unknown>; suggestions: Record<string, unknown> }) {
  const state = { ...initial, chatReads: 0, sent: [] as unknown[] };
  mswServer.use(
    http.get('/api/v1/agent/skills', () => HttpResponse.json(skills)),
    http.get(`/api/v1/projects/${PROJECT}/actions`, () => HttpResponse.json(actionsPage())),
    http.get(`/api/v1/agent/chats/${CHAT}`, () => {
      state.chatReads += 1;
      return HttpResponse.json(state.chat);
    }),
    http.get(SUGGESTIONS, () => HttpResponse.json(state.suggestions)),
    http.post(`/api/v1/agent/chats/${CHAT}/messages`, async ({ request }) => {
      state.sent.push(await request.json());
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  return state;
}

function renderChat(role: TestRole = 'owner') {
  return renderWithProviders(
    <Routes>
      <Route path="/agent/chats/:chatId" element={<ChatScreen />} />
    </Routes>,
    {
      initialEntries: [`/agent/chats/${CHAT}`],
      projectSelection: {
        ...selectionAs(role),
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
}

const editorView = () =>
  EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Page content (Markdown)' }))!;
const highlight = (id: string) =>
  document.querySelector<HTMLElement>(`mark[data-suggestion-id="${id}"]`);
/** A tab or filter's name with its count, "Applied (1)" (jsdom drops the space). */
const counted = (label: string, count: number) => new RegExp(`^${label} ?\\(${count}\\)$`);
const conflict = (code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status: 409 });

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('The page workspace', () => {
  it('opens a page chat as the page beside its suggestions, outline, SEO and chat', async () => {
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), needsInput]) });
    const user = userEvent.setup();
    renderChat();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Actions › acme.test/pricing' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Page content (Markdown)' })).toHaveTextContent(
      'Our plans start at ten dollars.',
    );
    expect(await screen.findByRole('tab', { name: counted('Suggestions', 2) })).toBeVisible();
    await vi.waitFor(() => expect(highlight(READY)).toHaveTextContent('ten dollars'));
    expect(highlight(READY)).toHaveClass('page-editor-suggestion-ready');
    expect(highlight(NEEDS)).toHaveClass('page-editor-suggestion-needs_input');
    expect(screen.getByLabelText('Reply to the agent')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByText('Pricing | Acme')).toBeVisible();
    expect(screen.getByText('Missing meta description')).toBeVisible();
    expect(screen.getByText(/Editing the page doesn’t rerun them/)).toBeVisible();
  });

  it('shows where each suggestion’s rule comes from, as an option unless it is a policy', async () => {
    const policy = spanSuggestion(NEEDS, BODY, 'Teams pay more', {
      category: 'search_guidelines',
      rule_id: 'search_guidelines.no_keyword_stuffing',
      guidance: {
        strength: 'requirement',
        source_label: 'Google Search Central: spam policies',
        source_url: 'https://developers.google.com/search/docs/essentials/spam-policies',
      },
    });
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), policy]) });
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('tab', { name: counted('Suggestions', 2) }));
    await screen.findAllByRole('button', { name: 'Dismiss' });
    const card = (id: string) => {
      const element = document.getElementById(`suggestion-${id}`);
      if (!element) throw new Error(`No card for ${id}`);
      return element;
    };
    const heuristic = card(READY);
    expect(within(heuristic).getByText('Heuristic')).toBeVisible();
    expect(heuristic).toHaveTextContent(
      'Optional. A heuristic, not search engine guidance, from Aggarwal et al. 2024, GEO (research)',
    );
    expect(
      within(heuristic).getByRole('link', { name: /Aggarwal et al\. 2024, GEO \(research\)/u }),
    ).toHaveAttribute('href', 'https://arxiv.org/abs/2311.09735');
    const required = card(NEEDS);
    expect(within(required).getByText('Search policy')).toBeVisible();
    expect(required).toHaveTextContent('Required by Google Search Central: spam policies');
    expect(within(required).queryByText('Heuristic')).not.toBeInTheDocument();
  });

  it('lets a viewer read the suggestions with no control to act on them', async () => {
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), needsInput]) });
    const user = userEvent.setup();
    renderChat('viewer');

    await user.click(await screen.findByRole('tab', { name: counted('Suggestions', 2) }));
    expect(
      await screen.findByText('Your role can read this page but not change it.'),
    ).toBeVisible();
    expect(document.getElementById(`suggestion-${READY}`)).toHaveTextContent('$10');
    for (const name of ['Apply', 'Dismiss', 'Apply all', 'Dismiss all']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('keeps every other chat as its thread', async () => {
    serve({ chat: detail(revision(REV1, 1, 'agent', 'Body.')), suggestions: suggestionsPage([]) });
    renderChat();

    expect(await screen.findByRole('region', { name: 'Pricing page edits' })).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Page content (Markdown)' }),
    ).not.toBeInTheDocument();
  });

  it('applies a ready suggestion against the revision on screen and clears its highlight', async () => {
    const applied = BODY.replace('ten dollars', '$10');
    const state = serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), needsInput]) });
    const requests: unknown[] = [];
    mswServer.use(
      http.post(`${SUGGESTIONS}/${READY}/apply`, async ({ request }) => {
        requests.push(await request.json());
        state.chat = pageChat(applied, REV2, 2);
        const position = { start: applied.indexOf('$10'), end: applied.indexOf('$10') + 3 };
        const done = ready({ status: 'applied', position });
        state.suggestions = suggestionsPage(
          [
            done,
            spanSuggestion(NEEDS, applied, 'Teams pay more', {
              readiness: 'needs_input',
              replacement: null,
              needs_input: needsInput.needs_input,
            }),
          ],
          REV2,
        );
        return HttpResponse.json({
          outcome: 'applied',
          reason: null,
          suggestion: done,
          revision: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await vi.waitFor(() => expect(highlight(READY)).not.toBeNull());
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[0]!);

    expect(requests).toEqual([{ base_revision_id: REV1 }]);
    await vi.waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Page content (Markdown)' })).toHaveTextContent(
        'Our plans start at $10.',
      ),
    );
    await vi.waitFor(() => expect(highlight(READY)).toBeNull());
    expect(highlight(NEEDS)).toHaveTextContent('Teams pay more');
    expect(screen.getByRole('radio', { name: counted('Applied', 1) })).toBeVisible();
  });

  it('reverts an applied suggestion back to To review', async () => {
    const state = serve({
      chat: pageChat(),
      suggestions: suggestionsPage([ready({ status: 'applied' })]),
    });
    const reverts: unknown[] = [];
    mswServer.use(
      http.post(`${SUGGESTIONS}/${READY}/revert`, async ({ request }) => {
        reverts.push(await request.json());
        state.suggestions = suggestionsPage([ready()]);
        return HttpResponse.json({
          outcome: 'reverted',
          reason: null,
          suggestion: ready(),
          revision: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('radio', { name: counted('Applied', 1) }));
    await user.click(screen.getByRole('button', { name: 'Revert' }));

    expect(await screen.findByText('Back in To review.')).toBeVisible();
    expect(reverts).toEqual([{ base_revision_id: REV1 }]);
    expect(await screen.findByRole('radio', { name: counted('To review', 1) })).toBeVisible();
  });

  it('reads the page again and says so when it changed under a change', async () => {
    const state = serve({ chat: pageChat(), suggestions: suggestionsPage([ready()]) });
    mswServer.use(
      http.post(`${SUGGESTIONS}/${READY}/dismiss`, () =>
        conflict('agent_output_conflict', 'Stale base revision.'),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    const reads = state.chatReads;
    await user.click(dismiss);

    expect(
      await screen.findByText(
        'The page changed since you opened it. The latest version is shown now; check it and try again.',
      ),
    ).toBeVisible();
    await vi.waitFor(() => expect(state.chatReads).toBeGreaterThan(reads));
  });

  it('shows the server’s reason when it refuses a suggestion change', async () => {
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready()]) });
    mswServer.use(
      http.post(`${SUGGESTIONS}/${READY}/apply`, () =>
        conflict('agent_suggestion_conflict', 'This suggestion was already dismissed.'),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('This suggestion was already dismissed.')).toBeVisible();
  });

  it('reports what Apply all applied and what it left, in the server’s counts', async () => {
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), needsInput]) });
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(`${SUGGESTIONS}/apply-all`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          applied: 3,
          left_to_choose: 2,
          needs_input: 1,
          stale: 1,
          revision: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByRole('button', { name: 'Apply all' }));
    expect(
      await screen.findByText(
        'Applied 3 suggestions. Left 2 overlapping suggestions for you to choose. Skipped 1 suggestion that need a fact from you. Set aside 1 suggestion that no longer fit the page.',
      ),
    ).toBeVisible();
    expect(bodies).toEqual([{ base_revision_id: REV1 }]);
  });

  it('writes a quoted reference into the composer for Ask AI and Add to context, sending nothing', async () => {
    const state = serve({ chat: pageChat(), suggestions: suggestionsPage([needsInput]) });
    const user = userEvent.setup();
    renderChat();

    await screen.findByRole('tab', { name: counted('Suggestions', 1) });
    const from = BODY.indexOf('Email us');
    editorView().dispatch({
      selection: { anchor: from, head: from + 'Email us any time.'.length },
      userEvent: 'select',
    });
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    const composer = screen.getByLabelText('Reply to the agent');
    expect(composer).toHaveValue('> Email us any time.\n\nSuggest how to improve this passage.');
    expect(composer).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add to context' }));
    expect(composer).toHaveValue(
      '> Email us any time.\n\nSuggest how to improve this passage.\n\n> What does the Teams plan cost?\n> On: “Teams pay more”',
    );
    expect(state.sent).toEqual([]);
  });

  it('opens a suggestion’s card from its highlight and jumps to a heading from the outline', async () => {
    serve({ chat: pageChat(), suggestions: suggestionsPage([ready(), needsInput]) });
    const user = userEvent.setup();
    renderChat();

    await vi.waitFor(() => expect(highlight(NEEDS)).not.toBeNull());
    fireEvent.click(highlight(NEEDS)!);
    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => item.id.startsWith('suggestion-'));
    expect(cards.map((card) => card.getAttribute('aria-current'))).toEqual([null, 'true']);

    await user.click(screen.getByRole('tab', { name: 'Outline' }));
    const outline = within(screen.getByRole('navigation', { name: 'Page outline' }));
    await user.click(outline.getByRole('button', { name: 'Support' }));
    expect(editorView().state.selection.main.head).toBe(BODY.indexOf('## Support'));
  });
});
