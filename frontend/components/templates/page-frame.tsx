import { lazy, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { pageSection } from '@/components/layout/nav-items';
import { PageTitleContext } from '@/components/layout/page-title-context';
import { ShellContext } from '@/components/layout/shell-context';
import { NavMenuButton } from '@/components/ui/app-shell';
import type { Crumb } from '@/components/ui/breadcrumb';
import { LazyIsland } from '@/components/ui/lazy-island';
import { Masthead, usePublishedHeight } from '@/components/ui/masthead';
import { PageEmptyOfferProvider } from '@/components/ui/masthead-actions';
import { textRole } from '@/components/ui/typography';
import { resolveTitle, routeWidth } from '@/lib/navigation/app-routes';
import { routeTrail } from '@/lib/navigation/route-trail';
import { cn } from '@/lib/utils';

// Only record pages draw a trail, so it stays out of the boot bundle; a route's loading frame fetches it first.
const Breadcrumb = lazy(() =>
  import('@/components/ui/breadcrumb').then(({ Breadcrumb }) => ({ default: Breadcrumb })),
);

export type PageFrameSlots = Readonly<{
  title?: string;
  trail?: readonly Crumb[];
  crumb?: Pick<Crumb, 'label' | 'mark'>;
  actions?: ReactNode;
  tabs?: ReactNode;
  filters?: ReactNode;
}>;

const STRIP =
  'border-rule flex min-w-0 border-b px-[calc(var(--page-pad-inline)+var(--page-start,0px))]';

export function PageFrame({
  title,
  trail,
  crumb,
  actions,
  tabs,
  filters,
  fill,
  children,
}: PageFrameSlots & Readonly<{ fill?: true; children: ReactNode }>) {
  const pathname = useLocation().pathname ?? '';
  const resolved = useRouteTitle(title, pathname);
  const parents = trail ?? routeTrail(pathname);
  const hasTrail = parents.length > 0;
  const width = fill ? 'full' : routeWidth(pathname);
  const shell = useContext(ShellContext);
  const navDrawer = shell?.navDrawer;
  const searchParams = useSearchParams()[0];
  return (
    <PageEmptyOfferProvider>
      <div
        data-page-width={width}
        className={cn('flex min-w-0 flex-1 flex-col', PAGE_START[width])}
      >
        <Masthead
          title={resolved}
          section={mastheadSection(
            pageSection(pathname, searchParams),
            parents[0]?.label ?? resolved,
          )}
          crumb={
            hasTrail ? (
              <LazyIsland failed={null} label="breadcrumb" defects="contain">
                <Breadcrumb parts={[...parents, crumb ?? { label: resolved }]} />
              </LazyIsland>
            ) : null
          }
          lead={
            navDrawer ? <NavMenuButton expanded={navDrawer.open} onOpen={navDrawer.onOpen} /> : null
          }
          search={shell?.searchTrigger}
          actions={actions}
          end={shell?.agentTrigger}
        />
        {hasTrail ? (
          <PageHeading
            title={resolved}
            strips={Boolean(tabs || filters)}
            className={PAGE_COLUMN[width]}
          />
        ) : null}
        {tabs || filters ? <PageStrips tabs={tabs} filters={filters} /> : null}
        <div
          data-page-body=""
          className={cn(
            'flex min-w-0 flex-1 flex-col pt-[var(--page-pad-block)]',
            PAGE_COLUMN[width],
            'pb-6',
          )}
        >
          {children}
        </div>
      </div>
    </PageEmptyOfferProvider>
  );
}

function PageHeading({
  title,
  strips,
  className,
}: Readonly<{ title: string; strips: boolean; className: string | false }>) {
  const block = useRef<HTMLDivElement>(null);
  usePublishedHeight(block, '--page-heading-block-size');
  return (
    <div
      ref={block}
      data-page-heading=""
      className={cn('min-w-0 pt-[var(--page-pad-block)]', strips && 'pb-3', className)}
    >
      <h1 className={textRole('title', 'break-words')}>{title}</h1>
    </div>
  );
}

function PageStrips({ tabs, filters }: Pick<PageFrameSlots, 'tabs' | 'filters'>) {
  const strips = useRef<HTMLDivElement>(null);
  usePublishedHeight(strips, '--strips-block-size');
  return (
    <div
      ref={strips}
      data-page-strips=""
      className="bg-panel z-sticky sticky top-[var(--masthead-block-size,var(--masthead-height))] -mx-[var(--page-pad-inline)] flex min-w-0 flex-col"
    >
      {tabs ? (
        <div data-page-band="tabs" className={cn(STRIP, 'h-[var(--page-tabs-height)] items-end')}>
          {tabs}
        </div>
      ) : null}
      {filters ? (
        <div
          data-page-band="filters"
          className={cn(STRIP, 'min-h-[var(--filter-bar-height)] items-center py-2')}
        >
          {filters}
        </div>
      ) : null}
    </div>
  );
}

type PageWidth = ReturnType<typeof routeWidth>;

const PAGE_COLUMN: Record<PageWidth, string | false> = {
  full: false,
  narrow: 'max-w-thread mx-auto w-full',
  // `max-w-prose` is Tailwind's 65ch, not the 720 `--container-prose`.
  compact: 'mx-auto w-full max-w-[var(--container-prose)]',
};

const PAGE_START: Record<PageWidth, string | false> = {
  full: false,
  narrow: '[--page-start:max(0px,calc((100cqw_-_var(--container-thread))/2))]',
  compact: '[--page-start:max(0px,calc((100cqw_-_var(--container-prose))/2))]',
};

export function PageSections({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <div
      data-page-content=""
      data-rhythm-gap="section"
      className={cn('flex min-w-0 flex-col gap-[var(--page-section-gap)]', className)}
    >
      {children}
    </div>
  );
}

function mastheadSection(section: Readonly<{ title: string }>, firstName: string) {
  return section.title === firstName ? null : section;
}

function useRouteTitle(title: string | undefined, pathname: string) {
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
