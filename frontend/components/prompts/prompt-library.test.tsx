import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { makePrompt, makeSet } from '@/test/fixtures/prompts';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { PromptLibrary } from './prompt-library';

const prompt = makePrompt({ text: 'Best running shoes for flat feet?' });
const set = makeSet([prompt]);
// The prompts arrive embedded in the project, before any read of their figures.
const project = makeProject({ prompt_sets: [set] });

function metric(visibilityRate: number) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    audit_id: '55555555-5555-4555-8555-555555555555',
    prompt_id: prompt.id,
    prompt_index: 0,
    prompt_text: prompt.text,
    cohort: 'core',
    composite_score: null,
    previous_score: null,
    immediate_delta: null,
    rolling_four: [],
    per_engine_scores: {},
    components: {},
    engine_agreement: 1,
    repetition_agreement: 1,
    evidence_coverage: 1,
    trend_confidence: 1,
    decline_confirmed: false,
    analyzer_version: 'v1',
    scoring_rule_version: 'v1',
    created_at: '2026-11-01T00:00:00Z',
    visibility_rate: visibilityRate,
    owned_citation_rate: null,
    avg_position: null,
    visibility_delta: null,
  };
}

/** The library's reads, with the latest run's figures answered by `figures`. */
function libraryReads(figures: () => Promise<Response>) {
  mswServer.use(
    http.get('/api/v1/prompt-sets', () => HttpResponse.json([set])),
    http.get(`/api/v1/prompt-sets/${set.id}/candidates`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/topics`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/visibility/prompts`, figures),
  );
}

function renderLibrary() {
  return renderWithProviders(<PromptLibrary />, {
    projectSelection: {
      projects: [project],
      activeProject: project,
      activeProjectId: project.id,
      status: 'ready',
    },
  });
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('PromptLibrary first load', () => {
  it("holds the prompt rows until the latest run's figures land, then draws them with their measured columns", async () => {
    const figures: { answer?: (response: Response) => void } = {};
    libraryReads(
      () =>
        new Promise<Response>((resolve) => {
          figures.answer = resolve;
        }),
    );

    renderLibrary();

    // The prompts are already known, but whether a run exists decides the
    // columns, so no row is drawn while the figures are being read.
    const answer = await vi.waitFor(() => {
      if (!figures.answer) throw new Error('The figures were not requested yet.');
      return figures.answer;
    });
    expect(screen.queryByText(prompt.text)).not.toBeInTheDocument();

    answer(HttpResponse.json([metric(0.5)]));

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual([
      'Prompt',
      'Visibility',
      'Owned citations',
      'Avg. mention position',
      'Change',
      'Enabled',
      'Actions',
    ]);
    const row = within(table).getByRole('row', { name: new RegExp(prompt.text.slice(0, 20)) });
    expect(within(row).getByText('50%')).toBeVisible();
  });

  it('draws the prompt rows without measured columns when the figures cannot be read', async () => {
    libraryReads(async () =>
      HttpResponse.json({ detail: 'Not allowed.', code: 'forbidden' }, { status: 403 }),
    );

    renderLibrary();

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).getByText(prompt.text)).toBeVisible();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Prompt', 'Enabled', 'Actions']);
  });
});
