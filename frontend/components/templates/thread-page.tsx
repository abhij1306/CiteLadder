import type { ReactNode, RefObject } from 'react';

import {
  ComposerBlocks,
  ShapeBlocks,
  SkeletonBlock,
  SkeletonFrame,
} from '@/components/ui/skeleton-block';

import { PageFrame, type PageFrameSlots } from './page-frame';

export function ThreadPageLoading({ label = 'Loading the chat…' }: Readonly<{ label?: string }>) {
  return (
    <ThreadPage
      composer={
        <div className="shrink-0 pt-2 pb-4">
          <ComposerBlocks />
        </div>
      }
    >
      <SkeletonFrame label={label} variant="thread">
        <ShapeBlocks shape={{ kind: 'thread' }} />
      </SkeletonFrame>
    </ThreadPage>
  );
}

export function NewChatLoading() {
  return (
    <ThreadPage>
      <SkeletonFrame
        label="Loading the Agent…"
        variant="new-chat"
        className="my-auto flex flex-col gap-[var(--page-section-gap)]"
      >
        <span className="flex h-7 items-center justify-center">
          <SkeletonBlock className="h-5 w-60 max-w-full" />
        </span>
        <ComposerBlocks />
      </SkeletonFrame>
    </ThreadPage>
  );
}

export function ThreadPage({
  composer,
  scrollRef,
  scrollLabel,
  children,
  ...slots
}: Omit<PageFrameSlots, 'tabs' | 'filters' | 'trail' | 'crumb'> &
  Readonly<{
    composer?: ReactNode;
    scrollRef?: RefObject<HTMLElement | null>;
    scrollLabel?: string;
    children: ReactNode;
  }>) {
  return (
    <PageFrame {...slots}>
      <div className="flex h-[calc(100dvh-var(--route-chrome-height))] min-h-0 flex-col gap-[var(--workspace-gap)]">
        <section
          ref={scrollRef}
          aria-label={scrollLabel}
          className="-m-1 min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain p-1"
        >
          <div
            data-page-content=""
            data-thread=""
            className="flex min-h-full w-full min-w-0 flex-col gap-[var(--workspace-gap)]"
          >
            {children}
          </div>
        </section>
        {composer ? <div className="w-full min-w-0">{composer}</div> : null}
      </div>
    </PageFrame>
  );
}
