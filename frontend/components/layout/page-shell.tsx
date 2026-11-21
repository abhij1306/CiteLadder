import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { OverviewLoading } from '@/components/projects/overview-loading';
import { IssuesPageLoading } from '@/components/site-health/issues-summary-loading';
import { PageFrame } from '@/components/templates/page-frame';
import { ReportPage } from '@/components/templates/report-page';
import { NewChatLoading, ThreadPageLoading } from '@/components/templates/thread-page';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { TextLineSkeleton } from '@/components/ui/loading-parts';
import { RailColumns } from '@/components/templates/settings-page';
import { HeldTabRail, HeldTabRow } from '@/components/ui/tabs';
import { ShapeBlocks, SkeletonFrame, type LoadingShape } from '@/components/ui/skeleton-block';
import { FRAME_FACE } from '@/components/ui/slip';
import { routeLoading } from '@/lib/navigation/app-routes';
import type { HeldTabs, RouteLoading } from '@/lib/navigation/route-types';
import { cn } from '@/lib/utils';

export const RESERVED_CONTROLS: FilterBarProps = {};

export function RouteLoadingScreen() {
  const location = useLocation();
  const loading = routeLoading(location.pathname);
  switch (loading.kind) {
    case 'overview':
      return (
        <ReportPage>
          <OverviewLoading />
        </ReportPage>
      );
    case 'issues':
      return (
        <ReportPage>
          <IssuesPageLoading />
        </ReportPage>
      );
    case 'thread':
      return <ThreadPageLoading />;
    case 'new-chat':
      return <NewChatLoading />;
    case 'cards': {
      const skeleton = (
        <SkeletonFrame
          label="Loading…"
          variant="route"
          className={cn(
            'flex flex-col',
            loading.stacked ? 'gap-[var(--workspace-gap)]' : 'gap-[var(--page-section-gap)]',
          )}
        >
          {loading.intro ? (
            <span data-loading-shape="intro" className="flex flex-col gap-1">
              <TextLineSkeleton text="heading" width="long" />
              <TextLineSkeleton text="body" width="long" />
            </span>
          ) : null}
          {loading.shapes.map((shape, index) => (
            <ShapeBox key={index} shape={shape} />
          ))}
        </SkeletonFrame>
      );
      return (
        <PageFrame
          tabs={
            loading.tabs ? <RouteTabs tabs={loading.tabs} search={location.search} /> : undefined
          }
          filters={loading.filters ? <FilterBar {...RESERVED_CONTROLS} /> : undefined}
        >
          {loading.rail ? (
            <RouteRail rail={loading.rail} search={location.search}>
              {skeleton}
            </RouteRail>
          ) : (
            skeleton
          )}
        </PageFrame>
      );
    }
    default: {
      const exhaustive: never = loading;
      return exhaustive;
    }
  }
}

function RouteRail({
  rail,
  search,
  children,
}: Readonly<{
  rail: NonNullable<Extract<RouteLoading, { kind: 'cards' }>['rail']>;
  search: string;
  children: ReactNode;
}>) {
  const value = new URLSearchParams(search).get(rail.param);
  const current = rail.items.find((item) => item.value === value) ?? rail.items[0];
  return (
    <RailColumns
      wide={current !== undefined && (rail.wide ?? []).includes(current.value)}
      rail={<HeldTabRail labels={rail.items.map((item) => item.label)} selected={current?.label} />}
    >
      {children}
    </RailColumns>
  );
}

function RouteTabs({ tabs, search }: Readonly<{ tabs: HeldTabs; search: string }>) {
  const value = new URLSearchParams(search).get(tabs.param);
  return (
    <HeldTabRow
      labels={tabs.items.map((item) => item.label)}
      selected={tabs.items.find((item) => item.value === value)?.label}
    />
  );
}

function ShapeBox({ shape }: Readonly<{ shape: LoadingShape }>) {
  const blocks = <ShapeBlocks shape={shape} />;
  switch (shape.kind) {
    case 'figures':
    case 'thread':
    case 'facts':
    case 'list':
      return (
        <div data-loading-shape={shape.kind} className="min-w-0">
          {blocks}
        </div>
      );
    case 'table':
      return (
        <div data-loading-shape={shape.kind} className={cn(FRAME_FACE, 'min-w-0 overflow-hidden')}>
          {blocks}
        </div>
      );
    case 'chart':
      return (
        <div data-loading-shape={shape.kind} className={cn(FRAME_FACE, 'min-w-0 px-4 py-3')}>
          {blocks}
        </div>
      );
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}
