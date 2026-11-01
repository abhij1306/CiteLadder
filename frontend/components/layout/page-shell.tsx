'use client';

import { useContext, useLayoutEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { TabRow, type TabRowProps } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { splitPaneClasses, type SplitPaneRole } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

import { CompactPageTitleContext } from './compact-page-title-context';
import { navigationMode } from './nav-items';
import { resolveTitle } from './page-titles';

/**
 * A detail route's way back to the collection it was opened from. Rendered
 * above the H1 in the identity band — the one place every detail route puts
 * it, instead of a breadcrumb line at the top of the content.
 */
export type PageBack = Readonly<{
  /** The collection route, e.g. `/runs`; scoped to the project like any app link. */
  href: string;
  /** The link text, e.g. "Back to runs". */
  label: string;
  /** Scope to this project rather than the active one. */
  projectId?: string | null;
}>;

/**
 * PageShell — the grammar every authenticated route is written in.
 *
 * Routes used to assemble their own top area, and no two agreed: five different
 * wrapper gaps, toolbars that were a bare `flex gap-2` on one screen and a
 * `<Card>` on another, tab strips at three heights, and nothing at all drawn
 * between a page's title and its work. The reader had to re-learn where a page
 * began on every navigation.
 *
 * So a page is now four regions in a fixed order, and only the first and last
 * are compulsory:
 *
 *   1. identity   — the route's one H1 and its actions.       (56px, ruled)
 *   2. navigation — the route's tabs, and nothing else.       (40px, ruled)
 *   3. controls   — filters, search, range, export.           (40px, ruled)
 *   4. content    — the work.
 *
 * Two invariants carry the consistency:
 *
 * Every band that is present closes with a hairline, and that hairline is
 * FULL-BLEED — it runs the whole width of the paper, not just the width of the
 * gutter. So the gutter lives inside each band rather than around all of them,
 * and content always begins directly below exactly one rule, at an offset the
 * reader has already seen on the previous screen. A route with no tabs and no
 * filters is not a different kind of page; it is this page with two rows
 * missing, and it still closes its identity band.
 *
 * And the bands are the only place these things may live. Tabs do not carry
 * actions (those are identity's), filters do not ride a section header, and a
 * toolbar is never boxed. That is what makes a screen's first read the same
 * everywhere: the answer to "where does this page start" is structural, not a
 * judgement each route makes for itself.
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
 * ListScreen — the template for a collection, dashboard or workspace route:
 * identity band → optional `TabRow` → optional `FilterBar` → the content
 * stack, its sections 24 apart.
 *
 *   `measure="workflow"` — the narrower reading measure (Agent, Billing).
 *   `fill`               — the content is one column that fills the viewport
 *                          below the shell chrome, so a chat's composer sits
 *                          at the bottom of a short thread.
 *
 * A page passes data, organisms and slots; the template owns every band and
 * every band-to-band gap.
 */
export function ListScreen<T extends string = string>({
  measure = 'analytical',
  fill = false,
  ...bands
}: ScreenBands<T> &
  Readonly<{
    measure?: 'analytical' | 'workflow';
    fill?: boolean;
  }>) {
  return <PageShell {...bands} measure={measure} fill={fill} />;
}

/**
 * DetailScreen — the template for one record: identity band with the way
 * back above the title → optional tabs and controls → the content, either one
 * stack or a split from `splitPaneClasses` when an `aside` is given
 * (`main-aside` by default, `list-detail` for a list beside its selection).
 */
export function DetailScreen<T extends string = string>({
  back,
  aside,
  split = 'main-aside',
  children,
  ...bands
}: ScreenBands<T> &
  Readonly<{
    back: PageBack;
    /** Supporting context beside the main content. */
    aside?: ReactNode;
    split?: Extract<SplitPaneRole, 'main-aside' | 'list-detail'>;
  }>) {
  return (
    <PageShell {...bands} back={back} measure="analytical" fill={false}>
      {aside ? (
        <div className={splitPaneClasses(split)}>
          <div className="grid min-w-0 content-start gap-[var(--page-section-gap)]">{children}</div>
          <aside className="grid min-w-0 content-start gap-[var(--page-section-gap)]">
            {aside}
          </aside>
        </div>
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
  measure,
  fill,
}: ScreenBands<T> &
  Readonly<{
    back?: PageBack;
    measure: 'analytical' | 'workflow';
    fill: boolean;
  }>) {
  return (
    <>
      <IdentityBand title={title} back={back} actions={actions} />
      {/* The tab band opens with the control band's 8px, so the first row
          under the title (tabs or filters) starts on the sidebar search's line;
          the tabs sit on the band's rule. */}
      {tabs ? (
        <PageBand kind="navigation" className="pt-2">
          <TabRow {...tabs} />
        </PageBand>
      ) : null}
      {controls ? (
        <PageBand kind="control">
          <FilterBar {...controls} />
        </PageBand>
      ) : null}
      {/* The content region owns the section rhythm: its sections stand 24px
          apart, whatever each one is. */}
      <div
        data-page-measure={measure}
        className={cn(
          pageGutterClasses,
          measure === 'workflow' && 'max-w-[var(--workflow-max-width)]',
          'grid grid-cols-[minmax(0,1fr)] content-start gap-[var(--page-section-gap)] pt-[var(--content-gutter)] pb-[var(--page-section-gap)]',
          // `--route-chrome-height` (globals.css) owns the chrome above the
          // route at each breakpoint; the gutter is the shell's padding under it.
          fill &&
            'flex min-h-[calc(100dvh-var(--route-chrome-height)-var(--content-gutter))] flex-col pb-0',
        )}
      >
        {children}
      </div>
    </>
  );
}

/**
 * The paper's measure. Bands and content share it so their gutters line up and
 * the rules stop at the same place the work does.
 */
const pageGutterClasses =
  'mx-auto w-full max-w-[var(--content-max-width)] px-[var(--content-gutter)]';

/**
 * One row of the grammar: a full-width rule with a gutter-padded row inside it.
 * The rule is on the outer element precisely so it is not inset — the reason
 * the whole shape reads as ruled paper rather than as a stack of loose boxes.
 *
 * `data-page-band` is the test surface: the design policy forbids tests
 * asserting visual classes, so the grammar is asserted through the attribute.
 */
function PageBand({
  kind,
  className,
  children,
}: Readonly<{
  kind: 'identity' | 'navigation' | 'control';
  className?: string;
  children: ReactNode;
}>) {
  return (
    <div
      data-page-band={kind}
      // Every band is the sheet itself, closed by its rule; cards on the
      // sheet are the raised step, so a band never wears a card's fill.
      className="bg-sheet border-border-subtle border-b"
    >
      <div className={cn(pageGutterClasses, 'flex', className)}>{children}</div>
    </div>
  );
}

function IdentityBand({
  title,
  back,
  actions,
}: Readonly<{ title?: string; back?: PageBack; actions?: ReactNode }>) {
  const pathname = useLocation().pathname ?? '';
  const resolved = title ?? resolveTitle(pathname);
  const setCompactTitle = useContext(CompactPageTitleContext);

  useLayoutEffect(() => {
    if (!setCompactTitle || title === undefined) return;
    setCompactTitle(title);
    return () => {
      setCompactTitle((current) => (current === title ? undefined : current));
    };
  }, [setCompactTitle, title]);

  return (
    <div
      data-page-band="identity"
      className={cn(
        'bg-sheet border-border-subtle border-b',
        // Below the desktop breakpoint the compact topbar already names the
        // page, so a band holding only a screen-reader title would be an
        // empty ruled row. A back link is visible content, so it keeps the band.
        !actions && !back && 'hidden desktop:block',
      )}
    >
      <div
        className={cn(
          pageGutterClasses,
          'flex min-w-0 flex-col gap-[var(--page-header-gap)] pt-[var(--page-header-padding-top)] pb-[var(--page-header-padding-bottom)]',
          // Desktop: one row on the sidebar's switcher line. The title centres
          // on it, and the first row of the band below lines up with the
          // sidebar's search.
          'desktop:flex-row desktop:items-center desktop:justify-between',
          'desktop:min-h-[var(--page-band-identity)] desktop:py-0',
        )}
      >
        {/* The title keeps a floor, so a long action row wraps rather than
            squeezing the page's name to nothing. */}
        <div
          className={cn(
            'grid min-w-0 flex-1 gap-1 desktop:min-w-[var(--page-title-min-width)]',
            !back && 'sr-only desktop:not-sr-only',
          )}
        >
          {back ? (
            <TextLink
              variant="back"
              text="label"
              className="justify-self-start"
              href={back.href}
              projectId={back.projectId}
            >
              {back.label}
            </TextLink>
          ) : null}
          {/* The route H1 is the top of the type ladder: nothing on the page
              out-ranks it except a figure. It stays the one H1 per route. */}
          {/* One row, always: a long title truncates rather than wrapping. */}
          <h1 className={textRole('pageTitle', 'min-w-0 truncate sr-only desktop:not-sr-only')}>
            {resolved}
          </h1>
        </div>
        {actions ? (
          // The shell paints the theme toggle, the account glyph and, on
          // Dashboard routes, the agent trigger at the end of this same row, so
          // route actions reserve that width instead of running underneath it.
          // Desktop-only, because that is the only width the glyphs appear at.
          <div
            className={cn(
              'flex min-w-0 min-h-[var(--control-height-md)] flex-wrap items-center gap-2 desktop:justify-end',
              navigationMode(pathname) === 'dashboard'
                ? 'desktop:pe-[calc(3*var(--control-height-md)+1.25rem)]'
                : 'desktop:pe-[calc(2*var(--control-height-md)+1rem)]',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
