/**
 * The Prompt Builder's run as data: the distribution step's settings, the
 * generate request they make, and review's coverage of what came back
 * against what was asked for, with the request for "Generate more".
 */
import type { PromptGenerateInput } from '@/lib/api/prompts';
import type { PromptCandidate, SeedQueries, Topic } from '@/lib/api/types';
import { MAX_GENERATION_COUNT, PROMPT_BUILDER } from '@/lib/config/prompts';

export type SeedChoice = SeedQueries['sources'][number]['source'] | 'none';
type IntentKey = keyof typeof PROMPT_BUILDER.defaultIntentMix;
export const INTENT_KEYS = [
  'informational',
  'commercial',
  'transactional',
] as const satisfies readonly IntentKey[];

/** The distribution step's controls, as typed: numbers stay text until the request is built. */
export type RunSettings = {
  count: string;
  brandedPercent: string;
  comparisonPercent: string;
  intent: Record<IntentKey, string>;
  personas: string[];
  /** The chosen search source; null until the person picks one (see `seedSourceOf`). */
  seedSource: SeedChoice | null;
  /** Seed queries the person unticked; every other listed query steers wording. */
  unticked: ReadonlySet<string>;
  runContext: string;
};

/** The source seeds come from: the person's choice, else the first connected source. */
export function seedSourceOf(settings: RunSettings, seeds: SeedQueries): SeedChoice {
  return settings.seedSource ?? seeds.sources[0]?.source ?? 'none';
}

/** Defaults that suit most businesses. */
export function defaultRunSettings(): RunSettings {
  const mix = PROMPT_BUILDER.defaultIntentMix;
  return {
    count: String(PROMPT_BUILDER.defaultCount),
    brandedPercent: String(PROMPT_BUILDER.defaultBrandedPercent),
    comparisonPercent: String(PROMPT_BUILDER.defaultComparisonPercent),
    intent: {
      informational: String(mix.informational),
      commercial: String(mix.commercial),
      transactional: String(mix.transactional),
    },
    personas: [],
    seedSource: null,
    unticked: new Set(),
    runContext: '',
  };
}

/** A whole number within bounds, or null. */
function whole(text: string, min: number, max: number): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

type Built = { ok: true; request: PromptGenerateInput } | { ok: false; problem: string };

/** The seed fields: every listed query is `[]`, none is the `none` source. */
function seedFields(
  settings: RunSettings,
  seeds: SeedQueries,
): Pick<PromptGenerateInput, 'seed_source' | 'seed_query_ids'> | string {
  const source = seedSourceOf(settings, seeds);
  if (source === 'none') return { seed_source: 'none' };
  const listed = seeds.sources.find((item) => item.source === source)?.queries ?? [];
  const ticked = listed.filter((query) => !settings.unticked.has(query.id)).map((q) => q.id);
  if (listed.length && !ticked.length) return { seed_source: 'none' };
  if (ticked.length === listed.length) return { seed_source: source };
  if (ticked.length > PROMPT_BUILDER.seedQueryIdsMax)
    return `Tick at most ${PROMPT_BUILDER.seedQueryIdsMax} search queries, or keep them all.`;
  return { seed_source: source, seed_query_ids: ticked };
}

/**
 * The generate request for every topic, or why the settings cannot make one.
 * `seeds` is null until the seed-query read has loaded, so a pending or failed
 * read never passes for "no search data". Only personas still offered count.
 */
export function runRequest(
  settings: RunSettings,
  context: {
    seeds: SeedQueries | null;
    hasCompetitors: boolean;
    personaChoices: readonly string[];
  },
): Built {
  const count = whole(settings.count, 1, MAX_GENERATION_COUNT);
  if (count === null)
    return { ok: false, problem: `Choose between 1 and ${MAX_GENERATION_COUNT} prompts.` };
  const branded = whole(settings.brandedPercent, 0, 100);
  const comparison = context.hasCompetitors ? whole(settings.comparisonPercent, 0, 100) : 0;
  if (branded === null || comparison === null)
    return { ok: false, problem: 'Shares are whole percentages from 0 to 100.' };
  if (branded + comparison > 100)
    return { ok: false, problem: 'Branded and competitor shares cannot pass 100%.' };
  const mix = INTENT_KEYS.map((key) => whole(settings.intent[key], 0, 100));
  if (mix.includes(null))
    return { ok: false, problem: 'Intent weights are whole numbers from 0 to 100.' };
  const [informational = 0, commercial = 0, transactional = 0] = mix.map((value) => value ?? 0);
  if (informational + commercial + transactional === 0)
    return { ok: false, problem: 'Give at least one intent a weight.' };
  if (!context.seeds)
    return { ok: false, problem: 'Your search data has to load before a run can start.' };
  const seeds = seedFields(settings, context.seeds);
  if (typeof seeds === 'string') return { ok: false, problem: seeds };
  const note = settings.runContext.trim();
  return {
    ok: true,
    request: {
      count,
      topic_ids: [],
      ...(note ? { run_context: note } : {}),
      distribution: {
        branded_share: branded / 100,
        comparison_share: comparison / 100,
        intent_mix: { informational, commercial, transactional },
        personas: settings.personas.filter((persona) => context.personaChoices.includes(persona)),
      },
      ...seeds,
    },
  };
}

