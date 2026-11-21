import type {
  AccuracyClaim,
  AccuracyCoverage,
  AccuracyResponse,
  ClaimVerdict,
  FactTopic,
} from '@citeladder/contracts/fact-checking';

import type { SentimentValue } from '@/components/ui/status-mark';

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
  model_omitted: 'left out by the checker',
  model_changed: 'checker model changed',
};

const REASON_COPY: Record<Reason, string> = {
  model_not_configured: 'Fact-checking is not set up on this platform yet.',
  platform_cap: 'The platform fact-checking limit was reached for these answers.',
  invalid_output: 'The checker returned nothing usable for these answers.',
  model_error: 'The checker could not be reached for these answers.',
  task_failed: 'Checking stopped before it finished for these answers.',
  model_omitted: 'The checker left these claims out of its answer.',
  model_changed: 'The checker model changed after these runs started, so they were not checked.',
};

export function accuracyStateCopy(
  state: Exclude<AccuracyResponse['state'], 'value'>,
  reason: AccuracyResponse['reason'],
): { heading: string; description: string | null } {
  switch (state) {
    case 'not_enabled':
      return { heading: 'Fact-checking is not enabled', description: 'Limited pilot.' };
    case 'no_facts':
      return { heading: 'No confirmed facts for these runs', description: null };
    case 'no_claims':
      return { heading: 'No factual claims about you', description: null };
    case 'pending':
      return { heading: 'Checking claims…', description: null };
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

function claimStateWords(claim: Pick<AccuracyClaim, 'status' | 'verdict' | 'reason'>): string {
  switch (claim.status) {
    case 'verdict':
      return claim.verdict ? VERDICT_LABELS[claim.verdict].toLowerCase() : 'not checked';
    case 'low_confidence':
      return 'low confidence';
    case 'pending':
      return 'still being checked';
    case 'unavailable':
      return claim.reason ? `unavailable (${REASON_SHORT[claim.reason]})` : 'unavailable';
    default: {
      const _exhaustive: never = claim.status;
      return _exhaustive;
    }
  }
}

export function claimAgentPrompt(claim: AccuracyClaim, engine: string): string {
  const facts = claim.facts.map((fact) => fact.statement).join('; ');
  const verdict = claimStateWords(claim);
  return [
    agentAsk(claim, engine),
    `Asked "${claim.prompt}", it said: "${claim.quote}" (claim: ${claim.claim}).`,
    facts ? `Checked against our fact: "${facts}". Verdict: ${verdict}.` : `Verdict: ${verdict}.`,
  ].join(' ');
}

function agentAsk(claim: Pick<AccuracyClaim, 'status' | 'verdict'>, engine: string): string {
  const verdict = claim.status === 'verdict' ? claim.verdict : null;
  if (verdict === 'contradicted') return `Help me correct what ${engine} says about us.`;
  if (verdict === 'supported')
    return `Help me keep what ${engine} gets right about us accurate where it reads.`;
  return `Help me check what ${engine} says about us.`;
}

export function contradictedChange(
  data: Pick<AccuracyResponse, 'source_audit_ids' | 'trend'>,
): number | null {
  const [latest, previous] = [data.trend.at(-1), data.trend.at(-2)];
  if (!latest || !previous || !latest.comparable) return null;
  if (data.source_audit_ids.length !== 1 || data.source_audit_ids[0] !== latest.audit_id)
    return null;
  return latest.score.coverage.contradicted - previous.score.coverage.contradicted;
}

export function accuracyCoverageLine(coverage: AccuracyCoverage): string {
  const verdicts =
    coverage.supported + coverage.contradicted + coverage.inconclusive + coverage.not_covered;
  return [
    `${verdicts} of ${coverage.claims} claims checked`,
    ...accuracyCoverageExtras(coverage),
  ].join(' · ');
}

export function accuracyCoverageExtras(coverage: AccuracyCoverage): string[] {
  const parts: string[] = [];
  if (coverage.pending) parts.push(`${coverage.pending} pending`);
  if (coverage.low_confidence) parts.push(`${coverage.low_confidence} low confidence`);
  for (const { reason, count } of coverage.unavailable)
    parts.push(`${count} unavailable (${REASON_SHORT[reason]})`);
  if (coverage.answers_pending) parts.push(`${coverage.answers_pending} answers still being read`);
  if (coverage.answers_unavailable)
    parts.push(`${coverage.answers_unavailable} answers could not be read`);
  return parts;
}
