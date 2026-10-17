import { describe, expect, it } from 'vite-plus/test';

import { makePrompt, makeSet } from '@/test/fixtures/prompts';

import {
  auditablePrompts,
  batchLabel,
  buildLaunchPayload,
  canLaunch,
  clampRepetitions,
  MAX_REPETITIONS,
  MIN_REPETITIONS,
  promptBatches,
  PROMPT_BATCH_SIZE,
  toggleEngine,
  toggleMarket,
  type LaunchSelection,
} from './launch';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SET_ID = '22222222-2222-4222-8222-222222222222';

function selection(overrides: Partial<LaunchSelection> = {}): LaunchSelection {
  return {
    projectId: PROJECT_ID,
    promptSetId: SET_ID,
    engines: ['gemini'],
    repetitions: 3,
    ...overrides,
  };
}

describe('clampRepetitions', () => {
  it('defaults a first run to one repetition', () => {
    expect(clampRepetitions(Number.NaN)).toBe(1);
  });

  it('clamps below/above the accepted range', () => {
    expect(clampRepetitions(0)).toBe(MIN_REPETITIONS);
    expect(clampRepetitions(99)).toBe(MAX_REPETITIONS);
    expect(clampRepetitions(4)).toBe(4);
  });
});

describe('canLaunch', () => {
  it('requires a prompt set and at least one engine', () => {
    expect(canLaunch(selection())).toBe(true);
    expect(canLaunch(selection({ promptSetId: null }))).toBe(false);
    expect(canLaunch(selection({ engines: [] }))).toBe(false);
    expect(
      canLaunch(
        selection({ promptSetId: null, promptIds: ['33333333-3333-4333-8333-333333333333'] }),
      ),
    ).toBe(true);
  });
});

describe('markets', () => {
  const GERMANY = '55555555-5555-4555-8555-555555555555';

  it('sends the picked markets, and refuses a launch with none', () => {
    expect(buildLaunchPayload(selection({ marketIds: [null, GERMANY] })).market_ids).toEqual([
      null,
      GERMANY,
    ]);
    expect(canLaunch(selection({ marketIds: [] }))).toBe(false);
  });

  it('toggles the default market apart from a named one', () => {
    expect(toggleMarket([null, GERMANY], null)).toEqual([GERMANY]);
    expect(toggleMarket([GERMANY], null)).toEqual([GERMANY, null]);
  });
});

describe('buildLaunchPayload', () => {
  it('builds the POST /audits body from a launchable selection', () => {
    const payload = buildLaunchPayload(
      selection({ engines: ['gemini', 'claude'], repetitions: 5 }),
    );
    expect(payload).toEqual({
      project_id: PROJECT_ID,
      prompt_set_id: SET_ID,
      engines: ['gemini', 'claude'],
      repetitions: 5,
      audit_scope: 'brand',
    });
  });

  it('clamps the repetition count into range', () => {
    expect(buildLaunchPayload(selection({ repetitions: 42 })).repetitions).toBe(MAX_REPETITIONS);
  });

  it('launches an explicitly approved prompt selection without a prompt set', () => {
    const promptId = '33333333-3333-4333-8333-333333333333';
    expect(
      buildLaunchPayload(selection({ promptSetId: null, promptIds: [promptId] })),
    ).toMatchObject({ prompt_ids: [promptId], audit_scope: 'brand' });
  });

  it('throws on an incomplete selection', () => {
    expect(() => buildLaunchPayload(selection({ engines: [] }))).toThrow();
    expect(() => buildLaunchPayload(selection({ promptSetId: null }))).toThrow();
  });
});

describe('toggleEngine', () => {
  it('adds and removes an engine immutably', () => {
    expect(toggleEngine(['gemini'], 'claude')).toEqual(['gemini', 'claude']);
    expect(toggleEngine(['gemini', 'claude'], 'gemini')).toEqual(['claude']);
  });
});

describe('prompt batching', () => {
  const prompts = Array.from({ length: 23 }, (_, index) =>
    makePrompt({
      id: `p${String(index).padStart(2, '0')}`,
      text: `Prompt ${index}`,
      created_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }),
  );

  it('runs only prompts the backend would resolve, in the backend order', () => {
    const set = makeSet([
      makePrompt({ id: 'later', created_at: '2026-02-01T00:00:00Z' }),
      makePrompt({ id: 'archived', status: 'archived', created_at: '2026-01-01T00:00:00Z' }),
      makePrompt({ id: 'disabled', enabled: false, created_at: '2026-01-02T00:00:00Z' }),
      makePrompt({ id: 'earlier', created_at: '2026-01-03T00:00:00Z' }),
    ]);
    // Archived and disabled prompts are not audit-eligible, so a batch must
    // never spend a slot on one — the backend would reject the whole request.
    expect(auditablePrompts(set).map((prompt) => prompt.id)).toEqual(['earlier', 'later']);
  });

  it('splits into batches of ten, with a short final batch', () => {
    const batches = promptBatches(prompts);
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 3]);
    expect(batches.flat()).toHaveLength(prompts.length);
    expect(PROMPT_BATCH_SIZE).toBe(10);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid batch size of %s',
    (size) => {
      expect(() => promptBatches(prompts, size)).toThrow(
        'Prompt batch size must be a positive integer.',
      );
    },
  );

  it('labels batches the way the list reads, one-indexed and inclusive', () => {
    const batches = promptBatches(prompts);
    expect(batchLabel(0, batches[0]!)).toBe('Prompts 1-10');
    expect(batchLabel(2, batches[2]!)).toBe('Prompts 21-23');
  });

  it('launches a batch as an explicit prompt id list', () => {
    const batch = promptBatches(prompts)[1]!;
    const payload = buildLaunchPayload(selection({ promptIds: batch.map((prompt) => prompt.id) }));
    expect(payload.prompt_ids).toEqual(batch.map((prompt) => prompt.id));
    expect(payload.prompt_set_id).toBeUndefined();
  });
});
