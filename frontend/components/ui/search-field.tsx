import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from '@/lib/icons';

import { Icon } from './icon';
import { FieldEndButton, Input } from './input';
import { Kbd } from './kbd';
import { Spinner } from './spinner';

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'size' | 'width'
> & {
  value: string;
  onValueChange: (value: string) => void;
  pending?: boolean;
  onClear?: () => void;
  shortcut?: true | string;
};

export function SearchField({
  value,
  onValueChange,
  pending = false,
  onClear,
  shortcut,
  className,
  onKeyDown,
  'aria-label': ariaLabel = 'Search',
  ...props
}: Readonly<SearchFieldProps>) {
  const ref = useRef<HTMLInputElement>(null);
  const cap = shortcut === true ? '⌘K' : shortcut;

  useEffect(() => {
    if (!cap) return undefined;
    const key = cap.slice(-1).toLowerCase();
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, [cap]);

  const clear = () => {
    if (onClear) onClear();
    else onValueChange('');
    ref.current?.focus();
  };

  let end: ReactNode = null;
  if (value) {
    end = (
      <FieldEndButton icon={X} label="Clear search" disabled={props.disabled} onClick={clear} />
    );
  } else if (cap) {
    end = <Kbd>{cap}</Kbd>;
  }

  return (
    <Input
      {...props}
      ref={ref}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.preventDefault();
          clear();
        }
        onKeyDown?.(event);
      }}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      containerClassName={className}
      className="[appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      startContent={pending ? <Spinner /> : <Icon icon={Search} className="text-ink-2" />}
      endContent={
        <span className="inline-flex min-h-5 min-w-7 items-center justify-end">{end}</span>
      }
    />
  );
}
