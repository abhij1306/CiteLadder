'use client';

import type { ReactNode } from 'react';
import { Play } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import type { Audit } from '@/lib/api/types';
import { marketLabel } from '@citeladder/contracts/markets';
import { auditBadgeValue, auditStatusLabel, formatDateTime } from '@/lib/runs/status';
import { useDisplayTimeZone } from '@/lib/display-timezone';

/** A launch's per-market runs arrive together; later rows point back to the first. */
const sameLaunch = (audit: Audit, previous: Audit | undefined) =>
  audit.launch_id !== null && previous?.launch_id === audit.launch_id;

/** Rows per page on the runs table (client-side; the list arrives whole). */
const PAGE_SIZE = 10;

const MARKET_COLUMN: DataTableColumn = { key: 'market', label: 'Market', width: 'name' };

function runsColumns(showMarket: boolean): DataTableColumn[] {
  return [
    { key: 'status', label: 'Status', width: 'status' },
    { key: 'scope', label: 'Scope' },
    ...(showMarket ? [MARKET_COLUMN] : []),
    { key: 'requested', label: 'Requested', width: 'figure', numeric: true },
    { key: 'completed', label: 'Completed', width: 'figure', numeric: true },
    { key: 'failed', label: 'Failed', width: 'figure', numeric: true },
    { key: 'created', label: 'Created', width: 'date', numeric: true },
    { key: 'actions', label: 'Actions', width: 'action', hideLabel: true },
  ];
}

/**
 * Runs (audits) list table, on the shared `DataTable`.
 *
 * One row per audit: a run-status badge, the requested/completed/failed
 * counts, and the created timestamp (cut to one line, in full on hover). Each
 * row links to the run detail page.
 * A status filter that matches nothing keeps the header and the page's
 * footprint and states the absence inside the table.
 */
export function RunsTable({
  audits,
  status,
  emptyHeading,
}: Readonly<{
  /** The runs the status filter left. */
  audits: Audit[];
  /** A live note in the table header, e.g. that the list is polling. */
  status: ReactNode;
  /** What the filtered-empty state says. */
  emptyHeading: string;
}>) {
  const timeZone = useDisplayTimeZone();
  const { page, setPage, pageCount, from, to } = useTablePage(audits.length, PAGE_SIZE);
  const pagedAudits = audits.slice(from - 1, to);
  // Markets only earn a column once a project measures more than its default.
  const showMarket = audits.some((audit) => audit.market.id !== null);

  return (
    <DataTable
      title="All runs"
      toolbar={{ status }}
      columns={runsColumns(showMarket)}
      pageSize={PAGE_SIZE}
      rowCount={pagedAudits.length}
      state={
        audits.length === 0
          ? { kind: 'empty', headingLevel: 3, icon: Play, heading: emptyHeading }
          : undefined
      }
      pager={{
        range: { from, to, total: audits.length, noun: 'runs' },
        ...pageNumberControls(page, pageCount, setPage),
      }}
    >
      {pagedAudits.map((audit, index) => (
        <TableRow key={audit.id}>
          <TableCell>
            <Badge variant="run-status" value={auditBadgeValue(audit.status)}>
              {auditStatusLabel(audit.status)}
            </Badge>
          </TableCell>
          <TableCell>
            <Badge variant="status" value={audit.audit_scope === 'commerce' ? 'info' : 'success'}>
              {audit.audit_scope === 'commerce' ? 'Commerce' : 'Brand'}
            </Badge>
          </TableCell>
          {showMarket ? <TableCell>{marketLabel(audit.market)}</TableCell> : null}
          <TableCell numeric>{audit.requested_count}</TableCell>
          <TableCell numeric>{audit.completed_count}</TableCell>
          <TableCell numeric>{audit.failed_count}</TableCell>
          <TableCell numeric className="text-secondary">
            {/* One line, cut before the View link; the full time is its tooltip. */}
            <ClampText lines={1}>
              {sameLaunch(audit, pagedAudits[index - 1])
                ? 'Same launch'
                : formatDateTime(audit.created_at, timeZone)}
            </ClampText>
          </TableCell>
          <TableCell>
            <TextLink href={`/runs/${audit.id}`} text="itemTitle">
              View
            </TextLink>
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
