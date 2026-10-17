/** Credentialed JSON boundary to approved provider endpoints: no redirects, one pinned address. */
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { providerPolicy } from './config.ts';
import { isNonEmpty } from '../lists.ts';

export class ProbeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Connection test failed: ${code}`);
    this.code = code;
  }
}
export type ProbeRequest = {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutSeconds: number;
  maxBytes: number;
  signal?: AbortSignal;
};
export type ProbeTransport = (input: ProbeRequest) => Promise<{ status: number; body: unknown }>;
function assertProbeUrl(url: URL) {
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password
  )
    throw new ProbeError('invalid_url');
}
function resolveAddresses(host: string, signal: AbortSignal) {
  return new Promise<{ address: string; family: number }[]>((resolve, reject) => {
    const aborted = () => reject(new ProbeError('timeout'));
    signal.addEventListener('abort', aborted, { once: true });
    const result = isIP(host)
      ? Promise.resolve([{ address: host, family: isIP(host) }])
      : lookup(host, { all: true });
    result
      .then(resolve, () => reject(new ProbeError('dns_resolution_failed')))
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}
export const sendProbe: ProbeTransport = async (input) => {
  const url = new URL(input.url);
  assertProbeUrl(url);
  const signal = AbortSignal.any([
    AbortSignal.timeout(input.timeoutSeconds * 1000),
    ...(input.signal ? [input.signal] : []),
  ]);
  if (signal.aborted) throw new ProbeError('timeout');
  const host = url.hostname.replaceAll(/[[\]]/gu, '');
  const addresses = await resolveAddresses(host, signal);
  if (!isNonEmpty(addresses)) throw new ProbeError('dns_resolution_failed');
  const target = addresses[0];
  const body = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
  if (body && body.length > providerPolicy.probe_max_request_bytes)
    throw new ProbeError('request_too_large');
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: body ? 'POST' : 'GET',
        agent: false,
        // One pinned address: without a family, Node races families and asks
        // the lookup for every address, which this single answer cannot satisfy.
        family: target.family,
        signal,
        headers: { ...input.headers, ...(body ? { 'content-type': 'application/json' } : {}) },
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('error', (error) =>
          reject(error instanceof ProbeError ? error : new ProbeError('connection')),
        );
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > input.maxBytes) res.destroy(new ProbeError('response_too_large'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(new ProbeError('parse_error'));
            return;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', () => reject(new ProbeError(signal.aborted ? 'timeout' : 'connection')));
    req.end(body);
  });
};
