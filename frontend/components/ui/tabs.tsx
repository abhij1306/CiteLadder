import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createContext, useContext, useRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

/**
 * The segmented track every in-page switch shares (Tabs, SegmentedControl,
 * the sidebar's mode switch): the pressed tint of whatever fill it sits on
 * (D51; `scroll-shade-x` paints it, since sunken would not show on the page
 * ground), `radius-md`, 32px with a 2px inset and 2px between segments. It
 * keeps its width when the selection changes. Its scrollbar is hidden, so when
 * the segments overflow it a soft shade marks each edge with more of them;
 * nothing shows while they fit.
 */
export const TAB_TRACK =
  'scroll-shade-x inline-flex h-[var(--control-md)] max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-md p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * One segment: full track height, 12px padding, `radius-sm`, 14/20 regular
 * `ink-secondary`; the selected one lifts onto `surface` with a 1px `line`
 * border (D51: an edge is a border, never a shadow ring) in `ink` at weight
 * 500 (owner, 2026-11-10; buttons stay 500 throughout). Every segment keeps a
 * 1px border, transparent until selected, so selecting one moves nothing. A
 * count follows the label in brackets (`ControlCount`, D16).
 */
export function tabClasses(selected: boolean, className?: string) {
  return cn(
    'focus-ring inline-flex h-full shrink-0 items-center justify-center gap-1.5 rounded-sm border px-3 text-label whitespace-nowrap transition-[background-color,color] duration-[var(--motion-fast)] focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-45',
    selected
      ? 'bg-surface border-line text-ink font-medium'
      : 'text-ink-secondary not-disabled:hover:text-ink border-transparent font-normal',
    className,
  );
}

/**
 * The sidebar's mode switch: the track stretched to two equal segments, and
 * in the rail (below the `shell:` breakpoint) the same track stacked as two
 * icon segments one control wide.
 */
export const MODE_TRACK =
  'overlay-pressed shell:h-[var(--control-md)] shell:w-full shell:flex-row shell:items-center flex w-[var(--control-md)] flex-col gap-0.5 rounded-md p-0.5';

export function modeSegmentClasses(selected: boolean) {
  return tabClasses(
    selected,
    'shell:h-full shell:flex-1 shell:basis-0 shell:px-3 h-[calc(var(--control-md)-6px)] w-full px-0',
  );
}

/**
 * The count a tab, segment or filter chip carries after its label: the sans face at
 * the control's own size, `ink-muted`, in brackets ("All signals (107)",
 * decision D16), never mono. Its text leads with a space, so an accessible
 * name reads "All signals (107)".
 */
export function ControlCount({ count }: Readonly<{ count: number }>) {
  return <span className="text-ink-muted tabular-nums">{` (${count.toLocaleString()})`}</span>;
}

type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  /** Rows the tab holds, in brackets after the label. */
  count?: number;
  disabled?: boolean;
};
const ActiveTabContext = createContext<string | null>(null);

type TabStripProps<T extends string> = {
  items: readonly TabItem<T>[];
  ariaLabel: string;
  className?: string;
  onIntent?: (value: T) => void;
  /** Segments share the track's full width (the sidebar's mode switch, a card head). */
  fill?: boolean;
};

export type TabsProps<T extends string> = TabStripProps<T> & {
  value: T;
  onValueChange: (value: T) => void;
  children?: ReactNode;
  rootClassName?: string;
  /** Section tabs over their panel: one workspace gap between strip and panel. */
  spaced?: boolean;
};

/**
 * The stateful wrapper, split out from the strip. A page's tabs live in the
 * screen template's navigation band while their panels live two bands below,
 * so the holder of the selected value has to span both.
 */
export function TabsRoot<T extends string>({
  value,
  onValueChange,
  className,
  children,
}: Readonly<{
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <ActiveTabContext value={value}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        className={className}
      >
        {children}
      </TabsPrimitive.Root>
    </ActiveTabContext>
  );
}

/** What a route passes to its screen template's `tabs`. */
export type TabRowProps<T extends string = string> = Readonly<
  Pick<TabStripProps<T>, 'items' | 'ariaLabel' | 'onIntent'>
>;

/**
 * TabRow — the route's navigation strip, inside a `TabsRoot`. The page shell
 * sets a control row of filters alone right after it (D60); a row with a
 * view, search or action stays the band under it (D57).
 */
export function TabRow<T extends string>({ items, ariaLabel, onIntent }: TabRowProps<T>) {
  return <TabStrip items={items} ariaLabel={ariaLabel} onIntent={onIntent} />;
}

/**
 * The strip: Radix tabs, so Left and Right move and select and Tab leaves the
 * list. Must be rendered inside a `TabsRoot` (or a `Tabs`).
 */
