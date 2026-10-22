'use client';

import { X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The chat template: a thread that scrolls and a composer docked to the
 * bottom edge of whatever scrolls it (the window on a chat route, the drawer
 * body in the panel — give that `Drawer` the `dock` body).
 *
 * `DockedThread` is the panel's column: the thread's parts 16 apart, the
 * dock under them, and `end` (the follow-latest sentinel) after the dock.
 * A chat route lays its thread out in its screen template and closes it with
 * `ComposerDock` alone.
 */
export function DockedThread({
  children,
  dock,
  floating,
  end,
}: Readonly<{ children: ReactNode; dock: ReactNode; floating?: ReactNode; end?: ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 flex-col gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
      <ComposerDock floating={floating}>{dock}</ComposerDock>
      {end}
    </div>
  );
}

/**
 * The composer's dock: sticky to the bottom edge on the surface's own fill,
 * 8 above the composer and 16 under it. `floating` (a "Jump to latest"
 * control) floats centred just above the dock, out of flow, so showing it
 * never moves the composer or changes the page height while a reply streams.
 */
export function ComposerDock({
  children,
  floating,
}: Readonly<{ children: ReactNode; floating?: ReactNode }>) {
  return (
    <div className="bg-panel z-sticky sticky bottom-0 pt-2 pb-4">
      {floating ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-2">
          <div className="pointer-events-auto">{floating}</div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The message box: one framed field with its context chips above it and its
 * tools and send control under it. The frame is the box (radius 12, the strong
 * edge, an 8 inset); the field inside is a `Textarea` with the `composer`
 * placement. Chips render only when there are any.
 */
export function ComposerFrame({
  onSubmit,
  chips,
  chipsLabel,
  field,
  tools,
  submit,
}: Readonly<{
  onSubmit: () => void;
  /** `RemovableChip`s; omitted or empty, the row is not drawn. */
  chips?: ReactNode;
  chipsLabel: string;
  field: ReactNode;
  tools?: ReactNode;
  submit: ReactNode;
}>) {
  return (
    <form
      className="bg-input border-border-strong grid gap-1 rounded-[var(--radius-card)] border p-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {chips ? (
        <ul aria-label={chipsLabel} className="flex flex-wrap gap-2">
          {chips}
        </ul>
      ) : null}
      {field}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">{tools}</div>
        {submit}
      </div>
    </form>
  );
}

/**
 * A reference the message will carry, as a pill in a `ComposerFrame`'s chip
 * row: its caption-sized label and, when it is optional, a control that
 * removes it.
 */
export function RemovableChip({
  label,
  onRemove,
}: Readonly<{ label: string; onRemove?: () => void }>) {
  return (
    <li className="bg-background-alt text-secondary inline-flex max-w-full items-center gap-1 rounded-full px-3 py-0.5">
      <span className={textRole('caption', 'truncate text-secondary')}>{label}</span>
      {onRemove ? (
        <Pressable
          className="focus-ring hover:text-foreground flex w-auto rounded-full"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <Icon icon={X} />
        </Pressable>
      ) : null}
    </li>
  );
}

export type Suggestion = Readonly<{ key: string; label: string; detail?: string }>;

/**
 * The suggestions an editable field offers while focus stays in the field (a
 * `/` skill or an `@` mention): a listbox that opens just above the field at
 * its full width, each option a label and an optional caption. The field owns
 * the keyboard (`aria-activedescendant` names `${id}-${index}`); a press picks
 * without taking focus.
 */
export function SuggestionList({
  id,
  label,
  open,
  options,
  selected,
  onPick,
}: Readonly<{
  id: string;
  label: string;
  open: boolean;
  options: readonly Suggestion[];
  selected: number;
  onPick: (index: number) => void;
}>) {
  return (
    <ul
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- The popup uses ARIA options while focus remains in the editable combobox.
      role="listbox"
      aria-label={label}
      hidden={!open}
      className={cn(menuPanelClasses, 'absolute inset-x-0 bottom-full mb-0.5 grid')}
    >
      {options.map((option, index) => (
        <li
          key={option.key}
          id={`${id}-${index}`}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- ARIA listbox options keep focus on the editable field.
          role="option"
          aria-selected={index === selected}
          data-active={index === selected}
          className={cn(menuItemVariants(), 'grid gap-0.5 py-2')}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(index);
          }}
        >
          <span className="truncate">{option.label}</span>
          {option.detail ? (
            <span className={textRole('caption', 'truncate')}>{option.detail}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
