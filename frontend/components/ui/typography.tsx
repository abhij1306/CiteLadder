import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils';

const TEXT_ROLES = {
  display: 'type-display',
  title: 'type-title',
  heading: 'type-heading',
  subheading: 'type-subheading',
  body: 'type-body',
  label: 'type-label',
  prose: 'type-prose',
  caption: 'type-caption',
  captionStrong: 'type-caption-strong',
  figureXl: 'type-figure-xl',
  figure: 'type-figure',
  code: 'type-code',
  emphasis: 'type-emphasis',
  pageTitle: 'type-page-title',
} as const;

export type TextRole = keyof typeof TEXT_ROLES;

export function textRole(role: TextRole, className?: string) {
  return cn(TEXT_ROLES[role], className);
}

export function Label({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={textRole('body', cn('text-ink-2', className))}>
      {children}
    </span>
  );
}

export function CodeToken({ children }: Readonly<{ children: string }>) {
  return (
    <code
      data-code-token=""
      className={textRole('code', 'bg-well min-w-0 truncate rounded-control px-2 py-1')}
    >
      {children}
    </code>
  );
}

export function InlineFigure({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={cn('tabular-nums', className)}>
      {children}
    </span>
  );
}

export function Metric({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={textRole('figure', className)}>
      {children}
    </span>
  );
}
