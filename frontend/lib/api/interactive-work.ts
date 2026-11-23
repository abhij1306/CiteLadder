import { INTERACTIVE_EXECUTION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';

export function startInteractiveWork(
  path: string,
  options?: ApiRequestOptions,
  body: unknown = {},
) {
  const execution = {
    ...options,
    timeoutMs: options?.timeoutMs ?? INTERACTIVE_EXECUTION_REQUEST_TIMEOUT_MS,
  };
  void apiClient.post(path, body, execution).catch(() => undefined);
}
