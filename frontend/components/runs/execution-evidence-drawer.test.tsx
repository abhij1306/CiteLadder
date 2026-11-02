import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { ExecutionEvidence } from '@/lib/api/types';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { ExecutionEvidenceDrawer } from './execution-evidence-drawer';

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
  search_query_count: 0,
  avg_position: null,
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

describe('Execution evidence drawer', () => {
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
      <ExecutionEvidenceDrawer
        execution={{ id: ID, prompt_index: 2 }}
        open
        onOpenChange={() => {}}
      />,
    );

    const drawer = await screen.findByRole('dialog', { name: 'Execution evidence' });
    expect(within(drawer).getByText('Prompt #3')).toBeInTheDocument();
    // The first import transforms the markdown renderer, so it gets a cold budget.
    const strong = await within(drawer).findByText('Acme Plumbing', {}, { timeout: 15_000 });
    expect(strong.tagName).toBe('STRONG');
    expect(
      within(drawer)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Fast', 'Local']);
  }, 20_000);

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
      <ExecutionEvidenceDrawer
        execution={{ id: ID, prompt_index: 0 }}
        open
        onOpenChange={() => {}}
      />,
    );

    const drawer = await screen.findByRole('dialog', { name: 'Execution evidence' });
    expect(
      await within(drawer).findByText(
        'No AI Overview was shown for this search.',
        {},
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
  }, 20_000);
});
