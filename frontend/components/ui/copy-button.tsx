'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from './button';
import { useToast } from './toast';

export type CopyButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'asChild' | 'onClick' | 'pending'
> & {
  value: string;
  copiedLabel?: string;
  iconOnly?: boolean;
};

export function CopyButton({
  value,
  children = 'Copy',
  copiedLabel = 'Copied',
  iconOnly = false,
  ...props
}: Readonly<CopyButtonProps>) {
  const { notify } = useToast();
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyInFlight = useRef(false);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setStatus((current) => (current === 'copied' ? current : 'copying'));
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
      notify(copiedLabel);
      resetTimer.current = setTimeout(() => setStatus('idle'), 1800);
    } catch {
      setStatus('error');
    } finally {
      copyInFlight.current = false;
    }
  }

  // An icon-only button says what it does through its label alone, so the
  // copied confirmation has to live there too. A labelled one keeps its action
  // text steady; the check icon and toast confirm success without resizing it.
  const iconLabel = status === 'copied' ? copiedLabel : 'Copy';
  let label: ReactNode = children;
  if (status === 'error') label = 'Copy failed — retry';

  return (
    <Button
      variant="secondary"
      {...props}
      aria-busy={status === 'copying' || undefined}
      onClick={() => void copy()}
      aria-live="polite"
      aria-label={iconOnly ? iconLabel : props['aria-label']}
    >
      {status === 'copied' ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {iconOnly ? null : label}
    </Button>
  );
}
