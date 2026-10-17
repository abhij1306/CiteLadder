'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';
import { textRole } from '@/components/ui/typography';

type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};
const ActiveTabContext = createContext<string | null>(null);

type TabsBarProps<T extends string> = {
  items: readonly TabItem<T>[];
  ariaLabel: string;
  className?: string;
  onIntent?: (value: T) => void;
  /**
   * Where this strip sits.
   *
   *   `section` — tabs heading a section inside the content region. They draw
   *               their own rule, because nothing around them does.
   *   `band`    — the route's navigation band in `PageShell`. The band owns the
   *               rule and runs it the full width of the paper, so the strip
   *               must not draw a second one a pixel above it.
   *
   * A band strip carries tabs and nothing else: route actions belong to the
   * identity band, and filters belong to the control band.
   */
  variant?: 'section' | 'band';
  /**
   * Triggers share the list's full width instead of hugging their labels.
   * For a tab strip that heads a card, so the row has no dead right edge.
   */
  fill?: boolean;
};

export type TabsProps<T extends string> = TabsBarProps<T> & {
  value: T;
  onValueChange: (value: T) => void;
  children?: ReactNode;
  rootClassName?: string;
};

/**
 * The stateful wrapper, split out from the strip itself.
 *
 * A page's tabs live in `PageShell`'s navigation band while their panels live
 * in the content region, two bands below — so the thing that holds the selected
 * value has to be able to span both. Section-level tabs, whose strip and panels
 * are adjacent, use `Tabs` instead and never see this.
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

/** The strip. Must be rendered inside a `TabsRoot` (or a `Tabs`). */
export function TabsBar<T extends string>({
  items,
  ariaLabel,
  className,
  onIntent,
  variant = 'section',
  fill = false,
}: Readonly<TabsBarProps<T>>) {
  const value = useContext(ActiveTabContext);
  return (
    // The rule sits on the wrapper; the strip overhangs it by the tab padding,
    // so a padded tab's label still starts on the content edge.
    <div className={cn('min-w-0', variant === 'section' && 'border-border border-b')}>
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn(
          'relative flex flex-nowrap gap-[var(--tab-gap)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // Labels retain intrinsic width; narrow strips scroll as one row.
          fill ? 'gap-0' : '-mx-[var(--tab-pad-x)]',
          className,
        )}
      >
        <TabTriggers items={items} value={value} fill={fill} onIntent={onIntent} />
      </TabsPrimitive.List>
    </div>
  );
}

/**
 * Each tab is a padded, button-shaped target: hover fills a rounded box inset
 * from the strip, and the active underline spans the label.
 */
function TabTriggers<T extends string>({
  items,
  value,
  fill,
  onIntent,
}: Readonly<Pick<TabsBarProps<T>, 'items' | 'onIntent'> & { value: unknown; fill: boolean }>) {
  return (
    <>
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
          className={cn(
            textRole(
              'label',
              'focus-ring text-secondary enabled:hover:text-foreground data-[state=active]:text-foreground disabled:text-muted relative inline-flex h-[var(--tab-height)] items-center rounded-[var(--radius-control)] px-[var(--tab-pad-x)] whitespace-nowrap transition-colors',
            ),
            'before:absolute before:inset-x-0 before:inset-y-1 before:rounded-[var(--radius-control)] before:transition-colors enabled:hover:before:bg-hover enabled:active:before:bg-active disabled:before:bg-disabled',
            fill ? 'min-w-max flex-1 basis-0 justify-center' : 'shrink-0',
          )}
        >
          {/* Positioned, so the label paints above the hover fill. */}
          <span className="relative">{item.label}</span>
          {item.value === value ? (
            <span
              className={cn(
                'bg-accent absolute bottom-0 h-0.5',
                fill ? 'inset-x-0' : 'inset-x-[var(--tab-pad-x)]',
              )}
            />
          ) : null}
        </TabsPrimitive.Trigger>
      ))}
    </>
  );
}

/** Root, strip and panels together — the shape section-level tabs want. */
export function Tabs<T extends string>({
  value,
  onValueChange,
  children,
  rootClassName,
  ...bar
}: Readonly<TabsProps<T>>) {
  return (
    <TabsRoot value={value} onValueChange={onValueChange} className={rootClassName}>
      <TabsBar {...bar} />
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
