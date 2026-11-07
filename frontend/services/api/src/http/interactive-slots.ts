/**
 * The in-request work this API instance runs at a time: interactive audits
 * and Agent turns share `interactiveCapacity.slots`. A full or stopping
 * instance refuses with 429 and `Retry-After`; the refused work is already
 * durable, so the browser retries or the runner takes it. On shutdown every
 * held slot's signal aborts, so open work stops and settles before exit.
 */
import { interactiveCapacity } from '../config/execution.ts';
import { ApiError } from '../errors.ts';

type Capacity = typeof interactiveCapacity;
export type InteractiveSlot = {
  /** Aborts when the instance shuts down: the work stops as interrupted. */
  readonly signal: AbortSignal;
  /** Frees the slot; later calls do nothing. */
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
  /** Admit one piece of in-request work or refuse it with 429 before it starts. */
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
  /** Runs `work` in a slot, released however it ends. */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const slot = this.acquire();
    try {
      return await work(slot.signal);
    } finally {
      slot.release();
    }
  }
  /**
   * Stops admitting, aborts every held slot and waits until they are all
   * released or `graceMs` passes. Resolves true when every slot settled.
   */
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

/** This process's slots: one per API instance. */
export const interactiveSlots = new InteractiveSlots();
