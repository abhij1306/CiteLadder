'use client';

import { useEffect, useRef, useState } from 'react';

import type { AgentChatDetail } from '@/lib/api/agent';
import { AGENT_FOLLOW_LATEST_GAP_PX } from '@/lib/config/agent';

/** Shares reading-position behavior between the page and the Dashboard drawer. */
export function useFollowLatest(detail: AgentChatDetail) {
  const endRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const jumpToLatest = () => {
    following.current = true;
    setShowJump(false);
    endRef.current?.scrollIntoView?.({ block: 'end' });
  };

  useEffect(() => {
    const root = scrollParent(endRef.current);
    const surface = root ?? window;
    const onScroll = () => {
      const height = root?.scrollHeight ?? document.documentElement.scrollHeight;
      const position = root?.scrollTop ?? window.scrollY;
      const viewport = root?.clientHeight ?? window.innerHeight;
      const nearEnd = height - position - viewport <= AGENT_FOLLOW_LATEST_GAP_PX;
      following.current = nearEnd;
      setShowJump(!nearEnd);
    };
    // A fresh chat starts at latest; a restored reading position stays where it is.
    if ((root?.scrollTop ?? window.scrollY) > 0) onScroll();
    surface.addEventListener('scroll', onScroll, { passive: true });
    return () => surface.removeEventListener('scroll', onScroll);
  }, []);

  // Streamed text grows the thread without a new read; keep following it, so the
  // end of a turn never jumps by everything that arrived meanwhile.
  useEffect(() => {
    const thread = endRef.current?.parentElement;
    if (!thread || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.current) endRef.current?.scrollIntoView?.({ block: 'end' });
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, []);

  const progress = detail.latest_run?.progress.at(-1);
  useEffect(() => {
    if (following.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [
    detail.messages.length,
    detail.latest_run?.status,
    detail.output?.latest_revision?.id,
    progress?.ordinal,
    progress?.status,
  ]);

  return { endRef, showJump, jumpToLatest };
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}
