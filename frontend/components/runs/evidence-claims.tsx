import type { ExecutionClaim } from '@citeladder/contracts/fact-checking';

import { Absence } from '@/components/ui/absence';
import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { Inline, Stack } from '@/components/ui/layout';
import { Label, textRole } from '@/components/ui/typography';
import type { Highlight } from '@/lib/markdown/highlight';
import { TOPIC_LABELS, VERDICT_LABELS, VERDICT_TONE } from '@/lib/visibility/accuracy';
import { wellClasses } from '@/components/ui/slip';

export function claimHighlights(claims: readonly ExecutionClaim[]): Highlight[] {
  return claims.flatMap((claim): Highlight[] => {
    if (claim.verdict === 'supported') return [{ text: claim.quote, tone: 'positive' }];
    if (claim.verdict === 'contradicted') return [{ text: claim.quote, tone: 'negative' }];
    return [];
  });
}

const STATE_WORDS: Record<Exclude<ExecutionClaim['status'], 'verdict' | 'unavailable'>, string> = {
  low_confidence: 'Low confidence',
  pending: 'Checking…',
};

export function VerdictChip({
  claim,
}: Readonly<{ claim: Pick<ExecutionClaim, 'status' | 'verdict'> }>) {
  if (claim.status === 'verdict' && claim.verdict)
    return (
      <StatusMark variant="sentiment" value={VERDICT_TONE[claim.verdict]}>
        {VERDICT_LABELS[claim.verdict]}
      </StatusMark>
    );
  if (claim.status === 'unavailable') return <Absence state="unavailable" />;
  return <Tag>{claim.status === 'verdict' ? 'Unchecked' : STATE_WORDS[claim.status]}</Tag>;
}

export function EvidenceClaims({ claims }: Readonly<{ claims: readonly ExecutionClaim[] }>) {
  if (!claims.length) return null;
  return (
    <Stack as="section" gap="item">
      <Label>Fact checks</Label>
      <Stack as="ul" gap="item">
        {claims.map((claim) => (
          <Stack
            as="li"
            gap="tight"
            key={`${claim.start}:${claim.end}:${claim.topic}`}
            className={wellClasses('min-w-0')}
          >
            <Inline as="span" className="flex-wrap">
              <span className={textRole('emphasis')}>“{claim.quote}”</span>
              <VerdictChip claim={claim} />
            </Inline>
            <span className="type-caption text-ink-2">
              {TOPIC_LABELS[claim.topic]}: {claim.claim}
            </span>
            {claim.facts.map((fact) => (
              <span key={fact.statement} className="type-caption text-ink-2">
                Your fact: {fact.statement}
              </span>
            ))}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
