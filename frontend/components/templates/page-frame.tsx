import { lazy, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { pageSection } from '@/components/layout/nav-items';
import { PageTitleContext } from '@/components/layout/page-title-context';
import { ShellContext } from '@/components/layout/shell-context';
import { NavMenuButton } from '@/components/ui/app-shell';
import type { Crumb } from '@/components/ui/breadcrumb';
import { LazyIsland } from '@/components/ui/lazy-island';
import { Masthead, usePublishedHeight } from '@/components/ui/masthead';
import {
  MastheadOverflow,
  MastheadPrimarySlot,
  PageEmptyOfferProvider,
} from '@/components/ui/masthead-actions';
import { TAB_BASELINE } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { resolveTitle, routeWidth } from '@/lib/navigation/app-routes';
import { useUrlSearch } from '@/lib/navigation/url-params';
import { routeTrail } from '@/lib/navigation/route-trail';
import { cn } from '@/lib/utils';

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

const STRIP = 'flex min-w-0 px-[calc(var(--page-pad-inline)+var(--page-start,0px))]';

export function PageFrame({
  title,
  trail,
  crumb,
  actions,
  tabs,
  filters,
  fill,
  head = 'page',
  children,
}: PageFrameSlots & Readonly<{ fill?: true; head?: 'page' | 'masthead'; children: ReactNode }>) {
  const pathname = useLocation().pathname ?? '';
  const resolved = useRouteTitle(title, pathname);
  const parents = trail ?? routeTrail(pathname);
  const hasTrail = parents.length > 0;
  const width = fill ? 'fill' : routeWidth(pathname);
  const headed = head === 'page' || hasTrail;
  return (
    <PageEmptyOfferProvider>
      <div
        data-page-width={width}
        className={cn('flex min-w-0 flex-1 flex-col', PAGE_START[width])}
      >
        <PageMasthead
          pathname={pathname}
          title={resolved}
          parents={parents}
          crumb={crumb}
          heading={!headed}
          actions={head === 'masthead' ? actions : undefined}
        />
        {headed ? (
          <PageHeading
            title={resolved}
            actions={head === 'page' ? actions : undefined}
            strips={Boolean(tabs || filters)}
            className={PAGE_COLUMN[width]}
          />
        ) : null}
        {tabs || filters ? <PageStrips tabs={tabs} filters={filters} /> : null}
        <div
          data-page-body=""
          className={cn('flex min-w-0 flex-1 flex-col pt-3', PAGE_COLUMN[width], 'pb-6')}
        >
          {children}
        </div>
      </div>
    </PageEmptyOfferProvider>
  );
}

function PageMasthead({
  pathname,
  title,
  parents,
  crumb,
  heading,
  actions,
}: Readonly<{
  pathname: string;
  title: string;
  parents: readonly Crumb[];
  crumb: PageFrameSlots['crumb'];
  heading: boolean;
  actions: ReactNode;
}>) {
  const shell = useContext(ShellContext);
  const navDrawer = shell?.navDrawer;
  const searchParams = useUrlSearch();
  return (
    <Masthead
      title={title}
      section={mastheadSection(pageSection(pathname, searchParams), parents[0]?.label ?? title)}
      crumb={
        parents.length > 0 ? (
          <LazyIsland failed={null} label="breadcrumb" defects="contain">
            <Breadcrumb parts={[...parents, crumb ?? { label: title }]} />
          </LazyIsland>
        ) : null
      }
      lead={
        navDrawer ? <NavMenuButton expanded={navDrawer.open} onOpen={navDrawer.onOpen} /> : null
      }
      search={shell?.searchTrigger}
      heading={heading}
      actions={actions}
      end={shell?.agentTrigger}
    />
  );
}

function PageHeading({
  title,
  actions,
  strips,
  className,
}: Readonly<{ title: string; actions?: ReactNode; strips: boolean; className: string | false }>) {
  const block = useRef<HTMLDivElement>(null);
  usePublishedHeight(block, '--page-heading-block-size');
  const [primarySlot, setPrimarySlot] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={block}
      data-page-heading=""
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 pt-[var(--page-pad-block)]',
        strips && 'pb-3',
        className,
      )}
    >
      <h1 className={textRole('pageTitle', 'min-w-0 break-words')}>{title}</h1>
      {actions === undefined ? null : (
        <div
          data-page-actions=""
          className="ms-auto flex min-h-[var(--control-md)] min-w-0 flex-wrap items-center justify-end gap-2"
        >
          <MastheadPrimarySlot value={primarySlot}>
            <MastheadOverflow label="Page actions">{actions}</MastheadOverflow>
          </MastheadPrimarySlot>
          <span ref={setPrimarySlot} data-masthead-primary="" className="contents" />
        </div>
      )}
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
      className="bg-page z-sticky sticky top-[var(--masthead-block-size,var(--masthead-height))] -mx-[var(--page-pad-inline)] -my-3 flex min-w-0 flex-col gap-3 py-3"
    >
      {tabs ? (
        <div data-page-band="tabs" className={cn(STRIP, 'h-[var(--page-tabs-height)] items-end')}>
          <div className={cn('flex min-w-0 flex-1 items-end', TAB_BASELINE)}>{tabs}</div>
        </div>
      ) : null}
      {filters ? (
        <div data-page-band="filters" className={cn(STRIP, 'items-center')}>
          {filters}
        </div>
      ) : null}
    </div>
  );
}

type PageWidth = ReturnType<typeof routeWidth> | 'fill';

const COLUMN_START = 'ms-[var(--page-start)] w-full';

const PAGE_START: Record<PageWidth, string | false> = {
  fill: false,
  full: '[--page-start:max(0px,calc((100cqw_-_var(--container-app))/2))]',
  narrow: '[--page-start:max(0px,calc((100cqw_-_var(--container-page))/2))]',
  compact: '[--page-start:max(0px,calc((100cqw_-_var(--container-measure))/2))]',
};

const PAGE_COLUMN: Record<PageWidth, string | false> = {
  fill: false,
  full: cn(COLUMN_START, 'max-w-[var(--container-app)]'),
  narrow: cn(COLUMN_START, 'max-w-[var(--container-page)]'),
  compact: cn(COLUMN_START, 'max-w-[var(--container-measure)]'),
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
