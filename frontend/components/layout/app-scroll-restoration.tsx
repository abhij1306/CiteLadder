import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export function AppScrollRestoration() {
  const { key, pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const shownPath = useRef(pathname);

  useLayoutEffect(() => {
    const panel = document.getElementById('main');
    if (!panel) return;
    const pathChanged = shownPath.current !== pathname;
    shownPath.current = pathname;
    const anchor = hash ? document.getElementById(fragmentId(hash)) : null;
    if (navigationType === 'POP') panel.scrollTop = positions.current.get(key) ?? 0;
    else if (anchor) anchor.scrollIntoView();
    else if (pathChanged) panel.scrollTop = 0;
    const save = () => positions.current.set(key, panel.scrollTop);
    panel.addEventListener('scroll', save, { passive: true });
    return () => panel.removeEventListener('scroll', save);
  }, [key, pathname, hash, navigationType]);

  return null;
}

function fragmentId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}
