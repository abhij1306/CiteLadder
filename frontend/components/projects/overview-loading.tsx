import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

import type {
  OverviewLayout,
  OverviewWidget,
  OverviewWidgetKey,
} from '@citeladder/contracts/overview';
import { PageSections } from '@/components/templates/page-frame';
import { AppGrid } from '@/components/ui/app-grid';
import {
  ReportSkeletonFrame,
  WidgetCardBlocks,
  type LoadingShape,
} from '@/components/ui/skeleton-block';
import { projectKeys } from '@/lib/api/query-keys/core';
import { overviewRows } from '@/lib/overview/layout';
import { useOptionalProjectContext } from '@/lib/project/project-scope';

const WIDGET_SHAPES: Record<OverviewWidgetKey, LoadingShape> = {
  project_state: { kind: 'figures', count: 4 },
  movement: { kind: 'chart', height: 'sm' },
  next_action: { kind: 'list', rows: 3 },
  missing_prompts: { kind: 'list', rows: 3 },
  ranked_actions: { kind: 'list', rows: 3 },
  company_facts: { kind: 'facts', rows: 3 },
  visibility_trend: { kind: 'chart', height: 'sm' },
  share_of_voice: { kind: 'facts', rows: 5 },
  top_movers: { kind: 'facts', rows: 5 },
  retrieval: { kind: 'facts', rows: 5 },
  perception: { kind: 'figures', count: 3 },
  ai_traffic: { kind: 'figures', count: 3 },
  search_console: { kind: 'figures', count: 3 },
};

const DEFAULT_WIDGETS: readonly OverviewWidget[] = [
  { key: 'project_state', size: 'full' },
  { key: 'movement', size: 'half' },
  { key: 'next_action', size: 'half' },
  { key: 'missing_prompts', size: 'full' },
  { key: 'ranked_actions', size: 'full' },
  { key: 'company_facts', size: 'full' },
];

export function overviewWidgetShape(key: OverviewWidgetKey): LoadingShape {
  return WIDGET_SHAPES[key];
}

function useCachedWidgets(): readonly OverviewWidget[] | undefined {
  const client = useContext(QueryClientContext);
  const project = useOptionalProjectContext()?.activeProject;
  if (!client || !project) return undefined;
  const key = projectKeys.overviewLayout({
    workspaceId: project.workspace_id,
    projectId: project.id,
  });
  return client.getQueryData<OverviewLayout>(key)?.widgets;
}

export function OverviewLoading({ widgets }: Readonly<{ widgets?: readonly OverviewWidget[] }>) {
  const cached = useCachedWidgets();
  const shown = widgets ?? cached ?? DEFAULT_WIDGETS;
  const block = (widget: OverviewWidget) => (
    <section key={widget.key} data-loading-widget={widget.key} className="min-w-0">
      <WidgetCardBlocks shape={WIDGET_SHAPES[widget.key]} />
    </section>
  );
  return (
    <ReportSkeletonFrame label="Loading the Overview" variant="overview">
      <PageSections>
        {overviewRows(shown).map((row) =>
          row.length === 1 ? (
            block(row[0])
          ) : (
            <AppGrid key={row.map((widget) => widget.key).join()} layout="halves">
              {row.map(block)}
            </AppGrid>
          ),
        )}
      </PageSections>
    </ReportSkeletonFrame>
  );
}
