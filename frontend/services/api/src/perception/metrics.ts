/**
 * Perception metrics over persisted answers: pure and deterministic. A missing
 * classification is a counted state (pending, unavailable by reason, not
 * assessable, low confidence), never a zero, and every score travels with
 * the coverage it was computed over.
 */
import type {
  PerceptionCoverage,
  PerceptionQuote,
  PerceptionResponse,
  PerceptionScore,
} from '@citeladder/contracts/visibility-perception';

import { z } from 'zod';
import { perceptionLabelSchema } from '@citeladder/contracts/visibility-perception';

import { compareText } from '../text-order.ts';
import { isNamed } from './passages.ts';
import type { VerifiedAspect } from './validate.ts';

type UnavailableReason = PerceptionCoverage['unavailable'][number]['reason'];
type ClassifiedLabel = 'positive' | 'neutral' | 'negative' | 'mixed';

export type MentionStatus =
  | { kind: 'classified'; label: ClassifiedLabel }
  | { kind: 'not_assessable' }
  | { kind: 'low_confidence' }
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type Mention = {
  entity: string;
  isBrand: boolean;
  status: MentionStatus;
  /** Verified aspects; only a classified mention's count toward themes. */
  aspects: VerifiedAspect[];
};

export type PerceptionAnswer = {
  auditId: string;
  executionId: string;
  observedAt: string;
  logicalEngine: string;
  prompt: string;
  topic: string;
  versions: { extractor: string; template: string; metrics: string };
  /** One per named tracked business. */
  mentions: Mention[];
  /** The brand's deterministic first-mention state, null when not assessed. */
  brandRecommendation: string | null;
  citations: { domain: string; url: string }[];
};

/** An `answer_perceptions` row's outcome, parsed at the read boundary. */
export const persistedOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('classified') }),
  z.object({ outcome: z.literal('no_mentions') }),
  z.object({ outcome: z.literal('invalid_output') }),
  z.object({ outcome: z.literal('model_error') }),
  z.object({
    outcome: z.literal('unavailable'),
    outcome_reason: z.enum(['model_not_configured', 'platform_cap', 'task_failed']),
  }),
]);
type PersistedOutcome = z.infer<typeof persistedOutcomeSchema>;
type PersistedEntity = { label: z.infer<typeof perceptionLabelSchema>; low_confidence: boolean };

/** One mention's status from its answer's perception row and its entity row. */
export function mentionStatus(
  perception: PersistedOutcome | undefined,
  entity: PersistedEntity | undefined,
): MentionStatus {
  if (!perception) return { kind: 'pending' };
  switch (perception.outcome) {
    case 'classified':
      if (!entity) return { kind: 'unavailable', reason: 'entity_limit' };
      if (entity.label === 'not_assessable') return { kind: 'not_assessable' };
      if (entity.low_confidence) return { kind: 'low_confidence' };
      return { kind: 'classified', label: entity.label };
    case 'invalid_output':
    case 'model_error':
      return { kind: 'unavailable', reason: perception.outcome };
    case 'no_mentions':
      return { kind: 'not_assessable' };
    case 'unavailable':
      return { kind: 'unavailable', reason: perception.outcome_reason };
    default: {
      const _exhaustive: never = perception;
      return _exhaustive;
    }
  }
}

export function score(mentions: readonly Mention[]): PerceptionScore {
  const counts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  for (const { status } of mentions) if (status.kind === 'classified') counts[status.label]++;
  const classified = counts.positive + counts.neutral + counts.negative + counts.mixed;
  const share = (count: number) => (classified ? count / classified : null);
  return {
    ...counts,
    classified,
    positive_share: share(counts.positive),
    negative_share: share(counts.negative),
    net_sentiment: classified ? ((counts.positive - counts.negative) / classified) * 100 : null,
  };
}

export function coverage(mentions: readonly Mention[]): PerceptionCoverage {
  const unavailable = new Map<UnavailableReason, number>();
  const result = {
    mentions: mentions.length,
    classified: 0,
    pending: 0,
    not_assessable: 0,
    low_confidence: 0,
  };
  for (const { status } of mentions) {
    if (status.kind === 'unavailable')
      unavailable.set(status.reason, (unavailable.get(status.reason) ?? 0) + 1);
    else result[status.kind]++;
  }
  return {
    ...result,
    unavailable: [...unavailable]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || compareText(a.reason, b.reason)),
  };
}

/** The read state: a value once anything is confidently classified. */
export function readState(cover: PerceptionCoverage): Pick<PerceptionResponse, 'state' | 'reason'> {
  if (cover.mentions === 0) return { state: 'no_mentions', reason: null };
  if (cover.classified > 0) return { state: 'value', reason: null };
  if (cover.pending > 0) return { state: 'pending', reason: null };
  return { state: 'unavailable', reason: cover.unavailable[0]?.reason ?? 'not_assessable' };
}

