import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { IconButton } from '@/components/ui/button';
import { isTextCut, Tooltip } from '@/components/ui/tooltip';
import {
  ChevronDown,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  type IconGlyph,
} from '@/lib/icons';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/sidebar-width';
import { cn } from '@/lib/utils';

export function SidebarFrame({
  ident,
  mode,
  nav,
  foot,
  account,
}: Readonly<{
  ident: ReactNode;
  mode: ReactNode;
  nav: ReactNode;
  foot: ReactNode;
  account: ReactNode;
}>) {
  return (
    <div className="h-full overflow-hidden">
      <div
        data-sidebar-frame=""
        className="rail:in-data-[sidebar-state=expanded]:w-[var(--sidebar-width-compact)] shell:in-data-[sidebar-state=expanded]:w-[var(--sidebar-width)] rail:in-data-[sidebar-state=collapsed]:w-[var(--sidebar-rail-width)] labelled:gap-2 flex h-full flex-col gap-1 p-2"
      >
        <div
          data-sidebar-ident-cell=""
          className="labelled:h-[var(--masthead-height)] labelled:flex-row flex shrink-0 flex-col items-center gap-1 in-data-[nav-drawer]:pe-10"
        >
          {ident}
        </div>
        {mode}
        {nav}
        <div className="labelled:gap-0.5 flex shrink-0 flex-col">
          <div className="labelled:flex-row labelled:items-center flex min-w-0 flex-col gap-0.5">
            <div className="labelled:flex-1 min-w-0">{foot}</div>
            <SidebarCollapseToggle />
          </div>
          {account}
        </div>
      </div>
    </div>
  );
}

type ScrollEnds = Readonly<{ top: boolean; bottom: boolean }>;

function useScrollEnds(ref: RefObject<HTMLElement | null>): ScrollEnds {
  const [ends, setEnds] = useState<ScrollEnds>({ top: false, bottom: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      // A 1px tolerance: the rounded heights may differ by 1 with nothing hidden.
      const hidden = node.scrollHeight - node.clientHeight;
      const top = hidden > 1 && node.scrollTop > 1;
      const bottom = hidden > 1 && node.scrollTop < hidden - 1;
      setEnds((current) =>
        current.top === top && current.bottom === bottom ? current : { top, bottom },
      );
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const content = node.firstElementChild;
    if (content) {
      observer.observe(content);
      for (const group of content.children) observer.observe(group);
    }
    void document.fonts?.ready.then(update);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref]);
  return ends;
}

const LIST_FADE = 32;

function revealCurrent(list: HTMLElement) {
  const current = list.querySelector<HTMLElement>('[aria-current="page"]');
  if (!current) return;
  const listBox = list.getBoundingClientRect();
  const rowBox = current.getBoundingClientRect();
  const inset = Math.max(0, Math.min(LIST_FADE, (listBox.height - rowBox.height) / 2));
  const above = listBox.top + inset - rowBox.top;
  const below = rowBox.bottom - (listBox.bottom - inset);
  if (above > 0) list.scrollTop -= above;
  else if (below > 0) list.scrollTop += below;
}

export function SidebarScrollList({
  label,
  revealKey,
  children,
}: Readonly<{ label: string; revealKey: string; children: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const ends = useScrollEnds(ref);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    revealCurrent(list);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) revealCurrent(list);
    });
    return () => {
      live = false;
    };
  }, [revealKey]);
  return (
    <div
      ref={ref}
      data-sidebar-scroll=""
      data-fade-top={ends.top || undefined}
      data-fade-bottom={ends.bottom || undefined}
      className="-mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1"
    >
      <nav aria-label={label} className="flex flex-col gap-4">
        {children}
      </nav>
    </div>
  );
}

export function SidebarNavGroup({
  title,
  expanded = true,
  onToggle,
  children,
}: Readonly<{
  title?: string | null;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}>) {
  const listId = useId();
  return (
    <div data-sidebar-group="" className="flex flex-col gap-0.5">
      {title ? (
        <button
          type="button"
          data-sidebar-group-toggle=""
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={onToggle}
          className="focus-ring type-caption-strong text-ink-2 hover:overlay-hover hover:text-ink rounded-control flex h-[var(--nav-row-height)] w-full min-w-0 items-center gap-2 px-2 text-left transition-colors"
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
              !expanded && '-rotate-90',
            )}
          />
        </button>
      ) : null}
      <ul id={listId} aria-label={title ?? undefined} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

const CURRENT_FILL = 'bg-[var(--nav-current-fill)]';
const CURRENT_TILE = cn(CURRENT_FILL, 'text-ink before:bg-accent');
const AT_REST = 'text-ink-2 hover:overlay-hover hover:text-ink';
const NAV_AT_REST = 'text-ink hover:overlay-hover';

export function sidebarNavRowClasses(active: boolean, className?: string) {
  return cn(
    'focus-ring type-label rounded-control relative flex font-normal h-[var(--nav-row-height)] w-full min-w-0 shrink-0 items-center gap-2 px-2 text-left transition-colors',
    'before:rounded-mark before:absolute before:inset-y-2 before:start-0 before:w-[var(--mark-width)]',
    active ? CURRENT_TILE : NAV_AT_REST,
    className,
  );
}

const ROW_ICON = 'size-3.5 shrink-0 in-data-[nav-drawer]:size-5';

export function SidebarNavRowContent({
  icon: Icon,
  label,
  count,
}: Readonly<{ icon: IconGlyph; label: string; count?: ReactNode }>) {
  return (
    <>
      <Icon className={ROW_ICON} aria-hidden />
      <span data-sidebar-text="title" className="min-w-0 flex-1 truncate">
        {label}
      </span>
      {count == null ? null : (
        <span className="w-[4ch] shrink-0 text-right tabular-nums">{count}</span>
      )}
    </>
  );
}

