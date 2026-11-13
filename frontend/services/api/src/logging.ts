/**
 * Structured JSON logging keyed by request id.
 *
 * Records carry `event`, `logger`, `level`, Cloud Logging's `severity`,
 * `correlation_id` and `timestamp` so one log query covers every record. The correlation id travels in
 * AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Level = 'debug' | 'info' | 'warning' | 'error';

/** Cloud Logging reads `severity` from a JSON line; log-based alerts filter on it. */
const SEVERITY = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARNING',
  error: 'ERROR',
} as const satisfies Record<Level, string>;

type Fields = Record<string, unknown>;
export type LogSink = (line: string) => void;

const correlation = new AsyncLocalStorage<string>();

let sink: LogSink = (line) => process.stdout.write(`${line}\n`);

/** Replace the output sink (tests capture records through this). */
export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

export function withCorrelationId<T>(correlationId: string, run: () => T): T {
  return correlation.run(correlationId, run);
}

function errorFields(error: unknown): Fields {
  if (!(error instanceof Error)) return { exception: String(error) };
  return { exception: `${error.name}: ${error.message}`, stack: error.stack };
}

/**
 * The class and code of a failure, for structured records that must not carry
 * its message (provider messages can echo request or response bodies). A
 * failure without a string `code` has none (null).
 */
export function failureFacts(error: unknown): { error_class: string; error_code: string | null } {
  if (!(error instanceof Error)) return { error_class: typeof error, error_code: null };
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  return { error_class: error.constructor.name, error_code: code };
}

export type Logger = {
  [level in Level]: (event: string, fields?: Fields) => void;
} & { exception: (event: string, error: unknown, fields?: Fields) => void };

export function getLogger(name: string): Logger {
  const write = (level: Level, event: string, fields: Fields = {}) => {
    const correlationId = correlation.getStore();
    sink(
      JSON.stringify({
        ...fields,
        event,
        logger: name,
        level,
        severity: SEVERITY[level],
        ...(correlationId ? { correlation_id: correlationId } : {}),
        timestamp: new Date().toISOString(),
      }),
    );
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warning: (event, fields) => write('warning', event, fields),
    error: (event, fields) => write('error', event, fields),
    exception: (event, error, fields) =>
      write('error', event, { ...fields, ...errorFields(error) }),
  };
}
