'use client';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pager, pageNumberControls, useTablePage } from '@/components/ui/pager';
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

/**
 * Runs (audits) list table.
 *
 * One row per audit: a run-status badge, the requested/completed/failed
 * counts, and the created timestamp. Each row links to the run detail page.
 * Client-side pagination footer (tabular page indicator + ghost buttons) per the
 * runs frame.
 */
export function RunsTable({ audits }: Readonly<{ audits: Audit[] }>) {
  const timeZone = useDisplayTimeZone();
  const { page, setPage, pageCount, from, to } = useTablePage(audits.length, PAGE_SIZE);
  const pagedAudits = audits.slice(from - 1, to);
  // Markets only earn a column once a project measures more than its default.
  const showMarket = audits.some((audit) => audit.market.id !== null);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Scope</TableHead>
            {showMarket ? <TableHead>Market</TableHead> : null}
            <TableHead numeric>Requested</TableHead>
            <TableHead numeric>Completed</TableHead>
            <TableHead numeric>Failed</TableHead>
            <TableHead numeric>Created</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedAudits.map((audit, index) => (
            <TableRow key={audit.id}>
              <TableCell>
                <Badge variant="run-status" value={auditBadgeValue(audit.status)}>
                  {auditStatusLabel(audit.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant="status"
                  value={audit.audit_scope === 'commerce' ? 'info' : 'success'}
                >
                  {audit.audit_scope === 'commerce' ? 'Commerce' : 'Brand'}
                </Badge>
              </TableCell>
              {showMarket ? <TableCell>{marketLabel(audit.market)}</TableCell> : null}
              <TableCell numeric className="tabular-nums">
                {audit.requested_count}
              </TableCell>
              <TableCell numeric className="tabular-nums">
                {audit.completed_count}
              </TableCell>
              <TableCell numeric className="tabular-nums">
                {audit.failed_count}
              </TableCell>
              <TableCell numeric className="text-secondary">
                {sameLaunch(audit, pagedAudits[index - 1])
                  ? 'Same launch'
                  : formatDateTime(audit.created_at, timeZone)}
              </TableCell>
              <TableCell>
                <TextLink href={`/runs/${audit.id}`} text="itemTitle">
                  View
                </TextLink>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        frame="table"
        range={{ from, to, total: audits.length, noun: 'runs' }}
        {...pageNumberControls(page, pageCount, setPage)}
      />
    </div>
  );
}
