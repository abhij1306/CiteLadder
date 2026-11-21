import { IconButton } from '@/components/ui/button';
import { ComposerFrame, PastedTextChip, RemovableChip } from '@/components/ui/chat-dock';
import { ArrowUp, RotateCcw, Square } from '@/lib/icons';
import type { ContextChip } from '@/lib/agent/handoff';
import { AGENT_COMPOSER_MAX_ROWS } from '@/lib/config/agent';

import { CommandField } from './command-menu';
import { ComposerMenu } from './composer-menu';
import type { SkillChoice } from './skill-picker';
import type { ComposerState } from './use-composer-commands';

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
  attachment,
  scope,
  skill,
  commands,
  onStop,
  stopping = false,
  onRetry,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  disabled: boolean;
  submissionDisabled?: boolean;
  placeholder: string;
  chips?: ContextChip[];
  onRemoveChip?: (chip: ContextChip) => void;
  attachment?: Readonly<{ label: string; onRemove: () => void }>;
  scope?: readonly string[];
  skill: SkillChoice;
  commands: ComposerState;
  onStop?: () => void;
  stopping?: boolean;
  onRetry?: () => void;
}>) {
  const canSend = !disabled && !submissionDisabled && !pending && value.trim().length > 0;
  const menuDisabled = disabled || submissionDisabled;
  return (
    <ComposerFrame
      onSubmit={() => {
        if (canSend) onSubmit();
      }}
      chipsLabel="Context for this request"
      chips={composerChips({
        attachment,
        chips,
        scope,
        skill: skill.chip,
        onRemoveChip,
        commands,
      })}
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
            commands={menuDisabled ? { ...commands, openSkillPicker: undefined } : commands}
            disabled={disabled}
            placeholder={placeholder}
            maxRows={AGENT_COMPOSER_MAX_ROWS}
          />
        </>
      }
      tools={
        <ComposerMenu
          menu={commands.menu}
          scope={commands.scope}
          skill={skill}
          disabled={menuDisabled}
        />
      }
      submit={
        <SubmitControl
          status={composerStatus({ pending, onStop, onRetry })}
          canSend={canSend}
          disabled={disabled}
          stopping={stopping}
          onStop={onStop}
          onRetry={onRetry}
        />
      }
    />
  );
}

type ComposerStatus = 'ready' | 'submitted' | 'streaming' | 'error';

function composerStatus({
  pending,
  onStop,
  onRetry,
}: Readonly<{ pending: boolean; onStop?: () => void; onRetry?: () => void }>): ComposerStatus {
  if (onStop) return 'streaming';
  if (pending) return 'submitted';
  return onRetry ? 'error' : 'ready';
}

function SubmitControl({
  status,
  canSend,
  disabled,
  stopping,
  onStop,
  onRetry,
}: Readonly<{
  status: ComposerStatus;
  canSend: boolean;
  disabled: boolean;
  stopping: boolean;
  onStop?: () => void;
  onRetry?: () => void;
}>) {
  switch (status) {
    case 'streaming':
      return (
        <IconButton
          type="button"
          variant="secondary"
          icon={Square}
          label="Stop"
          pending={stopping}
          pendingLabel="Stopping…"
          onClick={onStop}
        />
      );
    case 'error':
      return (
        <IconButton
          type="button"
          variant="primary"
          icon={RotateCcw}
          label="Retry send"
          disabled={disabled}
          onClick={onRetry}
        />
      );
    case 'submitted':
    case 'ready':
      return (
        <IconButton
          type="submit"
          variant="primary"
          icon={ArrowUp}
          label="Send"
          disabled={!canSend}
          pending={status === 'submitted'}
          pendingLabel="Sending…"
        />
      );
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

type Chip = Readonly<{ label: string; onRemove?: () => void }>;

function composerChips({
  attachment,
  chips,
  scope = [],
  skill,
  onRemoveChip,
  commands,
}: Readonly<{
  attachment: Chip | undefined;
  chips: ContextChip[];
  scope?: readonly string[];
  skill: Chip | undefined;
  onRemoveChip?: (chip: ContextChip) => void;
  commands: ComposerState;
}>) {
  const fixed: Chip[] = [
    ...(attachment ? [attachment] : []),
    ...chips.map((chip) => ({
      label: chip.label,
      onRemove: onRemoveChip ? () => onRemoveChip(chip) : undefined,
    })),
    ...scope.map((label) => ({ label })),
    ...(skill ? [skill] : []),
  ];
  const { mentions, pastes } = commands;
  if (fixed.length + mentions.length + pastes.items.length === 0) return null;
  return (
    <>
      {fixed.map((chip) => (
        <RemovableChip key={chip.label} label={chip.label} onRemove={chip.onRemove} />
      ))}
      {mentions.map((mention) => (
        <RemovableChip
          key={mention.id}
          label={`@${mention.label}`}
          onRemove={() => commands.onRemoveMention(mention.id)}
        />
      ))}
      {pastes.items.map((paste) => (
        <PastedTextChip
          key={paste.key}
          text={paste.text}
          onRemove={() => pastes.remove(paste.key)}
        />
      ))}
    </>
  );
}
