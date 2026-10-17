'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { resolveCommandGroups } from '@/components/layout/nav-items';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { textRole } from '@/components/ui/typography';
import { useProjectContext } from '@/lib/project/project-context';
import {
  scopedNavigationDestination,
  useSelectProject,
} from '@/lib/navigation/project-destination';
import { cn } from '@/lib/utils';
import { OPEN_COMMAND_PALETTE_EVENT } from '@/lib/navigation/shell-events';

/**
 * CommandPalette — ⌘K / Ctrl+K navigation for the authed shell.
 *
 * Keyboard-first velocity is the point: every nav destination and every
 * project in the workspace is reachable without leaving the home row. The
 * top-bar search is the pointer affordance for the same thing.
 *
 * Deliberately NOT built on components/ui/dialog.tsx — that wrapper owns a
 * title/description/close header, which a palette must not have (the input is
 * the header). It uses the same Radix primitive and the same scrim/surface
 * tokens, so the two stay visually consistent.
 *
 * Filtering is a plain substring match over label + group. There is no fuzzy
 * matcher and no index: the corpus is ~12 nav items plus the workspace's
 * projects, where subsequence matching mostly produces surprising ranking for
 * no measurable gain.
 */
type Command = {
  id: string;
  label: string;
  group: string;
  /** Nav destinations carry their canonical glyph; projects render a brand logo. */
  icon?: LucideIcon;
  logoUrl?: string | null;
  hint?: string;
  run: () => void;
};

/** Chrome shared by the empty state and each row, so heights never drift. */
const ROW =
  'type-control flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left min-h-[var(--menu-item-height)]';

function subscribeToPlatform() {
  return () => {};
}

function isMacPlatform() {
  return /Mac/i.test(navigator.platform);
}

type CommandPaletteLaunch = { trigger: HTMLElement };

export function CommandPaletteTrigger({
  className,
  onOpen,
}: Readonly<{
  className?: string;
  /** Lets a transient presenter close before the persistent palette opens. */
  onOpen?: (trigger: HTMLElement) => void;
}>) {
  const isMac = useSyncExternalStore(subscribeToPlatform, isMacPlatform, () => false);
  return (
    <Button
      variant="secondary"
      size="md"
      onClick={(event) => {
        const trigger = event.currentTarget;
        if (onOpen) onOpen(trigger);
        else {
          window.dispatchEvent(
            new CustomEvent<CommandPaletteLaunch>(OPEN_COMMAND_PALETTE_EVENT, {
              detail: { trigger },
            }),
          );
        }
      }}
      aria-label="Search or jump to"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn('text-muted min-w-0 w-full justify-start text-left [&>span]:w-full', className)}
    >
      <Search className="text-muted size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">Search or jump to…</span>
      <kbd className="bg-well text-muted type-badge ms-auto hidden shrink-0 rounded-xs px-1 py-0.5 sm:inline">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </Button>
  );
}

/**
 * Results keep ONE flat order for the keyboard cursor, but render grouped.
 * Rebuilding sections from that flat list (rather than grouping first and
 * flattening for keys) is what keeps the highlighted row and the Enter target
 * the same element — the two orders can never drift apart.
 */
function toSections(results: readonly Command[]) {
  const sections: { group: string; rows: { command: Command; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const last = sections.at(-1);
    if (last?.group === command.group) last.rows.push({ command, index });
    else sections.push({ group: command.group, rows: [{ command, index }] });
  });
  return sections;
}

