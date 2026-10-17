/**
 * The contract between the analytics worker and the executors it dispatches.
 *
 * An executor receives the claimed row and performs its kind's projection
 * over persisted rows or bounded acquisition. The worker owns the queue
 * lifecycle around it: run marking, heartbeats and the terminal write.
 */
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { parseUuid } from '../http/uuid.ts';
import type { QueueTask } from '../queue/task-queue.ts';

type ExecutorContext = {
  db: Database;
  /** Throws `TaskCancelledError` once the row turned terminal (cooperative cancel). */
  checkCancelled: (boundary: string) => Promise<void>;
  /** The attempt budget successor tasks are enqueued with. */
  maxAttempts: number;
};

export type TaskSettlement = {
  error: Error | null;
  /** Appends acquired evidence in the worker's fenced terminal transaction. */
  persist: (db: Database) => Promise<void>;
};
export type Executor = (
  task: QueueTask,
  context: ExecutorContext,
) => Promise<void | TaskSettlement>;

/** The claimed row turned terminal mid-run; the worker writes nothing. */
export class TaskCancelledError extends Error {}

/** A bounded admission/provider outcome that retrying cannot repair. */
export class TerminalExecutorError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

function payloadField(task: QueueTask, name: string): unknown {
  const payload = task.payload;
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload[name]
    : undefined;
}

export function requireProject(task: QueueTask): string {
  if (task.project_id === null) throw new Error(`${task.task_kind} task missing project_id`);
  return task.project_id;
}

export async function taskProject(db: Database, task: QueueTask): Promise<string> {
  const id = requireProject(task);
  const project = await new WorkspaceScope(task.workspace_id)
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!project) throw new Error('Analytics task project is outside its workspace');
  return id;
}

/** The payload's `import_artifact_id`; fails the attempt when absent or malformed. */
export function payloadArtifactId(task: QueueTask): string {
  const raw = payloadField(task, 'import_artifact_id');
  const id = parseUuid(raw);
  if (!raw || id === null) throw new Error(`${task.task_kind} payload missing import_artifact_id`);
  return id;
}

/** The payload's inclusive `window_start`/`window_end` as ISO dates. */
export function payloadWindow(task: QueueTask): { windowStart: string; windowEnd: string } {
  const start = payloadField(task, 'window_start');
  const end = payloadField(task, 'window_end');
  const isDate = (value: unknown): value is string =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  if (!isDate(start) || !isDate(end)) {
    throw new Error(`${task.task_kind} payload missing window_start/window_end`);
  }
  if (end < start) throw new Error(`${task.task_kind} window_end before window_start`);
  return { windowStart: start, windowEnd: end };
}

export function payloadString(task: QueueTask, name: string): string | null {
  const value = payloadField(task, name);
  return typeof value === 'string' && value ? value : null;
}
