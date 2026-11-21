import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AGENT_FOLLOW_LATEST_GAP_PX } from '@/lib/config/agent';

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

  useLayoutEffect(() => {
    if (scrollRef.current) lastTop.current = pinToEnd(scrollRef.current);
  }, []);

  useEffect(() => {
    const region = scrollRef.current;
    if (!region) return;
    const onScroll = () => {
      const top = region.scrollTop;
      const distance = distanceFromEnd(region);
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
    if (region.firstElementChild) observer.observe(region.firstElementChild);
    return () => {
      region.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return { scrollRef, showJump, jumpToLatest };
}

function pinToEnd(region: HTMLElement) {
  region.scrollTop = region.scrollHeight;
  return region.scrollTop;
}

function distanceFromEnd(region: HTMLElement) {
  return region.scrollHeight - region.scrollTop - region.clientHeight;
}
