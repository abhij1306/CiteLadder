/**
 * Structured JSON logging keyed by request id.
 *
 * Records carry `event`, `logger`, `level`, `correlation_id` and `timestamp`
 * so one log query covers every record. The correlation id travels in
 * AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Level = 'debug' | 'info' | 'warning' | 'error';
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
