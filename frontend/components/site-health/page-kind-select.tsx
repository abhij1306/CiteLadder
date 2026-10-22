'use client';

import { FilterChoice } from '@/components/ui/filter-bar';
import { PAGE_KINDS, pageKindLabel } from '@/lib/site-health/page-kinds';

const OPTIONS = [
  { value: '', label: 'All page kinds' },
  ...PAGE_KINDS.map((pageKind) => ({ value: pageKind, label: pageKindLabel(pageKind) })),
];

/**
 * The page-kind filter (site-health v2 P1) shared by the pages inventory and
 * the issues list: the shared single-choice filter trigger, whose empty
 * option clears the filter (all page kinds).
 */
export function PageKindSelect({
  value,
  onChange,
}: Readonly<{ value: string; onChange: (value: string) => void }>) {
  return (
    <FilterChoice
      label="Filter by page kind"
      menuLabel="Page kind"
      value={value}
      defaultValue=""
      options={OPTIONS}
      onChange={onChange}
    />
  );
}
