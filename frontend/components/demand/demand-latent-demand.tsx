import { Zap } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { DemandSnapshot } from '@/lib/api/demand';
import { isActionableGap, numericMetric } from '@/lib/demand/signals';
import { formatCount } from '@/lib/format';

/**
 * Latent demand: impressions across every non-branded (actionable) signal,
 * the one figure the per-type counts on the filters do not already give.
 * With no such signal the sum is a true zero; when none reported impressions
 * it was not measured, which is not zero; and when only some did, the text
 * says the sum covers those signals rather than passing it off as the whole.
 */
export function DemandLatentDemand({ snapshot }: Readonly<{ snapshot: DemandSnapshot }>) {
  const observed = snapshot.signals
    .filter(isActionableGap)
    .map((signal) => numericMetric(signal, 'impressions'));
  const known = observed.filter((value): value is number => value !== null);
  const partial = known.length > 0 && known.length < observed.length;
  return (
    <Inline as="span" gap="tight" className="type-caption">
      <Icon icon={Zap} />
      {observed.length > 0 && known.length === 0 ? (
        <>
          <UnavailableValue state="not_measured" /> latent demand
        </>
      ) : (
        <>
          <span className="text-foreground tabular-nums">
            {formatCount(known.reduce((sum, value) => sum + value, 0))}
          </span>
          {partial
            ? ` impressions on ${formatCount(known.length)} of ${formatCount(observed.length)} non-branded signals`
            : ' impressions on non-branded signals'}
        </>
      )}
    </Inline>
  );
}
