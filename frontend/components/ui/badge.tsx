import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  badgeBase,
  classificationBadge,
  neutralBadge,
  runStatusBadge,
  sentimentBadge,
  statusBadge,
  type BadgeTone,
  type ClassificationValue,
  type RunStatusValue,
  type SentimentValue,
  type StatusValue,
} from './badge-variants';

/**
 * Badge — discriminated on `variant` so each family only accepts its own
 * values, and each value resolves to the correct bridged token classes.
 * A text label is always rendered (never color-only meaning — WCAG 1.4.1).
 */
export type BadgeProps = {
  children: ReactNode;
  className?: string;
} & (
  | { variant: 'status'; value: StatusValue }
  | { variant: 'sentiment'; value: SentimentValue }
  | { variant: 'classification'; value: ClassificationValue }
  | { variant: 'run-status'; value: RunStatusValue }
  | { variant?: 'neutral'; value?: undefined }
) &
  Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

function badgeTone(props: BadgeProps): BadgeTone {
  switch (props.variant) {
    case 'status':
      return statusBadge[props.value];
    case 'sentiment':
      return sentimentBadge[props.value];
    case 'classification':
      return classificationBadge[props.value];
    case 'run-status':
      return runStatusBadge[props.value];
    default:
      return neutralBadge;
  }
}

export function Badge(props: Readonly<BadgeProps>) {
  // Strip the styling discriminants (`variant`/`value`) so they never leak onto
  // the DOM node; forward every other HTML attribute (id, style, aria-*,
  // onClick, …) to the span.
  const { children, className, variant: _variant, value: _value, ...rest } = props;
  const tone = badgeTone(props);
  return (
    <span className={cn(badgeBase, tone.label, className)} {...rest}>
      <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
      {children}
    </span>
  );
}