function TabStrip<T extends string>({
  items,
  ariaLabel,
  className,
  onIntent,
  fill = false,
}: Readonly<TabStripProps<T>>) {
  const active = useContext(ActiveTabContext);
  return (
    <TabsPrimitive.List
      aria-label={ariaLabel}
      className={cn(TAB_TRACK, fill && 'flex w-full', className)}
    >
      {items.map((item) => (
        <TabsPrimitive.Trigger
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          onMouseEnter={() => onIntent?.(item.value)}
          onFocus={(event) => {
            onIntent?.(item.value);
            event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }}
          className={tabClasses(
            item.value === active,
            fill ? 'min-w-max flex-1 basis-0' : undefined,
          )}
        >
          {item.label}
          {item.count === undefined ? null : <ControlCount count={item.count} />}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}

/** Root, strip and panels together — the shape section-level tabs want. */
export function Tabs<T extends string>({
  value,
  onValueChange,
  children,
  rootClassName,
  spaced = false,
  ...bar
}: Readonly<TabsProps<T>>) {
  return (
    <TabsRoot
      value={value}
      onValueChange={onValueChange}
      className={cn(spaced && 'grid min-w-0 gap-[var(--workspace-gap)]', rootClassName)}
    >
      <TabStrip {...bar} />
      {children}
    </TabsRoot>
  );
}

export function TabPanel({
  value,
  className,
  children,
  forceMount,
}: Readonly<{
  value: string;
  className?: string;
  children: ReactNode;
  forceMount?: true;
}>) {
  const activeValue = useContext(ActiveTabContext);
  return (
    <TabsPrimitive.Content
      value={value}
      forceMount={forceMount}
      hidden={activeValue !== value}
      className={cn('focus-ring', className)}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

/** Arrow keys that move the roving focus, and the direction each moves it. */
const ARROW_DELTA: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * One choice of a SegmentedControl. A filter choice may carry the number of
 * rows it keeps (`count`), a short status after its label (`detail`, muted)
 * and an explanation beside it (`hint`, an `InfoHint`).
 */
export type SegmentedOption<T extends string> = Readonly<{
  value: T;
  label: string;
  count?: number;
  detail?: string;
  hint?: ReactNode;
}>;

/**
 * SegmentedControl — the Tabs track as a single-select value with no panel
 * (a date range, a metric, a filter). Radiogroup semantics: one tab stop at
 * the checked option, and the arrow keys move focus and selection, wrapping
 * at both ends.
 *
 * `trailing` is a control that shares the track but is NOT one of the
 * choices (Performance's "More", which opens the range dialog): it sits
 * outside the radio group, on the same track.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  'aria-describedby': describedBy,
  className,
  disabled = false,
  trailing,
}: Readonly<{
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel?: string;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
  disabled?: boolean;
  /** A control on the same track that is not one of the choices. */
  trailing?: ReactNode;
}>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  // With an off-list `value` nothing is checked; fall back to the first option
  // so the group stays reachable by keyboard.
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div data-segmented-track="" className={cn(TAB_TRACK, className)}>
      {/* A nested flex row, NOT `display: contents`: some browsers drop a
          contents box from the accessibility tree, costing the group its name. */}
      <div
        id={id}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className="flex h-full shrink-0 items-center gap-0.5"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const segment = (
            <button
              key={option.value}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Button-based radio keeps roving focus and the segment face.
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => onChange(option.value)}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
              }
              onKeyDown={(event) => {
                const delta = ARROW_DELTA[event.key];
                if (delta === undefined) return;
                event.preventDefault();
                move(index, delta);
              }}
              className={tabClasses(selected)}
            >
              {option.label}
              {/* Each part leads with a space, so the radio's accessible name
                  reads "CTR gaps · Partial (50)". */}
              {option.detail ? (
                <span className="text-ink-muted">{` · ${option.detail}`}</span>
              ) : null}
              {option.count === undefined ? null : <ControlCount count={option.count} />}
            </button>
          );
          if (!option.hint) return segment;
          return (
            <span key={option.value} className="inline-flex h-full shrink-0 items-center gap-1">
              {segment}
              {option.hint}
            </span>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

/**
 * A button on a SegmentedControl's track that opens something rather than
 * selecting a value (Performance's "More"). `selected` says the active range
 * is one hiding behind it. It holds the width of the widest label it can
 * show, so picking a range never resizes it.
 */
export function SegmentedAction({
  selected = false,
  label,
  labels,
  className,
  children,
  ...props
}: Readonly<
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    selected?: boolean;
    /** What the action shows now. */
    label: string;
    /** Every label it can show; the widest sets its width. */
    labels: readonly string[];
    /** A trailing glyph after the label. */
    children?: ReactNode;
  }
>) {
  return (
    <button {...props} type="button" className={tabClasses(selected, className)}>
      <span className="inline-grid justify-items-center">
        {labels.map((reserved) => (
          <span key={reserved} aria-hidden="true" className="invisible col-start-1 row-start-1">
            {reserved}
          </span>
        ))}
        <span className="col-start-1 row-start-1">{label}</span>
      </span>
      {children}
    </button>
  );
}