const RAIL_BUTTON = cn(
  'focus-ring rounded-control relative flex size-[var(--rail-button)] shrink-0 items-center justify-center transition-colors [&_svg]:size-3.5',
  'before:rounded-mark before:absolute before:inset-y-2.5 before:start-0 before:w-[var(--mark-width)]',
  'data-[state=open]:overlay-pressed',
);

export function sidebarRailButtonClasses(current: boolean) {
  return cn(RAIL_BUTTON, current ? CURRENT_TILE : NAV_AT_REST);
}

export function sidebarModeTrackClasses(rail: boolean) {
  return rail
    ? 'flex flex-col items-center'
    : 'border-rule rounded-control flex h-[var(--control-md)] w-full min-w-0 shrink-0 border p-px';
}

export function sidebarModeSegmentClasses(current: boolean, rail: boolean) {
  if (rail) return cn(RAIL_BUTTON, current ? cn('text-ink', CURRENT_FILL) : AT_REST);
  return cn(
    'focus-ring type-label rounded-mark relative flex h-full min-w-0 flex-1 basis-0 items-center justify-center px-3 transition-colors',
    current ? cn('text-ink', CURRENT_FILL) : AT_REST,
  );
}

export function RailFlyoutSlot({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="px-2 py-1">{children}</div>;
}

export function SidebarRailList({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <nav
      aria-label={label}
      className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex flex-col items-center">{children}</ul>
    </nav>
  );
}

export function SidebarIdentButton({
  lead,
  title,
  meta,
  current = false,
  pending = false,
  ref,
  className,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'button'>, 'title'> & {
    lead: ReactNode;
    title: string;
    meta?: string;
    current?: boolean;
    pending?: boolean;
    ref?: Ref<HTMLButtonElement>;
  }
>) {
  return (
    <button
      ref={ref}
      type="button"
      data-sidebar-ident=""
      aria-current={current ? 'page' : undefined}
      className={cn(
        'focus-ring text-ink not-data-[state=open]:hover:overlay-hover data-[state=open]:overlay-pressed disabled:text-ink-2 labelled:w-full labelled:h-[var(--control-lg)] labelled:justify-start labelled:px-2 rounded-control flex h-[var(--rail-button)] w-[var(--rail-button)] min-w-0 items-center justify-center gap-2 text-left transition-colors disabled:pointer-events-none',
        current && CURRENT_FILL,
        className,
      )}
      {...props}
    >
      {lead}
      <span className="labelled:flex hidden min-w-0 flex-1 flex-col">
        {pending ? (
          <>
            <span aria-hidden className="bg-well rounded-control my-0.5 block h-4 w-24" />
            <span aria-hidden className="bg-well rounded-control block h-3 w-16" />
          </>
        ) : (
          <>
            <span data-sidebar-text="title" className="type-label text-ink truncate">
              {title}
            </span>
            {meta ? (
              <span data-sidebar-text="meta" className="type-caption text-ink-2 truncate">
                {meta}
              </span>
            ) : null}
          </>
        )}
      </span>
      <ChevronsUpDown className="text-ink-2 labelled:block hidden size-3.5 shrink-0" aria-hidden />
    </button>
  );
}

function SidebarCollapseToggle() {
  const collapsed = useSidebarCollapsed();
  return (
    <IconButton
      icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      shortcut={COLLAPSE_SHORTCUT}
      tooltipSide={collapsed ? 'right' : 'top'}
      aria-keyshortcuts="Meta+Backslash Control+Backslash"
      onClick={() => setSidebarCollapsed(!collapsed)}
      className="rail:inline-flex not-labelled:size-[var(--rail-button)] hidden shrink-0 self-center in-data-[nav-drawer]:hidden"
    />
  );
}

const COLLAPSE_SHORTCUT = 'Ctrl \\';

function isRail(trigger: HTMLElement) {
  if (trigger.closest('[data-nav-drawer]')) return false;
  return Boolean(trigger.closest('[data-sidebar-state="collapsed"]'));
}

export function SidebarRowTooltip({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  const shouldOpen = (trigger: HTMLElement) => {
    if (isRail(trigger)) return true;
    const text = trigger.querySelector<HTMLElement>('[data-sidebar-text]');
    return text !== null && isTextCut(text);
  };
  return (
    <Tooltip content={label} side="right" describe={false} shouldOpen={shouldOpen}>
      {children}
    </Tooltip>
  );
}

type SidebarTextLine = { line: string; text: string };

export function SidebarTextTooltip({
  inRail = false,
  children,
}: Readonly<{ inRail?: boolean | 'only'; children: ReactNode }>) {
  const [lines, setLines] = useState<readonly SidebarTextLine[]>([]);
  const openWhenCut = (trigger: HTMLElement) => {
    const parts = [...trigger.querySelectorAll<HTMLElement>('[data-sidebar-text]')];
    const rail = inRail !== false && isRail(trigger);
    if (!rail && (inRail === 'only' || !parts.some(isTextCut))) return false;
    const next = parts
      .map((part) => ({
        line: part.dataset.sidebarText ?? '',
        text: part.textContent?.trim() ?? '',
      }))
      .filter(({ text }) => text !== '');
    if (next.length === 0) return false;
    setLines(next);
    return true;
  };
  return (
    <Tooltip
      content={
        <span className="flex min-w-0 flex-col">
          {lines.map(({ line, text }) => (
            <span key={line} className="break-words">
              {text}
            </span>
          ))}
        </span>
      }
      side="right"
      describe={false}
      shouldOpen={openWhenCut}
    >
      {children}
    </Tooltip>
  );
}
