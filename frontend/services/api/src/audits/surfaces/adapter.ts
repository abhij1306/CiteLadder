/**
 * One adapter per route `surface_kind`. The audit worker owns the lease, heartbeat,
 * capacity and deadlines; an adapter owns what differs by surface: the frozen request,
 * the dispatch phase, the recovery deadline, the capacity pool and persistence.
 */
import type { Database } from '../../db/database.ts';
import type { executeAnswer } from '../../answer-engines/execute.ts';
import type { CapacityRequest } from '../../providers/capacity.ts';
import type { ProviderError } from '../../providers/errors.ts';
import type { AuditTask } from '../../queue/audit-queue.ts';
import type { AuditRuntime } from '../config.ts';
import type { ExecutionContext } from '../execution-context.ts';
import type { DeriveExecution, ExecutionResult } from '../result-persistence.ts';

/** The derivation owners a successful exchange commits with, and the run's finalizer. */
export type ProjectionOwners = {
  execution: DeriveExecution;
  prepare?: (context: ExecutionContext, result: ExecutionResult) => Promise<DeriveExecution>;
  finalize: (workspaceId: string, auditId: string) => Promise<unknown>;
};

/** What one leased phase may use: the lease owner, the clock and injected provider I/O. */
export type PhaseDeps = {
  db: Database;
  owner: string;
  runtime: AuditRuntime;
  now: () => Date;
  send: typeof fetch;
  executeAnswer: typeof executeAnswer;
  /** The derivation a successful result commits with (shelf preparation may replace the default). */
  derivation: (context: ExecutionContext, result: ExecutionResult) => Promise<DeriveExecution>;
};

/**
 * Written by the adapter during dispatch: whether a provider call started, and the
 * error the capacity release must hear about (a rate limit backs the pool off).
 */
export type DispatchState = { started: boolean; rateError?: ProviderError };

/** Why the worker ends a task outside the adapter's own dispatch. */
export type TaskFailure =
  /** The execution context could not be loaded (connection, account, funding, access). */
  | { kind: 'context_unavailable'; error: ProviderError }
  /** The audit's run cap passed before any paid submission. */
  | { kind: 'run_deadline' }
  /** A paid submission's recovery deadline passed. */
  | { kind: 'recovery_deadline' }
  /** An unexpected error escaped the phase. */
  | { kind: 'internal'; error: unknown; dispatched: boolean };

export type SurfaceAdapter = {
  /** The capacity pool this task's next phase draws from. */
  capacity: (task: AuditTask, context: ExecutionContext) => CapacityRequest;
  /** When a paid submission is written off; null when no recovery deadline applies. */
  recoveryDeadline: (task: AuditTask) => Date | null;
  /** One leased phase under acquired capacity; ownership was rechecked just before. */
  dispatch: (
    deps: PhaseDeps,
    context: ExecutionContext,
    state: DispatchState,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Terminalizes or parks the task for a failure the worker detected. */
  fail: (
    deps: PhaseDeps,
    task: AuditTask,
    context: ExecutionContext | null,
    failure: TaskFailure,
  ) => Promise<unknown>;
};
