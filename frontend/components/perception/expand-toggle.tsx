import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { ChevronDown, ChevronRight } from '@/lib/icons';

export function ExpandToggle({
  open,
  onToggle,
  children,
}: Readonly<{ open: boolean; onToggle: () => void; children: ReactNode }>) {
  return (
    <Pressable aria-expanded={open} onClick={onToggle} className="w-auto">
      <Inline as="span">
        <Icon icon={open ? ChevronDown : ChevronRight} className="text-ink-2" />
        {children}
      </Inline>
    </Pressable>
  );
}
