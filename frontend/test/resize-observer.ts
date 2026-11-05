/**
 * A drivable ResizeObserver for jsdom, which has none and lays nothing out.
 *
 * Radix only needs the observer contract, but a component that reacts to a
 * size change (a chat following its newest message) is untestable unless a
 * test can say "this element changed size": `emitResize` calls back every
 * observer watching that element, as a browser would after layout.
 */
class ResizeObserverStub {
  static readonly instances = new Set<ResizeObserverStub>();

  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    ResizeObserverStub.instances.delete(this);
  }

  emit(target: Element) {
    if (!this.targets.has(target)) return;
    const size = [{ inlineSize: 0, blockSize: 0 }];
    const entry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    };
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

export function installResizeObserver() {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
}

/** Reports a size change of `target` to every observer watching it. */
export function emitResize(target: Element) {
  for (const observer of ResizeObserverStub.instances) observer.emit(target);
}
