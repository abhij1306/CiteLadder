import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { COMPARISON_DATASET_KINDS, SEARCH_DATASET_LABELS } from '@/lib/config/search-intelligence';
import { datasetCount } from './search-intelligence-format';
import { SearchValue } from './search-intelligence-value';

// A reviewed canonical host may be www while saved competitor identities use apex domains.
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
  return (
    <Card className="min-w-0">
      <CardHeader bordered>
        <CardTitle>Competitive footprint</CardTitle>
      </CardHeader>
      <CardContent flush>
        <Table minWidth="md">
          <TableHeader>
            <TableRow>
              <TableHead>Competitor</TableHead>
              <TableHead numeric>Organic keywords</TableHead>
              <TableHead numeric>Est. monthly traffic</TableHead>
              <TableHead numeric>Missing keywords</TableHead>
              <TableHead numeric>Shared keywords</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitors.map((competitor) => {
              const footprint = datasets.find(
                (item) =>
                  item.dataset_kind === 'footprint' &&
                  matchesCompetitor(item.target_origin, competitor.registrable_domain),
              );
              const comparison = (kind: string) =>
                datasets.find(
                  (item) =>
                    item.dataset_kind === kind &&
                    matchesCompetitor(item.comparison_origin, competitor.registrable_domain),
                );
              return (
                <TableRow key={competitor.identity}>
                  <TableCell>
                    <div className="grid max-w-sm min-w-0">
                      <ClampText lines={1} className={textRole('itemTitle')}>
                        {competitor.label}
                      </ClampText>
                      <ClampText lines={1} className={textRole('caption')}>
                        {footprint?.target_hostname ?? competitor.hostname}
                      </ClampText>
                    </div>
                  </TableCell>
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
                  {COMPARISON_DATASET_KINDS.map((kind) => {
                    const dataset = comparison(kind);
                    return (
                      <TableCell numeric key={kind}>
                        {dataset ? (
                          <TextLink asChild text="inherit">
                            <Pressable
                              className="w-auto text-center"
                              aria-label={`${competitor.label}: ${SEARCH_DATASET_LABELS[kind]}`}
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
          </TableBody>
        </Table>
        {!competitors.length ? (
          <InlineEmpty className="p-4">No competitors saved for this project.</InlineEmpty>
        ) : null}
      </CardContent>
    </Card>
  );
}
