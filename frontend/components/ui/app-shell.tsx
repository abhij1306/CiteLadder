import { useId, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';
import { ChevronsUpDown, Menu, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The signed-in frame (the system's AppShell and AppSidebar parts).
 *
 * From the `shell:` variant (1280px) the sidebar is the full `sidebar-width`
 * column with labels; from `rail:` (900px) to `shell:` it is a rail one
 * control wide (decision D3) whose rows show only their icons and name
 * themselves in right-side tooltips, and the main gutter (`--content-gutter`)
 * narrows from 24 to 16. Below `rail:` there is no sidebar column: the page
 * header's menu button opens the same sidebar, labelled, in a left drawer
 * (`NavDrawerFrame`; owner, 2026-11-06). `labelled:` styles the sidebar
 * wherever it shows its labels. The page bands (header, controls, content)
 * are the page template's (`components/layout/page-shell.tsx`).
 *
 * The sidebar and the page share their lines (decisions D11, D12): the
 * project switcher's cell and the PageHeader are one sticky top bar
 * (`page-header-band`, ruled underneath), and the mode switch and the
 * palette field sit where the page's tabs and filter rows do. The main
 * column is a size container so the bar's rule and fill run edge to edge
 * whatever the page's width.
 *
 * The layout shell composes these with the real navigation and data; these
 * pieces own every number.
 */
const FRAME =
  'bg-paper text-ink shell:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] rail:grid-cols-[var(--sidebar-rail-width)_minmax(0,1fr)] grid min-h-dvh grid-cols-[minmax(0,1fr)]';
const SIDEBAR_COLUMN = 'border-line rail:block sticky top-0 hidden h-dvh min-w-0 border-r';
const PAGE = 'mx-auto flex w-full max-w-[var(--content-max-width)] min-w-0 flex-col';
const MAIN_INSET = '@container min-w-0 px-[var(--content-gutter)] pb-[var(--content-gutter)]';

export function AppShellFrame({
  sidebar,
  children,
}: Readonly<{ sidebar: ReactNode; children: ReactNode }>) {
  return (
    <div data-app-surface="" className={FRAME}>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <aside className={SIDEBAR_COLUMN}>{sidebar}</aside>
      <main id="main" tabIndex={-1} className={MAIN_INSET}>
        <div className={PAGE}>{children}</div>
      </main>
    </div>
  );
}

/**
 * The frame before the session resolves: the sidebar's column, empty (its
 * contents would be private), and the page inset exactly where the settled
 * shell puts it, so only the sidebar fills in when the shell opens.
 */
export function AppShellPlaceholder({
  busy,
  children,
}: Readonly<{ busy: boolean; children: ReactNode }>) {
  return (
    <div className={FRAME} aria-busy={busy || undefined}>
      <div className={SIDEBAR_COLUMN} />
      <div className={MAIN_INSET}>
        <div className={PAGE}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The sidebar's column, on the page's lines: the project switcher in the
 * top bar's cell (`page-header-band`, 56, ruled underneath like the
 * PageHeader, decision D12), level with the page title; `page-section-gap`
 * under it the controls (mode switch, then the palette field
 * `page-band-gap` below, as the page's tabs and filters are), then the
 * scrolling destinations and the account at the foot. There is no logo
 * (decision D11). In the rail the destinations do not scroll, so their
 * tooltips are never clipped. In the navigation drawer the ident row leaves
 * room for the drawer's close button.
 */
export function SidebarFrame({
  ident,
  controls,
  nav,
  foot,
}: Readonly<{ ident: ReactNode; controls: ReactNode; nav: ReactNode; foot: ReactNode }>) {
  return (
    <div className="flex h-full flex-col gap-[var(--page-section-gap)] px-3 pb-3">
      <div
        data-top-bar=""
        className="border-line -mx-3 flex h-[var(--page-header-band)] shrink-0 items-center border-b px-3 in-data-[nav-drawer]:pe-12"
      >
        {ident}
      </div>
      <div className="flex flex-col gap-[var(--page-band-gap)]">{controls}</div>
      <div className="labelled:overflow-y-auto -mx-3 flex min-h-0 flex-1 flex-col gap-4 px-3 py-1">
        {nav}
      </div>
      <div className="flex">{foot}</div>
    </div>
  );
}

/**
 * The project switcher's and the account's trigger: as tall as the
 * PageHeader's title row (`row-app`, 40) with two lines (the name in
 * `ink`, the domain or workspace in `ink-muted`), ghost until hovered or
 * open. In the rail it holds only its mark.
 */
export function SidebarIdentButton({
  lead,
  title,
  meta,
  ref,
  className,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'button'>, 'title'> & {
    lead: ReactNode;
    title: string;
    meta?: string;
    ref?: Ref<HTMLButtonElement>;
  }
>) {
  return (
    <button
      ref={ref}
      type="button"
      data-sidebar-ident=""
      className={cn(
        'focus-ring text-ink hover:bg-surface-sunken data-[state=open]:bg-surface-sunken disabled:text-ink-muted labelled:justify-start labelled:px-3 flex h-[var(--row-app)] w-full min-w-0 items-center justify-center gap-3 rounded-md text-left transition-colors disabled:pointer-events-none',
        className,
      )}
      {...props}
    >
      {lead}
      <span className="labelled:flex hidden min-w-0 flex-1 flex-col">
        <span className="type-control text-ink truncate">{title}</span>
        {meta ? <span className="type-caption truncate">{meta}</span> : null}
      </span>
      <ChevronsUpDown
        className="text-ink-muted labelled:block hidden size-4 shrink-0"
        aria-hidden
      />
    </button>
  );
}

/** A titled group of destinations; the title hides in the rail. */
export function SidebarNavGroup({
  title,
  children,
}: Readonly<{ title?: string | null; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5">
      {title ? (
        <p className="type-caption labelled:flex hidden min-h-7 items-center px-3 font-medium">
          {title}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

/**
 * A destination row's face, for the link that carries it: 36px, the label
 * in `ink-secondary`; the current row takes the selected-tab face (`surface`,
 * `shadow-xs`, `ink`) and its icon turns Flare, the app's one selected-nav
 * marker. In the rail the row is one control square. The row is at least
 * one control tall: a label that cannot fit (larger text spacing, WCAG
 * 1.4.12) wraps and the row grows, so no label is cut.
 */
export function sidebarNavRowClasses(active: boolean, plain = false) {
  return cn(
    'focus-ring group type-control labelled:justify-start labelled:px-3 flex min-h-[var(--control-md)] shrink-0 items-center justify-center gap-2 rounded-md transition-colors',
    active
      ? 'bg-surface text-ink shadow-xs'
      : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
    plain && 'labelled:flex hidden font-normal',
  );
}

/**
 * A destination row's content: the 16px icon, the label and a count slot of
 * a fixed 4ch, so a count arriving never moves the label. In the rail the
 * label and count stay for assistive technology only; where labels show, a
 * long label wraps rather than being cut.
 */
export function SidebarNavRowContent({
  icon: Icon,
  label,
  active,
  count,
}: Readonly<{ icon?: LucideIcon; label: string; active: boolean; count?: ReactNode }>) {
  return (
    <>
      {Icon ? (
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            active ? 'text-accent' : 'text-ink-muted group-hover:text-ink',
          )}
          aria-hidden
        />
      ) : null}
      <span className="labelled:not-sr-only labelled:min-w-0 labelled:flex-1 sr-only break-words">
        {label}
      </span>
      {Icon ? (
        <span className="type-caption labelled:not-sr-only labelled:w-[4ch] labelled:shrink-0 labelled:text-right sr-only font-mono tabular-nums">
          {count}
        </span>
      ) : null}
    </>
  );
}

const SHELL_QUERY = '(min-width: 1280px)';

/**
 * True while the row sits in the rail, where its tooltip names it; in the
 * navigation drawer and the full sidebar its own label does.
 */
function isRail(trigger: HTMLElement) {
  if (trigger.closest('[data-nav-drawer]')) return false;
  return typeof window === 'undefined' || !window.matchMedia?.(SHELL_QUERY).matches;
}

/**
 * The page header's menu button below `rail:` (900px), where there is no
 * sidebar column: it opens the navigation drawer. Hidden from `rail:` up.
 */
export function NavMenuButton({
  expanded,
  onOpen,
}: Readonly<{ expanded: boolean; onOpen: () => void }>) {
  return (
    <IconButton
      icon={Menu}
      label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onOpen}
      className="rail:hidden shrink-0"
    />
  );
}

/**
 * The navigation drawer below `rail:`: the sidebar, labelled, in the left
 * sheet (`Drawer side="left"`, full height). The dialog traps focus, Escape
 * closes it and focus returns to the menu button; the shell closes it when
 * the route changes.
 */
export function NavDrawer({
  open,
  onOpenChange,
  children,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }>) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title="Navigation"
      hideHeader
      body="dock"
      closeLabel="Close navigation"
    >
      <div data-nav-drawer="" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </Drawer>
  );
}

/**
 * A list of records below the sidebar's destinations (Agent mode's chats):
 * its label, then its controls and rows, 8 apart. The rail drops it: its rows
 * are plain records, not destinations. The sidebar precedes the page's H1, so
 * the label is not a heading.
 */
export function SidebarRecordSection({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  const labelId = useId();
  return (
    <section aria-labelledby={labelId} className="labelled:flex hidden flex-col gap-2">
      <p id={labelId} className="type-caption flex min-h-7 items-center px-3">
        {label}
      </p>
      {children}
    </section>
  );
}

/** A sentence standing in for a record list's rows (none yet, none match, a failed read). */
export function SidebarRecordNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={textRole('caption', 'px-3')}>{children}</p>;
}

/** A record list's rows. */
export function SidebarRecordRows({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className="flex flex-col gap-0.5">{children}</ul>;
}

/** One record row: its title over a caption line, current when it is the page. */
export function SidebarRecordRow({
  href,
  active,
  title,
  meta,
}: Readonly<{ href: string; active: boolean; title: string; meta: ReactNode }>) {
  return (
    <li>
      <Link
        to={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          sidebarNavRowClasses(active, true),
          'h-auto flex-col items-stretch gap-0.5 py-2',
        )}
      >
        <span className="truncate">{title}</span>
        {meta}
      </Link>
    </li>
  );
}

/** A record row's caption line, or a working marker while the record runs. */
export function SidebarRecordMeta({
  working,
  children,
}: Readonly<{ working?: boolean; children?: ReactNode }>) {
  if (working)
    return (
      <span className={textRole('caption', 'flex items-center gap-2')}>
        <Spinner className="text-ink-muted" />
        Working…
      </span>
    );
  return children ? <span className={textRole('caption', 'truncate')}>{children}</span> : null;
}

/** Names a row in the rail; above it the row's own label does, so it never opens. */
export function SidebarRowTooltip({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Tooltip content={label} side="right" describe={false} shouldOpen={isRail}>
      {children}
    </Tooltip>
  );
}