function breakdown(
  answers: readonly PerceptionAnswer[],
  key: (answer: PerceptionAnswer) => string,
  label: (answer: PerceptionAnswer) => string = key,
) {
  const groups = new Map<string, { label: string; mentions: Mention[] }>();
  for (const answer of answers) {
    const brand = answer.mentions.filter((mention) => mention.isBrand);
    if (!brand.length) continue;
    const group = groups.get(key(answer)) ?? { label: label(answer), mentions: [] };
    group.mentions.push(...brand);
    groups.set(key(answer), group);
  }
  return [...groups]
    .map(([groupKey, group]) => ({
      key: groupKey,
      label: group.label,
      score: score(group.mentions),
      coverage: coverage(group.mentions),
    }))
    .sort((a, b) => b.score.classified - a.score.classified || compareText(a.key, b.key));
}

/** A quote with its aspect's ordinal in the mention, the last key of its total order. */
export type PositionedQuote = PerceptionQuote & { ordinal: number };

/** Newest answer first, then execution, entity and aspect: a total order (keys are unique). */
export function quoteOrder(
  a: Pick<PositionedQuote, 'observed_at' | 'execution_id' | 'entity' | 'ordinal'>,
  b: Pick<PositionedQuote, 'observed_at' | 'execution_id' | 'entity' | 'ordinal'>,
) {
  return (
    compareText(b.observed_at, a.observed_at) ||
    compareText(a.execution_id, b.execution_id) ||
    compareText(a.entity, b.entity) ||
    a.ordinal - b.ordinal
  );
}

/** The verified aspects of confidently classified mentions `keep` accepts, in quote order. */
export function classifiedQuotes(
  answers: readonly PerceptionAnswer[],
  keep: (mention: Mention) => boolean,
): PositionedQuote[] {
  return answers
    .flatMap((answer) =>
      answer.mentions
        .filter((mention) => mention.status.kind === 'classified' && keep(mention))
        .flatMap((mention) =>
          mention.aspects.map((aspect, ordinal) => ({
            ...quoteOf(answer, mention, aspect),
            ordinal,
          })),
        ),
    )
    .sort(quoteOrder);
}

function quoteOf(
  answer: PerceptionAnswer,
  mention: Mention,
  aspect: VerifiedAspect,
): PerceptionQuote {
  return {
    text: aspect.quote,
    theme: aspect.theme,
    polarity: aspect.polarity,
    entity: mention.entity,
    is_brand: mention.isBrand,
    logical_engine: answer.logicalEngine,
    prompt: answer.prompt,
    run_id: answer.auditId,
    execution_id: answer.executionId,
    observed_at: answer.observedAt,
    extractor_version: answer.versions.extractor,
    template_version: answer.versions.template,
  };
}

function themes(quotes: readonly PerceptionQuote[], perTheme: number) {
  const groups = new Map<
    string,
    { positive: number; negative: number; quotes: PerceptionQuote[] }
  >();
  for (const quote of quotes) {
    const group = groups.get(quote.theme) ?? { positive: 0, negative: 0, quotes: [] };
    group[quote.polarity]++;
    if (group.quotes.length < perTheme) group.quotes.push(quote);
    groups.set(quote.theme, group);
  }
  return [...groups]
    .map(([theme, group]) => ({ theme, ...group }))
    .sort(
      (a, b) =>
        b.positive + b.negative - (a.positive + a.negative) || compareText(a.theme, b.theme),
    );
}

/** Domains cited in the answers `flagged` accepts, by answer count: co-occurrence only. */
export function citedDomains<A extends { citations: readonly { domain: string; url: string }[] }>(
  answers: readonly A[],
  flagged: (answer: A) => boolean,
  limit: number,
) {
  const domains = new Map<string, { answers: number; example_url: string | null }>();
  for (const answer of answers) {
    if (!flagged(answer)) continue;
    const seen = new Set<string>();
    for (const citation of answer.citations) {
      if (!citation.domain || seen.has(citation.domain)) continue;
      seen.add(citation.domain);
      const row = domains.get(citation.domain) ?? { answers: 0, example_url: citation.url || null };
      row.answers++;
      domains.set(citation.domain, row);
    }
  }
  return [...domains]
    .map(([domain, row]) => ({ domain, ...row }))
    .sort((a, b) => b.answers - a.answers || compareText(a.domain, b.domain))
    .slice(0, limit);
}

