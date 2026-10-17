import type { AdOwnership } from '@citeladder/contracts/visibility-ads';

import { Badge } from '@/components/ui/badge';
import { AD_OWNERSHIP } from '@/lib/visibility/ads';

/** Whose ad it is: you, a tracked competitor or another business. */
export function AdOwnershipChip({ ownership }: Readonly<{ ownership: AdOwnership }>) {
  const chip = AD_OWNERSHIP[ownership];
  return (
    <Badge variant="classification" value={chip.badge}>
      {chip.label}
    </Badge>
  );
}
