import { Button } from '@/components/ui/button';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { SearchField } from '@/components/ui/search-field';
import { Download } from '@/lib/icons';
import { downloadCsv } from '@/lib/csv/download';
import { standingLabel } from '@/lib/visibility/source-pages';
import { typeLabel, type SourceItem } from '@/lib/visibility/sources';

const DOMAIN_HEADERS = [
  'Domain',
  'Domain type',
  'Cited in',
  'Retrieved',
  'Pages cited',
  'Citations',
  'Citation share',
  'Citation rate',
] as const;

const URL_HEADERS = [
  'URL',
  'Page title',
  'URL type',
  'On the page',
  'Cited in',
  'Retrieved',
  'Citation rate',
  'Citations',
  'Mentions',
  'Mentioned',
  'Last seen',
] as const;

export function sourceTableToolbar({
  dimension,
  search,
  onSearch,
  rows,
  domain,
}: Readonly<{
  dimension: 'domain' | 'url';
  search: string;
  onSearch: (value: string) => void;
  rows: readonly SourceItem[];
  domain: string | null;
}>): FilterBarProps {
  const onExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = domain ? `${domain}-` : '';
    if (dimension === 'url') {
      downloadCsv(
        `citeladder-sources-${scope}urls-${stamp}`,
        URL_HEADERS,
        rows.map((row) => [
          row.key,
          row.title ?? '',
          typeLabel(row.page_format, 'url') ?? '',
          standingLabel(row.standing),
          row.responses,
          row.retrieved ?? '',
          row.citation_rate,
          row.annotations,
          row.mentions,
          row.brands.map((brand) => brand.name).join(' | '),
          row.last_cited_at ?? '',
        ]),
      );
      return;
    }
    downloadCsv(
      `citeladder-sources-domains-${stamp}`,
      DOMAIN_HEADERS,
      rows.map((row) => [
        row.key,
        typeLabel(row.categories.length === 1 ? row.categories[0] : null, 'domain') ?? '',
        row.response_rate,
        row.retrieved ?? '',
        row.retrieval_rate,
        row.annotations,
        row.citation_share,
        row.citation_rate,
      ]),
    );
  };

  return {
    search: (
      <SearchField
        value={search}
        onValueChange={onSearch}
        onClear={() => onSearch('')}
        placeholder="Search"
        aria-label={dimension === 'url' ? 'Search URLs' : 'Search domains'}
      />
    ),
    actions: (
      <Button variant="secondary" onClick={onExport} disabled={rows.length === 0}>
        <Icon icon={Download} />
        Export
      </Button>
    ),
  };
}
