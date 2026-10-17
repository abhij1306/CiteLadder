import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IntegrationClient } from '../src/integrations/client.ts';
import { integrationPolicy } from '../src/integrations/config.ts';

describe('Bing property discovery', () => {
  it('discovers GA4 properties in provider page order and preserves account labels', async () => {
    const requested: string[] = [];
    const client = new IntegrationClient(
      {},
      {
        fetch: async (input) => {
          const url = new URL(String(input));
          const token = url.searchParams.get('pageToken') ?? '';
          requested.push(token);
          const page = token
            ? {
                accountSummaries: [
                  {
                    displayName: 'Second',
                    propertySummaries: [{ property: 'properties/456', displayName: 'Site' }],
                  },
                ],
              }
            : {
                accountSummaries: [
                  {
                    displayName: 'First',
                    propertySummaries: [
                      { property: 'properties/123', displayName: 'Shop' },
                      { property: 'invalid' },
                    ],
                  },
                ],
                nextPageToken: 'next-page',
              };
          return new Response(JSON.stringify(page), { status: 200 });
        },
        sleep: async () => {},
      },
    );
    expect(await client.properties('ga4', 'recorded-token')).toEqual([
      { property_ref: '123', label: 'First / Shop' },
      { property_ref: '456', label: 'Second / Site' },
    ]);
    expect(requested).toEqual(['', 'next-page']);
  });
  it('retains the complete Bing report while normalizing only usable metric rows', async () => {
    const report = {
      d: [
        { Query: 'example query', Date: '/Date(1784505600000)/', Clicks: 3, Impressions: 10 },
        { Query: 'bad metrics', Date: '/Date(1784505600000)/', Clicks: false, Impressions: 10 },
      ],
    };
    const client = new IntegrationClient(
      {},
      {
        fetch: async () => new Response(JSON.stringify(report), { status: 200 }),
        sleep: async () => {},
      },
    );
    const page = await client.page(
      'bing',
      'recorded-token',
      'https://example.test',
      integrationPolicy.datasets.bing_query_daily,
      '2026-07-20',
      '2026-07-21',
      0,
    );
    expect(page.payload.d).toEqual(report.d);
    expect(page.rawRowCount).toBe(2);
    expect(page.payload.rows).toHaveLength(1);
  });
  it.each([
    ['gsc', { siteEntry: 'malformed' }],
    ['bing', { d: {} }],
    ['ga4', { accountSummaries: [], nextPageToken: 23 }],
  ] as const)('classifies a malformed %s discovery response', async (provider, payload) => {
    const client = new IntegrationClient(
      {},
      {
        fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
        sleep: async () => {},
      },
    );
    await expect(client.properties(provider, 'recorded-token')).rejects.toMatchObject({
      code: 'provider_api_error',
    });
  });
  it('accepts the recorded GetUserSites Site response without a synthetic verification flag', async () => {
    const recorded = await readFile(
      new URL('./fixtures/integrations/bing_sites_response.json', import.meta.url),
      'utf8',
    );
    const requests: { url: string; authorization: string | null }[] = [];
    const client = new IntegrationClient(
      {},
      {
        fetch: async (input, init) => {
          requests.push({
            url: String(input),
            authorization: new Headers(init?.headers).get('authorization'),
          });
          return new Response(recorded, { status: 200 });
        },
        sleep: async () => {},
      },
    );
    expect(await client.properties('bing', 'recorded-token')).toEqual([
      { property_ref: 'https://example.com', label: 'https://example.com' },
    ]);
    // An OAuth bearer token is accepted only on www.bing.com; ssl.bing.com
    // serves API-key calls and answers a bearer request with HTTP 400.
    expect(requests).toEqual([
      {
        url: 'https://www.bing.com/webmaster/api.svc/json/GetUserSites',
        authorization: 'Bearer recorded-token',
      },
    ]);
  });
});
