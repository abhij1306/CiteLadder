'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { menuItemVariants, menuPanelClasses } from '@/components/ui/menu-variants';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import {
  applyOption,
  tokenAt,
  type CommandOption,
  type CommandToken,
} from '@/lib/agent/composer-commands';
import { cn } from '@/lib/utils';

/** Inline `/` and `@` commands: the options for a token, and what a pick does. */
export type ComposerCommands = {
  options: (token: CommandToken) => CommandOption[];
  onPick: (option: CommandOption, token: CommandToken) => void;
  /** Actions this message mentions, shown as removable chips. */
  mentions: readonly Mention[];
  onRemoveMention: (id: string) => void;
  openSkillPicker?: (removeCommand: () => void, restoreFocus: () => void) => void;
  closeSkillPicker?: () => boolean;
};

export type Mention = { id: string; label: string };

const MENU_LABEL = { '/': 'Skills', '@': 'Actions to mention' } as const;
const MOVES: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

type MenuState = {
  token: CommandToken | null;
  options: CommandOption[];
  selected: number;
};

/**
 * The composer's message field. With `commands` it is an ARIA combobox with a
 * listbox above it: focus stays in the field, arrows move, Enter or Tab
 * picks, Escape closes until the text changes. Otherwise Enter submits and
 * Shift+Enter adds a line.
 */
export function CommandField({
  id,
  value,
  onChange,
  onEnter,
  commands,
  disabled,
  placeholder,
  rows,
}: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  commands?: ComposerCommands;
  disabled: boolean;
  placeholder: string;
  rows: number;
}>) {
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = `${id}-commands`;
  const state = menuState(commands, disabled ? null : tokenAt(value, caret), dismissed, active);
  const open = state.options.length > 0;

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

  /** Handles a key the open menu owns; false lets the field handle it. */
  const menuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    const count = state.options.length;
    if (event.key in MOVES) setActive((state.selected + MOVES[event.key]! + count) % count);
    else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')
      pick(state.options[state.selected]!);
    else if (event.key === 'Escape') setDismissed(tokenKey(state.token));
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
        rows={rows}
        // The text field owns focus; the surrounding form keeps its resting edge.
        className="min-h-0 resize-none bg-transparent px-2 py-1 shadow-none hover:shadow-none"

        value={value}
        disabled={disabled}
        placeholder={placeholder}
        {...comboboxProps}
        onChange={(event) => {
          const token = tokenAt(event.target.value, event.target.selectionStart);
          const input = event.nativeEvent as InputEvent;
          if (
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
        onKeyDown={(event) => {
          if (event.key === 'Escape' && commands?.closeSkillPicker?.()) {
            event.preventDefault();
            return;
          }
          if (event.nativeEvent.isComposing || menuKey(event)) return;
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
    <ul
      id={listId}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- The popup uses ARIA options while focus remains in the editable combobox.
      role="listbox"
      aria-label={state.token ? MENU_LABEL[state.token.trigger] : 'Commands'}
      hidden={!open}
      className={cn(menuPanelClasses, 'absolute inset-x-0 bottom-full mb-0.5 grid')}
    >
      {state.options.map((option, index) => (
        <li
          key={option.key}
          id={`${listId}-${index}`}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- ARIA listbox options keep focus on the editable field.
          role="option"
          aria-selected={index === state.selected}
          data-active={index === state.selected}
          className={cn(menuItemVariants(), 'grid gap-0.5 py-2')}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(option);
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
