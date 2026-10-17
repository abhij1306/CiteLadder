import { hasUnsafeUrlCharacters } from '@/lib/safe-http-url';

/** Routes within the app shell. Runtime validation still applies to API data. */
export type AppRoute = `/${string}`;

export function isAppRoute(href: string): href is AppRoute {
  // Browsers treat backslashes as slashes for special URLs and strip controls.
  // Reject them before React Router or the browser can reinterpret the path.
  return href.startsWith('/') && !href.startsWith('//') && !hasUnsafeUrlCharacters(href);
}
