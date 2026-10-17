import { INTERACTIVE_EXECUTION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';

/** Call only after durable admission. Polling reads remain independent of execution. */
export function startInteractiveWork(
  path: string,
  options?: ApiRequestOptions,
  body: unknown = {},
) {
  const execution = {
    ...options,
    timeoutMs: options?.timeoutMs ?? INTERACTIVE_EXECUTION_REQUEST_TIMEOUT_MS,
  };
  // A lost browser request never turns a committed creation into a failed mutation.
  // The runner and periodic recovery retain ownership of unfinished work.
  void apiClient.post(path, body, execution).catch(() => undefined);
}
