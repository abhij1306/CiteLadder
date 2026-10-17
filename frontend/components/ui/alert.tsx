import type { ReactNode } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { Info } from 'lucide-react';

import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { alertVariants } from './alert-variants';

const toneIcon = {
  danger: ICONS.danger,
  warning: ICONS.warning,
  success: ICONS.success,
  info: Info,
  neutral: Info,
} as const;

export type AlertProps = {
  children: ReactNode;
  className?: string;
  /** Hide the leading tone icon. */
  hideIcon?: boolean;
} & VariantProps<typeof alertVariants>;

export function Alert({ children, tone, hideIcon, className }: Readonly<AlertProps>) {
  if (!children) return null;
  const Icon = toneIcon[tone ?? 'danger'];
  return (
    <div role="alert" className={cn(alertVariants({ tone }), className)}>
      {hideIcon ? null : <Icon className="size-4 shrink-0" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
