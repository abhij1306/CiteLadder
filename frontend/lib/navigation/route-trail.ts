import { findAppRoute, isAgentPath } from './app-routes';

export function routeTrail(pathname: string): readonly { label: string; href: string }[] {
  if (isAgentPath(pathname)) return [];
  const collection = findAppRoute(pathname)?.collection;
  const parent = collection ? findAppRoute(collection) : undefined;
  return collection && parent?.title ? [{ label: parent.title, href: collection }] : [];
}
