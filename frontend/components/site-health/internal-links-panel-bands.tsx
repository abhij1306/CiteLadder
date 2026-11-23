import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { InternalLink, InternalLinkAnalysis } from '@citeladder/contracts/site-health';

import { RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { DisplayTime } from '@/components/ui/display-time';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { SearchField } from '@/components/ui/search-field';
import { Download } from '@/lib/icons';
import { ACTION_STATUS_LABEL } from '@/lib/agent/vocabulary';
import { httpErrorStatus } from '@/lib/api/errors';
import { internalLinksMutations, internalLinksQueries } from '@/lib/api/site-health-internal-links';
import { useSetUrlParams, useUrlParam, type UrlParamValues } from '@/lib/navigation/url-params';
import type { UrlHistory } from '@/lib/navigation/url-state';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayTimestamp } from '@/lib/format';
import { downloadInternalLinksCsv } from '@/lib/site-health/internal-link-csv';
import { INTERNAL_LINK_STATES, pollInternalLinks } from '@/lib/site-health/status';
import { useWorkspaceCapability } from '@/lib/project/project-context';

type Scope = Readonly<{ projectId: string; workspaceId: string }>;
type LinkParam = 'analysis' | 'link' | 'links_q' | 'links_status';
type LinkParams = Readonly<Record<LinkParam, string | null>>;
type ParamChange = (key: LinkParam, value: string, history?: UrlHistory) => void;
const CLEARED_BY: Readonly<Record<LinkParam, UrlParamValues>> = {
  analysis: { link: null, links_page: null },
  link: {},
  links_q: { links_page: null },
  links_status: { links_page: null },
};
export const isRunning = (state: InternalLinkAnalysis['state']) =>
  INTERNAL_LINK_STATES[state].active;

export function useLinkParams() {
  const setUrlParams = useSetUrlParams();
  const params: LinkParams = {
    analysis: useUrlParam('analysis'),
    link: useUrlParam('link'),
    links_q: useUrlParam('links_q'),
    links_status: useUrlParam('links_status'),
  };
  const update: ParamChange = (key, value, history = 'push') => {
    const changed: Partial<Record<LinkParam, string | null>> = {};
    changed[key] = value || null;
    setUrlParams({ ...changed, ...CLEARED_BY[key] }, history);
  };
  return { params, update };
}

function useInternalLinks(scope: Scope, enabled: boolean) {
  const { params, update } = useLinkParams();
  const analysisId = params.analysis || undefined;
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

export function useInternalLinksBands({
  scope,
  enabled,
  canAnalyze = true,
}: Readonly<{
  scope: Scope;
  enabled: boolean;
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
    params.links_q ?? '',
    params.links_status ?? '',
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
  params: LinkParams;
  update: ParamChange;
  links: InternalLink[];
  timeZone: string;
}>): FilterBarProps | undefined {
  if (read.query.isPending) return RESERVED_CONTROLS;
  const data = read.data;
  const analysis = data?.analysis;
  if (!data || !analysis) return undefined;
  return {
    search: (
      <SearchField
        value={params.links_q ?? ''}
        onValueChange={(value) => update('links_q', value, 'replace')}
        placeholder="Search pages and anchors"
        aria-label="Search pages and anchors"
      />
    ),
    filters: [
      choiceFilter({
        id: 'status',
        label: 'Action status',
        value: params.links_status ?? '',
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
      <span className="truncate" title={analysisSummary(analysis)}>
        {analysisSummary(analysis)} · <DisplayTime value={analysis.created_at} />
      </span>
    ),
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

function analysisSummary(analysis: InternalLinkAnalysis): string {
  const parts = [
    `${formatCount(analysis.recommendations.length)} suggestions`,
    `${formatCount(analysis.page_count)} pages analyzed`,
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
