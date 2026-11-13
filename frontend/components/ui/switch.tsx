import { cn } from '@/lib/utils';

/**
 * Switch — an on/off control for a setting that takes effect at once: a
 * 32×20 `radius-full` track, `line-control` off and `ink` on, with a 16px
 * `surface` thumb that slides 12px in 120ms (instant under reduced motion).
 * Focus is the 2px ring around the track.
 *
 * A native `<button role="switch">`: the browser gives Space and Enter,
 * focus and disabled semantics; `aria-checked` carries the state.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  describedBy,
  disabled = false,
  className,
}: Readonly<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The accessible name. Rendered by the caller if it should also be visible. */
  label: string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'focus-ring relative inline-block h-5 w-8 shrink-0 rounded-full transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-ink' : 'bg-line-control',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'bg-surface shadow-xs absolute top-0.5 left-0.5 size-4 rounded-full transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
          checked && 'translate-x-3',
        )}
      />
    </button>
  );
}
