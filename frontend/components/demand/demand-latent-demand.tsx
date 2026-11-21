import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { InlineFigure } from '@/components/ui/typography';
import { Absence } from '@/components/ui/absence';
import { Zap } from '@/lib/icons';
import type { DemandSnapshot } from '@/lib/api/demand';
import { isActionableGap, numericMetric } from '@/lib/demand/signals';
import { formatCount } from '@/lib/format';

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
          <Absence state="not_measured" /> latent demand
        </>
      ) : (
        <>
          <InlineFigure className="text-ink">
            {formatCount(known.reduce((sum, value) => sum + value, 0))}
          </InlineFigure>
          {partial ? (
            <>
              {' impressions on '}
              <InlineFigure>{formatCount(known.length)}</InlineFigure>
              {' of '}
              <InlineFigure>{formatCount(observed.length)}</InlineFigure>
              {' non-branded signals'}
            </>
          ) : (
            ' impressions on non-branded signals'
          )}
        </>
      )}
    </Inline>
  );
}
