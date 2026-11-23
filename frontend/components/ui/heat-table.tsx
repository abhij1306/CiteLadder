import { Fragment, type ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '@/components/ui/table';
import { Absence, printed } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { SkeletonBlock, SkeletonFrame } from '@/components/ui/skeleton-block';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import type { DataAvailabilityState, Formatted } from '@/lib/format';
import { cssVars } from '@/lib/css-vars';
import { cn } from '@/lib/utils';

const heat = (place: number) =>
  `color-mix(in oklch, var(--color-accent) ${Math.round(4 + 46 * Math.min(1, Math.max(0, place)))}%, var(--color-surface))`;
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 6px, var(--color-rule) 6px 7px)';

export type HeatValue =
  | { kind: 'value'; text: string; detail: string; tint: number }
  | { kind: 'void'; state: DataAvailabilityState; label: string };

type HeatTableProps = Readonly<{
  labelledBy: string;
  corner: string;
  columns: readonly { key: string; header: ReactNode }[];
  rows: readonly { key: string; header: ReactNode; cells: readonly HeatValue[] }[];
}>;

export function HeatTable({ labelledBy, corner, columns, rows }: HeatTableProps) {
  return (
    <GridFloor columns={columns.length}>
      <Table fixed ariaLabelledBy={labelledBy} className={HEAT_FLOOR}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">{corner}</TableHead>
            {columns.map((column) => (
              <TableHead key={column.key} className={HEAT_HEAD}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableRowHeader>{row.header}</TableRowHeader>
              {row.cells.map((cell, index) => (
                <td key={columns[index]?.key ?? index} className="p-0.5 text-center">
                  {cell.kind === 'void' ? (
                    <div
                      className="rounded-mark flex min-h-10 flex-col items-center justify-center"
                      style={{ backgroundImage: HATCH }}
                    >
                      <i className={textRole('caption')}>
                        <Absence state={cell.state} label={cell.label} />
                      </i>
                    </div>
                  ) : (
                    <div
                      className="rounded-mark flex min-h-10 flex-col items-center justify-center"
                      style={{ background: heat(cell.tint) }}
                    >
                      <span className={textRole('label', 'tabular-nums')}>{cell.text}</span>
                      <span className={textRole('caption', 'text-ink')}>{cell.detail}</span>
                    </div>
                  )}
                </td>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </GridFloor>
  );
}

const HEAT_FLOOR =
  'min-w-[calc(10rem+var(--grid-columns)*5rem)] phone:min-w-[calc(10rem+var(--grid-columns)*6rem)]';
const HEAT_HEAD =
  'phone:whitespace-normal phone:[&>span]:flex-col phone:[&>span]:gap-1 phone:[&_.truncate]:whitespace-normal text-center';
const RANK_CHIP =
  'rounded-mark flex h-[var(--control-md)] items-center justify-center gap-1 overflow-hidden px-2 whitespace-nowrap phone:h-auto phone:min-h-[var(--control-md)] phone:flex-wrap phone:py-1 phone:text-center';
const RANK_FLOOR = 'phone:min-w-[calc(10rem+var(--grid-columns)*8rem)]';

function GridFloor({ columns, children }: Readonly<{ columns: number; children: ReactNode }>) {
  return <div style={cssVars({ '--grid-columns': columns })}>{children}</div>;
}

export function GridTableSkeleton({
  label,
  rows,
  columns,
  variant,
}: Readonly<{ label: string; rows: number; columns: number; variant: 'heat' | 'rank' }>) {
  const cell =
    variant === 'heat' ? (
      <td className="p-0.5">
        <SkeletonBlock className="rounded-mark h-10 min-h-10" />
      </td>
    ) : (
      <td className="p-1">
        <SkeletonBlock className="rounded-mark h-[var(--control-md)]" />
      </td>
    );
  return (
    <SkeletonFrame label={label} variant="grid">
      <Table fixed>
        <TableHeader>
          <TableRow>
            <TableHead className={variant === 'heat' ? 'w-40' : 'w-54'}>
              <SkeletonBlock className="w-16" />
            </TableHead>
            {Array.from({ length: columns }, (_, index) => (
              <TableHead key={index}>
                <SkeletonBlock className="mx-auto w-12" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row}>
              <TableRowHeader>
                <SkeletonBlock className="w-24" />
              </TableRowHeader>
              {Array.from({ length: columns }, (_, index) => (
                <Fragment key={index}>{cell}</Fragment>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SkeletonFrame>
  );
}

export function HeatScale({ note }: Readonly<{ note: string }>) {
  return (
    <div className={textRole('caption', 'flex items-center gap-2')}>
      <span className="flex-1">{note}</span>
      <span>Low</span>
      <i
        aria-hidden
        className="h-1.5 w-30 rounded-full"
        style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(1)})` }}
      />
      <span>High</span>
    </div>
  );
}

export type RankChip = {
  key: string;
  mark: ReactNode;
  name: string;
  detail: Formatted;
  own: boolean;
};

export function RankTable({
  labelledBy,
  corner,
  places,
  rows,
}: Readonly<{
  labelledBy: string;
  corner: string;
  places: number;
  rows: readonly { key: string; header: ReactNode; chips: readonly RankChip[]; empty: ReactNode }[];
}>) {
  const columns = Array.from({ length: places }, (_, index) => index);
  return (
    <GridFloor columns={places}>
      <Table fixed ariaLabelledBy={labelledBy} className={RANK_FLOOR}>
        <TableHeader>
          <TableRow>
            <TableHead className="phone:w-40 w-54">{corner}</TableHead>
            {columns.map((index) => (
              <TableHead key={index} className="text-center">
                #{index + 1}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableRowHeader>{row.header}</TableRowHeader>
              {row.chips.length === 0
                ? columns.map((index) => (
                    <td key={index} className="p-1 text-center">
                      {row.empty}
                    </td>
                  ))
                : columns.map((index) => {
                    const chip = row.chips[index];
                    return (
                      <td key={chip?.key ?? index} className="p-1">
                        {chip ? (
                          <div
                            className={cn(
                              RANK_CHIP,
                              chip.own
                                ? textRole('captionStrong', 'bg-accent-wash text-accent-text')
                                : textRole('caption', 'bg-well text-ink'),
                            )}
                          >
                            {chip.mark}
                            <span className="phone:whitespace-normal min-w-0 truncate">
                              {chip.name}
                            </span>
                            <span className="opacity-80">{printed(chip.detail)}</span>
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </GridFloor>
  );
}

export function RankLegend() {
  return (
    <div className={textRole('caption', 'flex items-center gap-4')}>
      <span className="inline-flex items-center gap-2">
        <i aria-hidden className="rounded-mark bg-well size-2.5" />
        <span>Other brands</span>
      </span>
      <span className="inline-flex items-center gap-2">
        <i aria-hidden className="rounded-mark bg-accent-wash size-2.5" />
        <span>Your brand</span>
      </span>
    </div>
  );
}

export function AxisItemLabel({
  lead,
  text,
  trail,
  note,
}: Readonly<{
  lead?: ReactNode;
  text: string;
  trail?: ReactNode;
  note?: { label: string; tip: string };
}>) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
      {lead}
      <ClampText>{text}</ClampText>
      {trail}
      {note ? (
        <Tooltip content={note.tip}>
          <button type="button" className={textRole('caption', 'whitespace-nowrap')}>
            {note.label}
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}
