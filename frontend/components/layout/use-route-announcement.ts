import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · CiteLadder`;
  }, [title]);
}

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
