import { interactiveCapacity } from '../config/execution.ts';
import { ApiError } from '../errors.ts';

type Capacity = typeof interactiveCapacity;
export type InteractiveSlot = {
  readonly signal: AbortSignal;
  readonly release: () => void;
};

class InteractiveSlots {
  private readonly capacity: Capacity;
  private readonly stopping = new AbortController();
  private readonly held = new Set<InteractiveSlot>();
  private readonly idle = new Set<() => void>();
  constructor(capacity: Capacity = interactiveCapacity) {
    this.capacity = capacity;
  }
  acquire(): InteractiveSlot {
    if (this.stopping.signal.aborted || this.held.size >= this.capacity.slots)
      throw new ApiError(429, 'This server is busy; try again shortly', {
        headers: { 'retry-after': String(this.capacity.retryAfterSeconds) },
      });
    let freed = false;
    const slot: InteractiveSlot = {
      signal: this.stopping.signal,
      release: () => {
        if (freed) return;
        freed = true;
        this.held.delete(slot);
        if (!this.held.size) for (const resolve of this.idle) resolve();
      },
    };
    this.held.add(slot);
    return slot;
  }
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const slot = this.acquire();
    try {
      return await work(slot.signal);
    } finally {
      slot.release();
    }
  }
  async drain(graceMs = this.capacity.shutdownGraceMs): Promise<boolean> {
    this.stopping.abort(new DOMException('The server is shutting down', 'AbortError'));
    if (!this.held.size) return true;
    let timer: NodeJS.Timeout | undefined;
    let done!: () => void;
    const settled = new Promise<boolean>((resolve) => {
      done = () => resolve(true);
      this.idle.add(done);
      timer = setTimeout(() => resolve(false), graceMs);
    });
    try {
      return await settled;
    } finally {
      clearTimeout(timer);
      this.idle.delete(done);
    }
  }
}

export const interactiveSlots = new InteractiveSlots();
