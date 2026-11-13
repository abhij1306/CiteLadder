import { useContext, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

import { AppGrid } from '@/components/ui/app-grid';
import { NavMenuButton } from '@/components/ui/app-shell';
import { BackButton } from '@/components/ui/back-button';
import type { FilterDefinition } from '@/components/ui/all-filters';
import { FilterBar, FilterControls, type FilterBarProps } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { QueryState } from '@/components/ui/query-state';
import { TabRow, type TabRowProps } from '@/components/ui/tabs';
import { resolveTitle } from '@/lib/navigation/app-routes';

import { PageTitleContext } from './page-title-context';
import { ShellContext } from './shell-context';

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
  /** Overrides the route-derived title (rare — prefer the route manifest's title). */
  title?: string;
  /** Route-owned controls; their state and outcomes stay with the route owner. */
  actions?: ReactNode;
  /** The route's tabs, drawn as the `TabRow`; the route owns the `TabsRoot`. */
  tabs?: TabRowProps<T>;
  /**
   * The selected tab's control row, drawn as the `FilterBar`: view, search,
   * All filters, then the count and the action at its end (D57). A row of
   * filters alone follows the tabs, or with no tabs the header's title (D60).
   */
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

/**
 * ListScreen — a collection, dashboard or workspace route. A workspace opened
 * from a record (the Agent's page workspace, from its Action) leads its title
 * with `back`, as a detail page does.
 */
export function ListScreen<T extends string = string>(
  props: ScreenBands<T> & FillLayout & Readonly<{ back?: PageBack }> & NarrowLayout,
) {
  return <PageShell {...props} />;
}

/**
 * `narrow` centres the tabs, controls and content in one column at the thread
 * width (`max-w-thread`, the Agent's): settings, a short list or a setup page
 * whose rows would leave their actions stranded at a wide page's far edge (D61).
 */
type NarrowLayout = Readonly<{ narrow?: boolean }>;

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
 * or controls, then the content: one stack, the main column beside its
 * `aside` (AppGrid `main-aside`), or, with `column`, one centered column at
 * the thread width (`max-w-thread`, the Agent's) whose sections stand apart
 * like the page's bands (an Action).
 */
export function DetailScreen<T extends string = string>({
  back,
  lead,
  aside,
  column = false,
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
    /** One centered column instead of the full width. */
    column?: boolean;
  }>) {
  return (
    <PageShell {...bands} back={back}>
      {lead}
      <DetailContent column={column} aside={aside}>
        {children}
      </DetailContent>
    </PageShell>
  );
}

function DetailContent({
  column,
  aside,
  children,
}: Readonly<{ column: boolean; aside: ReactNode; children: ReactNode }>) {
  if (column)
    return (
      <div className="max-w-thread mx-auto flex w-full min-w-0 flex-col gap-[var(--page-section-gap)]">
        {children}
      </div>
    );
  if (!aside) return children;
  return (
    <AppGrid layout="main-aside">
      <div className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{children}</div>
      <aside className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{aside}</aside>
    </AppGrid>
  );
}

function PageShell<T extends string>({
  title,
  back,
  actions,
  tabs,
  controls,
  narrow = false,
  children,
  ...layout
}: ScreenBands<T> & FillLayout & Readonly<{ back?: PageBack }> & NarrowLayout) {
  const resolved = useRouteTitle(title);
  const shell = useContext(ShellContext);
  const navDrawer = shell?.navDrawer;
  const content = <PageContent {...layout}>{children}</PageContent>;
  // A control row holding only filters is one button: it follows the title
  // rather than taking a band of its own, its menus opening toward the content.
  const headerFilters = !tabs && controls && filtersOnly(controls) ? controls.filters : undefined;
  return (
    // header → 16 → tabs → 8 → filters → 8 → content; header → 16 → content.
    <div className="flex min-w-0 flex-col gap-[var(--page-section-gap)]">
      <PageHeader
        title={resolved}
        filters={headerFilters ? <FilterControls filters={headerFilters} /> : undefined}
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
        center={shell?.searchTrigger}
        actions={
          <>
            {actions}
            {shell?.agentTrigger}
          </>
        }
      />
      <NarrowColumn narrow={narrow}>
        <ControlBands tabs={tabs} controls={headerFilters ? undefined : controls}>
          {content}
        </ControlBands>
      </NarrowColumn>
    </div>
  );
}

function NarrowColumn({ narrow, children }: Readonly<{ narrow: boolean; children: ReactNode }>) {
  if (!narrow) return children;
  return (
    <div data-page-column="narrow" className="max-w-thread mx-auto w-full min-w-0">
      {children}
    </div>
  );
}

/** The tab row and the control row over the content, 8 apart; the content alone without them. */
function ControlBands<T extends string>({
  tabs,
  controls,
  children,
}: Pick<ScreenBands<T>, 'tabs' | 'controls'> & Readonly<{ children: ReactNode }>) {
  if (!tabs && !controls) return children;
  // On a tabbed page, a row of filters (and its live note) follows the tabs (D60).
  const onTabRow = Boolean(tabs && controls && joinsTabRow(controls));
  return (
    <div className="flex min-w-0 flex-col gap-[var(--page-band-gap)]">
      {tabs ? (
        <div data-page-band="control" className="flex min-w-0 flex-wrap items-center gap-2">
          <TabRow {...tabs} />
          {controls && onTabRow ? (
            <div className="flex min-w-0 flex-1">
              <FilterBar {...controls} />
            </div>
          ) : null}
        </div>
      ) : null}
      {controls && !onTabRow ? (
        <div data-page-band="control">
          <FilterBar {...controls} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Whether a control row carries filters and nothing else (no view, search, count or action). */
function filtersOnly(controls: FilterBarProps): controls is FilterBarProps & {
  filters: readonly FilterDefinition[];
} {
  return (
    Boolean(controls.filters?.length) &&
    !controls.view &&
    !controls.search &&
    controls.status === undefined &&
    !controls.actions
  );
}

/** Whether a control row is filters, with at most a live note: no view, search or action. */
function joinsTabRow(controls: FilterBarProps) {
  return (
    Boolean(controls.filters?.length) && !controls.view && !controls.search && !controls.actions
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
      {/* The scrollbar's track is reserved on both edges, so content centred
          in the region shares its centre with the dock below it. */}
      <section
        ref={scrollRef}
        aria-label={scrollLabel}
        className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto overscroll-contain"
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
