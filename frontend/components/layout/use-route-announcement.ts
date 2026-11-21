import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · CiteLadder`;
  }, [title]);
}

/**
 * Focuses the region that scrolls: a fitted page's own scroller, else the
 * main panel. Focus on a panel that cannot scroll leaves the keys and an
 * overlay scrollbar dead until a click moves focus inside.
 */
function focusPageScroller() {
  const target =
    document.querySelector<HTMLElement>('[data-page-scroller]') ?? document.getElementById('main');
  target?.focus({ preventScroll: true });
}

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
    focusPageScroller();
  }, [pathname]);
}
