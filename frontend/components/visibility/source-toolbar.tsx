'use client';

import type { ReactNode } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CardHeader } from '@/components/ui/card';
import { FilterRow } from '@/components/ui/filter-row';
import { SearchField } from '@/components/ui/search-field';
import { downloadCsv } from '@/lib/csv/download';
import { standingLabel } from '@/lib/visibility/source-pages';
import { typeLabel, type SourceItem } from '@/lib/visibility/sources';

const DOMAIN_HEADERS = [
  'Domain',
  'Domain type',
  'Cited in',
  'Retrieved in',
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
  'Retrieved in',
  'Citation rate',
  'Citations',
  'Mentions',
  'Mentioned',
  'Last seen',
] as const;

/**
 * Search, the type filter and export, above whichever table is showing.
 *
 * Export writes the rows AS SHOWN — after the filter, the search and the sort.
 * Widening it to the unfiltered set would hand back a different answer from the
 * one on screen, and a reader who had narrowed to one type would have no way to
 * tell until they opened the file.
 */
export function SourceTableToolbar({
  dimension,
  search,
  onSearch,
  rows,
  domain,
  typeControl,
  domainControl,
}: Readonly<{
  dimension: 'domain' | 'url';
  search: string;
  onSearch: (value: string) => void;
  rows: readonly SourceItem[];
  domain: string | null;
  typeControl: ReactNode;
  /** Narrows the URL table to one publisher, above the URL column. */
  domainControl?: ReactNode;
}>) {
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

  return (
    <CardHeader>
      <FilterRow
        search={
          <SearchField
            value={search}
            onValueChange={onSearch}
            onClear={() => onSearch('')}
            placeholder="Search"
            aria-label={dimension === 'url' ? 'Search URLs' : 'Search domains'}
          />
        }
        searchWidth="sm"
        actions={
          <Button variant="secondary" size="sm" onClick={onExport} disabled={rows.length === 0}>
            <Download className="size-3.5" aria-hidden />
            Export
          </Button>
        }
      >
        {domainControl}
        {typeControl}
      </FilterRow>
    </CardHeader>
  );
}
