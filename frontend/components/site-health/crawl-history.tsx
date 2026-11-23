import type { SiteCrawl } from '@citeladder/contracts';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Pressable } from '@/components/ui/pressable';
import { TableCell, TableRow, TableTime } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { absent, formatCount, formatScore } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';

export function CrawlHistory({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const [pinnedCrawlId, setPinnedCrawlId] = useUrlState('crawl_id', optionalStringUrlCodec);
  const { page, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: null,
    query: (request) => siteHealthQueries.crawls({ workspaceId, projectId }, request),
    noun: 'crawls',
    loading: 'Loading crawls…',
    subject: 'the crawls',
    empty: () => ({ kind: 'empty', icon: ICONS.issues, headingLevel: 3, heading: 'No crawls yet' }),
  });
  return (
    <DataTable label="Crawls" columns={COLUMNS} {...table}>
      {page?.items.map((crawl) => (
        <CrawlRow
          key={crawl.id}
          crawl={crawl}
          viewing={crawl.id === pinnedCrawlId}
          onView={() => setPinnedCrawlId(crawl.id)}
        />
      ))}
    </DataTable>
  );
}

function CrawlRow({
  crawl,
  viewing,
  onView,
}: Readonly<{ crawl: SiteCrawl; viewing: boolean; onView: () => void }>) {
  const summary = crawl.score_summary;
  return (
    <TableRow onClick={onView} className="cursor-pointer" aria-current={viewing || undefined}>
      <TableCell>
        <TextLink asChild underline="hover">
          <Pressable
            onClick={(event) => {
              event.stopPropagation();
              onView();
            }}
            className="min-h-6 w-auto min-w-0"
          >
            <TableTime value={crawl.started_at ?? crawl.created_at} />
          </Pressable>
        </TextLink>
      </TableCell>
      <TableCell>
        <CrawlStatusBadge crawl={crawl} />
      </TableCell>
      <TableCell numeric>{formatCount(crawl.analyzed_count)}</TableCell>
      <TableCell numeric>{summary ? formatCount(summary.issue_count) : absent()}</TableCell>
      <TableCell numeric>{formatScore(summary?.web_fundamentals_score ?? null)}</TableCell>
      <TableCell numeric>{formatScore(summary?.aeo_readiness_score ?? null)}</TableCell>
    </TableRow>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'pages', label: 'Pages audited', kind: 'number', width: 'metric' },
  { key: 'issues', label: 'Issues', kind: 'number', width: 'metric' },
  { key: 'web', label: 'Web fundamentals', kind: 'number', width: 'metric' },
  { key: 'aeo', label: 'AEO readiness', kind: 'number', width: 'metric' },
];
