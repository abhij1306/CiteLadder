'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AGENT_FOLLOW_LATEST_GAP_PX } from '@/lib/config/agent';

/**
 * Keeps a chat's scrolling region on its newest content while the reader is
 * at the end of it, for the page and the Dashboard drawer alike.
 *
 * Only the region scrolls: it is pinned by setting its own `scrollTop`, never
 * by `scrollIntoView`, which would also scroll the window and the shell. It
 * follows every size change of the thread (streamed thinking and reply, a
 * step's reads appearing and clearing) and of the region itself (the composer
 * growing), before the browser paints. Once the reader scrolls up nothing
 * moves them, and `showJump` offers the way back.
 */
export function useFollowLatest() {
  const scrollRef = useRef<HTMLElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const jumpToLatest = () => {
    following.current = true;
    setShowJump(false);
    if (scrollRef.current) lastTop.current = pinToEnd(scrollRef.current);
  };

  // A chat opens at its newest message.
  useLayoutEffect(() => {
    if (scrollRef.current) lastTop.current = pinToEnd(scrollRef.current);
  }, []);

  useEffect(() => {
    const region = scrollRef.current;
    if (!region) return;
    const onScroll = () => {
      const top = region.scrollTop;
      const distance = distanceFromEnd(region);
      // Moving up away from the end is the reader's choice; a thread that
      // shrinks clamps the position up but leaves it at the end.
      if (top < lastTop.current && distance > 1) following.current = false;
      else if (distance <= AGENT_FOLLOW_LATEST_GAP_PX) following.current = true;
      lastTop.current = top;
      setShowJump(distance > AGENT_FOLLOW_LATEST_GAP_PX);
    };
    const onResize = () => {
      if (following.current) lastTop.current = pinToEnd(region);
      else setShowJump(distanceFromEnd(region) > AGENT_FOLLOW_LATEST_GAP_PX);
    };
    region.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(region);
    // The region holds one column, the thread, which grows as a reply streams.
    if (region.firstElementChild) observer.observe(region.firstElementChild);
    return () => {
      region.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return { scrollRef, showJump, jumpToLatest };
}

/** Scrolls the region to its end and returns where it landed. */
function pinToEnd(region: HTMLElement) {
  region.scrollTop = region.scrollHeight;
  return region.scrollTop;
}

function distanceFromEnd(region: HTMLElement) {
  return region.scrollHeight - region.scrollTop - region.clientHeight;
}
