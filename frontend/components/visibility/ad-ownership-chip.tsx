import type { AdOwnership } from '@citeladder/contracts/visibility-ads';

import { StatusMark } from '@/components/ui/status-mark';
import { AD_OWNERSHIP } from '@/lib/visibility/ads';

export function AdOwnershipChip({ ownership }: Readonly<{ ownership: AdOwnership }>) {
  const chip = AD_OWNERSHIP[ownership];
  return (
    <StatusMark variant="classification" value={chip.badge}>
      {chip.label}
    </StatusMark>
  );
}
