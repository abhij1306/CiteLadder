'use client';

import { SendHorizontal, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import type { ContextChip } from '@/lib/agent/handoff';

import { CommandField, type ComposerCommands } from './command-menu';

/**
 * The message box every Agent surface shares. Enter sends, Shift+Enter adds a
 * line. Context chips show the typed references the turn will carry; optional
 * ones can be removed before sending. With `commands`, typing `/` or `@` at a
 * word start opens a menu (arrows move, Enter or Tab picks, Escape closes).
 */
export function Composer({
  id,
  label,
  value,
  onChange,
  onSubmit,
  pending,
  disabled,
  submissionDisabled = false,
  placeholder,
  chips = [],
  onRemoveChip,
  tools,
  commands,
  rows = 3,
  onStop,
  stopping = false,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  disabled: boolean;
  /** An accepted run blocks another send while the user may keep drafting. */
  submissionDisabled?: boolean;
  placeholder: string;
  chips?: ContextChip[];
  onRemoveChip?: (chip: ContextChip) => void;
  tools?: ReactNode;
  commands?: ComposerCommands;
  /** Visible lines before the field scrolls. */
  rows?: number;
  /** While a turn runs, the send button stops it instead. */
  onStop?: () => void;
  stopping?: boolean;
}>) {
  const canSend = !disabled && !submissionDisabled && !pending && value.trim().length > 0;
  return (
    <form
      className="bg-input border-border-strong grid gap-1 rounded-[var(--radius-card)] border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      {chips.length > 0 || (commands?.mentions.length ?? 0) > 0 ? (
        <ul aria-label="Context for this request" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              onRemove={onRemoveChip ? () => onRemoveChip(chip) : undefined}
            />
          ))}
          {commands?.mentions.map((mention) => (
            <Chip
              key={mention.id}
              label={`@${mention.label}`}
              onRemove={() => commands.onRemoveMention(mention.id)}
            />
          ))}
        </ul>
      ) : null}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <CommandField
        id={id}
        value={value}
        onChange={onChange}
        onEnter={() => {
          if (canSend) onSubmit();
        }}
        commands={commands}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">{tools}</div>
        {onStop ? (
          <Button type="button" variant="secondary" size="sm" disabled={stopping} onClick={onStop}>
            <Square className="size-4" aria-hidden />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!canSend}>
            <SendHorizontal className="size-4" aria-hidden />
            {pending ? 'Sending…' : 'Send'}
          </Button>
        )}
      </div>
    </form>
  );
}

function Chip({ label, onRemove }: Readonly<{ label: string; onRemove?: () => void }>) {
  return (
    <li className="bg-background-alt text-secondary inline-flex max-w-full items-center gap-1 rounded-full px-3 py-0.5">
      <span className={textRole('caption', 'truncate text-secondary')}>{label}</span>
      {onRemove ? (
        <Pressable
          className="focus-ring hover:text-foreground rounded-full"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X className="size-3" aria-hidden />
        </Pressable>
      ) : null}
    </li>
  );
}
