export function routePath(pathname: string): string {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === '/') end -= 1;
  return pathname.slice(0, end).toLowerCase();
}
