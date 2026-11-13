import { useState } from 'react';
import type { InternalLink, InternalLinkAnalysis } from '@citeladder/contracts/site-health';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { ACTION_STATUS_LABEL } from '@/lib/agent/vocabulary';
import type { ActionStatus } from '@/lib/api/actions';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import { MISSING_MARK, formatCount, readableUrl } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { internalLinkStateNotice } from '@/lib/site-health/status';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { InternalLinkReview } from './internal-link-review';
import {
  filterLinks,
  isRunning,
  useLinkParams,
  type LinksRead,
} from './internal-links-panel-bands';

/**
 * The Internal links tab's content. Its read, header actions and control band
 * come from `useInternalLinksBands`, which the screen owns: this draws the
 * notices, the suggestions and the review drawer.
 */
export function InternalLinksPanel({
  read,
  workspaceId,
}: Readonly<{ read: LinksRead; workspaceId: string }>) {
  const { params, update } = useLinkParams();
  const analysis = read.data?.analysis;
  const links = filterLinks(
    analysis?.recommendations ?? [],
    params.get('links_q') ?? '',
    params.get('links_status') ?? '',
  );
  const selected = analysis?.recommendations.find((link) => link.id === params.get('link'));
  return (
    <Stack gap="workspace" className="min-w-0">
      <Notices read={read} />
      {analysis ? (
        <LinksResult
          analysis={analysis}
          links={links}
          onSelect={(id) => update('link', id)}
          canAnalyze={Boolean(read.data?.crawl_id)}
        />
      ) : (
        <StartState read={read} />
      )}
      {analysis ? (
        <InternalLinkReview
          link={selected}
          links={analysis.recommendations}
          workspaceId={workspaceId}
          crawlId={analysis.crawl_id}
          stale={analysis.stale}
          onClose={() => update('link', '')}
        />
      ) : null}
    </Stack>
  );
}

function Notices({ read }: Readonly<{ read: LinksRead }>) {
  const mutationError = read.analyze.error || read.cancel.error;
  const failure = mutationError
    ? mutationNoticeForError(mutationError, {
        action: read.analyze.error ? 'start the analysis' : 'cancel the analysis',
      })
    : null;
  return (
    <>
      {read.query.isError ? (
        <QueryState
          kind="error"
          error={read.query.error}
          fallback="Internal links could not be loaded."
          onRetry={() => void read.query.refetch()}
        />
      ) : null}
      {failure ? <MutationNotice notice={failure} /> : null}
      {read.query.isPending ? <QueryState kind="loading" label="Loading internal links…" /> : null}
    </>
  );
}

function StartState({ read }: Readonly<{ read: LinksRead }>) {
  const canRun = useWorkspaceCapability('run');
  const data = read.data;
  if (!data) return null;
  if (!data.crawl_id)
    return (
      <QueryState
        kind="empty"
        icon={ICONS.site}
        heading="Run a crawl first"
        description="A completed crawl provides the pages and existing links to analyze."
      />
    );
  return (
    <QueryState
      kind="empty"
      icon={ICONS.site}
      heading="Find missing internal links"
      description="Find the contextual links each page is missing."
      action={
        canRun ? (
          <Button variant="primary" pending={read.analyze.isPending} onClick={read.startAnalysis}>
            Analyze internal links
          </Button>
        ) : undefined
      }
    />
  );
}

function LinksResult({
  analysis,
  links,
  onSelect,
  canAnalyze,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  onSelect: (id: string) => void;
  canAnalyze: boolean;
}>) {
  const summary = analysis.diagnostics;
  const notice = internalLinkStateNotice(analysis);
  if (isRunning(analysis.state) && !analysis.recommendations.length)
    return (
      <output className="type-body">
        {summary
          ? `Checking related pages… ${formatCount(summary.candidates - summary.pending)} of ${formatCount(summary.candidates)} page pairs done.`
          : 'Checking related pages…'}
      </output>
    );
  return (
    <>
      {analysis.stale ? (
        <Callout tone="warning">
          These suggestions use an earlier crawl.{' '}
          {canAnalyze ? 'Analyze again before making edits.' : null}
        </Callout>
      ) : null}
      {notice ? <Callout tone="info">{notice}</Callout> : null}
      {/* A run that could not check pairs has no result; never render it as empty. */}
      {['unavailable', 'failed', 'cancelled'].includes(analysis.state) &&
      !analysis.recommendations.length ? null : (
        <LinksBody analysis={analysis} links={links} onSelect={onSelect} />
      )}
    </>
  );
}