/** Domains cited in answers where the brand drew a negative aspect. */
function drivers(answers: readonly PerceptionAnswer[], limit: number) {
  return citedDomains(
    answers,
    (answer) =>
      answer.mentions.some(
        (mention) =>
          mention.isBrand &&
          mention.status.kind === 'classified' &&
          mention.aspects.some((aspect) => aspect.polarity === 'negative'),
      ),
    limit,
  );
}

const RECOMMENDATION_LIMITATION =
  "Explicit recommendation language near the brand's first mention, read in English phrasing only.";

function recommended(answers: readonly PerceptionAnswer[]) {
  const states = answers
    .map((answer) => answer.brandRecommendation)
    .filter((state): state is string => state !== null && isNamed(state));
  const count = (wanted: string) => states.filter((state) => state === wanted).length;
  return {
    mentioned: states.length,
    recommended: count('recommended'),
    recommended_against: count('recommended_against'),
    rate: states.length ? count('recommended') / states.length : null,
    limitation: RECOMMENDATION_LIMITATION,
  };
}

/**
 * Answers grouped into runs, oldest completion first; a run whose identity
 * differs from the previous run's is not comparable with it.
 */
export function runPoints<A extends { auditId: string; observedAt: string }>(
  answers: readonly A[],
  identity: (first: A) => string,
) {
  const runs = new Map<string, { first: A; rows: A[]; completedAt: string }>();
  for (const answer of answers) {
    const run = runs.get(answer.auditId);
    if (!run)
      runs.set(answer.auditId, { first: answer, rows: [answer], completedAt: answer.observedAt });
    else {
      run.rows.push(answer);
      if (compareText(answer.observedAt, run.completedAt) > 0) run.completedAt = answer.observedAt;
    }
  }
  let previous: string | null = null;
  return [...runs]
    .map(([auditId, run]) => ({ auditId, ...run }))
    .sort((a, b) => compareText(a.completedAt, b.completedAt) || compareText(a.auditId, b.auditId))
    .map((run) => {
      const key = identity(run.first);
      const comparable = previous === null || previous === key;
      previous = key;
      return { ...run, comparable };
    });
}

/** One point per run; a version change from the previous point breaks comparability. */
function trend(answers: readonly PerceptionAnswer[]) {
  return runPoints(answers, ({ versions }) =>
    JSON.stringify([versions.extractor, versions.template, versions.metrics]),
  ).map(({ auditId, first, rows, completedAt, comparable }) => {
    const versions = first.versions;
    const brand = rows.flatMap((row) => row.mentions.filter((mention) => mention.isBrand));
    return {
      audit_id: auditId,
      completed_at: completedAt,
      score: score(brand),
      mentions: brand.length,
      extractor_version: versions.extractor,
      template_version: versions.template,
      metrics_version: versions.metrics,
      comparable,
    };
  });
}

export function perceptionSummary(
  answers: readonly PerceptionAnswer[],
  limits: { max_quotes_per_theme: number; max_negative_quotes: number; max_drivers: number },
): Omit<PerceptionResponse, 'source_audit_ids'> {
  const all = answers.flatMap((answer) => answer.mentions);
  const brandMentions = all.filter((mention) => mention.isBrand);
  const byEntity = new Map<string, { isBrand: boolean; mentions: Mention[] }>();
  for (const mention of all) {
    const entity = byEntity.get(mention.entity);
    if (entity) entity.mentions.push(mention);
    else byEntity.set(mention.entity, { isBrand: mention.isBrand, mentions: [mention] });
  }
  const entities = [...byEntity]
    .map(([name, { isBrand, mentions }]) => ({
      name,
      is_brand: isBrand,
      score: score(mentions),
      coverage: coverage(mentions),
    }))
    .sort(
      (a, b) =>
        Number(b.is_brand) - Number(a.is_brand) ||
        b.coverage.mentions - a.coverage.mentions ||
        compareText(a.name, b.name),
    );
  const brandCoverage = coverage(brandMentions);
  const quotes = classifiedQuotes(answers, (mention) => mention.isBrand).map(
    ({ ordinal: _ordinal, ...quote }) => quote,
  );
  return {
    ...readState(brandCoverage),
    brand: entities.find((entity) => entity.is_brand) ?? null,
    coverage: brandCoverage,
    entities,
    engines: breakdown(answers, (answer) => answer.logicalEngine),
    topics: breakdown(answers, (answer) => answer.topic),
    prompts: breakdown(answers, (answer) => answer.prompt),
    themes: themes(quotes, limits.max_quotes_per_theme),
    negative_quotes: quotes
      .filter((quote) => quote.polarity === 'negative')
      .slice(0, limits.max_negative_quotes),
    drivers: drivers(answers, limits.max_drivers),
    recommended: recommended(answers),
    trend: trend(answers),
  };
}
