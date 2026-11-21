import type { CSSProperties, ReactNode } from 'react';

import { ChevronDown } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu';

export const SPLIT_ACTION_JOIN: CSSProperties = { borderStartEndRadius: 0, borderEndEndRadius: 0 };
const TRIGGER_JOIN: CSSProperties = {
  marginInlineStart: -1,
  borderStartStartRadius: 0,
  borderEndStartRadius: 0,
};

export function SplitButton({
  action,
  menuLabel,
  disabled = false,
  children,
}: Readonly<{
  action: ReactNode;
  menuLabel: string;
  disabled?: boolean;
  children: ReactNode;
}>) {
  return (
    <span data-split-button="" className="inline-flex">
      {action}
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="secondary"
            disabled={disabled}
            aria-label={menuLabel}
            className="px-2"
            style={TRIGGER_JOIN}
          >
            <Icon icon={ChevronDown} />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">{children}</MenuContent>
      </Menu>
    </span>
  );
}
