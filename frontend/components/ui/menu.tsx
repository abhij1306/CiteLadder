import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { FLOAT_FACE } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The floating panel menus and listboxes share: the floating face (`surface`,
 * a 1px `line` border, `shadow-float`; D51), `radius-lg`, a 4px inset,
 * entering in 200ms ease-out.
 */
export const MENU_PANEL = cn(
  FLOAT_FACE,
  'menu-panel z-modal focus-ring overflow-hidden rounded-lg p-1',
);

/**
 * One 32px row, which never shrinks when a long menu scrolls: `radius-sm`, 8px padding, 14/20 `ink`, a 16px lead column for
 * an icon or a check so labels align. Hover and keyboard highlight take the
 * hover overlay (D51); keyboard focus adds the shared 2px ring, which the
 * panel's 4px inset holds. A row a script focused as the pointer moved draws
 * no ring once the reader has pressed (`input-modality.ts`). `danger` is `negative` text with a `negative-soft`
 * highlight.
 */
export function menuItemClasses({
  danger = false,
  className,
}: Readonly<{ danger?: boolean; className?: string }> = {}) {
  return cn(
    'focus-ring relative flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-body-sm transition-colors select-none',
    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
    danger
      ? 'text-negative data-[highlighted]:bg-negative-soft hover:bg-negative-soft data-[disabled]:hover:bg-transparent [&_svg]:text-negative'
      : // A selected option (a listbox's value) keeps the selected overlay
        // and takes no hover, so the two states never look alike.
        'text-ink aria-selected:overlay-selected not-aria-selected:data-[highlighted]:overlay-hover not-aria-selected:not-data-[disabled]:hover:overlay-hover',
    className,
  );
}

/**
 * Menu — a dropdown of actions opened from a button (row actions, the account
 * menu, column options): Radix's keyboard model (arrows, Home, End, typeahead;
 * Escape and a press outside close it; checkbox and radio items keep it open).
 * Put the destructive item last, after a separator. A submenu (`MenuSub`)
 * holds one choice's options, as in All filters; never nest a second level.
 */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;
export const MenuSub = MenuPrimitive.Sub;

/**
 * The row that opens a submenu: the label, then its current value in the
 * secondary ink and a chevron at the row's end. Right arrow, Enter and Space
 * open it; Left arrow and Escape come back. While its submenu is open the row
 * keeps the highlighted rows' hover overlay and draws no focus ring (focus is
 * in the submenu, or the pointer opened it; globals.css).
 */
export function MenuSubTrigger({
  value,
  className,
  children,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger>, 'children'> & {
    /** The row's label. */
    children: string;
    /** The current choice, printed after the label. */
    value?: string;
  }
>) {
  return (
    <MenuPrimitive.SubTrigger
      className={menuItemClasses({ className: cn('data-[state=open]:overlay-hover', className) })}
      // Named as it reads, "Surface: All surfaces": a name built from the two
      // spans differs by browser (Chromium spaces them as "Surface : …").
      aria-label={value ? `${children}: ${value}` : undefined}
      {...props}
    >
      <span className="shrink-0">{children}</span>
      {value ? (
        <span className="text-ink-muted ms-auto min-w-0 truncate ps-4 text-end">{value}</span>
      ) : null}
      <ChevronRight
        className={cn('text-ink-muted size-4 shrink-0', !value && 'ms-auto')}
        aria-hidden
      />
    </MenuPrimitive.SubTrigger>
  );
}

/** A submenu's panel: the menu face, beside its row. */
export function MenuSubContent({
  sideOffset = 4,
  collisionPadding = 8,
  children,
  ...props
}: Readonly<Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>, 'className'>>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          MENU_PANEL,
          'flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] max-w-[min(28rem,calc(100vw-16px))] min-w-56 flex-col overflow-auto',
        )}
        {...props}
      >
        {children}
      </MenuPrimitive.SubContent>
    </MenuPrimitive.Portal>
  );
}

