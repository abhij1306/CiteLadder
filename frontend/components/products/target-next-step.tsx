'use client';

import type { BuyerPrompt, CompetitorCandidate, Shelf } from '@citeladder/contracts/commerce-suite';

import { Alert } from '@/components/ui/alert';
import { pluralCount } from '@/lib/format';

type Inputs = Readonly<{
  kind: 'category' | 'product';
  competitors: readonly Pick<CompetitorCandidate, 'state'>[];
  prompts: readonly Pick<BuyerPrompt, 'enabled'>[];
  shelf: Pick<Shelf, 'snapshot' | 'actions'>;
}>;

/**
 * The one thing that moves this target forward, in the order the work runs:
 * find competitors, review them, write prompts, approve them, measure, act.
 *
 * Competitors come first because a measurement without them cannot say who
 * holds the rest of the shelf; they are advice, not a gate, so a measured
 * target goes straight to its Actions.
 */
export function nextStep({ kind, competitors, prompts, shelf }: Inputs): string {
  const actions = shelf.actions.length;
  if (actions)
    return `${pluralCount(actions, 'Action')} can raise this ${kind}'s visibility in AI answers. Start with the first one below.`;
  if (shelf.snapshot)
    return `No open Actions for this ${kind}. Launch the audit again after you change its pages to see the effect.`;
  const pending = competitors.filter((row) => row.state === 'pending').length;
  if (!competitors.length)
    return `Find competitors for this ${kind}, so measurement can tell who holds the rest of the shelf.`;
  if (pending) return `Review ${pluralCount(pending, 'competitor candidate')}.`;
  if (!prompts.length) return `Generate buyer prompts to measure this ${kind}.`;
  if (!prompts.some((row) => row.enabled))
    return 'Approve the buyer prompts that a real shopper would type.';
  return `Review and launch an audit to measure this ${kind}.`;
}

export function TargetNextStep(props: Inputs) {
  return (
    <Alert tone="info">
      <strong>Next step:</strong> {nextStep(props)}
    </Alert>
  );
}
