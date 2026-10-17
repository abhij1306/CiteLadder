'use client';

import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Dropdown — Radix menu. Surface = bg-elevated, border,
 * shadow-overlay, and the shared menu radius.
 * Re-exports the Radix parts with token-styled Content / Item defaults.
 */
export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

/**
 * The rule between menu groups. Six call sites used to restate
 * `bg-border-subtle my-1 h-px`, which is the separator's whole definition —
 * its margin is its spacing, so it belongs here and not to whoever renders it.
 */
export function DropdownSeparator({
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>>) {
  return (
    <DropdownPrimitive.Separator
      {...props}
      className={cn('bg-border-subtle my-1 h-px', className)}
    />
  );
}
export const DropdownRadioGroup = DropdownPrimitive.RadioGroup;

export function DropdownContent({
  className,
  align = 'start',
  sideOffset = 4,
  collisionPadding = 8,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          menuPanelClasses,
          // A long catalog must scroll inside the panel rather than be clipped
          // by it: Radix reports the space it actually has, so cap there.
          'max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-40 overflow-auto',
          className,
        )}
        {...props}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>>) {
  return (
    <DropdownPrimitive.Item className={cn(menuItemVariants(), className)} {...props}>
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownCheckboxItem({
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>>) {
  return (
    <DropdownPrimitive.CheckboxItem
      className={cn(
        // `relative` makes each row the containing block for its own absolutely
        // positioned indicator below — without it every checkmark resolves
        // against a distant ancestor and they all stack in one spot.
        menuItemVariants({ inset: true }),
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="text-accent size-4" aria-hidden />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownRadioItem({
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>>) {
  return (
    <DropdownPrimitive.RadioItem
      className={cn(menuItemVariants({ inset: true }), className)}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="text-accent size-4" aria-hidden />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}

export function DropdownLabel({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <DropdownPrimitive.Label className={textRole('label', cn('px-2 py-1', className))}>
      {children}
    </DropdownPrimitive.Label>
  );
}
