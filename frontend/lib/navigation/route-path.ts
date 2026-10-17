/**
 * A pathname compared as a route: trailing slashes dropped, lower-cased.
 * Scans from the end instead of using `/\/+$/`, which backtracks quadratically
 * on long slash runs in a request path.
 */
export function routePath(pathname: string): string {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === '/') end -= 1;
  return pathname.slice(0, end).toLowerCase();
}
