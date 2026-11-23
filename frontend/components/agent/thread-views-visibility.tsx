import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import type { Visibility } from '@citeladder/contracts';
import type { AgentView } from '@citeladder/contracts/agent-views';
import { isForbidden, ViewFrame, ViewUnavailable } from '@/components/agent/thread-view-frame';
import { RankingRowsTable } from '@/components/visibility/ranking-rows';
import { DomainTable } from '@/components/visibility/source-rows';
import { SelectionGate } from '@/components/visibility/selection-gate';
import { tableState } from '@/components/visibility/visibility-sources';
import {
  BrandTrendPanel,
  metricCodec,
  type Metric,
} from '@/components/visibility/visibility-trends';
import { agentViewHref } from '@/lib/agent/view-links';
import type { VisibilityCohortParam } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { subsetChangeNote } from '@/lib/visibility/coverage';
import { sortItems, type SortState } from '@/lib/visibility/sources';
import { rangeToFrom } from '@/lib/visibility/trends';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
type VisibilityView<Kind extends AgentView['kind']> = Extract<AgentView, { kind: Kind }>;
type Selection = Readonly<{ market_id: string | null; topic_id: string | null }>;

const COHORT: VisibilityCohortParam = 'core';
const SOURCE_ROWS = 10;

function selectionParams(view: Selection) {
  return {
    market: view.market_id ?? undefined,
    topic: view.topic_id ?? undefined,
    cohort: COHORT,
  };
}

function useLatestSelection(scope: Scope, view: Selection) {
  return useQuery(
    visibilityQueries.project(scope, { ...selectionParams(view), selection_mode: 'latest' }),
  );
}

function VisibilityFrame({
  title,
  scope,
  view,
  children,
}: Readonly<{
  title: string;
  scope: Scope;
  view: VisibilityView<'visibility_trend' | 'visibility_ranking' | 'visibility_sources'>;
  children: (selected: Visibility) => ReactNode;
}>) {
  const selection = useLatestSelection(scope, view);
  return (
    <ViewFrame title={title} href={agentViewHref(view)}>
      {isForbidden(selection.error) ? (
        <ViewUnavailable />
      ) : (
        <SelectionGate query={selection}>{children}</SelectionGate>
      )}
    </ViewFrame>
  );
}

export function TrendView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: VisibilityView<'visibility_trend'> }>) {
  const [metric, setMetric] = useState<Metric>(() => metricCodec.parse(null));
  const [focused, setFocused] = useState<string | null>(null);
  const [from] = useState(() => rangeToFrom(view.range));
  const trend = useQuery(
    visibilityQueries.trends(scope, { ...selectionParams(view), from, granularity: 'run' }),
  );
  return (
    <VisibilityFrame title="Visibility trend" scope={scope} view={view}>
      {(selected) => (
        <BrandTrendPanel
          query={trend}
          selected={selected}
          metric={metric}
          onMetric={setMetric}
          focused={focused}
          onFocus={setFocused}
        />
      )}
    </VisibilityFrame>
  );
}

export function RankingView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: VisibilityView<'visibility_ranking'> }>) {
  return (
    <VisibilityFrame title="Competitor ranking" scope={scope} view={view}>
      {(selected) => (
        <RankingRowsTable
          rows={selected.rankings}
          description={subsetChangeNote(selected) ?? undefined}
        />
      )}
    </VisibilityFrame>
  );
}

export function SourcesView({
  scope,
  view,
}: Readonly<{ scope: Scope; view: VisibilityView<'visibility_sources'> }>) {
  return (
    <VisibilityFrame title="Cited sources" scope={scope} view={view}>
      {(selected) => <SourceRows scope={scope} view={view} auditId={selected.audit_id} />}
    </VisibilityFrame>
  );
}

function SourceRows({
  scope,
  view,
  auditId,
}: Readonly<{
  scope: Scope;
  view: VisibilityView<'visibility_sources'>;
  auditId: string | null;
}>) {
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const [sort, setSort] = useState<SortState>(null);
  const query = useQuery({
    ...visibilityQueries.sources(scope, {
      audit_id: auditId ?? undefined,
      topic: view.topic_id ?? undefined,
      cohort: COHORT,
      dimension: 'domain',
      limit: SOURCE_ROWS,
    }),
    enabled: auditId !== null,
  });
  const rows = sortItems(query.data?.items ?? [], sort);
  return (
    <DomainTable
      rows={rows}
      sort={sort}
      onSort={(column) =>
        setSort(
          sort?.column === column
            ? { column, direction: sort.direction === 'desc' ? 'asc' : 'desc' }
            : { column, direction: 'desc' },
        )
      }
      onOpenDomain={(domain) =>
        void navigate(
          projectHref(
            `/visibility?${new URLSearchParams({ tab: 'urls', source_pick: domain }).toString()}`,
            scope.projectId,
          ),
        )
      }
      retrieval={query.data?.retrieval}
      frame={{
        pageSize: SOURCE_ROWS,
        busy: { active: query.isFetching, label: 'Updating sources' },
        state: tableState({ query, rows, narrowed: false, searching: false, gapOnly: false }),
      }}
    />
  );
}
