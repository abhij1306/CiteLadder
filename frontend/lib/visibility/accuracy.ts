/**
 * Display helpers for fact-check accuracy. Values are projected from the read,
 * never recomputed; a missing value stays `null` so the component draws the
 * shared missing mark rather than a zero.
 */
import type {
  AccuracyCoverage,
  AccuracyResponse,
  ClaimVerdict,
  FactTopic,
} from '@citeladder/contracts/fact-checking';

import type { SentimentValue } from '@/components/ui/badge-variants';

export const TOPIC_LABELS: Record<FactTopic, string> = {
  pricing: 'Pricing',
  plans: 'Plans',
  integrations: 'Integrations',
  availability: 'Availability',
  markets: 'Markets',
  policies: 'Policies',
  specs: 'Specifications',
  company: 'Company',
};

export const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  inconclusive: 'Inconclusive',
  not_covered: 'Not covered',
};

/** The shared tone scale: supported reads as success, contradicted as danger. */
export const VERDICT_TONE: Record<ClaimVerdict, SentimentValue> = {
  supported: 'positive',
  contradicted: 'negative',
  inconclusive: 'mixed',
  not_covered: 'neutral',
};

type Reason = NonNullable<AccuracyResponse['reason']>;

const REASON_SHORT: Record<Reason, string> = {
  model_not_configured: 'checker not set up',
  platform_cap: 'platform limit reached',
  invalid_output: 'unusable checker output',
  model_error: 'checker unreachable',
  task_failed: 'check stopped',
};

const REASON_COPY: Record<Reason, string> = {
  model_not_configured: 'Fact-checking is not set up on this platform yet.',
  platform_cap: 'The platform fact-checking limit was reached for these answers.',
  invalid_output: 'The checker returned nothing usable for these answers.',
  model_error: 'The checker could not be reached for these answers.',
  task_failed: 'Checking stopped before it finished for these answers.',
};

/** The heading and sentence for a read that has no value to show. */
export function accuracyStateCopy(
  state: Exclude<AccuracyResponse['state'], 'value'>,
  reason: AccuracyResponse['reason'],
): { heading: string; description: string } {
  switch (state) {
    case 'not_enabled':
      return {
        heading: 'Fact-checking is not enabled',
        description: 'Fact-checking is in a limited pilot and is not enabled for this workspace.',
      };
    case 'no_facts':
      return {
        heading: 'No confirmed facts for these runs',
        description:
          'Confirm brand facts in Agent → Context. Runs started after that are checked against them.',
      };
    case 'no_claims':
      return {
        heading: 'No factual claims about you',
        description:
          'Answers in these runs named you without a checkable claim about pricing, plans, integrations or other facts.',
      };
    case 'pending':
      return {
        heading: 'Checking claims…',
        description: 'Claims answers made about you are being checked. Check back shortly.',
      };
    case 'unavailable':
      return {
        heading: 'Fact-checking unavailable',
        description: reason ? REASON_COPY[reason] : 'Nothing could be checked for these answers.',
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** "N of M claims with a verdict", then every other non-empty bucket. */
export function accuracyCoverageLine(coverage: AccuracyCoverage): string {
  const verdicts =
    coverage.supported + coverage.contradicted + coverage.inconclusive + coverage.not_covered;
  const parts = [`${verdicts} of ${coverage.claims} claims checked`];
  if (coverage.pending) parts.push(`${coverage.pending} pending`);
  if (coverage.low_confidence) parts.push(`${coverage.low_confidence} low confidence`);
  for (const { reason, count } of coverage.unavailable)
    parts.push(`${count} unavailable (${REASON_SHORT[reason]})`);
  if (coverage.answers_pending) parts.push(`${coverage.answers_pending} answers still being read`);
  if (coverage.answers_unavailable)
    parts.push(`${coverage.answers_unavailable} answers could not be read`);
  return parts.join(' · ');
}
