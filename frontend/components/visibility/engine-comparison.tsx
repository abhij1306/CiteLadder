'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { Visibility } from '@/lib/api/types';
import {
  engineLabel,
  formatRate,
  measured,
  visibleEngines,
  type VisibilityFilters,
} from '@/lib/visibility/dashboard';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { MissingValue } from '@/components/ui/unavailable-value';
import { textRole } from '@/components/ui/typography';

export function EngineComparison({
  visibility,
  filter,
  onSelect,
}: Readonly<{
  visibility: Visibility;
  filter: VisibilityFilters['engine'];
  onSelect?: (engine: string) => void;
}>) {
  const engines = visibleEngines(visibility, filter);
  return (
    <Card>
      <CardHeader>
        <CardTitle>By model</CardTitle>
        <CardDescription>How each answer engine treated your brand.</CardDescription>
      </CardHeader>
      <CardContent>
        {!engines.length ? (
          <InlineEmpty>No model observations.</InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead numeric>Visibility</TableHead>
                <TableHead numeric>Owned citation rate</TableHead>
                <TableHead numeric>Answers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {engines.map((engine) => (
                <TableRow key={engine.logical_engine}>
                  <TableCell>
                    {onSelect ? (
                      <Button variant="ghost" onClick={() => onSelect(engine.logical_engine)}>
                        {engineLabel(engine.logical_engine)}
                      </Button>
                    ) : (
                      <ClampText lines={1}>{engineLabel(engine.logical_engine)}</ClampText>
                    )}
                    <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
                      {visibility.model_provenance
                        .filter((item) => item.logical_engine === engine.logical_engine)
                        .map((item) => item.transport_model)
                        .join(', ')}
                    </ClampText>
                  </TableCell>
                  <TableCell numeric>
                    {measured(formatRate(engine.brand_mention_rate)) ?? <MissingValue />}
                  </TableCell>
                  <TableCell numeric>
                    {measured(formatRate(engine.owned_citation_rate)) ?? <MissingValue />}
                  </TableCell>
                  {/* This read "N measured / M expected", or "expected count
                      unavailable" — the run's own bookkeeping. How many answers
                      a rate is drawn from is the reader's business; how many we
                      hoped for is not. */}
                  <TableCell numeric>{engine.total_completed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
