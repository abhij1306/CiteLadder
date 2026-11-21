import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { COMMERCE_TARGETS_MAX } from '@citeladder/contracts/commerce-suite';
import { X } from '@/lib/icons';
import { humanizeApiError } from '@/lib/api/errors';
import { Section } from '@/components/ui/section';

export function BulkActions({
  count,
  pending,
  error,
  onDiscover,
  onClear,
}: Readonly<{
  count: number;
  pending: boolean;
  error: unknown;
  onDiscover: () => void;
  onClear: () => void;
}>) {
  const noun = count === 1 ? 'product' : 'products';
  const tooMany = count > COMMERCE_TARGETS_MAX;
  const hint = tooMany ? `Up to ${COMMERCE_TARGETS_MAX} products at a time` : null;
  return (
    <Section>
      <Inline gap="compact" className="flex-wrap justify-between">
        <Stack gap="tight">
          <span aria-live="polite" className={textRole('body')}>
            {count ? `${count} ${noun} selected` : 'No products selected'}
          </span>
          {hint ? <span className="type-caption">{hint}</span> : null}
          {error ? (
            <span role="alert" className="type-caption text-negative">
              {humanizeApiError(error, 'Competitor discovery could not start.').message}
            </span>
          ) : null}
        </Stack>
        <Inline className="flex-wrap">
          <Button
            variant="secondary"
            disabled={!count || tooMany}
            pending={pending}
            pendingLabel="Finding…"
            onClick={onDiscover}
          >
            Find competitors
          </Button>
          <Button variant="quiet" disabled={pending} onClick={onClear}>
            <Icon icon={X} />
            Clear selection
          </Button>
        </Inline>
      </Inline>
    </Section>
  );
}
