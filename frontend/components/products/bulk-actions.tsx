import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { COMMERCE_TARGETS_MAX } from '@citeladder/contracts/commerce-suite';
import { humanizeApiError } from '@/lib/api/errors';

/** Selection-only bulk actions for the checked catalog products. */
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
  let hint = 'Check products to use bulk actions.';
  if (tooMany)
    hint = `Competitors can be found for up to ${COMMERCE_TARGETS_MAX} products at a time.`;
  else if (count) hint = 'Find competitors for every checked product.';
  return (
    <Card>
      <Inline gap="compact" className="flex-wrap justify-between">
        <Stack gap="tight">
          <span aria-live="polite" className={textRole('itemTitle')}>
            {count ? `${count} ${noun} selected` : 'No products selected'}
          </span>
          <span className="type-caption">{hint}</span>
          {error ? (
            <span role="alert" className="type-caption text-negative">
              {humanizeApiError(error, 'Competitor discovery could not start.').message}
            </span>
          ) : null}
        </Stack>
        <Inline className="flex-wrap">
          <Button
            variant="primary"
            disabled={!count || tooMany}
            pending={pending}
            pendingLabel="Finding…"
            onClick={onDiscover}
          >
            Find competitors
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onClear}>
            Clear selection
          </Button>
        </Inline>
      </Inline>
    </Card>
  );
}
