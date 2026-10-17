'use client';

import { useContext, useLayoutEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { pageToolbarClasses } from '@/components/ui/workspace';
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
export function PageShell({
  title,
  back,
  actions,
  tabs,
  controls,
  children,
  className,
  measure = 'analytical',
}: Readonly<{
  /** Overrides the route-derived title (rare — prefer `page-titles.ts`). */
  title?: string;
  /** A detail route's link back to its collection, above the title. */
  back?: PageBack;
  /** Route-owned controls; their state and outcomes stay with the route owner. */
  actions?: ReactNode;
  /** The route's tab strip. Pass `<Tabs variant="band">`. */
  tabs?: ReactNode;
  /** Filters, search, range and export for the whole route. */
  controls?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Content measure; page bands retain the analytical alignment. */
  measure?: 'analytical' | 'workflow';
}>) {
  return (
    <>
      <IdentityBand title={title} back={back} actions={actions} />
      {tabs ? <PageBand kind="navigation">{tabs}</PageBand> : null}
      {controls ? (
        <PageBand kind="control" className={pageToolbarClasses}>
          {controls}
        </PageBand>
      ) : null}
      <div
        data-page-measure={measure}
        className={cn(
          pageGutterClasses,
          measure === 'workflow' && 'max-w-[var(--workflow-max-width)]',
          'pt-[var(--content-gutter)] pb-[var(--page-section-gap)]',
          className,
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
      className={cn(
        'border-border-subtle border-b',
        kind === 'control' ? 'bg-panel-tonal' : 'bg-panel',
      )}
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
        'bg-panel border-border-subtle border-b',
        // Below 701px the compact topbar already names the page, so a band
        // holding only a screen-reader title would be an empty ruled row. A
        // back link is visible content, so it keeps the band.
        !actions && !back && 'max-[700px]:hidden',
      )}
    >
      <div
        className={cn(
          pageGutterClasses,
          'flex min-w-0 flex-col gap-[var(--page-header-gap)] pt-[var(--page-header-padding-top)] pb-[var(--page-header-padding-bottom)]',
          'min-[701px]:flex-row min-[701px]:items-center min-[701px]:justify-between',
          // Desktop: the sidebar's switcher line. The title centres on it, and
          // the band below starts where the sidebar's second row starts.
          'min-[981px]:min-h-[var(--page-band-identity)] min-[981px]:py-0',
        )}
      >
        {/* The title keeps a floor, so a long action row wraps rather than
            squeezing the page's name to nothing. */}
        <div
          className={cn(
            'grid min-w-0 flex-1 gap-1 min-[701px]:min-w-[var(--page-title-min-width)]',
            !back && 'max-[700px]:sr-only',
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
          <h1 className={textRole('pageTitle', 'min-w-0 truncate max-[700px]:sr-only')}>
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
              'flex min-w-0 min-h-[var(--control-height-md)] flex-wrap items-center gap-2 min-[701px]:justify-end',
              navigationMode(pathname) === 'dashboard'
                ? 'min-[981px]:pe-[calc(3*var(--control-height-md)+1.25rem)]'
                : 'min-[981px]:pe-[calc(2*var(--control-height-md)+1rem)]',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
