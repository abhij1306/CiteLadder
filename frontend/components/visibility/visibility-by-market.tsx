'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import type { ProjectMarket } from '@citeladder/contracts/markets';
import type { VisibilityMarkets } from '@citeladder/contracts/visibility';

import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Delta } from '@/components/ui/delta';
import { readErrorProps } from '@/components/ui/read-error';
import { TableCell, TableRow } from '@/components/ui/table';
import { MissingValue, UnavailableValue } from '@/components/ui/unavailable-value';
import { formatRate, measured } from '@/lib/visibility/dashboard';
import { formatNet } from '@/lib/visibility/perception';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'market', label: 'Market' },
  { key: 'mention', label: 'Mention rate', width: 'figure', numeric: true },
  { key: 'mention-change', label: 'Change', width: 'figure', numeric: true },
  { key: 'voice', label: 'Share of voice', width: 'figure', numeric: true },
  { key: 'voice-change', label: 'Change', width: 'figure', numeric: true },
  { key: 'net', label: 'Net sentiment', width: 'figure', numeric: true },
];

function marketsState(query: UseQueryResult<VisibilityMarkets>): DataTableState | undefined {
  if (query.isError)
    return { kind: 'error', ...readErrorProps(query), fallback: 'Could not load the markets.' };
  if (query.isPending) return { kind: 'loading', label: 'Loading markets…' };
  return undefined;
}

/**
 * Each market's latest run side by side. Markets are measured apart and never
 * pooled; a market without a run reads "Not run", never zero.
 */
export function VisibilityByMarket({
  query,
  markets,
  market,
  onSelectMarket,
}: Readonly<{
  query: UseQueryResult<VisibilityMarkets>;
  markets: readonly ProjectMarket[];
  market: string | null;
  onSelectMarket: (market: string | null) => void;
}>) {
  if (markets.length < 2) return null;
  return (
    <DataTable
      title="By market"
      columns={COLUMNS}
      footer="Each market's latest run, with the change since its previous comparable run."
      state={marketsState(query)}
    >
      {(query.data?.markets ?? []).map((row) => (
        <TableRow key={row.market.id ?? 'default'}>
          <TableCell>
            <Button
              variant="ghost"
              aria-current={row.market.id === market ? 'true' : undefined}
              onClick={() => onSelectMarket(row.market.id)}
            >
              {row.market.label}
            </Button>
          </TableCell>
          {row.state === 'no_run' ? (
            <TableCell numeric colSpan={5}>
              <UnavailableValue state="not_run" />
            </TableCell>
          ) : (
            <>
              <TableCell numeric>
                {measured(formatRate(row.mention_rate)) ?? <MissingValue />}
              </TableCell>
              <TableCell numeric>
                <Delta
                  value={row.mention_rate_delta}
                  unit=" pp"
                  missingReason="No comparable earlier run"
                />
              </TableCell>
              <TableCell numeric>
                {measured(formatRate(row.share_of_voice)) ?? <MissingValue />}
              </TableCell>
              <TableCell numeric>
                <Delta
                  value={row.share_of_voice_delta}
                  unit=" pp"
                  missingReason="No comparable earlier run"
                />
              </TableCell>
              <TableCell numeric>
                {formatNet(row.net_sentiment) ?? <MissingValue reason="No classified mentions" />}
              </TableCell>
            </>
          )}
        </TableRow>
      ))}
    </DataTable>
  );
}