export function CommandPalette() {
  const router = useNavigate();
  const { projects, activeProjectId, activeWorkspaceId } = useProjectContext();
  const selectProject = useSelectProject();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Where focus goes when the palette closes. Radix restores focus to its own
  // Trigger, but the ⌘K path has no trigger, so without this the caller loses
  // their place in the page and focus falls back to <body>.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const restoreFocus = useCallback(() => {
    const target = returnFocusTo.current;
    returnFocusTo.current = null;
    // The element may have unmounted while the palette was open — switching
    // project re-renders the shell — so check it is still in the document.
    if (target?.isConnected) target.focus();
  }, []);

  // Opening resets the palette. Done in the handler, not an effect — the reset
  // is caused by the interaction, not by state outside React.
  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(0);
    }
  }, []);

  const openFromTrigger = useCallback(
    (trigger: HTMLElement) => {
      returnFocusTo.current = trigger;
      setOpenState(true);
    },
    [setOpenState],
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<CommandPaletteLaunch>).detail;
      if (detail?.trigger) openFromTrigger(detail.trigger);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
  }, [openFromTrigger]);

  // ⌘K / Ctrl+K toggles from anywhere. Bound on keydown so it beats the
  // browser's own find-in-page on the platforms that map ⌘K.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Modifier first, then `key`. This handler runs on EVERY keystroke in the
      // app, so the cheap test should gate the string work — and `event.key` is
      // optional on a programmatically constructed KeyboardEvent (browser
      // extensions and IMEs dispatch these), where reading `.toLowerCase()` off
      // it threw "Cannot read properties of undefined".
      if (!(event.metaKey || event.ctrlKey) || event.key?.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (open) {
        setOpen(false);
        return;
      }

      // Capture the caller's position before the dialog steals focus.
      const activeEl = document.activeElement;
      returnFocusTo.current = activeEl instanceof HTMLElement ? activeEl : null;
      setQuery('');
      setActive(0);
      setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const navigation = resolveCommandGroups().flatMap((group) =>
      group.items.map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        group: group.title,
        icon: item.icon,
        run: () =>
          router(
            scopedNavigationDestination(
              item.href,
              item.scope ?? 'project',
              activeProjectId,
              activeWorkspaceId,
            ),
          ),
      })),
    );

    // Switching project re-scopes the API client's workspace header, so this
    // is a genuine action rather than a link.
    const projectCommands = projects.map((project) => ({
      id: `project:${project.id}`,
      // brand_name is required by projectSchema, so there is no fallback to
      // guard here; ProjectSwitcher shows the same label.
      label: project.brand_name,
      group: 'Switch project',
      logoUrl: project.brand?.logo_url,
      hint: project.id === activeProjectId ? 'Current' : undefined,
      run: () => selectProject(project.id),
    }));

    return [...navigation, ...projectCommands];
  }, [router, projects, activeProjectId, activeWorkspaceId, selectProject]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.group}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  // The cursor is CLAMPED during render rather than corrected in an effect:
  // typing shrinks the result set, and storing an index that is briefly out of
  // range would render one frame with nothing selected before a corrective
  // pass fixed it. Deriving it means there is no such frame.
  const activeIndex = active >= results.length ? 0 : active;

  // Keep the highlighted row visible when moving by keyboard past the fold.
  // Feature-detected: jsdom does not implement scrollIntoView, and this is
  // presentation-only — losing it must never break selection.
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-active="true"]');
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const runCommand = useCallback((command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  }, []);

  // Movement is relative to the CLAMPED index, so wrapping stays correct even
  // on the render right after a filter shrank the list.
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(results[activeIndex]);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpenState}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-overlay-scrim z-overlay fixed inset-0" />
        <DialogPrimitive.Content
          // Radix requires a Title for the dialog's accessible name and
          // warns when one is absent. The palette has no visible heading —
          // its input is the header — so the title is screen-reader only.
          // `aria-describedby={undefined}` opts out of the description Radix
          // otherwise looks for, which this dialog deliberately lacks.
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
          className="bg-elevated shadow-overlay z-modal focus-ring fixed top-24 left-1/2 flex max-h-3/5 w-full max-w-xl -translate-x-1/2 flex-col overflow-hidden overscroll-contain rounded-[var(--radius-card)] border border-transparent"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="focus-frame border-border-subtle flex items-center gap-3 border-b px-4">
            <Search className="text-muted size-4 shrink-0" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search or jump to…"
              role="combobox"
              aria-label="Search commands"
              aria-expanded={results.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                results[activeIndex] ? `${listboxId}-${results[activeIndex].id}` : undefined
              }
              className="type-body text-foreground placeholder:text-muted h-[var(--control-height-md)] min-w-0 flex-1 bg-transparent"
            />
            <kbd className="bg-well text-muted type-badge shrink-0 rounded-xs px-1 py-0.5 tabular-nums">
              esc
            </kbd>
          </div>

          <div
            ref={listRef}
            className="content-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
          >
            {/* The empty state is a message, not an option, so it sits
                  beside the listbox rather than inside it. */}
            {results.length === 0 ? (
              <p className={cn(ROW, 'text-muted')}>No matches for “{query}”</p>
            ) : null}
            <div
              id={listboxId}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Command results are an active-descendant popup; native select/datalist cannot contain grouped action buttons.
              role="listbox"
              aria-label="Commands"
            >
              {toSections(results).map((section, sectionIndex) => {
                const headingId = `${listboxId}-group-${sectionIndex}`;
                return (
                  <div
                    key={section.group}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A listbox may only own options and groups; fieldset is not a permitted child.
                    role="group"
                    aria-labelledby={headingId}
                    className="mb-1 last:mb-0"
                  >
                    <p id={headingId} className={textRole('label', 'px-2 pt-2 pb-1')}>
                      {section.group}
                    </p>
                    {section.rows.map(({ command, index }) => {
                      const isActive = index === activeIndex;
                      const Icon = command.icon;
                      return (
                        <button
                          key={command.id}
                          id={`${listboxId}-${command.id}`}
                          type="button"
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Focus stays on the palette input while these action options are active descendants.
                          role="option"
                          // Options are reached through the input's active
                          // descendant, never by Tab.
                          tabIndex={-1}
                          aria-selected={isActive}
                          data-active={isActive}
                          onMouseMove={() => setActive(index)}
                          onClick={() => runCommand(command)}
                          className={cn(
                            ROW,
                            'focus-ring transition-colors active:bg-active',
                            isActive
                              ? 'bg-selected text-foreground'
                              : 'text-secondary hover:bg-hover hover:text-foreground',
                          )}
                        >
                          {Icon ? (
                            <Icon
                              className={cn('size-4 shrink-0', !isActive && 'text-muted')}
                              aria-hidden
                            />
                          ) : (
                            <BrandLogo
                              name={command.label}
                              logoUrl={command.logoUrl}
                              size="xs"
                              className="bg-foreground text-background"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{command.label}</span>
                          {command.hint ? (
                            <span className="type-caption shrink-0">{command.hint}</span>
                          ) : null}
                          {isActive ? (
                            <CornerDownLeft className="text-muted size-4 shrink-0" aria-hidden />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Keyboard legend — the palette is a keyboard surface first, so
                it states its own controls rather than assuming they are known. */}
          <div className="border-border-subtle type-caption flex shrink-0 items-center gap-4 border-t px-4 py-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-well text-muted type-badge rounded-xs px-1 py-0.5 tabular-nums">
                ↑
              </kbd>
              <kbd className="bg-well text-muted type-badge rounded-xs px-1 py-0.5 tabular-nums">
                ↓
              </kbd>
              {'navigate'}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-well text-muted type-badge rounded-xs px-1 py-0.5 tabular-nums">
                ↵
              </kbd>
              {'select'}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
