/** Public website transport. Each hop validates all DNS answers and dials one pinned IP. */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import ipaddr from 'ipaddr.js';
import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import { isNonEmpty } from '../lists.ts';

export class FetchError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export type FetchOptions = {
  maxBytes: number;
  timeoutSeconds: number;
  redirects: number;
  /** Media types a 2xx may carry; `*` accepts any. */
  contentTypes: readonly string[];
  domain?: string;
  signal?: AbortSignal;
  maxDecodedBytes?: number;
  gate?: <T>(url: URL, send: () => Promise<T>, signal: AbortSignal) => Promise<T>;
  authorize?: (url: URL) => Promise<void>;
  /** Response headers kept on the result; defaults to the evidence allowlist. */
  headerNames?: readonly string[];
  /** Observes every network call, including failed ones, in call order. */
  onCall?: (call: FetchCall) => void;
};
/** One real network call made while serving a fetch; redirects make several. */
export type FetchCall = {
  url: string;
  status: number | null;
  error: unknown;
  wireBytes: number | null;
  decodedBytes: number | null;
  ttfbMs: number | null;
  latencyMs: number;
};
export type FetchedPage = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  charset?: string;
  headers?: Record<string, string>;
  redirects?: string[];
  /** Each followed redirect with the status that issued it. */
  redirectChain?: { from: string; to: string; status: number }[];
  httpVersion?: string;
  wireBytes?: number;
  ttfbMs?: number;
};
type TransportResult = {
  status: number;
  location: string | undefined;
  type: string;
  body: Buffer;
  charset?: string;
  headers?: Record<string, string>;
  httpVersion?: string;
  wireBytes?: number;
  ttfbMs?: number;
};
const EVIDENCE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'x-robots-tag',
  'link',
  'last-modified',
  'strict-transport-security',
];
export type WebsiteFetcher = (url: string, options: FetchOptions) => Promise<FetchedPage>;
type Dns = (host: string) => Promise<readonly { address: string; family: number }[]>;

export function publicUrl(value: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new FetchError('invalid_url');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const hostname = url.hostname.replace(/\.$/u, '');
  const bounds = policy.audits.url_identity;
  if (
    !policy.web_fetch.schemes.includes(url.protocol.slice(0, -1)) ||
    !policy.web_fetch.ports.includes(port) ||
    url.username ||
    url.password ||
    !url.hostname ||
    hostname.length > bounds.max_dns_hostname_chars ||
    hostname
      .split('.')
      .some((label) => !label.length || label.length > bounds.max_dns_label_chars) ||
    url.href.length > 1024
  )
    throw new FetchError('invalid_url');
  url.hash = '';
  return url;
}
export function websiteIdentity(value: string) {
  const url = publicUrl(value.includes('://') ? value.trim() : `https://${value.trim()}`);
  const domain = getDomain(url.hostname);
  if (!domain || isIP(url.hostname.replaceAll(/[[\]]/gu, ''))) throw new FetchError('invalid_url');
  return { url: url.href, domain };
}

// IANA special-purpose IPv4 blocks that ipaddr labels ordinary unicast.
// These fixed CIDRs deny outbound targets; they are not server addresses to connect to.
const SPECIAL_PURPOSE_IPV4 = [
  '192.0.0.0/24', // NOSONAR: a denied SSRF target, not a connection address.
  '192.0.2.0/24',
  '198.51.100.0/24',
  '203.0.113.0/24',
];

export function validateAddress(address: string): void {
  if (!ipaddr.isValid(address)) throw new FetchError('ssrf_blocked');
  const ip = ipaddr.process(address);
  if (ip.range() !== 'unicast') throw new FetchError('ssrf_blocked');
  if (
    ip.kind() === 'ipv4' &&
    SPECIAL_PURPOSE_IPV4.some((range) => ip.match(ipaddr.parseCIDR(range) as [ipaddr.IPv4, number]))
  )
    throw new FetchError('ssrf_blocked');
}

export function decodedBody(body: Buffer, encoding: string, maxBytes: number): Buffer {
  let decoded: Buffer;
  try {
    const options = { maxOutputLength: maxBytes };
    switch (encoding.trim().toLowerCase()) {
      case '':
      case 'identity':
        decoded = body;
        break;
      case 'gzip':
        decoded = gunzipSync(body, options);
        break;
      case 'deflate':
        decoded = inflateSync(body, options);
        break;
      case 'br':
        decoded = brotliDecompressSync(body, options);
        break;
      default:
        throw new FetchError('content_encoding');
    }
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError('response_too_large');
  }
  if (decoded.length > maxBytes) throw new FetchError('response_too_large');
  return decoded;
}

