/**
 * Display helpers for answer perception. Values are projected from the read,
 * never recomputed; a missing value stays `null` so the component draws the
 * shared missing mark rather than a zero.
 */
import { formatPercent, measured } from '@/lib/format';
import type {
  PerceptionCoverage,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

/** Net sentiment as a signed whole number, or null when nothing was classified. */
export function formatNet(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** A 0–1 share as a whole percentage, or null. */
export function formatShare(value: number | null): string | null {
  return measured(formatPercent(value));
}

const THEME_LABELS: Record<string, string> = {
  ease_of_use: 'Ease of use',
  security_privacy: 'Security and privacy',
  reputation_trust: 'Reputation and trust',
  shipping_delivery: 'Shipping and delivery',
  returns_policy: 'Returns policy',
};

export function themeLabel(theme: string): string {
  const known = THEME_LABELS[theme];
  if (known) return known;
  const words = theme.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const REASON_COPY: Record<NonNullable<PerceptionResponse['reason']>, string> = {
  model_not_configured: 'Sentiment classification is not set up on this platform yet.',
  platform_cap: 'The platform classification limit was reached for these answers.',
  entity_limit: 'These answers named more businesses than are classified per answer.',
  invalid_output: 'The classifier returned nothing usable for these answers.',
  model_error: 'The classifier could not be reached for these answers.',
  task_failed: 'Classification stopped before it finished for these answers.',
  not_assessable: 'The answers did not say enough about you to judge their tone.',
};

/** The heading and sentence for a read that has no value to show. */
export function stateCopy(
  state: Exclude<PerceptionResponse['state'], 'value'>,
  reason: PerceptionResponse['reason'],
): { heading: string; description: string } {
  switch (state) {
    case 'pending':
      return {
        heading: 'Classifying answers…',
        description: 'Answers that name you are being read for sentiment. Check back shortly.',
      };
    case 'no_mentions':
      return {
        heading: 'No answers named you',
        description: 'Perception needs answers that mention your brand in the selected runs.',
      };
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
};

/** "N of M mentions classified", then every other bucket that is non-empty. */
export function coverageLine(coverage: PerceptionCoverage): string {
  const parts = [`${coverage.classified} of ${coverage.mentions} mentions classified`];
  if (coverage.pending) parts.push(`${coverage.pending} pending`);
  if (coverage.low_confidence) parts.push(`${coverage.low_confidence} low confidence`);
  if (coverage.not_assessable) parts.push(`${coverage.not_assessable} not assessable`);
  for (const { reason, count } of coverage.unavailable)
    parts.push(`${count} unavailable (${UNAVAILABLE_SHORT[reason]})`);
  return parts.join(' · ');
}
