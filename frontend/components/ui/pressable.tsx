import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils';

export type PressableProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
};

export function Pressable({ className, type = 'button', ref, ...props }: Readonly<PressableProps>) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'focus-ring w-full rounded-control text-left transition-[background-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] disabled:pointer-events-none disabled:bg-well disabled:text-ink-2 disabled:border-rule',
        className,
      )}
      {...props}
    />
  );
}