/**
 * Menu width is a role, never a number: unset a menu is at least 224px and
 * hugs its items; `trigger` matches the control that opened it, for a menu
 * that reads as that control's list.
 */
export function MenuContent({
  align = 'start',
  sideOffset = 4,
  collisionPadding = 8,
  width,
  children,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.Content>, 'className'> & {
    width?: 'trigger';
  }
>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          MENU_PANEL,
          'flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-auto',
          width === 'trigger' ? 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-0' : 'min-w-56',
        )}
        {...props}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

/** The lead column: a 16px icon slot, kept empty when the item has none. */
function Lead({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <span className="text-ink-secondary flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
      {children}
    </span>
  );
}

/**
 * One row: the lead glyph (an icon, a logo), the label, then at the row's end
 * a shortcut or, for the current choice in a switcher, the check. The label
 * is text only, so the row stays one line and the label truncates.
 */
export function MenuItem({
  icon,
  shortcut,
  value,
  selected = false,
  danger = false,
  className,
  children,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & {
    /** A 16px glyph in the lead column (an icon, an inline `BrandMark`). */
    icon?: ReactNode;
    /** A shortcut, mono 12px `ink-muted`, at the row's end. */
    shortcut?: string;
    /** A setting's current value, in the secondary ink at the row's end. */
    value?: string;
    /** The current choice of a switcher: an `accent` check at the row's end. */
    selected?: boolean;
    danger?: boolean;
  }
>) {
  return (
    <MenuPrimitive.Item className={menuItemClasses({ danger, className })} {...props}>
      {icon ? <Lead>{icon}</Lead> : null}
      <span className={cn('min-w-0 truncate', value ? 'shrink-0' : 'flex-1')}>{children}</span>
      {value ? (
        <span className="text-ink-muted ms-auto min-w-0 truncate ps-4 text-end">{value}</span>
      ) : null}
      {shortcut ? (
        <span className="text-ink-muted text-caption ms-4 font-mono">{shortcut}</span>
      ) : null}
      {selected ? <Check className="text-accent size-4 shrink-0" aria-hidden /> : null}
    </MenuPrimitive.Item>
  );
}

/**
 * A menu row that is a link: the single child (`<a>` or a router `Link`)
 * becomes the item, with the row face, so it navigates like a link and keeps
 * the menu's keyboard model. Put the 16px icon and the label inside the link.
 */
export function MenuLinkItem({
  className,
  children,
  ...props
}: Readonly<Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.Item>, 'asChild'>>) {
  return (
    <MenuPrimitive.Item asChild className={menuItemClasses({ className })} {...props}>
      {children}
    </MenuPrimitive.Item>
  );
}

function Indicator() {
  return (
    <span className="text-ink flex size-4 shrink-0 items-center justify-center">
      <MenuPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </span>
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>>) {
  return (
    <MenuPrimitive.CheckboxItem className={menuItemClasses({ className })} {...props}>
      <Indicator />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>>) {
  return (
    <MenuPrimitive.RadioItem className={menuItemClasses({ className })} {...props}>
      <Indicator />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

/** The rule between groups: 1px `line`, running to the panel's edges. */
export function MenuSeparator(
  props: Readonly<Omit<ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>, 'className'>>,
) {
  return <MenuPrimitive.Separator {...props} className="bg-line -mx-1 my-1 h-px shrink-0" />;
}

/**
 * A row that holds its own control rather than being one (the account menu's
 * Theme row): the label on the left in the item's text, the control at the
 * row's end, at the item's height so the menu keeps one rhythm.
 */
export function MenuControlRow({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="text-body-sm text-ink flex min-h-8 items-center justify-between gap-4 px-2 py-1">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** A small group label: 12/16 medium `ink-muted`. */
export function MenuLabel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <MenuPrimitive.Label className="text-ink-muted text-caption px-2 pt-2 pb-1">
      {children}
    </MenuPrimitive.Label>
  );
}
