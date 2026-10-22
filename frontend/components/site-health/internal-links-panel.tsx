'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { InternalLink, InternalLinkAnalysis } from '@citeladder/contracts/site-health';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { SearchField } from '@/components/ui/search-field';
import { Select } from '@/components/ui/select';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { ACTION_STATUS_LABEL } from '@/lib/agent/vocabulary';
import type { ActionStatus } from '@/lib/api/actions';
import { httpErrorStatus, humanizeApiError } from '@/lib/api/errors';
import { internalLinksApi, internalLinksQuery } from '@/lib/api/site-health-internal-links';
import type { UrlHistory } from '@/lib/navigation/url-state';
import { RERUN_POLL_INTERVAL_MS } from '@/lib/config/site-health';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import { downloadInternalLinksCsv } from '@/lib/site-health/internal-link-csv';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayTimestamp } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { internalLinkStateNotice } from '@/lib/site-health/status';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { InternalLinkReview } from './internal-link-review';

type Scope = Readonly<{ projectId: string; workspaceId: string }>;
type ParamChange = (key: string, value: string, history?: UrlHistory) => void;
const isRunning = (state: string | undefined) => state === 'queued' || state === 'running';

const STATE_LABELS: Record<InternalLinkAnalysis['state'], string> = {
  queued: 'Running',
  running: 'Running',
  completed: 'Complete',
  partial: 'Partial',
  unavailable: 'Failed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function useInternalLinks({ projectId, workspaceId }: Scope, update: ParamChange) {
  const [params] = useSearchParams();
  const analysisId = params.get('analysis') || undefined;
  const queryClient = useQueryClient();
  const options = internalLinksQuery(workspaceId, projectId, analysisId);
  const query = useQuery({
    ...options,
    refetchInterval: (current) =>
      isRunning(current.state.data?.analysis?.state) ? RERUN_POLL_INTERVAL_MS : false,
  });
  const denied = [401, 403, 404].includes(httpErrorStatus(query.error) ?? 0);
  const data = denied ? undefined : query.data;
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const analyze = useMutation({
    mutationFn: () =>
      internalLinksApi.analyze(
        projectId,
        { crawl_id: data!.crawl_id!, idempotency_key: requestKey },
        { workspaceId },
      ),
    onSuccess: (result) => {
      setRequestKey(crypto.randomUUID());
      void queryClient.invalidateQueries({
        queryKey: internalLinksQuery(workspaceId, projectId).queryKey,
        exact: true,
        refetchType: 'none',
      });
      if (!result.analysis) return;
      // Seed the selected-analysis key so the URL change does not flash a reload.
      queryClient.setQueryData(
        internalLinksQuery(workspaceId, projectId, result.analysis.id).queryKey,
        result,
      );
      update('analysis', result.analysis.id);
    },
  });
  const cancel = useMutation({
    mutationFn: () => internalLinksApi.cancel(projectId, data!.analysis!.id, { workspaceId }),
    onSuccess: (result) => queryClient.setQueryData(options.queryKey, result),
  });
  return { data, query, analyze, cancel };
}
type LinksRead = ReturnType<typeof useInternalLinks>;

