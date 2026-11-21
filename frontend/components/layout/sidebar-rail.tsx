import { lazy, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Check, type IconGlyph } from '@/lib/icons';
import { LazyIsland } from '@/components/ui/lazy-island';
import { Menu, MenuContent, MenuLabel, MenuLinkItem, MenuTrigger } from '@/components/ui/menu';
import { SidebarRowTooltip, sidebarRailButtonClasses } from '@/components/ui/sidebar';

import type { NavItem } from './nav-items';

const OpenActionCountLabel = lazy(() =>
  import('./open-action-count').then(({ OpenActionCountLabel }) => ({
    default: OpenActionCountLabel,
  })),
);

export function RailLink({ item, active }: Readonly<{ item: NavItem; active: boolean }>) {
  const Icon = item.icon;
  return (
    <SidebarRowTooltip label={item.label}>
      <Link
        to={item.href}
        aria-current={active ? 'page' : undefined}
        className={sidebarRailButtonClasses(active)}
      >
        <Icon aria-hidden />
        <span className="sr-only">
          {item.label}
          {item.badge === 'open-actions' ? (
            <LazyIsland failed={null} label="open-action-count" defects="contain">
              <OpenActionCountLabel />
            </LazyIsland>
          ) : null}
        </span>
      </Link>
    </SidebarRowTooltip>
  );
}

export function RailFlyout({
  label,
  icon: Icon,
  current,
  children,
}: Readonly<{ label: string; icon: IconGlyph; current: boolean; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return (
    // Not modal: a modal menu locks scrolling and pointer events until an outside click.
    <Menu open={open} onOpenChange={setOpen} modal={false}>
      <SidebarRowTooltip label={label}>
        <MenuTrigger
          aria-label={label}
          aria-current={current ? 'true' : undefined}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setOpen(true);
          }}
          className={sidebarRailButtonClasses(current)}
        >
          <Icon aria-hidden />
        </MenuTrigger>
      </SidebarRowTooltip>
      <MenuContent side="right" align="start" aria-label={label}>
        <MenuLabel>{label}</MenuLabel>
        {children}
      </MenuContent>
    </Menu>
  );
}

export function RailGroupMenu({
  label,
  icon,
  current,
  items,
}: Readonly<{
  label: string;
  icon: IconGlyph;
  current: boolean;
  items: readonly (NavItem & { active: boolean })[];
}>) {
  return (
    <RailFlyout label={label} icon={icon} current={current}>
      {items.map(({ icon: ItemIcon, ...item }) => (
        <MenuLinkItem key={item.href}>
          <Link to={item.href} aria-current={item.active ? 'page' : undefined}>
            <ItemIcon className="text-ink-2 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.active ? <Check className="text-accent size-3.5 shrink-0" aria-hidden /> : null}
          </Link>
        </MenuLinkItem>
      ))}
    </RailFlyout>
  );
}
