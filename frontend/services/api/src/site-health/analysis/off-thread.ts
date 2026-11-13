/**
 * CPU-bound parsing of fetched documents stays off the event loop, on a small
 * persistent pool: page interpretation, sitemap XML and the logo refresh's
 * homepage HTML. Spawning a thread (and loading the analyzer) per page cost
 * more than many analyses on a one-vCPU runner. Each job has a time limit: a
 * thread that overruns it is replaced, so one pathological document never
 * stalls the jobs queued behind it.
 */
import { Worker } from 'node:worker_threads';
import { policy } from '../../config.ts';
import { resolveSettingSpec } from '../../config/settings.ts';
import {
  SitemapParseError,
  type parseSitemap,
  type SitemapLimits,
} from '../../web-evidence/sitemaps.ts';
import type { analyzePage, PageContext } from './analyze-page.ts';
import type { Delivery, factSettings, PageFacts } from './facts.ts';
import type { Facts } from './read-facts.ts';
import type { discoveryLinks } from '../discovery-links.ts';
import type { Scope } from '../url-admission.ts';

export type Interpretation =
  | {
      kind: 'extract';
      body: Uint8Array;
      delivery: Delivery;
      settings: ReturnType<typeof factSettings>;
    }
  | { kind: 'analyze'; facts: Facts; context: PageContext }
  | {
      kind: 'discover';
      body: Uint8Array;
      delivery: Delivery;
      settings: ReturnType<typeof factSettings>;
      scope: Scope;
    }
  | { kind: 'sitemap'; body: Uint8Array; contentType: string; limits: SitemapLimits }
  | { kind: 'page_icons'; body: Uint8Array; url: string };

/** A sitemap job's reply: an invalid document is an answer, not a thread failure. */
export type SitemapParse =
  | { kind: 'parsed'; document: ReturnType<typeof parseSitemap> }
  | { kind: 'invalid'; reason: string };

type Pending = {
  input: Interpretation;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
/** A thread runs its jobs in arrival order, so the first pending job is the running one. */
type Slot = {
  worker: Worker;
  pending: Map<number, Pending>;
  /** The running job the timer limits. */
  running?: number;
  timer?: NodeJS.Timeout;
};
type Reply = { id: number; result?: unknown; error?: string };

const slots: Slot[] = [];
let nextId = 0;

const settings = policy.site_health.settings;
const poolSize = () =>
  Math.max(1, Number(resolveSettingSpec(settings.interpretation_worker_threads, process.env)));
const jobTimeoutMs = () =>
  Number(resolveSettingSpec(settings.interpretation_job_timeout_seconds, process.env)) * 1000;

export class InterpretationTimeoutError extends Error {
  constructor() {
    super('Page interpretation exceeded its time limit');
    this.name = 'InterpretationTimeoutError';
  }
}

/**
 * Idle threads never keep a draining job process alive, and the running job's
 * time limit starts when it reaches the head of its thread.
 */
function settle(slot: Slot) {
  if (slot.pending.size) slot.worker.ref();
  else slot.worker.unref();
  const running = slot.pending.keys().next().value;
  if (running === slot.running) return;
  clearTimeout(slot.timer);
  slot.running = running;
  slot.timer =
    running === undefined ? undefined : setTimeout(() => expire(slot, running), jobTimeoutMs());
}

/**
 * Retire a thread: fail the job it was running (the head of its queue) with
 * `error` and move the jobs queued behind it to another thread. A thread is
 * retired once; its later `error` or `exit` changes nothing.
 */
function retire(slot: Slot, error: Error) {
  const index = slots.indexOf(slot);
  if (index < 0) return;
  slots.splice(index, 1);
  const [running, ...queued] = slot.pending.values();
  slot.pending.clear();
  clearTimeout(slot.timer);
  slot.running = undefined;
  slot.timer = undefined;
  running?.reject(error);
  for (const waiting of queued) post(waiting);
}

/** The running job overran: fail it, retire its thread and move the queued jobs to another. */
function expire(slot: Slot, id: number) {
  if (slot.running !== id || !slot.pending.has(id)) return;
  retire(slot, new InterpretationTimeoutError());
  void slot.worker.terminate();
}

function start(): Slot {
  const worker = new Worker(new URL('./interpret-worker.ts', import.meta.url), {
    // Do not inherit a test runner's preload/loader into the native TS worker.
    execArgv: [],
  });
  const slot: Slot = { worker, pending: new Map() };
  worker.on('message', ({ id, result, error }: Reply) => {
    const job = slot.pending.get(id);
    if (!job) return;
    slot.pending.delete(id);
    settle(slot);
    if (error === undefined) job.resolve(result);
    else job.reject(new Error(error));
  });
  // A crashed thread fails only the job it was running; its queue moves to a replacement.
  worker.on('error', (error: unknown) =>
    retire(slot, error instanceof Error ? error : new Error(String(error))),
  );
  worker.on('exit', (code) => retire(slot, new Error(`Page interpretation exited (${code})`)));
  slots.push(slot);
  return slot;
}

/** The least-busy thread, starting one while the pool is below its size. */
function slot(): Slot {
  const idle = slots.find((candidate) => candidate.pending.size === 0);
  if (idle) return idle;
  const [first, ...rest] = slots;
  if (!first || slots.length < poolSize()) return start();
  return rest.reduce(
    (best, candidate) => (candidate.pending.size < best.pending.size ? candidate : best),
    first,
  );
}

function post(job: Pending) {
  const target = slot();
  const id = nextId++;
  target.pending.set(id, job);
  settle(target);
  target.worker.postMessage({ id, input: job.input });
}

function interpret<T>(input: Interpretation): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    post({ input, resolve: resolve as (value: unknown) => void, reject });
  });
}

export const extractFactsAsync = (
  body: Uint8Array,
  delivery: Delivery,
  settings: ReturnType<typeof factSettings>,
) => interpret<Facts>({ kind: 'extract', body, delivery, settings });

export const analyzePageAsync = (facts: Facts, context: PageContext) =>
  interpret<ReturnType<typeof analyzePage>>({ kind: 'analyze', facts, context });

/** A discovered page's links and facts from one parse of the whole document. */
export const discoverAsync = (
  body: Uint8Array,
  delivery: Delivery,
  settings: ReturnType<typeof factSettings>,
  scope: Scope,
) =>
  interpret<{ discovery: ReturnType<typeof discoveryLinks>; facts: PageFacts }>({
    kind: 'discover',
    body,
    delivery,
    settings,
    scope,
  });

/** `parseSitemap` off the event loop; a document that does not parse throws `SitemapParseError`. */
export async function parseSitemapAsync(body: Buffer, contentType: string, limits: SitemapLimits) {
  const reply = await interpret<SitemapParse>({ kind: 'sitemap', body, contentType, limits });
  if (reply.kind === 'invalid') throw new SitemapParseError(reply.reason);
  return reply.document;
}

/** The icon links a fetched homepage declares, parsed off the event loop. */
export const pageIconsAsync = (body: Buffer, url: string) =>
  interpret<string[]>({ kind: 'page_icons', body, url });
