import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { BrandMark } from '@/components/ui/brand-mark';
import { Kbd } from '@/components/ui/kbd';
import { Search, type IconGlyph } from '@/lib/icons';
import { useProjectContext } from '@/lib/project/project-context';
import {
  scopedNavigationDestination,
  useSelectProject,
} from '@/lib/navigation/project-destination';
import { PALETTE_LAUNCHER } from '@/components/ui/command-palette-launcher';
import { returnTargetFor, SCRIM } from '@/components/ui/dialog';
import { pluralCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { OPEN_COMMAND_PALETTE_EVENT } from '@/lib/navigation/shell-events';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { SHEET_FACE } from '@/components/ui/slip';

type PaletteGroup = Readonly<{
  title: string;
  items: readonly Readonly<{
    label: string;
    href: string;
    icon: IconGlyph;
    scope: 'project' | 'workspace';
  }>[];
}>;

type Command = {
  id: string;
  label: string;
  group: string;
  icon?: IconGlyph;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  hint?: string;
  href?: string;
  run: () => void;
};

function toSections(results: readonly Command[]) {
  const sections: { group: string; rows: { command: Command; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const last = sections.at(-1);
    if (last?.group === command.group) last.rows.push({ command, index });
    else sections.push({ group: command.group, rows: [{ command, index }] });
  });
  return sections;
}

export type PaletteLaunch = Readonly<{ returnTo: HTMLElement | null }>;

export function CommandPalette({
  destinations,
  launch,
}: Readonly<{
  /** The shell's destinations by group. */
  destinations: () => readonly PaletteGroup[];
  launch?: PaletteLaunch;
}>) {
  const router = useNavigate();
  const { projects, activeProjectId, activeWorkspaceId } = useProjectContext();
  const selectProject = useSelectProject();
  const [open, setOpen] = useState(launch !== undefined);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const returnFocusTo = useRef<HTMLElement | null>(launch?.returnTo ?? null);

  const restoreFocus = useCallback(() => {
    const target = returnFocusTo.current;
    returnFocusTo.current = null;
    const opener = target === document.body ? null : returnTargetFor(target);
    (opener ?? returnTargetFor(document.querySelector<HTMLElement>(PALETTE_LAUNCHER)))?.focus();
  }, []);

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
      const trigger: unknown = event instanceof CustomEvent ? event.detail?.trigger : null;
      if (trigger instanceof HTMLElement) openFromTrigger(trigger);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
  }, [openFromTrigger]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key?.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (open) {
        setOpen(false);
        return;
      }

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
    const navigation = destinations().flatMap((group) =>
      group.items.map((item) => {
        const href = scopedNavigationDestination(
          item.href,
          item.scope,
          activeProjectId,
          activeWorkspaceId,
        );
        return {
          id: `nav:${item.href}`,
          label: item.label,
          group: group.title,
          icon: item.icon,
          href,
          run: () => router(href),
        };
      }),
    );

    const projectCommands = projects.map((project) => ({
      id: `project:${project.id}`,
      label: project.brand_name,
      group: 'Switch project',
      logoUrl: project.brand?.logo_url,
      websiteUrl: project.website_url,
      hint: project.id === activeProjectId ? 'Current' : undefined,
      run: () => selectProject(project.id),
    }));

    return [...navigation, ...projectCommands];
  }, [router, projects, activeProjectId, activeWorkspaceId, selectProject, destinations]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.group}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  const activeIndex = active >= results.length ? 0 : active;

  useEffect(() => {
    const row = listRef.current?.querySelector('[data-active="true"]');
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const onIntent = useRouteIntent();
  function highlight(index: number) {
    if (index === activeIndex) return;
    setActive(index);
    const href = results[index]?.href;
    if (href) onIntent(href);
  }

  const runCommand = useCallback((command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  }, []);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight((activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(results[activeIndex]);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpenState}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn('dialog-overlay', SCRIM)} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
          className={cn(
            SHEET_FACE,
            'dialog-panel z-modal fixed top-16 left-1/2 flex max-h-[calc(100dvh-8rem)] w-[calc(100vw-3rem)] max-w-160 -translate-x-1/2 flex-col overflow-hidden overscroll-contain rounded-overlay',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="palette-field border-rule text-ink-2 flex min-h-[var(--control-lg)] shrink-0 items-center gap-3 border-b px-4">
            <Search className="size-3.5 shrink-0" aria-hidden />
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
              className="type-body text-ink placeholder:text-ink-3 min-w-0 flex-1 self-stretch bg-transparent"
            />
            <Kbd>Esc</Kbd>
          </div>
          <output className="sr-only">
            {query.trim() ? paletteOutcome(results.length, query) : ''}
          </output>

          <div
            ref={listRef}
            className="content-scroll max-h-100 min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
          >
            {results.length === 0 ? (
              <p className="type-body text-ink-2 px-4 py-[var(--page-section-gap)] text-center">
                {`No matches for “${query}”`}
              </p>
            ) : null}
            <div
              id={listboxId}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="listbox"
              aria-label="Commands"
            >
              {toSections(results).map((section, sectionIndex) => {
                const headingId = `${listboxId}-group-${sectionIndex}`;
                return (
                  <div
                    key={section.group}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                    role="group"
                    aria-labelledby={headingId}
                    className="[&+&]:mt-2"
                  >
                    <p id={headingId} className="type-caption-strong px-2 py-1">
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
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                          role="option"
                          tabIndex={-1}
                          aria-selected={isActive}
                          data-active={isActive}
                          onMouseMove={() => highlight(index)}
                          onClick={() => runCommand(command)}
                          className={cn(
                            'press [--press:0.98] type-body text-ink flex min-h-[var(--control-md)] w-full items-center gap-2 rounded-mark px-2 text-left',
                            isActive && 'overlay-hover',
                          )}
                        >
                          {Icon ? (
                            <Icon className="text-ink-2 size-3.5 shrink-0" aria-hidden />
                          ) : (
                            <BrandMark
                              name={command.label}
                              logoUrl={command.logoUrl}
                              websiteUrl={command.websiteUrl}
                              placement="inline"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{command.label}</span>
                          {command.hint ? (
                            <span className="type-caption text-ink-2 shrink-0 whitespace-nowrap">
                              {command.hint}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-rule type-caption text-ink-2 flex shrink-0 items-center gap-4 border-t px-4 py-2">
            <span className="inline-flex items-center gap-2">
              <Kbd keys={['↑', '↓']} />
              {'navigate'}
            </span>
            <span className="inline-flex items-center gap-2">
              <Kbd>↵</Kbd>
              {'select'}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function paletteOutcome(count: number, query: string) {
  return count === 0 ? `No matches for “${query}”` : pluralCount(count, 'result');
}
