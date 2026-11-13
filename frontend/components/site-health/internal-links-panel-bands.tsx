import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { InternalLink, InternalLinkAnalysis } from '@citeladder/contracts/site-health';

import { RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { DisplayTime } from '@/components/ui/display-time';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { SearchField } from '@/components/ui/search-field';
import { ACTION_STATUS_LABEL } from '@/lib/agent/vocabulary';
import { httpErrorStatus } from '@/lib/api/errors';
import { internalLinksMutations, internalLinksQueries } from '@/lib/api/site-health-internal-links';
import type { UrlHistory } from '@/lib/navigation/url-state';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayTimestamp } from '@/lib/format';
import { downloadInternalLinksCsv } from '@/lib/site-health/internal-link-csv';
import { INTERNAL_LINK_STATES, pollInternalLinks } from '@/lib/site-health/status';
import { useWorkspaceCapability } from '@/lib/project/project-context';

type Scope = Readonly<{ projectId: string; workspaceId: string }>;
type ParamChange = (key: string, value: string, history?: UrlHistory) => void;
export const isRunning = (state: InternalLinkAnalysis['state']) =>
  INTERNAL_LINK_STATES[state].active;

/** The Internal links tab's address: the saved analysis, the search and the status filter. */
export function useLinkParams() {
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
  return { params, update };
}

/**
 * The tab's read and its run/cancel mutations. The screen owns it, because
 * the page header (Export, Analyze again) and the control band (search,
 * status, saved analysis) act on the same analysis the panel draws.
 */
function useInternalLinks(scope: Scope, enabled: boolean) {
  const { params, update } = useLinkParams();
  const analysisId = params.get('analysis') || undefined;
  const query = useQuery({
    ...internalLinksQueries.analysis(scope, analysisId),
    enabled,
    refetchInterval: (current) => pollInternalLinks(current.state.data?.analysis?.state),
  });
  const denied = [401, 403, 404].includes(httpErrorStatus(query.error) ?? 0);
  const data = denied ? undefined : query.data;
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const analyze = useMutation(internalLinksMutations.analyze(scope));
  const cancel = useMutation(internalLinksMutations.cancel(scope, analysisId));
  // Both actions are offered only once the read names their crawl or analysis.
  const startAnalysis = () => {
    const crawlId = data?.crawl_id;
    if (!crawlId) return;
    analyze.mutate(
      { crawl_id: crawlId, idempotency_key: requestKey },
      {
        onSuccess: (result) => {
          setRequestKey(crypto.randomUUID());
          if (result.analysis) update('analysis', result.analysis.id);
        },
      },
    );
  };
  const cancelAnalysis = () => {
    const analysis = data?.analysis;
    if (analysis) cancel.mutate(analysis.id);
  };
  return { data, query, analyze, cancel, startAnalysis, cancelAnalysis };
}
export type LinksRead = ReturnType<typeof useInternalLinks>;

export function filterLinks(links: InternalLink[], search: string, status: string) {
  const needle = search.toLocaleLowerCase();
  return links.filter(
    (link) =>
      (!status || (link.action_status ?? '') === status) &&
      `${link.source.title} ${link.source.url} ${link.target.title} ${link.target.url} ${link.anchor}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}

/**
 * Internal links' share of the page bands: the read the panel draws, the
 * header's one primary (Analyze again) and the control row: search, All
 * filters (status, saved analysis), the summary, then Export. `enabled` is false on every
 * other tab, so nothing is read there.
 */
export function useInternalLinksBands({
  scope,
  enabled,
  canAnalyze = true,
}: Readonly<{
  scope: Scope;
  enabled: boolean;
  /** False while the screen withholds mutations: the export stays, the run does not. */
  canAnalyze?: boolean;
}>): Readonly<{
  read: LinksRead;
  actions: ReactNode;
  controls: FilterBarProps | undefined;
}> {
  const read = useInternalLinks(scope, enabled);
  const { params, update } = useLinkParams();
  const timeZone = useDisplayTimeZone();
  const analysis = read.data?.analysis;
  const links = filterLinks(
    analysis?.recommendations ?? [],
    params.get('links_q') ?? '',
    params.get('links_status') ?? '',
  );
  return {
    read,
    actions: analysis ? <LinksRun read={read} analysis={analysis} canAnalyze={canAnalyze} /> : null,
    controls: linksControls({ read, params, update, links, timeZone }),
  };
}

function linksControls({
  read,
  params,
  update,
  links,
  timeZone,
}: Readonly<{
  read: LinksRead;
  params: URLSearchParams;
  update: ParamChange;
  links: InternalLink[];
  timeZone: string;
}>): FilterBarProps | undefined {
  // The first read holds the band, so the table starts on the same line once it lands.
  if (read.query.isPending) return RESERVED_CONTROLS;
  const data = read.data;
  const analysis = data?.analysis;
  if (!data || !analysis) return undefined;
  return {
    search: (
      <SearchField
        value={params.get('links_q') ?? ''}
        onValueChange={(value) => update('links_q', value, 'replace')}
        placeholder="Search pages and anchors"
        aria-label="Search pages and anchors"
      />
    ),
    filters: [
      choiceFilter({
        id: 'status',
        label: 'Action status',
        value: params.get('links_status') ?? '',
        defaultValue: '',
        groups: [
          {
            options: [
              { value: '', label: 'All statuses' },
              ...Object.entries(ACTION_STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ],
          },
        ],
        onChange: (value) => update('links_status', value),
      }),
      ...savedAnalysisFilter(data.history, analysis.id, update, timeZone),
    ],
    status: (
      <>
        {analysisSummary(analysis)} · <DisplayTime value={analysis.created_at} />
      </>
    ),
    // Held while the filters match nothing, so the row never reflows.
    actions: (
      <Button
        variant="secondary"
        disabled={!links.length}
        onClick={() => downloadInternalLinksCsv(links)}
      >
        <Icon icon={Download} />
        Export CSV
      </Button>
    ),
  };
}

/** Which saved analysis the tab reads; offered once there are two to choose from. */
function savedAnalysisFilter(
  history: NonNullable<LinksRead['data']>['history'],
  analysisId: string,
  update: ParamChange,
  timeZone: string,
): FilterDefinition[] {
  if (history.length < 2) return [];
  return [
    choiceFilter({
      id: 'analysis',
      label: 'Saved analysis',
      value: analysisId,
      defaultValue: history[0]?.id ?? analysisId,
      groups: [
        {
          options: history.map((run) => ({
            value: run.id,
            label: `${formatDisplayTimestamp(run.created_at, timeZone)} · ${INTERNAL_LINK_STATES[run.state].label}`,
          })),
        },
      ],
      onChange: (value) => update('analysis', value),
    }),
  ];
}

/** What was analyzed and when, closing the control row. */
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

/** The tab's header action: run the analysis again, or cancel the running one. */
function LinksRun({
  read,
  analysis,
  canAnalyze,
}: Readonly<{
  read: LinksRead;
  analysis: InternalLinkAnalysis;
  canAnalyze: boolean;
}>) {
  const canRun = useWorkspaceCapability('run') && canAnalyze;
  const running = isRunning(analysis.state);
  let run: ReactNode = null;
  if (canRun && running)
    run = (
      <Button variant="secondary" pending={read.cancel.isPending} onClick={read.cancelAnalysis}>
        Cancel analysis
      </Button>
    );
  else if (canRun)
    run = (
      <Button
        variant="primary"
        disabled={!read.data?.crawl_id || read.query.isError}
        pending={read.analyze.isPending}
        onClick={read.startAnalysis}
      >
        Analyze again
      </Button>
    );
  return run;
}
