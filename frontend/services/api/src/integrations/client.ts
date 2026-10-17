import { z } from 'zod';

import {
  codes,
  endpoints,
  integrationPolicy,
  integrationSecrets,
  integrationSettings,
} from './config.ts';
import type { Dataset, IntegrationProvider, IntegrationTransport } from './config.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('api.integrations.client');

export class IntegrationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfter: number | null;
  /** The provider's HTTP status, when the error is a provider response. */
  readonly httpStatus: number | null;

  constructor(
    code: string,
    message: string,
    retryable = false,
    retryAfter: number | null = null,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.httpStatus = httpStatus;
  }
}

const object = z.record(z.string(), z.unknown());
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).optional(),
});
export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number | null;
  scopes: string[];
};
export type ProviderProperty = { property_ref: string; label: string };
export type ImportPage = { payload: Record<string, unknown>; rawRowCount: number };
export type IntegrationIO = { fetch: typeof fetch; sleep: (milliseconds: number) => Promise<void> };
function providerValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new IntegrationError(codes.ERROR_PROVIDER_API, 'Malformed integration provider response');
  return parsed.data;
}
const defaultIO: IntegrationIO = {
  fetch: (...args) => fetch(...args),
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(() => resolve(), milliseconds);
    }),
};

/** Fixed provider HTTPS hosts only; redirects never carry credentials elsewhere. */
function approvedIntegrationUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !endpoints.INTEGRATION_APPROVED_ENDPOINT_HOSTS.includes(url.hostname)
  ) {
    throw new IntegrationError(codes.ERROR_UNAPPROVED_ENDPOINT, 'Unapproved integration endpoint');
  }
  return url;
}

function statusError(status: number, retryAfter: string | null): IntegrationError {
  const seconds = !retryAfter?.trim() ? Number.NaN : Number(retryAfter);
  let code = codes.ERROR_PROVIDER_API;
  if (status === 429) code = codes.ERROR_RATE_LIMITED;
  // A 401 is the credential; a 403 is this property's permission, which must
  // not demote a grant that still serves the workspace's other properties.
  else if (status === 401) code = codes.ERROR_GRANT_AUTH_FAILED;
  else if (status === 403) code = codes.ERROR_PROPERTY_NOT_ACCESSIBLE;
  return new IntegrationError(
    code,
    `Integration provider returned HTTP ${status}`,
    status === 429 || [500, 502, 503, 504].includes(status),
    Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
    status,
  );
}

export function providerNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw.trim()))
    return null;
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

export class IntegrationClient {
  readonly settings;
  readonly secrets;
  readonly io;
  readonly #lastRequest = new Map<string, number>();

  constructor(
    env: Record<string, string | undefined> = process.env,
    io: IntegrationIO = defaultIO,
  ) {
    this.settings = integrationSettings(env);
    this.secrets = integrationSecrets(env);
    this.io = io;
  }

