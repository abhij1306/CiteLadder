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

export function emitResize(target: Element) {
  for (const observer of ResizeObserverStub.instances) observer.emit(target);
}
