'use client';

import { useContext, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

import { AgentPanelTrigger } from '@/components/agent/agent-panel-host';
import { AppGrid } from '@/components/ui/app-grid';
import { NavMenuButton } from '@/components/ui/app-shell';
import { BackButton } from '@/components/ui/back-button';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { QueryState } from '@/components/ui/query-state';
import { TabRow, type TabRowProps } from '@/components/ui/tabs';

import { NavDrawerContext } from './nav-drawer-context';
import { PageTitleContext } from './page-title-context';
import { resolveTitle } from './page-titles';

/**
 * A detail route's way back to the collection it was opened from, drawn as
 * the round back button before the title.
 */
export type PageBack = Readonly<{
  /** The collection route, e.g. `/runs`; scoped to the project like any app link. */
  href: string;
  /** The button's accessible name and hover hint, e.g. "Back to runs". */
  label: string;
  /** Scope to this project rather than the active one. */
  projectId?: string | null;
}>;

/**
 * The page template every authenticated route is written in: the system's
 * AppShell bands.
 *
 *   1. header   — the PageHeader: the route's one H1 and its actions, the
 *                 page's half of the sticky top bar (decision D12).
 *   2. controls — the route's tabs (settings sections, a screen's views),
 *                 then its FilterBar (search, filters, one action) for the
 *                 selected tab.
 *   3. content  — the work, its cards 12 apart.
 *
 * The template owns every band-to-band gap (decision D11): header → 16 →
 * tabs → 8 → filters → 8 → content (16 straight to the content when there
 * are no controls). The header and the controls sit on the sidebar's lines.
 * A page passes data, organisms and slots and adds no margins between bands.
 */
type ScreenBands<T extends string> = Readonly<{
  /** Overrides the route-derived title (rare — prefer `page-titles.ts`). */
  title?: string;
  /** Route-owned controls; their state and outcomes stay with the route owner. */
  actions?: ReactNode;
  /** The route's tabs, drawn as the `TabRow`; the route owns the `TabsRoot`. */
  tabs?: TabRowProps<T>;
  /** Search, filters, status and export for the whole route, drawn as the `FilterBar`. */
  controls?: FilterBarProps;
  children?: ReactNode;
}>;

/**
 * A screen that fills the viewport below the header (a chat): the content
 * scrolls in its own region and `dock` (a `ComposerDock`) stays under it, so
 * the window, the header and the dock never move while the content grows.
 * `scrollRef` reaches the scrolling region (`useFollowLatest`); `scrollLabel`
 * names it when it holds a conversation.
 */
type FillLayout =
  | Readonly<{ fill?: false; dock?: never; scrollRef?: never; scrollLabel?: never }>
  | Readonly<{
      fill: true;
      dock?: ReactNode;
      scrollRef?: RefObject<HTMLElement | null>;
      scrollLabel?: string;
    }>;

/** ListScreen — a collection, dashboard or workspace route. */
export function ListScreen<T extends string = string>(props: ScreenBands<T> & FillLayout) {
  return <PageShell {...props} />;
}

/**
 * The control band, held while the route's filters wait on their first read.
 * A loading frame passes it as `controls` when the loaded page will have a
 * control band, so the work below starts on the same line in both frames.
 */
export const RESERVED_CONTROLS: FilterBarProps = {};

/**
 * RouteLoadingScreen — the frame a route shows before its own page can draw:
 * the route's header (its title comes from the path) and one loading box
 * where the content begins. The shell's fallback, the route chunk's Suspense
 * boundary and the project gate all draw it, and a page's own first read
 * draws the same box in the same place.
 */
export function RouteLoadingScreen({ label }: Readonly<{ label?: string }>) {
  return (
    <ListScreen>
      <QueryState kind="loading" label={label} />
    </ListScreen>
  );
}

/**
 * DetailScreen — one record: the back button before the title, optional tabs
 * or controls, then the content, either one stack or the main column beside
 * its `aside` (AppGrid `main-aside`).
 */
export function DetailScreen<T extends string = string>({
  back,
  lead,
  aside,
  children,
  ...bands
}: ScreenBands<T> &
  Readonly<{
    back: PageBack;
    /**
     * The record's summary (its URL, status line), full width above the split,
     * so the main column and the aside begin on the same line.
     */
    lead?: ReactNode;
    /** Supporting context beside the main content. */
    aside?: ReactNode;
  }>) {
  return (
    <PageShell {...bands} back={back}>
      {lead}
      {aside ? (
        <AppGrid layout="main-aside">
          <div className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{children}</div>
          <aside className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{aside}</aside>
        </AppGrid>
      ) : (
        children
      )}
    </PageShell>
  );
}

function PageShell<T extends string>({
  title,
  back,
  actions,
  tabs,
  controls,
  children,
  ...layout
}: ScreenBands<T> & FillLayout & Readonly<{ back?: PageBack }>) {
  const resolved = useRouteTitle(title);
  const navDrawer = useContext(NavDrawerContext);
  const content = <PageContent {...layout}>{children}</PageContent>;
  const tabBand = tabs ? (
    <div data-page-band="control">
      <TabRow {...tabs} />
    </div>
  ) : null;
  const filterBand = controls ? (
    <div data-page-band="control">
      <FilterBar {...controls} />
    </div>
  ) : null;
  return (
    // header → 16 → tabs → 8 → filters → 8 → content; header → 16 → content.
    <div className="flex min-w-0 flex-col gap-[var(--page-section-gap)]">
      <PageHeader
        title={resolved}
        lead={
          <>
            {/* Below 900px the header leads with the navigation menu. */}
            {navDrawer ? (
              <NavMenuButton expanded={navDrawer.open} onOpen={navDrawer.onOpen} />
            ) : null}
            {back ? (
              <BackButton href={back.href} label={back.label} projectId={back.projectId} />
            ) : null}
          </>
        }
        actions={
          <>
            {actions}
            <AgentPanelTrigger />
          </>
        }
      />
      {tabBand || filterBand ? (
        <div className="flex min-w-0 flex-col gap-[var(--page-band-gap)]">
          {tabBand}
          {filterBand}
          {content}
        </div>
      ) : (
        content
      )}
    </div>
  );
}

/** The route's title, announced by the shell when a page overrides it. */
function useRouteTitle(title: string | undefined) {
  const pathname = useLocation().pathname ?? '';
  const setTitle = useContext(PageTitleContext);
  useLayoutEffect(() => {
    if (!setTitle || title === undefined) return;
    setTitle(title);
    return () => {
      setTitle((current) => (current === title ? undefined : current));
    };
  }, [setTitle, title]);
  return title ?? resolveTitle(pathname);
}

/**
 * The content band: its cards stack 12 apart. A fill screen's content is
 * exactly the viewport left below the header, so the window never scrolls:
 * the column scrolls in its own region and the dock sits under it.
 */
function PageContent({ children, ...layout }: FillLayout & Readonly<{ children: ReactNode }>) {
  if (!layout.fill) {
    return (
      <div data-page-content="" className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">
        {children}
      </div>
    );
  }
  return (
    <FillContent dock={layout.dock} scrollRef={layout.scrollRef} scrollLabel={layout.scrollLabel}>
      {children}
    </FillContent>
  );
}

function FillContent({
  dock,
  scrollRef,
  scrollLabel,
  children,
}: Readonly<{
  dock: ReactNode;
  scrollRef: RefObject<HTMLElement | null> | undefined;
  scrollLabel: string | undefined;
  children: ReactNode;
}>) {
  return (
    <div className="flex h-[calc(100dvh-var(--route-chrome-height))] min-h-0 flex-col gap-[var(--workspace-gap)]">
      <section
        ref={scrollRef}
        aria-label={scrollLabel}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          data-page-content=""
          className="flex min-h-full min-w-0 flex-col gap-[var(--workspace-gap)]"
        >
          {children}
        </div>
      </section>
      {dock}
    </div>
  );
}
