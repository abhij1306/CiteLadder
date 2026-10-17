'use client';

import type { ComponentProps, InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';

import { Input } from './input';
import { Pressable } from './pressable';
import { Spinner } from './spinner';

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'size'
> & {
  value: string;
  onValueChange: (value: string) => void;
  pending?: boolean;
  onClear?: () => void;
  size?: ComponentProps<typeof Input>['size'];
};

export function SearchField({
  value,
  onValueChange,
  pending = false,
  onClear,
  className,
  size,
  'aria-label': ariaLabel = 'Search',
  ...props
}: Readonly<SearchFieldProps>) {
  return (
    <Input
      {...props}
      type="search"
      size={size}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      containerClassName={className}
      className="[appearance:textfield] [&::-webkit-search-cancel-button]:hidden"
      startContent={
        pending ? (
          <Spinner className="text-muted" />
        ) : (
          <Search className="text-muted size-4 shrink-0" aria-hidden />
        )
      }
      endContentFlush
      endContent={
        value ? (
          <Pressable
            className="text-muted enabled:hover:bg-hover enabled:hover:text-foreground enabled:active:bg-active grid size-[var(--field-end-target)] place-items-center rounded-[var(--radius-control)]"
            disabled={props.disabled}
            onClick={() => (onClear ? onClear() : onValueChange(''))}
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden />
          </Pressable>
        ) : null
      }
    />
  );
}