function LinksBody({
  analysis,
  links,
  onSelect,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  onSelect: (id: string) => void;
}>) {
  const summary = analysis.diagnostics;
  return (
    <>
      {isRunning(analysis.state) && summary ? (
        <output className="type-caption">
          {formatCount(summary.candidates - summary.pending)} of {formatCount(summary.candidates)}{' '}
          page pairs checked. Suggestions appear as they are found.
        </output>
      ) : null}
      <LinksTable links={links} emptyReason={emptyReason(analysis)} onSelect={onSelect} />
    </>
  );
}

const LINK_COLUMNS: readonly DataTableColumn[] = [
  { key: 'source', label: 'Source page' },
  { key: 'target', label: 'Add link to' },
  { key: 'anchor', label: 'Anchor text', width: 'name' },
  { key: 'action', label: 'Action', width: 'status' },
  { key: 'review', label: 'Review', width: 'action', hideLabel: true },
];

/** Distinguish "nothing to compare" from "compared and nothing qualified". */
function emptyReason(analysis: InternalLinkAnalysis): string {
  const summary = analysis.diagnostics;
  if (analysis.recommendations.length) return 'No suggestions match these filters.';
  if (!summary?.candidates)
    return 'No supported source placements for unlinked destinations were found in this crawl.';
  return `${formatCount(summary.completed)} page pairs were checked and none qualified for a contextual link.`;
}

function LinksTable({
  links,
  emptyReason,
  onSelect,
}: Readonly<{
  links: InternalLink[];
  emptyReason: string;
  onSelect: (id: string) => void;
}>) {
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const pagination = useTablePage(links.length, pageSize);
  const paged = links.slice(pagination.from - 1, pagination.to);
  return (
    <DataTable
      label="Internal link suggestions"
      columns={LINK_COLUMNS}
      // A table of more than one page reserves a full page, so the pager stays put.
      pageSize={links.length > pageSize ? pageSize : undefined}
      rowCount={paged.length}
      state={
        links.length
          ? undefined
          : { kind: 'empty', icon: ICONS.site, heading: emptyReason, headingLevel: 3 }
      }
      pager={
        links.length
          ? {
              range: {
                from: pagination.from,
                to: pagination.to,
                total: links.length,
                noun: 'suggestions',
              },
              pageSize: {
                value: pageSize,
                onChange: (size) => {
                  setPageSize(isTablePageSize(size) ? size : TABLE_DEFAULT_PAGE_SIZE);
                  pagination.setPage(1);
                },
              },
              ...pageNumberControls(pagination.page, pagination.pageCount, pagination.setPage),
            }
          : undefined
      }
    >
      {paged.map((link) => (
        <TableRow key={link.id}>
          <TableCell>
            <PageCell title={link.source.title} url={link.source.url} />
          </TableCell>
          <TableCell>
            <PageCell title={link.target.title} url={link.target.url} />
          </TableCell>
          <TableCell>{link.anchor}</TableCell>
          <TableCell className="whitespace-nowrap">
            <LinkActionStatus status={link.action_status} />
          </TableCell>
          <TableCell>
            <Button
              variant="ghost"
              onClick={() => onSelect(link.id)}
              aria-label={`Review link from ${link.source.title || link.source.url} to ${link.target.title || link.target.url}`}
            >
              Review
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

/** The link's Action status; a status this build does not know is not "no Action". */
function LinkActionStatus({ status }: Readonly<{ status: string | null }>) {
  if (status === null) return <NoAction />;
  if (status in ACTION_STATUS_LABEL) return <ActionStatusBadge status={status as ActionStatus} />;
  return <>Unknown status</>;
}

/**
 * A suggestion no Action tracks yet: the shared missing mark rather than the
 * same words on every row, still named for assistive technology.
 */
function NoAction() {
  return (
    <span className="value-placeholder">
      <span aria-hidden>{MISSING_MARK}</span>
      <span className="sr-only">No Action yet</span>
    </span>
  );
}

function PageCell({ title, url }: Readonly<{ title: string; url: string }>) {
  const path = new URL(url).pathname;
  return (
    <span className="grid max-w-sm min-w-0">
      <ClampText lines={1} tooltip={title || url}>
        {title || path}
      </ClampText>
      <ClampText lines={1} tooltip={url} className="type-caption">
        {readableUrl(path)}
      </ClampText>
    </span>
  );
}
