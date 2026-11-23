import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { SuggestionList } from '@/components/ui/chat-dock';
import { Textarea } from '@/components/ui/textarea';
import { isImeComposing } from '@/lib/accessibility/ime';
import {
  applyOption,
  tokenAt,
  type CommandOption,
  type CommandToken,
  type Mention,
} from '@/lib/agent/composer-commands';
import type { AgentAttachment } from '@citeladder/contracts/agent';

export type ComposerCommands = {
  options: (token: CommandToken) => CommandOption[];
  onTrigger?: (trigger: CommandToken['trigger'], query: string) => void;
  onPick: (option: CommandOption, token: CommandToken) => void;
  onPaste?: (pasted: string, edit: (change: (current: string) => string) => void) => void;
  mentions: readonly Mention[];
  onRemoveMention: (id: string) => void;
  openSkillPicker?: (removeCommand: () => void, restoreFocus: () => void) => void;
  closeSkillPicker?: () => boolean;
  pastes?: ComposerPastes;
};

export type ComposerPastes = {
  items: readonly { key: string; attachment: AgentAttachment }[];
  add: (text: string) => boolean;
  attach: (files: readonly File[]) => void;
  remove: (key: string) => void;
};

const MENU_LABEL = { '/': 'Skills', '@': 'Actions to mention' } as const;
const MOVES: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

type MenuState = {
  token: CommandToken | null;
  options: CommandOption[];
  selected: number;
};

export function CommandField({
  id,
  value,
  onChange,
  onEnter,
  commands,
  disabled,
  placeholder,
  maxRows,
}: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  commands?: ComposerCommands;
  disabled: boolean;
  placeholder: string;
  maxRows: number;
}>) {
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = `${id}-commands`;
  const state = menuState(commands, disabled ? null : tokenAt(value, caret), dismissed, active);
  const open = state.options.length > 0;
  const trigger = state.token?.trigger ?? null;
  const query = state.token?.query ?? '';
  const onTrigger = commands?.onTrigger;
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(() => {
    if (trigger) onTrigger?.(trigger, query);
  }, [trigger, query, onTrigger]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    field.current?.focus();
    field.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, caret]);

  const pick = (option: CommandOption) => {
    if (!state.token || !commands) return;
    const next = applyOption(value, state.token, option);
    pendingCaret.current = next.caret;
    onChange(next.text);
    commands.onPick(option, state.token);
    setCaret(next.caret);
    setActive(0);
  };

  const menuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    const count = state.options.length;
    const move = MOVES[event.key];
    if (move !== undefined) setActive((state.selected + move + count) % count);
    else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      const option = state.options[state.selected];
      if (option) pick(option);
    } else if (event.key === 'Escape') setDismissed(tokenKey(state.token));
    else return false;
    event.preventDefault();
    return true;
  };

  const comboboxProps = commands
    ? {
        role: 'combobox',
        'aria-autocomplete': 'list' as const,
        'aria-expanded': open,
        'aria-controls': listId,
        'aria-activedescendant': open ? `${listId}-${state.selected}` : undefined,
      }
    : {};

  return (
    <div className="relative">
      <Textarea
        ref={field}
        id={id}
        maxRows={maxRows}
        placement="composer"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        {...comboboxProps}
        onChange={(event) => {
          const token = tokenAt(event.target.value, event.target.selectionStart);
          const input = event.nativeEvent;
          if (
            input instanceof InputEvent &&
            input.inputType === 'insertText' &&
            input.data === '/' &&
            token?.trigger === '/' &&
            token.query === '' &&
            commands?.openSkillPicker
          ) {
            const text = event.target.value,
              end = event.target.selectionStart;
            let restoredCaret = end;
            onChange(text);
            commands.openSkillPicker(
              () => {
                restoredCaret = token.start;
                onChange(text.slice(0, token.start) + text.slice(end));
              },
              () =>
                requestAnimationFrame(() => {
                  field.current?.focus();
                  field.current?.setSelectionRange(restoredCaret, restoredCaret);
                }),
            );
            return;
          }
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setActive(0);
          setDismissed(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text/plain');
          if (commands?.pastes?.add(pasted)) event.preventDefault();
          else commands?.onPaste?.(pasted, (change) => onChange(change(latest.current)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && commands?.closeSkillPicker?.()) {
            event.preventDefault();
            return;
          }
          if (isImeComposing(event) || menuKey(event)) return;
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          onEnter();
        }}
      />
      {commands ? <CommandList listId={listId} state={state} open={open} onPick={pick} /> : null}
    </div>
  );
}

function tokenKey(token: CommandToken | null): string | null {
  return token ? `${token.start}${token.trigger}` : null;
}

function menuState(
  commands: ComposerCommands | undefined,
  token: CommandToken | null,
  dismissed: string | null,
  active: number,
): MenuState {
  if (!commands || !token || tokenKey(token) === dismissed)
    return { token, options: [], selected: 0 };
  const options = commands.options(token);
  return { token, options, selected: Math.min(active, Math.max(options.length - 1, 0)) };
}

function CommandList({
  listId,
  state,
  open,
  onPick,
}: Readonly<{
  listId: string;
  state: MenuState;
  open: boolean;
  onPick: (option: CommandOption) => void;
}>): ReactNode {
  return (
    <SuggestionList
      id={listId}
      label={state.token ? MENU_LABEL[state.token.trigger] : 'Commands'}
      open={open}
      options={state.options.map((option) => ({
        ...option,
        aside: option.status ? <ActionStatusBadge status={option.status} /> : undefined,
      }))}
      selected={state.selected}
      onPick={(index) => {
        const option = state.options[index];
        if (option) onPick(option);
      }}
    />
  );
}