export type CoverageState = 'on_target' | 'short' | 'empty' | 'not_planned';
export type CoverageRow = {
  key: string;
  label: string;
  /** What the request planned for this row; 0 when it planned none. */
  target: number;
  actual: number;
  state: CoverageState;
};

function coverageState(target: number, actual: number): CoverageState {
  if (actual >= target) return target === 0 && actual === 0 ? 'not_planned' : 'on_target';
  return actual === 0 ? 'empty' : 'short';
}

/** `total` split over `weights` by largest remainder, so the parts sum to it. */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const floors = exact.map(Math.floor);
  const remainder = total - floors.reduce((a, b) => a + b, 0);
  const extra = new Set(
    exact
      .map((value, index) => ({ index, rest: value - Math.floor(value) }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index)
      .slice(0, remainder)
      .map(({ index }) => index),
  );
  return floors.map((part, index) => part + (extra.has(index) ? 1 : 0));
}

/** Each requested topic: drafted suggestions against an even share of the count. */
export function topicCoverage(
  request: PromptGenerateInput,
  topics: readonly Topic[],
  drafted: readonly PromptCandidate[],
): CoverageRow[] {
  const ids = request.topic_ids?.length ? request.topic_ids : topics.map((topic) => topic.id);
  const scoped = ids.flatMap((id) => topics.find((topic) => topic.id === id) ?? []);
  const targets = apportion(
    request.count ?? 0,
    scoped.map(() => 1),
  );
  return scoped.map((topic, index) => {
    const actual = drafted.filter((candidate) => candidate.topic_id === topic.id).length;
    const target = targets[index] ?? 0;
    return {
      key: topic.id,
      label: topic.name,
      target,
      actual,
      state: coverageState(target, actual),
    };
  });
}

type Segment = 'core' | 'brand_diagnostic' | 'comparison';
const SEGMENTS: readonly { key: Segment; label: string }[] = [
  { key: 'core', label: 'Unbranded' },
  { key: 'brand_diagnostic', label: 'Branded' },
  { key: 'comparison', label: 'Competitor alternatives' },
];

export type SegmentCoverageRow = CoverageRow & { segment: Segment };

/** Each planned segment (cohort): drafted suggestions against its share of the count. */
export function segmentCoverage(
  request: PromptGenerateInput,
  drafted: readonly PromptCandidate[],
): SegmentCoverageRow[] {
  const branded = request.distribution?.branded_share ?? 0;
  const comparison = request.distribution?.comparison_share ?? 0;
  const targets = apportion(request.count ?? 0, [
    Math.max(0, 1 - branded - comparison),
    branded,
    comparison,
  ]);
  return SEGMENTS.flatMap(({ key, label }, index) => {
    const target = targets[index] ?? 0;
    const actual = drafted.filter((candidate) => candidate.cohort === key).length;
    if (!target && !actual) return [];
    return [{ key, segment: key, label, target, actual, state: coverageState(target, actual) }];
  });
}

const missing = (row: CoverageRow) => Math.max(1, row.target - row.actual);

/** The builder's request narrowed to one topic, for the suggestions it is missing. */
export function moreForTopic(request: PromptGenerateInput, row: CoverageRow): PromptGenerateInput {
  return { ...request, topic_ids: [row.key], count: missing(row) };
}

/** The builder's request narrowed to one segment, for the suggestions it is missing. */
export function moreForSegment(
  request: PromptGenerateInput,
  row: SegmentCoverageRow,
): PromptGenerateInput {
  return {
    ...request,
    count: missing(row),
    distribution: {
      ...request.distribution,
      branded_share: row.segment === 'brand_diagnostic' ? 1 : 0,
      comparison_share: row.segment === 'comparison' ? 1 : 0,
    },
  };
}
