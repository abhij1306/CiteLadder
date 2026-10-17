'use client';

import { Badge } from '@/components/ui/badge';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { pageKindLabel } from '@/lib/site-health/page-kinds';

/**
 * The page-kind chip (site-health v2 P1) rendered on page rows (pages +
 * inventory), affected-URL rows, and the per-URL detail header. Reuses the
 * design-system neutral `Badge` — no new colour family. An unclassified page
 * (no completed analysis yet, or a projection that does not carry the field)
 * renders the `Not measured` placeholder, never a guessed type.
 *
 * `className` exists so a table can tune layout without creating a second
 * page-kind treatment; the shared badge owns the 12px compact label size.
 */
export function PageKindBadge({
  pageKind,
  className,
}: Readonly<{ pageKind: string | null | undefined; className?: string }>) {
  if (!pageKind) {
    return <UnavailableValue state="not_measured" className={className} />;
  }
  return <Badge className={className}>{pageKindLabel(pageKind)}</Badge>;
}
