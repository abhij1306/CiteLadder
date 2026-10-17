/**
 * Route code loaders by path, so navigation intent can start a screen's
 * download before the click. The router registers each lazy route; a path it
 * never registered (or one with a parameter segment) is simply not preloaded.
 */
const loaders = new Map<string, () => Promise<unknown>>();

export function registerRouteChunk(path: string, load: () => Promise<unknown>): void {
  loaders.set(path, load);
}

/** Start the chunk for a pathname; failures surface when the route mounts. */
export function preloadRouteChunk(pathname: string): void {
  void loaders
    .get(pathname)?.()
    .catch(() => undefined);
}
