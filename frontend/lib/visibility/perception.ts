import type { NetSentiment } from '@citeladder/contracts';
import { PERCEPTION_MIN_CLASSIFIED } from '@/lib/config/visibility';
import { availabilityLabel, percentText } from '@/lib/format';
import type {
  PerceptionCoverage,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

export function formatNet(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function sentimentReading(
  sentiment: NetSentiment | null | undefined,
  minimum = PERCEPTION_MIN_CLASSIFIED,
):
  | { kind: 'not_measured' }
  | { kind: 'no_mentions' }
  | { kind: 'too_few'; classified: number; mentions: number; minimum: number }
  | { kind: 'value'; net: string; classified: number; mentions: number } {
  if (!sentiment) return { kind: 'not_measured' };
  if (sentiment.mentions === 0) return { kind: 'no_mentions' };
  const { classified, mentions } = sentiment;
  const reading = netReading(sentiment.net_sentiment, classified, minimum);
  if (reading.kind === 'too_few') return { kind: 'too_few', classified, mentions, minimum };
  return { kind: 'value', net: reading.text, classified, mentions };
}

export const NOT_NAMED = 'Not named';

export function sentimentFigureValue(sentiment: NetSentiment | null | undefined): {
  value: string | null;
  missingLabel: string;
} {
  const reading = sentimentReading(sentiment);
  return {
    value: reading.kind === 'value' ? reading.net : null,
    missingLabel: missingSentimentLabel(reading.kind),
  };
}

function missingSentimentLabel(kind: ReturnType<typeof sentimentReading>['kind']): string {
  if (kind === 'no_mentions') return NOT_NAMED;
  if (kind === 'too_few') return `${availabilityLabel('too_few')} classified`;
  return availabilityLabel('not_measured');
}

export type GatedReading =
  | { kind: 'too_few'; basis: number; minimum: number }
  | { kind: 'value'; text: string };

function meetsMinimum(basis: number, minimum: number): boolean {
  return basis >= Math.max(1, minimum);
}

function gated(text: string | null, basis: number, minimum: number): GatedReading {
  if (!meetsMinimum(basis, minimum) || text === null) return { kind: 'too_few', basis, minimum };
  return { kind: 'value', text };
}

export function shareReading(
  share: number | null | undefined,
  basis: number,
  minimum = PERCEPTION_MIN_CLASSIFIED,
): GatedReading {
  return gated(share == null ? null : percentText(share), basis, minimum);
}

export function netReading(
  net: number | null | undefined,
  basis: number,
  minimum = PERCEPTION_MIN_CLASSIFIED,
): GatedReading {
  return gated(formatNet(net ?? null), basis, minimum);
}

export function gatedFigure(
  reading: GatedReading,
  noun = 'classified',
): { value: string | null; missingLabel: string } {
  return {
    value: reading.kind === 'value' ? reading.text : null,
    missingLabel: `${availabilityLabel('too_few')} ${noun}`,
  };
}

const REASON_COPY: Record<NonNullable<PerceptionResponse['reason']>, string> = {
  model_not_configured: 'Sentiment classification is not set up on this platform yet.',
  platform_cap: 'The platform classification limit was reached for these answers.',
  entity_limit: 'These answers named more businesses than are classified per answer.',
  invalid_output: 'The classifier returned nothing usable for these answers.',
  model_error: 'The classifier could not be reached for these answers.',
  task_failed: 'Classification stopped before it finished for these answers.',
  not_assessable: 'The answers did not say enough about you to judge their tone.',
  model_omitted: 'The classifier left these businesses out of its answer.',
  model_changed:
    'The classifier model changed after these runs started, so they were not classified.',
};

export function stateCopy(
  state: Exclude<PerceptionResponse['state'], 'value'>,
  reason: PerceptionResponse['reason'],
): { heading: string; description: string | null } {
  switch (state) {
    case 'pending':
      return { heading: 'Classifying answers…', description: null };
    case 'no_mentions':
      return { heading: 'No answers named you', description: null };
    case 'unavailable':
      return {
        heading: 'Perception unavailable',
        description: REASON_COPY[reason ?? 'not_assessable'],
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

const UNAVAILABLE_SHORT: Record<NonNullable<PerceptionResponse['reason']>, string> = {
  model_not_configured: 'classifier not set up',
  platform_cap: 'platform limit reached',
  entity_limit: 'too many businesses in one answer',
  invalid_output: 'unusable classifier output',
  model_error: 'classifier unreachable',
  task_failed: 'classification stopped',
  not_assessable: 'not assessable',
  model_omitted: 'left out by the classifier',
  model_changed: 'classifier model changed',
};

type Score = PerceptionResponse['entities'][number]['score'];
type Theme = PerceptionResponse['themes'][number];

export function negativeHeadline(
  score: Score | null | undefined,
  minimum = PERCEPTION_MIN_CLASSIFIED,
): string | null {
  if (!score || score.negative_share === null || !meetsMinimum(score.classified, minimum))
    return null;
  if (score.negative === 0) return 'AI says nothing negative about you in classified mentions';
  return `AI says something negative about you in ${Math.round(score.negative_share * 100)}% of classified mentions`;
}

export function rankThemes(
  themes: readonly Theme[],
  order: 'negative' | 'positive',
  limit: number,
): Theme[] {
  return themes
    .filter((theme) => theme[order] > 0)
    .sort((a, b) => b[order] - a[order] || a.theme.localeCompare(b.theme))
    .slice(0, limit);
}

export function themeNegativeShare(
  theme: Pick<Theme, 'negative' | 'positive'>,
  minimum = PERCEPTION_MIN_CLASSIFIED,
): number | null {
  const polar = theme.negative + theme.positive;
  return meetsMinimum(polar, minimum) ? theme.negative / polar : null;
}

export function sentimentTrend(
  trend: PerceptionResponse['trend'],
  formatDate: (iso: string) => string,
  minimum = PERCEPTION_MIN_CLASSIFIED,
) {
  return trend.map((point, index) => ({
    label: formatDate(point.completed_at),
    value: meetsMinimum(point.score.classified, minimum) ? point.score.net_sentiment : null,
    timestamp: Date.parse(point.completed_at),
    breakBefore: index > 0 && !point.comparable,
  }));
}

export type BreakdownRow =
  | { kind: 'too_few'; classified: number; mentions: number; needed: number }
  | {
      kind: 'value';
      classified: number;
      mentions: number;
      positive: number;
      neutral: number;
      negative: number;
      net: number | null;
    };

export function breakdownRow(
  row: PerceptionResponse['topics'][number],
  minimum: number,
): BreakdownRow {
  const { score, coverage } = row;
  const counts = { classified: score.classified, mentions: coverage.mentions };
  if (!meetsMinimum(score.classified, minimum))
    return { kind: 'too_few', ...counts, needed: minimum };
  // `mixed` counts in the denominator only, so the three shares need not sum to one.
  return {
    kind: 'value',
    ...counts,
    positive: score.positive / score.classified,
    neutral: score.neutral / score.classified,
    negative: score.negative / score.classified,
    net: score.net_sentiment,
  };
}

export function coverageLine(coverage: PerceptionCoverage): string {
  return [
    `${coverage.classified} of ${coverage.mentions} mentions classified`,
    ...coverageExtras(coverage),
  ].join(' · ');
}

export function coverageExtras(coverage: PerceptionCoverage): string[] {
  const parts: string[] = [];
  if (coverage.pending) parts.push(`${coverage.pending} pending`);
  if (coverage.low_confidence) parts.push(`${coverage.low_confidence} low confidence`);
  if (coverage.not_assessable) parts.push(`${coverage.not_assessable} not assessable`);
  for (const { reason, count } of coverage.unavailable)
    parts.push(`${count} unavailable (${UNAVAILABLE_SHORT[reason]})`);
  return parts;
}
