import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

import type { FilterDefinition, FilterIcon } from '@/components/ui/all-filters';
import { focusFieldOnEntry, FilterOptions } from '@/components/ui/filter-options';
import { TRIGGER_BOX } from '@/components/ui/input';
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { Bot, CalendarDays, ChevronDown, Folder, Globe, Tag, X, type IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

export function FilterTrigger({
  label,
  value,
  lead,
  iconOnly = false,
  active = false,
  className,
  ref,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
    label: string;
    value?: string;
    lead?: ReactNode;
    iconOnly?: boolean;
    active?: boolean;
    ref?: Ref<HTMLButtonElement>;
  }
>) {
  const name = value === undefined ? label : `${label}: ${value}`;
  return (
    // Always wrapped, so moving off the default keeps the same button (and its focus).
    <Tooltip content={name} describe={false}>
      <button
        ref={ref}
        type="button"
        data-active={active || undefined}
        aria-label={name}
        className={cn(
          TRIGGER_BOX,
          'focus-input flex w-auto max-w-full min-w-0 shrink-0 items-center text-left',
          'press',
          'disabled:cursor-not-allowed disabled:opacity-45',
          iconOnly ? 'gap-1 px-0 pe-2' : 'gap-2 ps-3 pe-2',
          className,
        )}
        {...props}
      >
        {lead ? (
          <span className={cn('text-ink-2 flex shrink-0 items-center', iconOnly && 'ps-2')}>
            {lead}
          </span>
        ) : null}
        {iconOnly || value === undefined ? null : (
          <span data-filter-value="" className="text-ink min-w-0 truncate">
            {value}
          </span>
        )}
        <ChevronDown className="text-ink-2 size-3.5 shrink-0" aria-hidden />
      </button>
    </Tooltip>
  );
}

const GLYPHS: Record<FilterIcon, IconGlyph> = {
  period: CalendarDays,
  engines: Bot,
  market: Globe,
  prompts: Tag,
  topic: Folder,
};

function engineStack(filter: FilterDefinition): ReactNode {
  if (filter.kind !== 'choice') return null;
  const options = filter.groups.flatMap((group) => group.options);
  const shown = filter.isDefault
    ? options.filter((option) => option.mark).slice(0, 3)
    : options.filter((option) => option.value === filter.value && option.mark);
  if (shown.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5 [&_svg]:size-3.5">
      {shown.map((option) => (
        <span key={option.value} className="flex">
          {option.mark}
        </span>
      ))}
    </span>
  );
}

function filterLead(filter: FilterDefinition): ReactNode {
  if (!filter.icon) return null;
  const marks = filter.icon === 'engines' ? engineStack(filter) : null;
  if (marks) return marks;
  const Glyph = GLYPHS[filter.icon];
  return <Glyph className="size-3.5" aria-hidden />;
}

export function FilterChip({
  filter,
  align = 'start',
}: Readonly<{ filter: FilterDefinition; align?: 'start' | 'end' }>) {
  const lead = filterLead(filter);
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger
          label={filter.label}
          value={filter.valueLabel}
          lead={lead}
          iconOnly={lead !== null && filter.isDefault}
          active={!filter.isDefault}
          disabled={filter.disabled}
        />
      </MenuTrigger>
      <MenuContent align={align} onFocus={focusFieldOnEntry}>
        <FilterOptions filter={filter} />
      </MenuContent>
    </Menu>
  );
}

export function ValueChip({ filter }: Readonly<{ filter: FilterDefinition }>) {
  return (
    <Tooltip content={filter.label}>
      <span className="face bg-raised border-rule rounded-control type-body text-ink inline-flex min-h-[var(--control-md)] max-w-full min-w-0 shrink-0 items-center gap-1 border ps-3 pe-1">
        <span className="min-w-0 truncate">{filter.valueLabel}</span>
        <button
          type="button"
          aria-label={`Remove ${filter.label} filter`}
          onClick={filter.reset}
          className="focus-ring rounded-mark text-ink-2 hover:text-ink hover:overlay-hover flex size-5.5 shrink-0 items-center justify-center"
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
    </Tooltip>
  );
}
