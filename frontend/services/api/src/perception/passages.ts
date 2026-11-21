import { createHash } from 'node:crypto';

import { countedMatches, trackedEntities } from '../analysis/entity-assessment.ts';
import { namedByPrompt, type ScoringConfig } from '../analysis/scoring.ts';
import type { PerceptionPolicy } from '../config/perception.ts';
import { canonicalJson } from '../canonical-json.ts';

export type Span = { start: number; end: number; text: string };

export type EntityPassages = {
  entity_id: string;
  name: string;
  kind: 'brand' | 'competitor';
  spans: Span[];
};

export type PerceptionPackage = {
  extractor_version: string;
  template_version: string;
  language: string;
  prompt: string;
  themes: { id: string; name: string }[];
  entities: EntityPassages[];
};

const NOT_NAMED = new Set(['absent', 'unavailable']);

export function isNamed(state: string): boolean {
  return !NOT_NAMED.has(state);
}

export function namesAnyEntity(assessments: readonly { state: string }[]): boolean {
  return assessments.some((row) => isNamed(row.state));
}

function segmenter(languageCode: string) {
  try {
    return new Intl.Segmenter(languageCode || 'en', { granularity: 'sentence' });
  } catch {
    return new Intl.Segmenter('en', { granularity: 'sentence' });
  }
}

function codePointIndex(text: string): (utf16: number) => number {
  const offsets = new Uint32Array(text.length + 1);
  let points = 0;
  for (let index = 0; index < text.length;) {
    const width = (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    offsets[index] = points;
    if (width === 2) offsets[index + 1] = points;
    index += width;
    points += 1;
  }
  offsets[text.length] = points;
  return (utf16) => offsets[utf16]!;
}

type Range = { start: number; end: number };

function sentences(answer: string, languageCode: string): Range[] {
  const ranges: Range[] = [];
  for (const { index, segment } of segmenter(languageCode).segment(answer)) {
    const lead = segment.length - segment.trimStart().length;
    const body = segment.trim();
    if (body) ranges.push({ start: index + lead, end: index + lead + body.length });
  }
  return ranges;
}

function windows(occurrences: readonly number[], ranges: readonly Range[]): Range[] {
  const hit: number[] = [];
  let sentence = 0;
  for (const offset of occurrences) {
    while (sentence < ranges.length && offset >= (ranges[sentence]?.end ?? Infinity)) sentence++;
    if (sentence === ranges.length) break;
    const from = Math.max(0, sentence - 1, (hit.at(-1) ?? -1) + 1);
    for (let index = from; index <= Math.min(ranges.length - 1, sentence + 1); index++)
      hit.push(index);
  }
  return mergeAdjacent(hit, ranges);
}

function mergeAdjacent(indexes: readonly number[], ranges: readonly Range[]): Range[] {
  const merged: Range[] = [];
  let previous = -2;
  for (const index of indexes) {
    const range = ranges[index];
    if (!range) continue;
    const last = merged.at(-1);
    if (last && previous + 1 === index) last.end = range.end;
    else merged.push({ ...range });
    previous = index;
  }
  return merged;
}

function clip(start: number, end: number, mention: number, budget: number) {
  if (end - start <= budget) return { start, end };
  const from = Math.min(Math.max(start, mention - Math.floor(budget / 2)), end - budget);
  return { start: from, end: from + budget };
}

export function entityPassages(input: {
  answer: string;
  languageCode: string;
  config: ScoringConfig;
  policy: Pick<PerceptionPolicy, 'max_entities' | 'max_passage_chars_per_entity'>;
  promptNamesBrand: boolean;
}): EntityPassages[] {
  const { answer, policy } = input;
  if (!answer.trim()) return [];
  const ranges = sentences(answer, input.languageCode);
  const points = codePointIndex(answer);
  const chars = Array.from(answer);
  type Named = {
    entity: ReturnType<typeof trackedEntities>[number];
    occurrences: number[];
    first: number;
    windows: Range[] | null;
  };
  const named = trackedEntities(input.config).flatMap((entity): Named[] => {
    if (entity.kind === 'brand' && namedByPrompt(input.promptNamesBrand, answer))
      return [{ entity, occurrences: [0], first: 0, windows: [{ start: 0, end: answer.length }] }];
    const occurrences = countedMatches(entity.aliases, answer, entity.matching).map((m) => m.index);
    const [first] = occurrences;
    return first === undefined ? [] : [{ entity, occurrences, first, windows: null }];
  });
  const [brand, competitors] = [
    named.filter(({ entity }) => entity.kind === 'brand'),
    named.filter(({ entity }) => entity.kind !== 'brand').sort((a, b) => a.first - b.first),
  ];
  const selected = [...brand, ...competitors].slice(0, policy.max_entities);
  return selected.map(({ entity, occurrences, windows: fixed }) => {
    let budget = policy.max_passage_chars_per_entity;
    const spans: Span[] = [];
    for (const window of fixed ?? windows(occurrences, ranges)) {
      if (budget <= 0) break;
      const mention = occurrences.find((offset) => offset >= window.start) ?? window.start;
      const { start, end } = clip(
        points(window.start),
        points(window.end),
        points(mention),
        budget,
      );
      const text = chars.slice(start, end).join('');
      spans.push({ start, end, text });
      budget -= end - start;
    }
    return {
      entity_id: entity.id,
      name: entity.name,
      kind: entity.kind === 'brand' ? 'brand' : 'competitor',
      spans,
    };
  });
}

export function packageHash(pkg: PerceptionPackage): string {
  return createHash('sha256').update(canonicalJson(pkg, false)).digest('hex');
}
