import { hasUnsafeUrlCharacters } from '@/lib/safe-http-url';

export type AppRoute = `/${string}`;

export function isAppRoute(href: string): href is AppRoute {
  return href.startsWith('/') && !href.startsWith('//') && !hasUnsafeUrlCharacters(href);
}
