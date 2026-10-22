'use client';

import type { InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';

import { Icon } from './icon';
import { FieldEndButton, Input } from './input';
import { Spinner } from './spinner';

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'size' | 'width'
> & {
  value: string;
  onValueChange: (value: string) => void;
  pending?: boolean;
  onClear?: () => void;
};

/** The product search field: one form, the 32px control. */
export function SearchField({
  value,
  onValueChange,
  pending = false,
  onClear,
  className,
  'aria-label': ariaLabel = 'Search',
  ...props
}: Readonly<SearchFieldProps>) {
  return (
    <Input
      {...props}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      containerClassName={className}
      className="[appearance:textfield] [&::-webkit-search-cancel-button]:hidden"
      startContent={
        pending ? <Spinner className="text-muted" /> : <Icon icon={Search} className="text-muted" />
      }
      endContentFlush
      endContent={
        value ? (
          <FieldEndButton
            icon={X}
            label="Clear search"
            disabled={props.disabled}
            onClick={() => (onClear ? onClear() : onValueChange(''))}
          />
        ) : null
      }
    />
  );
}
