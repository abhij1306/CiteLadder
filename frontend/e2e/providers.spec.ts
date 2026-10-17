import { expect, test, type Request } from '@playwright/test';
import { providerCatalogFixture } from '../test/provider-catalog-fixture';
import { FIXTURE_PROJECT, stubAuthedShell } from './helpers/app-fixture';

/**
 * Direct-provider Provider Settings e2e.
 *
 * All backend calls are stubbed at the network layer so the spec runs without a
 * live backend (mirrors `runs.spec.ts`). It exercises saving an OpenAI key
 * from its provider row, which probes the key as part of the save.
 *
 * The app calls only relative `/api/v1` paths (Next rewrites proxy them), so the
 * spec also asserts that every `/api/` request the browser issues is
 * same-origin with the page's baseURL — no cross-origin backend URL.
 */
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = FIXTURE_PROJECT.workspace_id;

const catalog = providerCatalogFixture;

function connection() {
  return {
    id: CONNECTION_ID,
    workspace_id: WORKSPACE_ID,
    label: 'chatgpt',
    transport_provider: 'openai',
    base_url: null,
    active: true,
    api_key_set: true,
    last_tested_at: null,
    last_test_status: '',
    routes: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        logical_engine: 'chatgpt',
        transport_provider: 'openai',
        transport_model: 'gpt-5.4',
        is_default: false,
        active: true,
      },
    ],
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
  };
}

/** Assert every observed `/api/` request is same-origin with the baseURL. */
function assertSameOriginApi(requests: Request[], baseURL: string) {
  const origin = new URL(baseURL).origin;
  const apiRequests = requests.filter((r) => new URL(r.url()).pathname.includes('/api/'));
  // The app must actually have talked to the API (sanity check).
  expect(apiRequests.length).toBeGreaterThan(0);
  for (const request of apiRequests) {
    expect(new URL(request.url()).origin).toBe(origin);
  }
}

test('provider settings: an OpenAI key saves and verifies from its row', async ({
  page,
  baseURL,
}) => {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));

  // Connection list flips to "configured" once the OpenAI key is saved.
  let created = false;

  await stubAuthedShell(page);
  await page.route('**/api/v1/provider-catalog', (route) => route.fulfill({ json: catalog }));
  await page.route('**/api/v1/provider-connections', (route) => {
    if (route.request().method() === 'POST') {
      created = true;
      return route.fulfill({ status: 201, json: connection() });
    }
    return route.fulfill({ json: created ? [connection()] : [] });
  });
  await page.route(`**/api/v1/provider-connections/${CONNECTION_ID}/test`, (route) =>
    route.fulfill({
      json: {
        connection_id: CONNECTION_ID,
        status: 'ok',
        error_code: '',
        detail: 'Connection succeeded',
        latency_ms: 42,
        logical_engine: 'chatgpt',
        transport_provider: 'openai',
        transport_model: 'gpt-5.4',
        tested_at: '2026-07-15T00:00:00Z',
      },
    }),
  );

  await page.goto('/settings?tab=providers');

  // The list's static contract — one row per provider, the engines each
  // measures, the unverified→connected status machine — is pinned in jsdom by
  // components/settings/provider-settings.test.tsx. What only a real browser
  // can show is that the save + probe round trip issues same-origin /api/
  // requests through the Next rewrite.
  const openaiRow = page.locator('li', {
    has: page.getByRole('heading', { name: 'OpenAI', exact: true }),
  });
  await openaiRow.getByRole('button', { name: 'Connect OpenAI' }).click();
  await openaiRow.getByPlaceholder(/paste your api key/i).fill('sk-test-key');

  // Saving always probes: storing a key alone never makes it usable.
  const probe = page.waitForRequest((request) =>
    request.url().endsWith(`/provider-connections/${CONNECTION_ID}/test`),
  );
  await openaiRow.getByRole('button', { name: /save key/i }).click();
  await probe;
  // A verified save collapses the row.
  await expect(openaiRow.getByPlaceholder(/api key|stored/i)).toBeHidden();

  // Same-origin: every /api/ request went to the page origin (no cross-origin backend).
  assertSameOriginApi(requests, baseURL!);
});
