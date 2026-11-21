import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { PAGE_KINDS, pageKindLabel } from '@/lib/site-health/page-kinds';

const OPTIONS = [
  { value: '', label: 'All page kinds' },
  ...PAGE_KINDS.map((pageKind) => ({ value: pageKind, label: pageKindLabel(pageKind) })),
];

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