  async #request(
    url: string | URL,
    init: RequestInit,
    pace?: IntegrationProvider,
  ): Promise<Response> {
    const approved = approvedIntegrationUrl(String(url));
    if (pace) {
      const interval = 60_000 / this.settings[`${pace}_requests_per_minute`];
      const delay = (this.#lastRequest.get(pace) ?? -Infinity) + interval - Date.now();
      if (delay > 0) await this.io.sleep(delay);
      this.#lastRequest.set(pace, Date.now());
    }
    try {
      const response = await this.io.fetch(approved, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.settings.sync_request_timeout_seconds * 1000),
      });
      if (response.status !== 200)
        logger.warning('integration_provider_status', {
          host: approved.hostname,
          path: approved.pathname,
          status: response.status,
        });
      return response;
    } catch (error) {
      // Never surface provider bodies, URLs, headers or request exceptions
      // containing credentials; the error's class alone tells a timeout from
      // a refused redirect or a network failure.
      logger.warning('integration_provider_request_failed', {
        host: approved.hostname,
        path: approved.pathname,
        error_name: error instanceof Error ? error.name : typeof error,
      });
      throw new IntegrationError(
        codes.ERROR_PROVIDER_API,
        'Integration provider request failed',
        true,
      );
    }
  }

  async #json(response: Response): Promise<Record<string, unknown>> {
    if (response.status !== 200)
      throw statusError(response.status, response.headers.get('retry-after'));
    try {
      return object.parse(await response.json());
    } catch {
      logger.warning('integration_provider_malformed', {
        content_type: response.headers.get('content-type') ?? '',
      });
      throw new IntegrationError(
        codes.ERROR_PROVIDER_API,
        'Malformed integration provider response',
      );
    }
  }

  async token(transport: IntegrationTransport, form: Record<string, string>): Promise<TokenBundle> {
    const credential = this.secrets.credentials[transport];
    if (!credential.id || !credential.secret) {
      throw new IntegrationError(
        codes.ERROR_OAUTH_NOT_CONFIGURED,
        'Integration OAuth is not configured',
      );
    }
    const response = await this.#request(endpoints.INTEGRATION_OAUTH_TOKEN_URLS[transport], {
      method: 'POST',
      body: new URLSearchParams({
        ...form,
        client_id: credential.id,
        client_secret: credential.secret,
      }),
    });
    const parsed = tokenSchema.safeParse(await this.#json(response));
    if (!parsed.success)
      throw new IntegrationError(codes.ERROR_PROVIDER_API, 'Malformed OAuth token response');
    const expiry = providerNumber(parsed.data.expires_in);
    const scopes = parsed.data.scope?.trim().split(/\s+/u).filter(Boolean) ?? [];
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token || form.refresh_token || '',
      expiresIn: expiry !== null && expiry >= 0 ? Math.trunc(expiry) : null,
      scopes:
        scopes.length || form.grant_type === 'refresh_token'
          ? scopes
          : endpoints.INTEGRATION_OAUTH_SCOPES[transport],
    };
  }

  async revoke(transport: IntegrationTransport, token: string): Promise<void> {
    const url = endpoints.INTEGRATION_OAUTH_REVOKE_URLS[transport];
    if (!url) return;
    const response = await this.#request(url, {
      method: 'POST',
      body: new URLSearchParams({ token }),
    });
    if (response.status !== 200)
      throw statusError(response.status, response.headers.get('retry-after'));
  }

  properties(provider: IntegrationProvider, token: string): Promise<ProviderProperty[]> {
    const headers = { authorization: `Bearer ${token}` };
    if (provider === 'gsc') return this.#gscProperties(headers);
    if (provider === 'bing') return this.#bingProperties(headers);
    return this.#ga4Properties(headers);
  }

  async #gscProperties(headers: Record<string, string>): Promise<ProviderProperty[]> {
    const payload = await this.#json(
      await this.#request(
        endpoints.GSC_API_BASE_URL + endpoints.GSC_SITES_PATH,
        { headers },
        'gsc',
      ),
    );
    return providerValue(z.array(object), payload.siteEntry ?? []).flatMap((entry) =>
      typeof entry.siteUrl === 'string' &&
      entry.siteUrl.trim() &&
      entry.permissionLevel !== endpoints.GSC_PERMISSION_UNVERIFIED
        ? [{ property_ref: entry.siteUrl, label: entry.siteUrl }]
        : [],
    );
  }

  async #bingProperties(headers: Record<string, string>): Promise<ProviderProperty[]> {
    const payload = await this.#json(
      await this.#request(
        endpoints.BING_API_BASE_URL +
          endpoints.BING_API_JSON_ROOT +
          endpoints.BING_SITES_PROBE_METHOD,
        { headers },
        'bing',
      ),
    );
    return providerValue(z.array(object), payload.d ?? []).flatMap((entry) =>
      typeof entry.Url === 'string' && entry.Url.trim() && entry.IsVerified !== false
        ? [{ property_ref: entry.Url, label: entry.Url }]
        : [],
    );
  }

  async #ga4Properties(headers: Record<string, string>): Promise<ProviderProperty[]> {
    const properties = new Map<string, ProviderProperty>();
    let pageToken = '';
    const seen = new Set<string>();
    // Each discovery request depends on the preceding provider page token.
    for (let page = 0; page < endpoints.GA4_ACCOUNT_SUMMARIES_MAX_PAGES; page++) {
      const url = new URL(endpoints.GA4_ADMIN_API_BASE_URL + endpoints.GA4_ACCOUNT_SUMMARIES_PATH);
      url.searchParams.set('pageSize', String(endpoints.GA4_ACCOUNT_SUMMARIES_PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await this.#json(await this.#request(url, { headers }, 'ga4'));
      collectGa4Properties(payload, properties);
      pageToken = providerValue(z.string(), payload.nextPageToken ?? '');
      if (!pageToken) return [...properties.values()];
      if (seen.has(pageToken)) break;
      seen.add(pageToken);
    }
    throw new IntegrationError(
      codes.ERROR_PROVIDER_API,
      'GA4 property discovery exceeded its page bound',
    );
  }

  async page(
    provider: IntegrationProvider,
    token: string,
    property: string,
    template: Dataset,
    start: string,
    end: string,
    offset: number,
  ): Promise<ImportPage> {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const size = this.settings.sync_page_size;
    if (provider === 'gsc') {
      const url =
        endpoints.GSC_API_BASE_URL +
        endpoints.GSC_SEARCH_ANALYTICS_PATH.replace('{property_ref}', encodeURIComponent(property));
      const payload = await this.#json(
        await this.#request(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              startDate: start,
              endDate: end,
              dimensions: template.dimensions,
              rowLimit: size,
              startRow: offset,
            }),
          },
          provider,
        ),
      );
      const rows = providerValue(z.array(z.unknown()), payload.rows ?? []);
      return { payload, rawRowCount: rows.length };
    }
    if (provider === 'ga4') {
      const url =
        endpoints.GA4_API_BASE_URL +
        endpoints.GA4_RUN_REPORT_PATH.replace(
          '{property_ref}',
          encodeURIComponent(property.replace(/^properties\//u, '')),
        );
      const response = await this.#request(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            dateRanges: [{ startDate: start, endDate: end }],
            dimensions: template.dimensions.map((name) => ({ name })),
            metrics: template.metrics.map((name) => ({ name })),
            limit: size,
            offset,
          }),
        },
        provider,
      );
      if (response.status === 400 && template.dataset === 'ga4_item_source_medium_daily') {
        const payload: unknown = await response
          .clone()
          .json()
          .catch(() => null);
        const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
        if (
          parsed.success &&
          integrationPolicy.ga4_incompatible_markers.some((marker) =>
            parsed.data.error.message.toLowerCase().includes(marker),
          )
        ) {
          throw new IntegrationError(
            codes.ERROR_GA4_DIMENSION_INCOMPATIBLE,
            'GA4 item attribution dimensions are incompatible',
          );
        }
      }
      const payload = await this.#json(response);
      const raw = providerValue(z.array(z.unknown()), payload.rows ?? []);
      return { payload, rawRowCount: raw.length };
    }
    if (offset > 0) return { payload: { rows: [] }, rawRowCount: 0 };
    const url = new URL(
      endpoints.BING_API_BASE_URL + endpoints.BING_API_JSON_ROOT + template.api_method,
    );
    url.searchParams.set('siteUrl', property);
    const payload = await this.#json(await this.#request(url, { headers }, provider));
    const raw = providerValue(z.array(z.unknown()), payload.d ?? []);
    return {
      payload: { ...payload, rows: raw.flatMap((row) => normalizeBing(row, template)) },
      rawRowCount: raw.length,
    };
  }
}