export async function pinnedRequest(
  url: URL,
  target: { address: string; family: number },
  options: FetchOptions,
  signal: AbortSignal,
) {
  const started = performance.now();
  return new Promise<TransportResult>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        agent: false,
        // Exactly one validated address is selected above; no family race.
        family: target.family,
        signal,
        headers: {
          'user-agent': policy.web_fetch.user_agent,
          accept: options.contentTypes.includes('*') ? '*/*' : options.contentTypes.join(', '),
          'accept-encoding': 'gzip, deflate, br',
        },
        // Keep the URL hostname for Host, TLS SNI and certificate verification.
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      },
      (response) => {
        response.on('error', reject);
        const ttfbMs = Math.round(performance.now() - started);
        const status = response.statusCode ?? 0;
        const type = String(response.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase();
        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy();
          resolve({
            status,
            location: response.headers.location,
            type,
            body: Buffer.alloc(0),
            httpVersion: response.httpVersion,
            ttfbMs,
          });
          return;
        }
        const acceptable =
          options.contentTypes.includes(type) || options.contentTypes.includes('*');
        if (status >= 200 && status < 300 && !acceptable) {
          response.destroy(new FetchError('content_type'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > options.maxBytes) {
            response.destroy(new FetchError('response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            resolve({
              status,
              location: undefined,
              type,
              httpVersion: response.httpVersion,
              wireBytes: bytes,
              ttfbMs,
              body: decodedBody(
                Buffer.concat(chunks),
                String(response.headers['content-encoding'] ?? ''),
                options.maxDecodedBytes ?? options.maxBytes,
              ),
              charset:
                /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(
                  String(response.headers['content-type'] ?? ''),
                )?.[1] ?? '',
              headers: Object.fromEntries(
                (options.headerNames ?? EVIDENCE_HEADERS).flatMap((key) =>
                  typeof response.headers[key] === 'string' ? [[key, response.headers[key]]] : [],
                ),
              ),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

export function createWebsiteFetcher(
  dns: Dns = (host) => lookup(host, { all: true }),
  send = pinnedRequest,
): WebsiteFetcher {
  return async (value, options) => {
    const timeout = options.gate
      ? new AbortController().signal
      : AbortSignal.timeout(options.timeoutSeconds * 1000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let url = publicUrl(value);
    const redirects: string[] = [];
    const redirectChain: { from: string; to: string; status: number }[] = [];
    for (let hop = 0; hop <= options.redirects; hop++) {
      signal.throwIfAborted();
      if (options.domain && getDomain(url.hostname) !== options.domain)
        throw new FetchError('out_of_scope');
      const sendHop = async () => {
        const hopSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(options.timeoutSeconds * 1000),
        ]);
        await options.authorize?.(url);
        hopSignal.throwIfAborted();
        const host = url.hostname.replaceAll(/[[\]]/gu, '');
        const addresses = isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : await abortable(dns(host), hopSignal);
        if (!isNonEmpty(addresses)) throw new FetchError('dns_resolution_failed');
        for (const target of addresses) validateAddress(target.address);
        const started = performance.now();
        try {
          const response = await send(url, addresses[0], options, hopSignal);
          options.onCall?.({
            url: url.href,
            status: response.status,
            error: null,
            wireBytes: response.wireBytes ?? null,
            decodedBytes: response.location ? null : response.body.length,
            ttfbMs: response.ttfbMs ?? null,
            latencyMs: Math.round(performance.now() - started),
          });
          return response;
        } catch (error) {
          options.onCall?.({
            url: url.href,
            status: null,
            error,
            wireBytes: null,
            decodedBytes: null,
            ttfbMs: null,
            latencyMs: Math.round(performance.now() - started),
          });
          throw error;
        }
      };
      const result = options.gate ? await options.gate(url, sendHop, signal) : await sendHop();
      if (!result.location)
        return {
          url: url.href,
          status: result.status,
          contentType: result.type,
          body: result.body,
          charset: result.charset,
          headers: result.headers,
          redirects,
          redirectChain,
          httpVersion: result.httpVersion,
          wireBytes: result.wireBytes,
          ttfbMs: result.ttfbMs,
        };
      const from = url.href;
      url = publicUrl(result.location, url.href);
      redirects.push(url.href);
      redirectChain.push({ from, to: url.href, status: result.status });
    }
    throw new FetchError('redirect_limit');
  };
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
export const fetchWebsite = createWebsiteFetcher();
