'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import type { VariantProps } from 'class-variance-authority';

import { Slot } from '@radix-ui/react-slot';
import { Spinner } from '@/components/ui/spinner';

import { cn } from '@/lib/utils';
import { buttonVariants } from './button-variants';

export type ButtonProps = ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element as the button (Radix Slot) instead of a <button>. */
    asChild?: boolean;
    pending?: boolean;
    pendingLabel?: ReactNode;
    ref?: Ref<HTMLButtonElement>;
  };

function buttonClass(
  variant: ButtonProps['variant'],
  size: ButtonProps['size'],
  opensPopup: boolean,
  className: string | undefined,
) {
  return cn(buttonVariants({ variant, size }), opensPopup ? 'active:scale-100' : null, className);
}

function SlottedButton({
  className,
  variant,
  size,
  pending = false,
  ref,
  children,
  disabled: _disabled,
  pendingLabel: _pendingLabel,
  type: _type,
  asChild: _asChild,
  ...props
}: Readonly<ButtonProps>) {
  const opensPopup = props['aria-haspopup'] !== undefined;
  return (
    <Slot
      ref={ref}
      {...props}
      data-button-variant={variant ?? 'primary'}
      data-button-size={size ?? 'md'}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, opensPopup, className)}
    >
      {children}
    </Slot>
  );
}

function NativeButton({
  className,
  variant,
  size,
  pending = false,
  pendingLabel,
  type,
  ref,
  children,
  asChild: _asChild,
  ...props
}: Readonly<ButtonProps>) {
  const opensPopup = props['aria-haspopup'] !== undefined;
  return (
    <button
      ref={ref}
      {...props}
      type={type ?? 'button'}
      data-button-variant={variant ?? 'primary'}
      data-button-size={size ?? 'md'}
      aria-busy={pending || undefined}
      disabled={props.disabled || pending}
      className={buttonClass(variant, size, opensPopup, cn('relative', className))}
    >
      <span
        aria-hidden={pending || undefined}
        className={cn('inline-flex items-center gap-2', pending && 'hidden')}
      >
        {children}
      </span>
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner size="md" />
          {pendingLabel ?? children}
        </span>
      ) : null}
    </button>
  );
}

export function Button(props: Readonly<ButtonProps>) {
  return props.asChild ? <SlottedButton {...props} /> : <NativeButton {...props} />;
}
