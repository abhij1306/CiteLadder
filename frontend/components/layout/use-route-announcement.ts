'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Names the document after the screen and project, and after an in-app move
 * to another screen puts focus on the main region, so a keyboard or
 * screen-reader user starts at the new screen instead of the link they left.
 * Changing a tab or filter on the same screen keeps focus where it is.
 */
export function useRouteAnnouncement({
  title,
  projectName,
}: Readonly<{ title: string; projectName: string | null }>) {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    document.title = [title, projectName, 'CiteLadder'].filter(Boolean).join(' · ');
  }, [title, projectName]);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
}
