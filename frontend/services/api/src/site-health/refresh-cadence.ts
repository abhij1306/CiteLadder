import type { SiteWorkerSettings } from './runtime.ts';

type CadenceSettings = Omit<SiteWorkerSettings['scoreRefresh'], 'countersSeconds' | 'issuePages'>;

export class RefreshCadence {
  readonly #marks = new Map<string, { refreshedAt: number; observed: number; pending: number }>();
  readonly #settings: CadenceSettings;
  constructor(settings: CadenceSettings) {
    this.#settings = settings;
  }
  admits(crawlId: string, at: { now?: number; pages?: number } = {}) {
    const { now = performance.now(), pages = 0 } = at;
    const { pageInterval, pageFraction, largePages, largeIntervalSeconds } = this.#settings;
    const minIntervalSeconds =
      largePages > 0 && pages >= largePages
        ? Math.max(largeIntervalSeconds, this.#settings.minIntervalSeconds)
        : this.#settings.minIntervalSeconds;
    if (pageInterval <= 0 && minIntervalSeconds <= 0) return true;
    const mark = this.#marks.get(crawlId);
    if (!mark) {
      this.#marks.set(crawlId, { refreshedAt: now, observed: 1, pending: 0 });
      this.#prune();
      return true;
    }
    mark.observed++;
    mark.pending++;
    const growing = Math.max(
      pageInterval,
      Math.ceil((mark.observed - mark.pending) * pageFraction),
    );
    const due =
      (pageInterval > 0 && mark.pending >= growing) ||
      (minIntervalSeconds > 0 && now - mark.refreshedAt >= minIntervalSeconds * 1000);
    if (due) {
      mark.refreshedAt = now;
      mark.pending = 0;
    }
    this.#prune();
    return due;
  }
  #prune() {
    const cap = this.#settings.maxTrackedCrawls;
    if (cap <= 0 || this.#marks.size <= cap) return;
    const stale = [...this.#marks].sort((a, b) => a[1].refreshedAt - b[1].refreshedAt);
    for (const [id] of stale.slice(0, this.#marks.size - cap)) this.#marks.delete(id);
  }
}

export function crawlCadences(settings: SiteWorkerSettings['scoreRefresh']) {
  return {
    score: new RefreshCadence(settings),
    discovery: new RefreshCadence(settings),
    analysisEvent: new RefreshCadence(settings),
    discoveryEvent: new RefreshCadence(settings),
    issues: new RefreshCadence({
      ...settings,
      pageInterval: settings.issuePages,
      pageFraction: 0,
      largePages: 0,
      minIntervalSeconds: 0,
    }),
    counters: new RefreshCadence({
      ...settings,
      pageInterval: 0,
      largePages: 0,
      minIntervalSeconds: settings.countersSeconds,
    }),
  };
}
export type CrawlCadences = ReturnType<typeof crawlCadences>;
