'use client';

import type { ExecutionClaim } from '@citeladder/contracts/fact-checking';

import { Badge } from '@/components/ui/badge';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Label, textRole } from '@/components/ui/typography';
import type { Highlight } from '@/lib/markdown/highlight';
import { TOPIC_LABELS, VERDICT_LABELS, VERDICT_TONE } from '@/lib/visibility/accuracy';

/** Supported and contradicted claims, to mark in the rendered answer. */
export function claimHighlights(claims: readonly ExecutionClaim[]): Highlight[] {
  return claims.flatMap((claim): Highlight[] => {
    if (claim.verdict === 'supported') return [{ text: claim.quote, tone: 'positive' }];
    if (claim.verdict === 'contradicted') return [{ text: claim.quote, tone: 'negative' }];
    return [];
  });
}

const STATE_WORDS: Record<Exclude<ExecutionClaim['status'], 'verdict'>, string> = {
  low_confidence: 'Low confidence',
  pending: 'Checking…',
  unavailable: 'Unavailable',
};

function VerdictChip({ claim }: Readonly<{ claim: ExecutionClaim }>) {
  if (claim.status === 'verdict' && claim.verdict)
    return (
      <Badge variant="sentiment" value={VERDICT_TONE[claim.verdict]}>
        {VERDICT_LABELS[claim.verdict]}
      </Badge>
    );
  return <Badge>{claim.status === 'verdict' ? 'Unchecked' : STATE_WORDS[claim.status]}</Badge>;
}

/** The factual claims this answer made about the brand, with the facts behind each verdict. */
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
            className={panelClasses({ tone: 'well' }, 'min-w-0')}
          >
            <Inline as="span" className="flex-wrap">
              <span className={textRole('emphasis')}>“{claim.quote}”</span>
              <VerdictChip claim={claim} />
            </Inline>
            <span className="type-caption text-secondary">
              {TOPIC_LABELS[claim.topic]}: {claim.claim}
            </span>
            {claim.facts.map((fact) => (
              <span key={fact.statement} className="type-caption text-secondary">
                Your fact: {fact.statement}
              </span>
            ))}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
