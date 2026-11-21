const loaders = new Map<string, () => Promise<unknown>>();

export function registerRouteChunk(path: string, load: () => Promise<unknown>): void {
  loaders.set(path, load);
}

export function preloadRouteChunk(pathname: string): void {
  void loaders
    .get(pathname)?.()
    .catch(() => undefined);
}
