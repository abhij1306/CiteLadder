import type { ReactNode } from 'react';

import { Inline, Stack } from './layout';
import { Tag as DraftTag } from './tag';
import { textRole } from './typography';
import { cn } from '@/lib/utils';

export type DraftState = 'draft' | 'accepted' | 'declined';

const MARKER: Readonly<Record<DraftState, string>> = {
  draft: 'Draft',
  accepted: 'Accepted',
  declined: 'Dismissed',
};

function draftAttribute(state: DraftState) {
  switch (state) {
    case 'draft':
      return 'true';
    case 'accepted':
      return 'false';
    case 'declined':
      return undefined;
    default: {
      const unknown: never = state;
      return unknown;
    }
  }
}

function draftSheetClasses(state: DraftState, className?: string) {
  return cn(
    'rounded-card p-[var(--card-padding)]',
    state === 'declined' ? 'bg-well' : 'bg-surface shadow-card edge-draft',
    className,
  );
}

export function DraftSheet({
  title,
  state,
  marker,
  actions,
  as: Tag = 'section',
  id,
  className,
  children,
  ...aria
}: Readonly<{
  title?: string;
  state: DraftState;
  marker?: string;
  actions?: ReactNode;
  as?: 'section' | 'li' | 'div';
  id?: string;
  className?: string;
  children?: ReactNode;
  'aria-current'?: boolean;
}>) {
  return (
    <Tag
      id={id}
      aria-label={Tag === 'section' ? title : undefined}
      aria-current={aria['aria-current']}
      data-draft={draftAttribute(state)}
      data-draft-state={state}
      className={draftSheetClasses(state, className)}
    >
      <Stack gap="item">
        <p className="flex">
          <DraftTag kind={state === 'draft' ? 'draft' : 'category'}>
            {marker ?? MARKER[state]}
          </DraftTag>
        </p>
        {title ? <h2 className={textRole('subheading', 'min-w-0 break-words')}>{title}</h2> : null}
        {children}
        {actions ? <Inline className="flex-wrap">{actions}</Inline> : null}
      </Stack>
    </Tag>
  );
}
