import { BrandMark } from '@/components/ui/brand-mark';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { searchDatasetKindsWith } from '@citeladder/contracts/search-intelligence';
import { Users } from '@/lib/icons';
import { SEARCH_DATASET_LABELS } from '@/lib/config/search-intelligence';

const COMPARISON_KINDS = searchDatasetKindsWith('comparison');
import { datasetCount } from './search-intelligence-format';
import { SearchValue } from './search-intelligence-value';

export function matchesCompetitor(origin: string, domain: string): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === domain || host === `www.${domain}`;
  } catch {
    return false;
  }
}

export function SearchIntelligenceCompetitors({
  datasets,
  competitors,
  onOpen,
}: Readonly<{
  datasets: SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  onOpen: (dataset: SearchIntelligenceDataset) => void;
}>) {
  const rows = competitors.map((competitor) => {
    const footprint = datasets.find(
      (item) =>
        item.dataset_kind === 'footprint' &&
        matchesCompetitor(item.target_origin, competitor.registrable_domain),
    );
    const comparisons = new Map(
      COMPARISON_KINDS.map((kind) => [
        kind,
        datasets.find(
          (item) =>
            item.dataset_kind === kind &&
            matchesCompetitor(item.comparison_origin, competitor.registrable_domain),
        ),
      ]),
    );
    const fetched = Boolean(footprint) || [...comparisons.values()].some(Boolean);
    return { competitor, footprint, comparisons, fetched };
  });
  const noneFetched = rows.length > 0 && !rows.some((row) => row.fetched);
  return (
    <DataTable
      title="Competitive footprint"
      description={noneFetched ? 'Competitive footprint not fetched yet' : undefined}
      columns={noneFetched ? COMPETITOR_COLUMNS.slice(0, 1) : COMPETITOR_COLUMNS}
      state={
        competitors.length
          ? undefined
          : {
              kind: 'empty',
              icon: Users,
              heading: 'No competitors saved for this project',
            }
      }
    >
      {rows.map(({ competitor, footprint, comparisons, fetched }) => {
        const identity = (
          <TableCell>
            <Inline as="span">
              <BrandMark name={competitor.label} websiteUrl={competitor.hostname} />
              <TableCellLines
                title
                primary={competitor.label}
                secondary={footprint?.target_hostname ?? competitor.hostname}
              />
            </Inline>
          </TableCell>
        );
        if (noneFetched) return <TableRow key={competitor.identity}>{identity}</TableRow>;
        if (!fetched)
          return (
            <TableRow key={competitor.identity}>
              {identity}
              {FIGURE_KEYS.map((key) => (
                <TableCell numeric key={key}>
                  <SearchValue value={null} fetched={false} />
                </TableCell>
              ))}
            </TableRow>
          );
        return (
          <TableRow key={competitor.identity}>
            {identity}
            <TableCell numeric>
              <SearchValue
                value={footprint?.summary.organic_keywords}
                fetched={Boolean(footprint)}
              />
            </TableCell>
            <TableCell numeric>
              <SearchValue
                value={footprint?.summary.estimated_monthly_traffic}
                fetched={Boolean(footprint)}
              />
            </TableCell>
            {COMPARISON_KINDS.map((kind) => {
              const dataset = comparisons.get(kind);
              return (
                <TableCell numeric key={kind}>
                  {dataset ? (
                    <TextLink asChild text="body">
                      <Pressable
                        className="min-h-6 w-auto min-w-6 text-center"
                        aria-label={`${datasetCount(dataset)} ${SEARCH_DATASET_LABELS[kind]}: ${competitor.label}`}
                        onClick={() => onOpen(dataset)}
                      >
                        {datasetCount(dataset)}
                      </Pressable>
                    </TextLink>
                  ) : (
                    <SearchValue value={null} fetched={false} />
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        );
      })}
    </DataTable>
  );
}

const COMPETITOR_COLUMNS: readonly DataTableColumn[] = [
  { key: 'competitor', label: 'Competitor', kind: 'identity' },
  { key: 'organic', label: 'Organic keywords', kind: 'number' },
  { key: 'traffic', label: 'Est. monthly traffic', kind: 'number', priority: 'low' },
  { key: 'missing', label: 'Missing keywords', kind: 'number' },
  { key: 'shared', label: 'Shared keywords', kind: 'number' },
];

const FIGURE_KEYS = COMPETITOR_COLUMNS.slice(1).map((column) => column.key);
