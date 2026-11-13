import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';

export type PageStandingFilter = 'gap' | 'near_miss' | null;

type TypeChoice = Readonly<{
  value: string | null;
  options: readonly { token: string; label: string }[];
  onChange: (value: string | null) => void;
}>;
type StandingChoice = Readonly<{
  value: PageStandingFilter;
  onChange: (value: PageStandingFilter) => void;
}>;
type DomainChoice = Readonly<{
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
}>;

const ALL = 'all';

/**
 * The Sources table's filters, for the page's All filters menu, in the order
 * they keep: type first, then the two that only mean something for pages
 * (standing, and the publisher, which the Domains view and a domain's own page
 * do not offer).
 *
 * A filter with one option is nothing to choose between and is not listed --
 * unless it is already filtering, where removing it would strand the reader
 * with no way back to "All".
 */
export function sourceTableFilters({
  dimension,
  type,
  standing,
  domain,
}: Readonly<{
  dimension: 'domain' | 'url';
  type: TypeChoice;
  standing: StandingChoice;
  /** Absent where the publisher is fixed or meaningless. */
  domain: DomainChoice | null;
}>): FilterDefinition[] {
  const urls = dimension === 'url';
  const filters: FilterDefinition[] = [];
  if (type.options.length >= 2 || type.value) filters.push(typeFilter(urls, type));
  if (urls) filters.push(standingFilter(standing));
  if (urls && domain && (domain.options.length >= 2 || domain.value))
    filters.push(domainFilter(domain));
  return filters;
}

/** Narrows the table to one domain type, or one URL type. */
function typeFilter(urls: boolean, { value, options, onChange }: TypeChoice): FilterDefinition {
  return choiceFilter({
    id: 'source-type',
    label: urls ? 'URL type' : 'Domain type',
    value: value ?? ALL,
    defaultValue: ALL,
    groups: [
      {
        options: [
          { value: ALL, label: urls ? 'All URL types' : 'All domain types' },
          ...options.map((option) => ({ value: option.token, label: option.label })),
        ],
      },
    ],
    onChange: (next) => onChange(next === ALL ? null : next),
  });
}

/**
 * Narrows the URL table to gaps -- pages whose latest reading lists a tracked
 * competitor and not you; a page nobody has read is never a gap -- or to your
 * own pages an engine read and still did not cite.
 */
function standingFilter({ value, onChange }: StandingChoice): FilterDefinition {
  return choiceFilter<'all' | 'gap' | 'near_miss'>({
    id: 'source-standing',
    label: 'Standing',
    value: value ?? ALL,
    defaultValue: ALL,
    groups: [
      {
        options: [
          { value: ALL, label: 'All pages' },
          { value: 'gap', label: 'Gaps: competitors listed, not you' },
          { value: 'near_miss', label: 'Your pages read but not cited' },
        ],
      },
    ],
    onChange: (next) => onChange(next === ALL ? null : next),
  });
}

/** Narrows every table on the tab to one publisher. */
function domainFilter({ value, options, onChange }: DomainChoice): FilterDefinition {
  return choiceFilter({
    id: 'source-domain',
    label: 'Domain',
    value: value ?? ALL,
    defaultValue: ALL,
    groups: [
      {
        options: [
          { value: ALL, label: 'All domains' },
          ...options.map((entry) => ({ value: entry, label: entry })),
        ],
      },
    ],
    onChange: (next) => onChange(next === ALL ? null : next),
  });
}
