import { cn } from '@/lib/utils';

export function Switch({
  id,
  checked,
  onCheckedChange,
  label,
  describedBy,
  disabled = false,
  className,
}: Readonly<{
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'press focus-ring hit-area inline-flex h-5 w-10 shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'bg-primary not-disabled:hover:bg-primary-hover'
          : 'bg-control-line not-disabled:hover:bg-rule',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'ms-0.5 h-4 w-5.5 rounded-full transition-transform duration-[var(--motion-slide)] ease-[var(--ease-fluid)]',
          checked ? 'bg-on-primary translate-x-3.5' : 'bg-thumb',
        )}
      />
    </button>
  );
}
