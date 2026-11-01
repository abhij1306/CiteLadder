import { describe, expect, it } from 'vite-plus/test';

import type { PromptCandidate, SeedQueries, Topic } from '@/lib/api/types';

import {
  defaultRunSettings,
  moreForSegment,
  moreForTopic,
  runRequest,
  segmentCoverage,
  topicCoverage,
} from './builder-run';

const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const NETS = '33333333-3333-4333-8333-333333333333';
const MATS = '44444444-4444-4444-8444-444444444444';
const seeds: SeedQueries = {
  sources: [
    {
      source: 'search_console',
      queries: [
        { id: Q1, text: 'best golf net for a small garden', topic_id: NETS },
        { id: Q2, text: 'which hitting mat lasts longest', topic_id: MATS },
      ],
    },
  ],
};
const context = { seeds, hasCompetitors: false, personaChoices: ['Parent', 'Club coach'] };

const topic = (id: string, name: string): Topic => ({
  id,
  project_id: '55555555-5555-4555-8555-555555555555',
  parent_id: null,
  name,
  description: '',
  origin: 'manual',
  active_count: 0,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});
const candidate = (topicId: string, cohort: PromptCandidate['cohort']): PromptCandidate => ({
  id: crypto.randomUUID(),
  run_id: '66666666-6666-4666-8666-666666666666',
  prompt_set_id: '77777777-7777-4777-8777-777777777777',
  topic_id: topicId,
  text: 'Which golf net catches every shot?',
  intent: 'purchase',
  buyer_stage: 'decision',
  prompt_intent: 'buy',
  cohort,
  created_at: '2026-11-01T00:00:00Z',
  expires_at: '2026-11-02T00:00:00Z',
  quality_status: 'judged',
  quality_flags: [],
  grounded: false,
});

describe('runRequest', () => {
  it('makes the default run: 10 prompts, 80/20 unbranded, intents 25/50/25, every connected search', () => {
    expect(runRequest(defaultRunSettings(), context)).toEqual({
      ok: true,
      request: {
        count: 10,
        topic_ids: [],
        distribution: {
          branded_share: 0.2,
          comparison_share: 0,
          intent_mix: { informational: 25, commercial: 50, transactional: 25 },
          personas: [],
        },
        seed_source: 'search_console',
      },
    });
  });

  it('sends only the ticked searches, and no seeds once every search is unticked', () => {
    const settings = { ...defaultRunSettings(), runContext: '  winter  ' };
    const one = runRequest({ ...settings, unticked: new Set([Q2]) }, context);
    expect(one.ok && one.request).toMatchObject({
      run_context: 'winter',
      seed_source: 'search_console',
      seed_query_ids: [Q1],
    });
    const none = runRequest({ ...settings, unticked: new Set([Q1, Q2]) }, context);
    expect(none.ok && none.request.seed_source).toBe('none');
  });

  it('refuses settings the API would reject, saying why', () => {
    const base = defaultRunSettings();
    expect(runRequest({ ...base, count: '51' }, context)).toEqual({
      ok: false,
      problem: 'Choose between 1 and 50 prompts.',
    });
    expect(
      runRequest(
        { ...base, brandedPercent: '70', comparisonPercent: '40' },
        {
          ...context,
          hasCompetitors: true,
        },
      ),
    ).toEqual({ ok: false, problem: 'Branded and competitor shares cannot pass 100%.' });
    expect(
      runRequest(
        { ...base, intent: { informational: '0', commercial: '0', transactional: '0' } },
        context,
      ),
    ).toEqual({ ok: false, problem: 'Give at least one intent a weight.' });
  });

  it('plans no competitor share without a tracked competitor', () => {
    const built = runRequest({ ...defaultRunSettings(), comparisonPercent: '30' }, context);
    expect(built.ok && built.request.distribution?.comparison_share).toBe(0);
  });

  it('waits for search data rather than treating an unloaded read as none', () => {
    expect(runRequest(defaultRunSettings(), { ...context, seeds: null })).toEqual({
      ok: false,
      problem: 'Your search data has to load before a run can start.',
    });
  });

  it('sends only personas step 1 still offers', () => {
    const built = runRequest(
      { ...defaultRunSettings(), personas: ['Parent', 'Removed role'] },
      context,
    );
    expect(built.ok && built.request.distribution?.personas).toEqual(['Parent']);
  });

  it('seeds from the first connected source until the person picks one', () => {
    const none = runRequest(defaultRunSettings(), { ...context, seeds: { sources: [] } });
    expect(none.ok && none.request.seed_source).toBe('none');
    const picked = runRequest({ ...defaultRunSettings(), seedSource: 'none' }, context);
    expect(picked.ok && picked.request.seed_source).toBe('none');
  });
});

describe('coverage', () => {
  const topics = [topic(NETS, 'Golf nets'), topic(MATS, 'Hitting mats')];
  const request = {
    count: 5,
    topic_ids: [],
    distribution: { branded_share: 0.2, comparison_share: 0 },
  };
  const drafted = [candidate(NETS, 'core'), candidate(NETS, 'core'), candidate(NETS, 'core')];

  it('marks each topic on target, short or empty against an even share of the count', () => {
    expect(topicCoverage(request, topics, drafted)).toEqual([
      { key: NETS, label: 'Golf nets', target: 3, actual: 3, state: 'on_target' },
      { key: MATS, label: 'Hitting mats', target: 2, actual: 0, state: 'empty' },
    ]);
  });

  it('marks each planned segment against its share', () => {
    expect(segmentCoverage(request, [...drafted, candidate(MATS, 'brand_diagnostic')])).toEqual([
      { key: 'core', segment: 'core', label: 'Unbranded', target: 4, actual: 3, state: 'short' },
      {
        key: 'brand_diagnostic',
        segment: 'brand_diagnostic',
        label: 'Branded',
        target: 1,
        actual: 1,
        state: 'on_target',
      },
    ]);
  });

  it('asks for what one topic or segment is missing, keeping the rest of the request', () => {
    const [, mats] = topicCoverage(request, topics, drafted);
    expect(mats && moreForTopic(request, mats)).toEqual({
      ...request,
      topic_ids: [MATS],
      count: 2,
    });
    const [core] = segmentCoverage(request, drafted);
    expect(core && moreForSegment(request, core)).toEqual({
      ...request,
      count: 1,
      distribution: { branded_share: 0, comparison_share: 0 },
    });
  });
});
