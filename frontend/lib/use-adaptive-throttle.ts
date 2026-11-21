import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useAdaptiveThrottle<T>(
  value: T,
  { floor, cap }: { floor: number; cap: number },
): T {
  const [shown, setShown] = useState(value);
  const paintedAt = useRef(0);
  const wait = useRef(floor);
  const updatedAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (updatedAt.current === null) return;
    wait.current = Math.min(cap, Math.max(floor, 2 * (Date.now() - updatedAt.current)));
    updatedAt.current = null;
  }, [shown, floor, cap]);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        paintedAt.current = Date.now();
        updatedAt.current = paintedAt.current;
        setShown(value);
      },
      Math.max(0, paintedAt.current + wait.current - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value]);
  return shown;
}
