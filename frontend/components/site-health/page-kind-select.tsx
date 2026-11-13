import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { PAGE_KINDS, pageKindLabel } from '@/lib/site-health/page-kinds';

const OPTIONS = [
  { value: '', label: 'All page kinds' },
  ...PAGE_KINDS.map((pageKind) => ({ value: pageKind, label: pageKindLabel(pageKind) })),
];

/**
 * The page-kind filter (site-health v2 P1) shared by the pages inventory and
 * the issues list, as one entry of their All filters menu; its empty option
 * clears the filter (all page kinds).
 */
export function pageKindFilter({
  value,
  onChange,
}: Readonly<{ value: string; onChange: (value: string) => void }>): FilterDefinition {
  return choiceFilter({
    id: 'page_kind',
    label: 'Page kind',
    value,
    defaultValue: '',
    groups: [{ options: OPTIONS }],
    onChange,
  });
}
