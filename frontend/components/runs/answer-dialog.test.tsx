import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type { ExecutionEvidence } from '@citeladder/contracts';
import { PromptPastAnswers } from '@/components/prompts/prompt-past-answers';
import { runsApi } from '@/lib/api/runs';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AnswerDialog } from './answer-dialog';

const runRoute = { projectSelection: { activeProject: makeProject() } };

const ID = '11111111-1111-4111-8111-111111111111';
const evidence: ExecutionEvidence = {
  id: ID,
  analysis_id: ID,
  audit_id: ID,
  task_id: ID,
  artifact_id: null,
  analyzer_version: '1',
  scoring_rule_version: '1',
  logical_engine: 'chatgpt',
  transport_provider: 'openai',
  transport_model: 'gpt-4',
  retrieval_enabled: true,
  prompt_index: 0,
  repetition: 1,
  prompt_class: 'unbranded',
  cohort: 'core',
  answer_text: '',
  search_surface_outcome: '',
  brand_mentioned: false,
  brand_first_offset: null,
  owned_domain_cited: false,
  owned_citation_count: 0,
  unintended_domain_cited: false,
  citation_count: 0,
  search_used: false,
  search: 'not_used',
  search_query_count: 0,
  avg_position: null,
  first_named: { kind: 'none' },
  named: [],
  answer_formats: { kind: 'not_applicable' },
  score: null,
  citations: [],
  competitors_mentioned: [],
  search_surface: null,
  perception: [],
  claims: [],
  ads: { applicability: 'not_applicable', parser_version: null, items: [] },
  created_at: '2026-01-15T00:00:00Z',
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Answer dialog', () => {
  it('renders the answer the single-execution read returns, as markdown', async () => {
    mswServer.use(
      http.get(`/api/v1/executions/${ID}`, () =>
        HttpResponse.json({
          ...evidence,
          answer_text: 'Try **Acme Plumbing** first.\n\n- Fast\n- Local',
        }),
      ),
    );
    renderWithProviders(
      <AnswerDialog execution={{ id: ID, prompt_index: 2 }} open onOpenChange={() => {}} />,
      runRoute,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Prompt #3' });
    expect(within(dialog).getAllByText(/Prompt #3/)).toHaveLength(1);
    // The first import transforms the markdown renderer, so it gets a cold budget.
    const strong = await within(dialog).findByText('Acme Plumbing', {}, { timeout: 15_000 });
    expect(strong.tagName).toBe('STRONG');
    const list = within(dialog).getByText('Fast').closest('ul');
    expect(
      within(list ?? dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Fast', 'Local']);
  }, 20_000);

  it('switches to another engine’s answer to the same prompt without leaving the dialog', async () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const row = {
      transport_provider: 'x',
      error_code: '',
      latency_ms: 1,
      prompt_text: 'best plumber near me',
    };
    mswServer.use(
      http.get(`/api/v1/executions/${ID}`, () =>
        HttpResponse.json({ ...evidence, answer_text: 'From the first engine.' }),
      ),
      http.get(`/api/v1/executions/${OTHER}`, () =>
        HttpResponse.json({
          ...evidence,
          id: OTHER,
          task_id: OTHER,
          logical_engine: 'gemini',
          answer_text: 'From the second engine.',
        }),
      ),
      http.get(`/api/v1/audits/${ID}/executions`, () =>
        HttpResponse.json([
          { ...row, id: ID, prompt_index: 0, logical_engine: 'chatgpt', status: 'succeeded' },
          { ...row, id: OTHER, prompt_index: 0, logical_engine: 'gemini', status: 'succeeded' },
          {
            ...row,
            id: ID.replace('1', '3'),
            prompt_index: 1,
            logical_engine: 'claude',
            status: 'succeeded',
          },
          {
            ...row,
            id: ID.replace('1', '4'),
            prompt_index: 0,
            logical_engine: 'perplexity',
            status: 'failed',
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <AnswerDialog
        execution={{ id: ID, prompt_index: 0, prompt_text: 'best plumber' }}
        open
        onOpenChange={() => {}}
      />,
      runRoute,
    );

    const dialog = await screen.findByRole('dialog', { name: 'best plumber' });
    await within(dialog).findByText('From the first engine.', {}, { timeout: 15_000 });
    expect(await within(dialog).findByText('Succeeded')).toBeVisible();
    const conversation = within(dialog).getByRole('list', { name: 'Conversation' });
    expect(within(conversation).getByText('best plumber near me')).toBeVisible();
    expect(within(dialog).getAllByText('best plumber')).toHaveLength(1);
    expect(within(dialog).queryByText(/Prompt #/)).toBeNull();
    await user.click(await within(dialog).findByRole('button', { name: /^Engine:/u }));
    const options = await screen.findAllByRole('menuitemradio');
    expect(options).toHaveLength(2);
    await user.click(screen.getByRole('menuitemradio', { name: /gemini/iu }));
    expect(await within(dialog).findByText('From the second engine.')).toBeInTheDocument();
  }, 20_000);

  describe('opened from Past answers', () => {
    const project = makeProject();
    const PROMPT = '33333333-3333-4333-8333-333333333333';
    const fanoutRow = {
      audit_id: ID,
      task_id: ID,
      analysis_id: ID,
      artifact_id: null,
      prompt_snapshot_id: ID,
      prompt_id: PROMPT,
      prompt_index: 0,
      prompt_text: 'best plumber',
      repetition: 1,
      completed_at: null,
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      transport_model: 'gpt-4',
      retrieval_enabled: true,
      search_used: true,
      search_query_count: 1,
      query_text_available: true,
      state: 'queries_available',
      search_events: [
        {
          sequence: 0,
          query: 'plumbers open now',
          call_id: 'c',
          call_sequence: 0,
          query_sequence: 0,
        },
      ],
      event_source: 'raw_artifact',
      mentions: [],
      citations: [],
    };

    async function openFromPastAnswers(fanout: (input: { request: Request }) => Response) {
      vi.spyOn(runsApi, 'listPromptExecutions').mockResolvedValue({
        market_id: null,
        next_cursor: null,
        items: [
          {
            execution_id: ID,
            audit_id: ID,
            run_at: '2026-03-16T00:00:00Z',
            logical_engine: 'chatgpt',
            brands: [],
            first_named: { kind: 'none' },
            brand_mentioned: false,
            position: null,
            cited: false,
            search: 'used',
            answer_formats: { kind: 'not_applicable' },
          },
        ],
      });
      mswServer.use(
        http.get(`/api/v1/executions/${ID}`, () =>
          HttpResponse.json({
            ...evidence,
            search_used: true,
            search: 'used',
            search_query_count: 1,
          }),
        ),
        http.get(`/api/v1/projects/${project.id}/visibility/evidence`, fanout),
      );
      const user = userEvent.setup();
      renderWithProviders(
        <PromptPastAnswers promptId={PROMPT} promptText="best plumber" params={{}} markets={[]} />,
        { projectSelection: { activeProject: project } },
      );
      await user.click(await screen.findByRole('button', { name: /^Open the .* answer from/ }));
      return screen.findByRole('dialog', { name: 'best plumber' });
    }

    it("reads the answer's searches narrowed to its prompt", async () => {
      const dialog = await openFromPastAnswers(({ request }) => {
        const narrowed = new URL(request.url).searchParams.get('prompt_id') === PROMPT;
        return HttpResponse.json({ items: narrowed ? [fanoutRow] : [], truncated: !narrowed });
      });
      expect(
        await within(dialog).findByText('plumbers open now', {}, { timeout: 15_000 }),
      ).toBeVisible();
    }, 20_000);

    it('says the searches read failed, not that the wording is unavailable', async () => {
      const dialog = await openFromPastAnswers(() =>
        HttpResponse.json({ error: { message: 'down' } }, { status: 500 }),
      );
      expect(
        await within(dialog).findByText(
          "Couldn't load this answer's searches",
          {},
          { timeout: 15_000 },
        ),
      ).toBeVisible();
      expect(within(dialog).queryByText(/wording is unavailable/)).toBeNull();
    }, 20_000);
  });

  it("reports a measured AI Overview absence from the read's persisted outcome", async () => {
    mswServer.use(
      http.get(`/api/v1/executions/${ID}`, () =>
        HttpResponse.json({
          ...evidence,
          logical_engine: 'google_ai_overview',
          answer_text: '',
          search_surface_outcome: 'no_ai_overview',
        }),
      ),
    );
    renderWithProviders(
      <AnswerDialog execution={{ id: ID, prompt_index: 0 }} open onOpenChange={() => {}} />,
      runRoute,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Prompt #1' });
    expect(
      await within(dialog).findByText(
        'No AI Overview was shown for this search.',
        {},
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
  }, 20_000);
});
