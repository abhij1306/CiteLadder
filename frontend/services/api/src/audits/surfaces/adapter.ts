import type { Database } from '../../db/database.ts';
import type { executeAnswer } from '../../answer-engines/execute.ts';
import type { CapacityRequest } from '../../providers/capacity.ts';
import type { ProviderError } from '../../providers/errors.ts';
import type { AuditTask } from '../../queue/audit-queue.ts';
import type { AuditRuntime } from '../config.ts';
import type { ExecutionContext } from '../execution-context.ts';
import type { DeriveExecution, ExecutionResult } from '../result-persistence.ts';

export type ProjectionOwners = {
  execution: DeriveExecution;
  prepare?: (context: ExecutionContext, result: ExecutionResult) => Promise<DeriveExecution>;
  finalize: (workspaceId: string, auditId: string) => Promise<unknown>;
};

export type PhaseDeps = {
  db: Database;
  owner: string;
  runtime: AuditRuntime;
  now: () => Date;
  send: typeof fetch;
  executeAnswer: typeof executeAnswer;
  derivation: (context: ExecutionContext, result: ExecutionResult) => Promise<DeriveExecution>;
};

export type DispatchState = { started: boolean; rateError?: ProviderError };

export type TaskFailure =
  | { kind: 'context_unavailable'; error: ProviderError }
  | { kind: 'run_deadline' }
  | { kind: 'recovery_deadline' }
  | { kind: 'internal'; error: unknown; dispatched: boolean };

export type SurfaceAdapter = {
  capacity: (task: AuditTask, context: ExecutionContext) => CapacityRequest;
  recoveryDeadline: (task: AuditTask) => Date | null;
  dispatch: (
    deps: PhaseDeps,
    context: ExecutionContext,
    state: DispatchState,
    signal: AbortSignal,
  ) => Promise<void>;
  fail: (
    deps: PhaseDeps,
    task: AuditTask,
    context: ExecutionContext | null,
    failure: TaskFailure,
  ) => Promise<unknown>;
};
