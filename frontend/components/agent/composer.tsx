'use client';

import { SendHorizontal, Square } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ComposerFrame, RemovableChip } from '@/components/ui/chat-dock';
import { Icon } from '@/components/ui/icon';
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
  const hasChips = chips.length > 0 || (commands?.mentions.length ?? 0) > 0;
  return (
    <ComposerFrame
      onSubmit={() => {
        if (canSend) onSubmit();
      }}
      chipsLabel="Context for this request"
      chips={
        hasChips ? (
          <>
            {chips.map((chip) => (
              <RemovableChip
                key={chip.key}
                label={chip.label}
                onRemove={onRemoveChip ? () => onRemoveChip(chip) : undefined}
              />
            ))}
            {commands?.mentions.map((mention) => (
              <RemovableChip
                key={mention.id}
                label={`@${mention.label}`}
                onRemove={() => commands.onRemoveMention(mention.id)}
              />
            ))}
          </>
        ) : null
      }
      field={
        <>
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
        </>
      }
      tools={tools}
      submit={
        onStop ? (
          <Button type="button" variant="secondary" disabled={stopping} onClick={onStop}>
            <Icon icon={Square} />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button type="submit" disabled={!canSend}>
            <Icon icon={SendHorizontal} />
            {pending ? 'Sending…' : 'Send'}
          </Button>
        )
      }
    />
  );
}
