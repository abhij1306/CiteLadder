import type {
  PerceptionCoverage,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

import { StateBlock } from '@/components/ui/state-block';
import { MessageSquareQuote } from '@/lib/icons';
import { coverageLine, stateCopy } from '@/lib/visibility/perception';

export function PerceptionState({
  state,
  reason,
  coverage,
}: Readonly<{
  state: Exclude<PerceptionResponse['state'], 'value'>;
  reason: PerceptionResponse['reason'];
  coverage?: PerceptionCoverage;
}>) {
  const copy = stateCopy(state, reason);
  const counted = coverage?.mentions ? coverageLine(coverage) : null;
  return (
    <StateBlock
      kind="empty"
      headingLevel={3}
      icon={MessageSquareQuote}
      heading={copy.heading}
      description={[copy.description, counted].filter(Boolean).join(' · ') || undefined}
    />
  );
}
