'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pager, pageNumberControls, useTablePage } from '@/components/ui/pager';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableFillerRows,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { DemandSignal } from '@/lib/api/demand';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import {
  demandSignalHandoffHref,
  numericMetric,
  signalPage,
  signalPageLine,
  signalTarget,
  signalTypeMeta,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount } from '@/lib/format';

/** A signal type as a labelled chip; its meaning lives in the legend. */
export function SignalChip({ signalType }: Readonly<{ signalType: string }>) {
  const meta = signalTypeMeta(signalType);
  return meta.tone === 'neutral' ? (
    <Badge>{meta.label}</Badge>
  ) : (
    <Badge variant="status" value={meta.tone}>
      {meta.label}
    </Badge>
  );
}

/** Each signal type present, explained once. */
export function SignalLegend({ signals }: Readonly<{ signals: readonly DemandSignal[] }>) {
  const types = [...new Set(signals.map((signal) => signal.signal_type))];
  if (types.length === 0) return null;
  return (
    <section aria-label="Signal types">
      <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
        {types.map((type) => (
          <div key={type} className="flex items-start gap-2">
            <dt className="shrink-0">
              <SignalChip signalType={type} />
            </dt>
            <dd className={textRole('caption')}>{signalTypeMeta(type).definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The signals, one flat row each in priority order, a page at a time. The
 * landing page rides under its query as a caption instead of a full-width
 * group row, so every row is a signal. Detail stays in the evidence drawer.
 *
 * The whole list is already in the persisted snapshot, so it pages on the
 * client. `filterKey` names the active filter: a new filter starts at page 1,
 * while a refetch of the same filter only clamps the page into range.
 */
export function DemandSignalTable({
  rows,
  filterKey,
  onInspect,
}: Readonly<{
  rows: readonly RankedSignal[];
  filterKey: string;
  onInspect: (signal: DemandSignal) => void;
}>) {
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const { page, setPage, pageCount, from, to } = useTablePage(rows.length, pageSize);
  const [pagedFilter, setPagedFilter] = useState(filterKey);
  if (pagedFilter !== filterKey) {
    setPagedFilter(filterKey);
    setPage(1);
  }

  const pageRows = rows.slice(from - 1, to);
  // Paging never moves the layout: fixed column widths, and a short last
  // page keeps a full page's height (a single page just ends).
  const filler = pageCount > 1 ? pageSize - pageRows.length : 0;

  return (
    <div>
      <Table minWidth="lg" fixed>
        <TableHeader>
          <TableRow>
            <TableHead numeric className="w-16">
              Rank
            </TableHead>
            <TableHead>Query and page</TableHead>
            <TableHead className="w-44">Signal</TableHead>
            <TableHead numeric className="w-28">
              Impressions
            </TableHead>
            <TableHead numeric className="w-20">
              Clicks
            </TableHead>
            <TableHead numeric className="w-20">
              CTR
            </TableHead>
            <TableHead numeric className="w-28">
              Avg. position
            </TableHead>
            <TableHead className="w-52">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map(({ signal, rank }) => (
            <SignalRow key={signal.id} signal={signal} rank={rank} onInspect={onInspect} />
          ))}
          <TableFillerRows count={filler} colSpan={8} spacer={<TwoLines title=" " caption=" " />} />
        </TableBody>
      </Table>
      <Pager
        frame="table"
        range={{ from, to, total: rows.length, noun: 'signals' }}
        pageSize={{
          value: pageSize,
          onChange: (size) => {
            setPageSize(isTablePageSize(size) ? size : TABLE_DEFAULT_PAGE_SIZE);
            setPage(1);
          },
        }}
        {...pageNumberControls(page, pageCount, setPage)}
      />
    </div>
  );
}

function SignalRow({
  signal,
  rank,
  onInspect,
}: Readonly<{ signal: DemandSignal; rank: number; onInspect: (signal: DemandSignal) => void }>) {
  const target = signalTarget(signal);
  const pageLine = signalPageLine(signal);
  return (
    <TableRow>
      <TableCell numeric className={textRole('caption')}>
        {rank}
      </TableCell>
      <TableCell>
        <TwoLines title={target} caption={pageLine} captionTooltip={signalPage(signal)} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <SignalChip signalType={signal.signal_type} />
      </TableCell>
      <TableCell numeric>
        <Count value={numericMetric(signal, 'impressions')} />
      </TableCell>
      <TableCell numeric>
        <Count value={numericMetric(signal, 'clicks')} />
      </TableCell>
      <TableCell numeric>
        <Ctr signal={signal} />
      </TableCell>
      <TableCell numeric>
        <Position value={numericMetric(signal, 'position')} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            aria-label={`Inspect evidence for ${target}`}
            onClick={() => onInspect(signal)}
          >
            Inspect
          </Button>
          {/* A signal promoted into an Action opens it; any other is asked about. */}
          {signal.action_id ? (
            <Button variant="secondary" asChild>
              <ProjectLink
                href={`/agent/actions/${signal.action_id}`}
                aria-label={`Open the Action for ${target}`}
              >
                Open Action
                <ChevronRight className="size-3.5" aria-hidden />
              </ProjectLink>
            </Button>
          ) : (
            <Button variant="ghost" asChild>
              <ProjectLink
                href={demandSignalHandoffHref(signal)}
                aria-label={`Ask agent about ${target}`}
              >
                Ask agent
                <ChevronRight className="size-3.5" aria-hidden />
              </ProjectLink>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * The query over its landing page. Always two lines tall, even with no page,
 * so every row (and a filler row) is the same height.
 */
function TwoLines({
  title,
  caption,
  captionTooltip,
}: Readonly<{ title: string; caption: string | null; captionTooltip?: string | null }>) {
  return (
    <>
      <ClampText lines={1} className={textRole('itemTitle')}>
        {title}
      </ClampText>
      <ClampText lines={1} tooltip={captionTooltip} className={textRole('caption')}>
        {caption ?? ' '}
      </ClampText>
    </>
  );
}

function Count({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <UnavailableValue state="not_measured" /> : formatCount(value);
}

function Position({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <UnavailableValue state="not_measured" /> : value.toFixed(1);
}

/** The persisted CTR, else clicks over impressions; never a guessed zero. */
function Ctr({ signal }: Readonly<{ signal: DemandSignal }>) {
  const persisted = numericMetric(signal, 'ctr');
  if (persisted !== null) return `${(persisted * 100).toFixed(1)}%`;
  const impressions = numericMetric(signal, 'impressions');
  const clicks = numericMetric(signal, 'clicks');
  if (impressions === null || clicks === null || impressions === 0)
    return <UnavailableValue state="not_measured" />;
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}
