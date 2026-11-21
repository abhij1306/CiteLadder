import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from 'react';

import { IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { FIELD_EDGE } from '@/components/ui/input';
import { LogoMark } from '@/components/ui/logo-mark';
import { MENU_PANEL, menuItemClasses } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { Tag } from '@/components/ui/tag';
import { textRole } from '@/components/ui/typography';
import { wellClasses } from '@/components/ui/slip';
import { ArrowDown, FileText } from '@/lib/icons';
import { cn } from '@/lib/utils';

export function DockedThread({
  children,
  dock,
  onJumpToLatest,
  label,
  scrollRef,
}: Readonly<{
  children: ReactNode;
  dock?: ReactNode;
  onJumpToLatest?: (() => void) | null;
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
          <ComposerDock onJumpToLatest={onJumpToLatest}>{dock}</ComposerDock>
        </div>
      ) : null}
    </div>
  );
}

export function ComposerDock({
  children,
  onJumpToLatest,
}: Readonly<{ children: ReactNode; onJumpToLatest?: (() => void) | null }>) {
  return (
    <div className="z-sticky relative shrink-0 pt-2 pb-4">
      {onJumpToLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-2">
          <IconButton
            icon={ArrowDown}
            label="Jump to latest"
            variant="secondary"
            onClick={onJumpToLatest}
            className="shadow-sheet pointer-events-auto rounded-full"
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function ComposerFrame({
  onSubmit,
  chips,
  chipsLabel,
  field,
  tools,
  submit,
}: Readonly<{
  onSubmit: () => void;
  chips?: ReactNode;
  chipsLabel: string;
  field: ReactNode;
  tools?: ReactNode;
  submit: ReactNode;
}>) {
  return (
    <form
      className={cn(
        'focus-frame max-w-thread mx-auto grid w-full gap-1 rounded-card p-2 transition-[border-color,box-shadow] duration-[var(--motion-fast)]',
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{tools}</div>
        <div className="ms-auto shrink-0">{submit}</div>
      </div>
    </form>
  );
}

export function AgentThread({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="max-w-thread mx-auto flex w-full min-w-0 flex-col gap-[var(--card-padding)] px-4">
      {children}
    </div>
  );
}

export function UserTurn({ text, footer }: Readonly<{ text: string; footer?: ReactNode }>) {
  return (
    <div className="flex justify-end">
      <div
        className={wellClasses(
          'flex max-w-[min(80%,var(--container-prose))] min-w-0 flex-col gap-2 px-4 py-3',
        )}
      >
        <p className={textRole('body', 'text-ink whitespace-pre-wrap [overflow-wrap:anywhere]')}>
          {text}
        </p>
        {footer}
      </div>
    </div>
  );
}

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
        <span className={textRole('body', 'text-ink-2')}>Agent</span>
        {time ? <span className={textRole('caption', 'tabular-nums')}>{time}</span> : null}
        {meta ? <span className={textRole('caption')}>{meta}</span> : null}
      </div>
      <div data-turn-rail="" className="border-rule ms-3 flex min-w-0 flex-col gap-3 border-s ps-4">
        {children}
      </div>
    </article>
  );
}

export function RemovableChip({
  label,
  onRemove,
}: Readonly<{ label: string; onRemove?: () => void }>) {
  return (
    <li className="max-w-full">
      <ChipTag label={label} onRemove={onRemove}>
        {label}
      </ChipTag>
    </li>
  );
}

function ChipTag({
  label,
  onRemove,
  children,
}: Readonly<{ label: string; onRemove?: () => void; children: ReactNode }>) {
  return onRemove ? (
    <Tag kind="removable" removeLabel={label} onRemove={onRemove}>
      {children}
    </Tag>
  ) : (
    <Tag>{children}</Tag>
  );
}

export function PastedTextChip({
  text,
  onRemove,
}: Readonly<{ text: string; onRemove?: () => void }>) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n').length;
  const label = `Pasted text, ${lines} ${lines === 1 ? 'line' : 'lines'}`;
  return (
    <li className="max-w-full">
      <ChipTag label={label} onRemove={onRemove}>
        <Pressable
          className="focus-ring hover:text-ink rounded-mark inline-flex w-auto min-w-0 items-center gap-1"
          aria-label={`View ${label}`}
          onClick={() => setOpen(true)}
        >
          <Icon icon={FileText} className="my-0" />
          <span className="truncate">{label}</span>
        </Pressable>
      </ChipTag>
      <Dialog open={open} onOpenChange={setOpen} title="Pasted text" width="wide">
        <pre className={textRole('body', 'text-ink font-mono break-words whitespace-pre-wrap')}>
          {text}
        </pre>
      </Dialog>
    </li>
  );
}

export type Suggestion = Readonly<{
  key: string;
  label: string;
  detail?: string;
  aside?: ReactNode;
}>;

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
  useEffect(() => {
    if (open) document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, open, selected]);
  return (
    <ul
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- The popup uses ARIA options while focus remains in the editable combobox.
      role="listbox"
      aria-label={label}
      hidden={!open}
      data-open={open || undefined}
      className={cn(
        MENU_PANEL,
        'absolute inset-x-0 bottom-full mb-0.5 grid max-h-[min(20rem,40dvh)] overflow-auto overscroll-contain [--popup-origin:bottom]',
      )}
    >
      {options.map((option, index) => (
        <li key={option.key} role="none">
          <button
            type="button"
            id={`${id}-${index}`}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- ARIA listbox options keep focus on the editable field.
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            data-active={index === selected}
            className={menuItemClasses({ className: 'grid h-auto w-full gap-0.5 py-2 text-left' })}
            // Focus stays in the field; the choice commits on release (WCAG 2.5.2).
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(index)}
          >
            {option.aside ? (
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate">{option.label}</span>
                {option.aside}
              </span>
            ) : (
              <span className="truncate">{option.label}</span>
            )}
            {option.detail ? (
              <span className={textRole('caption', 'truncate')}>{option.detail}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
