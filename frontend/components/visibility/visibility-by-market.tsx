'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import type { ProjectMarket } from '@citeladder/contracts/markets';
import type { VisibilityMarkets } from '@citeladder/contracts/visibility';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MissingValue, UnavailableValue } from '@/components/ui/unavailable-value';
import { formatRate, measured } from '@/lib/visibility/dashboard';
import { formatNet } from '@/lib/visibility/perception';

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
    <Card>
      <CardHeader>
        <CardTitle>By market</CardTitle>
        <CardDescription>
          Each market&apos;s latest run, with the change since its previous comparable run.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {query.isError ? (
          <ReadError {...readErrorProps(query)} fallback="Could not load the markets." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead numeric>Mention rate</TableHead>
                <TableHead numeric>Change</TableHead>
                <TableHead numeric>Share of voice</TableHead>
                <TableHead numeric>Change</TableHead>
                <TableHead numeric>Net sentiment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data?.markets ?? []).map((row) => (
                <TableRow key={row.market.id ?? 'default'}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
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
                        {formatNet(row.net_sentiment) ?? (
                          <MissingValue reason="No classified mentions" />
                        )}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