function filterLinks(links: InternalLink[], search: string, status: string) {
  const needle = search.toLocaleLowerCase();
  return links.filter(
    (link) =>
      (!status || (link.action_status ?? '') === status) &&
      `${link.source.title} ${link.source.url} ${link.target.title} ${link.target.url} ${link.anchor}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}

export function InternalLinksPanel(scope: Scope) {
  const [params, setParams] = useSearchParams();
  const update: ParamChange = (key, value, history = 'push') =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key === 'analysis') next.delete('link');
        return next;
      },
      { replace: history === 'replace' },
    );
  const read = useInternalLinks(scope, update);
  const analysis = read.data?.analysis;
  const links = filterLinks(
    analysis?.recommendations ?? [],
    params.get('links_q') ?? '',
    params.get('links_status') ?? '',
  );
  const selected = analysis?.recommendations.find((link) => link.id === params.get('link'));
  return (
    <div className="grid min-w-0 gap-4">
      <LinksHeader read={read} links={links} update={update} />
      <Notices read={read} />
      {analysis ? (
        <LinksResult
          analysis={analysis}
          links={links}
          params={params}
          update={update}
          canAnalyze={Boolean(read.data?.crawl_id)}
        />
      ) : (
        <StartState read={read} />
      )}
      {analysis ? (
        <InternalLinkReview
          link={selected}
          links={analysis.recommendations}
          workspaceId={scope.workspaceId}
          crawlId={analysis.crawl_id}
          stale={analysis.stale}
          onClose={() => update('link', '')}
        />
      ) : null}
    </div>
  );
}

/** One line: what was analyzed and when, plus the controls that act on it. */
function analysisSummary(analysis: InternalLinkAnalysis): string {
  const parts = [
    `${formatCount(analysis.recommendations.length)} suggestions`,
    `${formatCount(analysis.page_count)} pages`,
  ];
  const summary = analysis.diagnostics;
  if (summary && !isRunning(analysis.state))
    parts.push(
      `${formatCount(summary.candidates)} page pairs checked in ${Math.round(summary.elapsed_seconds)}s`,
    );
  if (analysis.omitted_pages)
    parts.push(`${formatCount(analysis.omitted_pages)} pages over the limit`);
  return parts.join(' · ');
}

function LinksHeader({
  read,
  links,
  update,
}: Readonly<{ read: LinksRead; links: InternalLink[]; update: ParamChange }>) {
  const timeZone = useDisplayTimeZone();
  const data = read.data;
  const analysis = data?.analysis;
  if (!data || !analysis) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <output className="type-caption min-w-0 flex-1">
        {analysisSummary(analysis)} · <DisplayTime value={analysis.created_at} />
      </output>
      {data.history.length > 1 ? (
        <Select
          ariaLabel="Saved analysis"
          value={analysis.id}
          onValueChange={(value) => update('analysis', value)}
          options={data.history.map((run) => ({
            value: run.id,
            label: `${formatDisplayTimestamp(run.created_at, timeZone)} · ${STATE_LABELS[run.state]}`,
          }))}
        />
      ) : null}
      {links.length ? (
        <Button variant="secondary" onClick={() => downloadInternalLinksCsv(links)}>
          Export CSV
        </Button>
      ) : null}
      <RunControls read={read} running={isRunning(analysis.state)} />
    </div>
  );
}

function RunControls({ read, running }: Readonly<{ read: LinksRead; running: boolean }>) {
  const canRun = useWorkspaceCapability('run');
  if (!canRun) return null;
  if (running)
    return (
      <Button
        variant="secondary"
        pending={read.cancel.isPending}
        onClick={() => read.cancel.mutate()}
      >
        Cancel analysis
      </Button>
    );
  return (
    <Button
      disabled={!read.data?.crawl_id || read.query.isError}
      pending={read.analyze.isPending}
      onClick={() => read.analyze.mutate()}
    >
      Analyze again
    </Button>
  );
}

function Notices({ read }: Readonly<{ read: LinksRead }>) {
  const mutationError = read.analyze.error || read.cancel.error;
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
      {mutationError ? (
        <Alert>{humanizeApiError(mutationError, 'Analysis could not be started.').message}</Alert>
      ) : null}
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
      description="Compare related pages from your latest crawl and suggest the contextual links each page is missing."
      action={
        canRun ? (
          <Button pending={read.analyze.isPending} onClick={() => read.analyze.mutate()}>
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
  params,
  update,
  canAnalyze,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  params: URLSearchParams;
  update: ParamChange;
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
        <Alert tone="warning">
          These suggestions use an earlier crawl.{' '}
          {canAnalyze ? 'Analyze again before making edits.' : null}
        </Alert>
      ) : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {/* A run that could not check pairs has no result; never render it as empty. */}
      {['unavailable', 'failed', 'cancelled'].includes(analysis.state) &&
      !analysis.recommendations.length ? null : (
        <LinksBody analysis={analysis} links={links} params={params} update={update} />
      )}
    </>
  );
}

function LinksBody({
  analysis,
  links,
  params,
  update,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  params: URLSearchParams;
  update: ParamChange;
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
      <LinksTable
        links={links}
        toolbar={
          analysis.recommendations.length
            ? {
                search: (
                  <SearchField
                    value={params.get('links_q') ?? ''}
                    onValueChange={(value) => update('links_q', value, 'replace')}
                    placeholder="Search pages and anchors"
                    aria-label="Search pages and anchors"
                  />
                ),
                filters: (
                  <Select
                    ariaLabel="Action status"
                    value={params.get('links_status') ?? ''}
                    onValueChange={(value) => update('links_status', value)}
                    options={[
                      { value: '', label: 'All statuses' },
                      ...Object.entries(ACTION_STATUS_LABEL).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                ),
              }
            : undefined
        }
        emptyReason={emptyReason(analysis)}
        onSelect={(id) => update('link', id)}
      />
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
  toolbar,
  emptyReason,
  onSelect,
}: Readonly<{
  links: InternalLink[];
  toolbar?: FilterBarProps;
  emptyReason: string;
  onSelect: (id: string) => void;
}>) {
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const pagination = useTablePage(links.length, pageSize);
  const paged = links.slice(pagination.from - 1, pagination.to);
  return (
    <DataTable
      label="Internal link suggestions"
      toolbar={toolbar}
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
            {link.action_status && link.action_status in ACTION_STATUS_LABEL ? (
              <ActionStatusBadge status={link.action_status as ActionStatus} />
            ) : (
              <span className="type-caption">No Action yet</span>
            )}
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

function PageCell({ title, url }: Readonly<{ title: string; url: string }>) {
  const path = new URL(url).pathname;
  return (
    <span className="grid max-w-sm min-w-0">
      <ClampText lines={1} tooltip={title || url}>
        {title || path}
      </ClampText>
      <ClampText lines={1} tooltip={url} className="type-caption">
        {decodeURIPath(path)}
      </ClampText>
    </span>
  );
}

function decodeURIPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
