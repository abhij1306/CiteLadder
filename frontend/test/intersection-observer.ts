/**
 * A drivable IntersectionObserver for jsdom, which has none.
 *
 * Components reach for it to answer "is this on screen?" without reading
 * layout on the main thread. A stub that only satisfies the constructor would
 * make every such component untestable in the one state that matters, so this
 * keeps its instances reachable and lets a test say what the answer is.
 */
type Entry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target'>;

class IntersectionObserverStub {
  static readonly instances = new Set<IntersectionObserverStub>();

  readonly targets = new Set<Element>();
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: readonly number[] = [0];

  constructor(private readonly callback: (entries: Entry[]) => void) {
    IntersectionObserverStub.instances.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    IntersectionObserverStub.instances.delete(this);
  }

  takeRecords(): Entry[] {
    return [];
  }

  emit(isIntersecting: boolean) {
    for (const target of this.targets) this.callback([{ isIntersecting, target }]);
  }
}

export function installIntersectionObserver() {
  globalThis.IntersectionObserver ??=
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
}
