'use client';

import { X } from 'lucide-react';
import type { FormEvent, ReactNode, RefObject } from 'react';

import { Icon } from '@/components/ui/icon';
import { FIELD_EDGE } from '@/components/ui/input';
import { LogoMark } from '@/components/ui/logo-mark';
import { MENU_PANEL, menuItemClasses } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The chat template: a thread that scrolls in its own region and a composer
 * docked under that region, so only the thread moves while a reply streams.
 * A chat route gets it from `ListScreen fill` with a `ComposerDock` as its
 * `dock`; the panel uses `DockedThread` (give that `Drawer` the `dock` body).
 *
 * `DockedThread` is the panel's column: the thread's parts 16 apart in a
 * region that scrolls (`scrollRef`, named by `label`), the dock under it.
 */
export function DockedThread({
  children,
  dock,
  floating,
  label,
  scrollRef,
}: Readonly<{
  children: ReactNode;
  /** The composer; omitted while the chat loads or cannot be shown. */
  dock?: ReactNode;
  floating?: ReactNode;
  label?: string;
  scrollRef?: RefObject<HTMLElement | null>;
}>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section
        ref={scrollRef}
        aria-label={label}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-[var(--modal-padding)]"
      >
        <div className="flex min-h-full min-w-0 flex-col gap-4 py-4">{children}</div>
      </section>
      {dock ? (
        <div className="px-[var(--modal-padding)]">
          <ComposerDock floating={floating}>{dock}</ComposerDock>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The composer's dock: under the thread's scrolling region, 8 above the
 * composer and 16 under it. `floating` (a "Jump to latest" control) floats
 * centred just above the dock, over the end of the thread and out of flow,
 * so showing it never moves the composer or resizes the thread.
 */
export function ComposerDock({
  children,
  floating,
}: Readonly<{ children: ReactNode; floating?: ReactNode }>) {
  return (
    <div className="z-sticky relative shrink-0 pt-2 pb-4">
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
 * AgentComposer's frame: one framed field (three lines) with its context
 * chips above it and one 36px control row under it, the tools on the left
 * and Send or Stop always at the right end. The frame is the box (`surface`,
 * `radius-lg`, the soft xs ring a field wears, an 8 inset), as wide as the
 * thread above it (`max-w-thread`, 1040); while the field has focus
 * the frame takes the field focus (a `focus` edge and a 3px `line` halo).
 * The field inside is a `Textarea` with the `composer` placement. Chips
 * render only when there are any.
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
      className={cn(
        'focus-frame max-w-thread mx-auto grid w-full gap-1 rounded-lg p-2 transition-[border-color,box-shadow] duration-[var(--motion-fast)]',
        FIELD_EDGE,
      )}
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
      <div className="flex min-h-[var(--control-md)] flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">{tools}</div>
        <div className="ms-auto shrink-0">{submit}</div>
      </div>
    </form>
  );
}

/**
 * AgentThread — the conversation's column: the thread measure (1040), centred
 * in the page or panel, its turns 24 apart.
 */
export function AgentThread({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="max-w-thread mx-auto flex w-full min-w-0 flex-col gap-[var(--card-padding)]">
      {children}
    </div>
  );
}

/**
 * The person's turn: a right-aligned bubble (`surface`, `shadow-xs`,
 * `radius-lg`) at most 80% of the column, the message as written (its line
 * breaks kept) over its `footer` (mentions, a sending state).
 */
export function UserTurn({ text, footer }: Readonly<{ text: string; footer?: ReactNode }>) {
  return (
    <div className="flex justify-end">
      <div className="bg-surface flex max-w-[80%] min-w-0 flex-col gap-2 rounded-lg px-4 py-3 shadow-xs">
        <p className={textRole('body', 'whitespace-pre-wrap')}>{text}</p>
        {footer}
      </div>
    </div>
  );
}

/**
 * The agent's turn, with no bubble: the logo mark, "Agent", the time and any
 * `meta` (the skill it used) on one line, then the reply's parts 12 apart.
 * `inProgress` marks the reply still being written.
 */
export function AgentTurn({
  time,
  meta,
  inProgress = false,
  children,
}: Readonly<{ time?: ReactNode; meta?: ReactNode; inProgress?: boolean; children: ReactNode }>) {
  return (
    <article
      aria-label={inProgress ? 'Agent reply in progress' : 'Agent reply'}
      aria-busy={inProgress || undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <LogoMark wordmark={false} variant="compact" />
        <span className={textRole('label')}>Agent</span>
        {time ? (
          <span className={textRole('caption', 'font-mono tabular-nums')}>{time}</span>
        ) : null}
        {meta ? <span className={textRole('caption')}>{meta}</span> : null}
      </div>
      {children}
    </article>
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
    <li className="border-line text-ink-secondary inline-flex max-w-full items-center gap-1 rounded-sm border px-3 py-0.5">
      <span className={textRole('caption', 'truncate text-ink-secondary')}>{label}</span>
      {onRemove ? (
        <Pressable
          className="focus-ring hover:text-ink flex w-auto rounded-xs"
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
      className={cn(MENU_PANEL, 'absolute inset-x-0 bottom-full mb-0.5 grid')}
    >
      {options.map((option, index) => (
        <li
          key={option.key}
          id={`${id}-${index}`}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- ARIA listbox options keep focus on the editable field.
          role="option"
          aria-selected={index === selected}
          data-active={index === selected}
          className={menuItemClasses({ className: 'grid h-auto gap-0.5 py-2' })}
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