function collectGa4Properties(
  payload: Record<string, unknown>,
  properties: Map<string, ProviderProperty>,
): void {
  for (const account of providerValue(z.array(object), payload.accountSummaries ?? [])) {
    for (const property of providerValue(z.array(object), account.propertySummaries ?? [])) {
      const ref =
        typeof property.property === 'string'
          ? property.property.replace(/^properties\//u, '')
          : '';
      if (!/^\d+$/u.test(ref)) continue;
      const labels = [account.displayName, property.displayName].filter(
        (value): value is string => typeof value === 'string' && !!value,
      );
      properties.set(ref, { property_ref: ref, label: labels.join(' / ') || ref });
    }
  }
}

function normalizeBing(raw: unknown, template: Dataset): Record<string, unknown>[] {
  const parsed = object.safeParse(raw);
  if (
    !parsed.success ||
    typeof parsed.data.Query !== 'string' ||
    typeof parsed.data.Date !== 'string'
  )
    return [];
  const match = /^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/u.exec(parsed.data.Date);
  if (!match) return [];
  const date = new Date(Number(match[1]));
  if (!Number.isFinite(date.getTime())) return [];
  const fields = Object.fromEntries(
    Object.entries(parsed.data).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const metrics = template.metrics.map((name) => providerNumber(fields[name]));
  if (metrics.some((value) => value === null || value < 0 || !Number.isInteger(value))) return [];
  return [
    {
      keys: [parsed.data.Query, date.toISOString().slice(0, 10)],
      ...Object.fromEntries(template.metrics.map((name, index) => [name, metrics[index]])),
    },
  ];
}
