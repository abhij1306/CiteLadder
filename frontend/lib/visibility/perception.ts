import type { NetSentiment } from '@citeladder/contracts';
import { PERCEPTION_MIN_CLASSIFIED, PERCEPTION_MIN_THEME_JUDGING } from '@/lib/config/visibility';
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

export function describesTooFew(data: Pick<PerceptionResponse, 'state' | 'reason' | 'coverage'>) {
  if (data.state === 'pending') return false;
  if (data.state === 'unavailable') return data.reason === 'not_assessable';
  return data.coverage.classified < PERCEPTION_MIN_CLASSIFIED;
}

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
        description: reason ? sentenceCase(UNAVAILABLE_SHORT[reason]) : null,
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

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Category = PerceptionResponse['entities'][number]['categories'][number];
export type Polarity = 'negative' | 'positive';

export const SMALL_SAMPLE = 'Small sample';

export type SampleShare =
  | { kind: 'empty' }
  | { kind: 'value'; share: number; text: string; count: number; basis: number; small: boolean };

export function sampleShare({
  count,
  basis,
  minimum = PERCEPTION_MIN_CLASSIFIED,
}: Readonly<{ count: number; basis: number; minimum?: number }>): SampleShare {
  if (basis <= 0) return { kind: 'empty' };
  const share = count / basis;
  const small = basis < minimum;
  return {
    kind: 'value',
    share,
    text: small ? `${count} / ${basis}` : percentText(share),
    count,
    basis,
    small,
  };
}

export function sampleNote(reading: SampleShare, noun: string): string | undefined {
  if (reading.kind === 'empty') return undefined;
  return `${reading.count} of ${reading.basis} ${noun}`;
}

export function categoryShare(
  category: Pick<Category, 'negative' | 'positive'>,
  minimum = PERCEPTION_MIN_THEME_JUDGING,
): SampleShare {
  return sampleShare({
    count: category.negative,
    basis: category.negative + category.positive,
    minimum,
  });
}

export function rankCategories(categories: readonly Category[], order: Polarity): Category[] {
  return categories
    .filter((category) => category[order] > 0)
    .sort((a, b) => b[order] - a[order] || a.category.localeCompare(b.category));
}

export type CategorySort = Readonly<{
  key: 'attribute' | 'negative' | 'positive' | 'share';
  descending: boolean;
}>;

function sortValue(category: Category, key: Exclude<CategorySort['key'], 'attribute'>): number {
  if (key !== 'share') return category[key];
  const judged = category.negative + category.positive;
  return judged ? category.negative / judged : -1;
}

export function sortCategories(categories: readonly Category[], sort: CategorySort): Category[] {
  const sign = sort.descending ? -1 : 1;
  return [...categories].sort((a, b) => {
    const byName = a.category.localeCompare(b.category);
    if (sort.key === 'attribute') return sign * byName;
    return sign * (sortValue(a, sort.key) - sortValue(b, sort.key)) || byName;
  });
}

export function filterCategories(
  categories: readonly Category[],
  { query, polarity }: Readonly<{ query: string; polarity: Polarity | 'all' }>,
): Category[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (text: string) => !needle || text.toLocaleLowerCase().includes(needle);
  return categories.flatMap((category) => {
    if (polarity !== 'all' && category[polarity] === 0) return [];
    const named = matches(category.category);
    const attributes = category.attributes.flatMap((attribute) => {
      if (polarity !== 'all' && attribute[polarity] === 0) return [];
      if (!named && !matches(attribute.attribute)) return [];
      const quotes =
        polarity === 'all'
          ? attribute.quotes
          : attribute.quotes.filter((quote) => quote.polarity === polarity);
      return [{ ...attribute, quotes }];
    });
    if (!named && !attributes.length) return [];
    return [{ ...category, attributes }];
  });
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

export function breakdownRow(
  row: PerceptionResponse['topics'][number],
  minimum = PERCEPTION_MIN_CLASSIFIED,
) {
  const { score, coverage } = row;
  const share = (count: number) => sampleShare({ count, basis: score.classified, minimum });
  return {
    classified: score.classified,
    mentions: coverage.mentions,
    small: score.classified > 0 && score.classified < minimum,
    positive: share(score.positive),
    neutral: share(score.neutral),
    negative: share(score.negative),
    net: netReading(score.net_sentiment, score.classified, minimum),
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
