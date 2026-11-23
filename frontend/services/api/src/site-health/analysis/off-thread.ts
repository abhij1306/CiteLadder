import { Worker } from 'node:worker_threads';
import { policy } from '../../config.ts';
import { resolveSettingSpec } from '../../config/settings.ts';
import {
  SitemapParseError,
  SitemapTooLargeError,
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

export type SitemapParse =
  | { kind: 'parsed'; document: ReturnType<typeof parseSitemap> }
  | { kind: 'invalid'; reason: string }
  | { kind: 'too_large'; reason: string };

type Pending = {
  input: Interpretation;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
type Slot = {
  worker: Worker;
  pending: Map<number, Pending>;
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

function expire(slot: Slot, id: number) {
  if (slot.running !== id || !slot.pending.has(id)) return;
  retire(slot, new InterpretationTimeoutError());
  void slot.worker.terminate();
}

function start(): Slot {
  const worker = new Worker(new URL('./interpret-worker.ts', import.meta.url), {
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
  worker.on('error', (error: unknown) =>
    retire(slot, error instanceof Error ? error : new Error(String(error))),
  );
  worker.on('exit', (code) => retire(slot, new Error(`Page interpretation exited (${code})`)));
  slots.push(slot);
  return slot;
}

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

export async function parseSitemapAsync(body: Buffer, contentType: string, limits: SitemapLimits) {
  const reply = await interpret<SitemapParse>({ kind: 'sitemap', body, contentType, limits });
  switch (reply.kind) {
    case 'parsed':
      return reply.document;
    case 'invalid':
      throw new SitemapParseError(reply.reason);
    case 'too_large':
      throw new SitemapTooLargeError(reply.reason);
    default:
      return reply satisfies never;
  }
}

export const pageIconsAsync = (body: Buffer, url: string) =>
  interpret<string[]>({ kind: 'page_icons', body, url });
