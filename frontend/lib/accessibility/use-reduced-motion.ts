import { useMediaQuery } from '@/lib/use-media-query';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
