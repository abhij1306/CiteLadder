import {
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { ClampText } from '@/components/ui/clamp-text';
import { pressableRowClasses } from '@/components/ui/open-row-skeleton';
import { textRole } from '@/components/ui/typography';
import { Check, ChevronDown } from '@/lib/icons';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

function listRowClasses({ selected = false }: Readonly<{ selected?: boolean }> = {}) {
  return cn(
    'relative rounded-control transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
    selected
      ? 'overlay-selected text-ink'
      : 'text-ink-2 hover:overlay-hover hover:text-ink active:overlay-pressed',
  );
}

export function OptionRow({
  title,
  caption,
  selected,
  pending = false,
  disabled,
  onSelect,
}: Readonly<{
  title: ReactNode;
  caption?: ReactNode;
  selected: boolean;
  pending?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}>) {
  return (
    <Pressable
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        listRowClasses({ selected }),
        pressableRowClasses,
        'disabled:pointer-events-none disabled:[&_.type-body]:text-ink-2',
      )}
    >
      <span className="min-w-0 flex-1">
        <ClampText className={textRole('body')}>{title}</ClampText>
        {caption ? <ClampText className="type-caption tabular-nums">{caption}</ClampText> : null}
      </span>
      {pending ? <Spinner className="text-ink-2" /> : null}
      {selected && !pending ? <Icon icon={Check} className="text-ink" /> : null}
    </Pressable>
  );
}

export function DisclosureList({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className="divide-rule grid min-w-0 divide-y">{children}</ul>;
}

export function DisclosureRow({
  title,
  meta,
  children,
}: Readonly<{
  title: ReactNode;
  meta: ReactNode;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="grid min-w-0">
      <Pressable
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className={cn(listRowClasses(), pressableRowClasses, 'min-h-10')}
      >
        <span className="phone:flex-wrap phone:gap-y-1 phone:py-2 flex min-w-0 flex-1 items-center gap-3">
          <ClampText phoneWrap className={textRole('label', 'text-ink phone:basis-full min-w-0')}>
            {title}
          </ClampText>
          <span className={textRole('caption', 'text-ink-2 flex shrink-0 items-center gap-3')}>
            {meta}
          </span>
        </span>
        <Icon
          icon={ChevronDown}
          className={cn('text-ink-2 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </Pressable>
      <div
        id={panelId}
        hidden={!open}
        className="bg-well rounded-control mb-2 grid min-w-0 gap-3 px-4 py-3"
      >
        {open ? children : null}
      </div>
    </li>
  );
}

export function TreeList({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <ul aria-label={label} className="flex min-w-0 flex-col gap-0.5">
      {children}
    </ul>
  );
}

export function TreeItem({
  label,
  count,
  nested = false,
  actions,
}: Readonly<{
  label: string;
  count?: number;
  nested?: boolean;
  actions?: ReactNode;
}>) {
  return (
    <li
      data-tree-item=""
      className={cn(
        'text-ink flex min-h-[var(--control-md)] min-w-0 items-center gap-2 ps-3 pe-0.5',
        nested && 'ms-3',
        listRowClasses(),
      )}
    >
      <ClampText className="type-body flex-1">{label}</ClampText>
      {typeof count === 'number' ? (
        <span className="type-caption shrink-0 tabular-nums">{formatCount(count)}</span>
      ) : null}
      {actions}
    </li>
  );
}

const TREE_INDENT = ['', 'ms-4', 'ms-8', 'ms-12', 'ms-16', 'ms-20'] as const;
const treeIndent = (depth: number) => TREE_INDENT[Math.min(depth, TREE_INDENT.length - 1)];

export function TreeCheckOption({
  label,
  checked,
  disabled = false,
  depth = 0,
  badge,
  onCheckedChange,
}: Readonly<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  depth?: number;
  badge?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}>) {
  return (
    <li
      className={cn('flex min-h-[var(--control-md)] min-w-0 items-center gap-2', treeIndent(depth))}
    >
      <Checkbox
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      {badge}
    </li>
  );
}

export function TreeItemForm({
  nested = false,
  onSubmit,
  children,
}: Readonly<{ nested?: boolean; onSubmit: () => void; children: ReactNode }>) {
  return (
    <li>
      <form
        className={cn('flex items-center gap-2', nested && 'ms-3')}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </li>
  );
}

export function ItemRow({
  icon,
  title,
  caption,
  status,
  actions,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'li'>, 'className' | 'children' | 'title'> & {
    icon: ReactNode;
    title: ReactNode;
    caption: ReactNode;
    status: ReactNode;
    actions: ReactNode;
  }
>) {
  return (
    <li
      {...props}
      className="phone:grid-cols-[20px_minmax(0,1fr)] grid grid-cols-[20px_minmax(0,1fr)_fit-content(40%)] items-center gap-3 py-3 @[640px]:grid-cols-[20px_minmax(0,1fr)_fit-content(40%)_auto]"
    >
      <span className="flex size-5 items-center justify-center self-start">{icon}</span>
      <div className="grid min-w-0 gap-0.5">
        <p className={textRole('label', 'text-ink')}>{title}</p>
        <div
          data-item-caption=""
          className={textRole(
            'caption',
            'text-ink-2 phone:flex-wrap flex min-w-0 items-baseline gap-1',
          )}
        >
          {caption}
        </div>
      </div>
      <div
        className={textRole(
          'caption',
          'text-ink-2 phone:col-start-2 flex min-w-0 items-center gap-2',
        )}
      >
        {status}
      </div>
      <div className="col-[2/-1] flex flex-wrap items-center gap-2 @[640px]:col-auto">
        {actions}
      </div>
    </li>
  );
}
