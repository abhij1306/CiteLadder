'use client';

import { ChevronDown } from 'lucide-react';

import {
  Dropdown,
  DropdownContent,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { inputClasses } from '@/components/ui/input';
import type { PageKind } from '@/lib/api/types';
import { PAGE_KINDS, pageKindLabel } from '@/lib/site-health/page-kinds';
import { cn } from '@/lib/utils';

/**
 * The page-kind filter control (site-health v2 P1) shared by the pages,
 * inventory, and issues list screens. A custom styled Radix dropdown on the
 * shared `inputClasses` control treatment — the empty option clears the
 * filter (all page kinds).
 */
export function PageKindSelect({
  value,
  onChange,
}: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const currentLabel = value ? pageKindLabel(value as PageKind) : 'All page kinds';

  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Filter by page kind"
        className={cn(
          inputClasses,
          'flex w-36 cursor-pointer items-center justify-between text-left select-none',
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="text-muted size-4 shrink-0" aria-hidden />
      </DropdownTrigger>
      <DropdownContent align="start" className="max-h-64 w-48 overflow-y-auto">
        <DropdownRadioGroup value={value} onValueChange={onChange}>
          <DropdownRadioItem value="">All page kinds</DropdownRadioItem>
          {PAGE_KINDS.map((pageKind) => (
            <DropdownRadioItem key={pageKind} value={pageKind}>
              {pageKindLabel(pageKind)}
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}
