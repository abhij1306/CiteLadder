export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: string, retryable = false, retryAfterSeconds?: number) {
    super(`Provider execution failed: ${code}`);
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
