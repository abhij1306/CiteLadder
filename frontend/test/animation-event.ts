if (!('AnimationEvent' in globalThis)) {
  class AnimationEventStub extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? '';
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? '';
    }
  }
  Object.defineProperty(globalThis, 'AnimationEvent', {
    configurable: true,
    writable: true,
    value: AnimationEventStub,
  });
}
