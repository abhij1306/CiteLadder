import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import {
  CHATGPT_MODEL,
  CONNECTION_ID,
  WORKSPACE_ID,
  catalogHandler,
  connection,
  failedTestHandler,
  providerCatalogFixture,
} from '@/test/provider-catalog-fixture';

import { ProviderSettings } from './provider-settings';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  window.localStorage.clear();
  mswServer.use(
    http.get('/api/v1/provider-connections/states', () =>
      HttpResponse.json({ workspace_id: WORKSPACE_ID, providers: [] }),
    ),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

/** The list row for one provider, found by its heading. */
async function row(name: string) {
  const heading = await screen.findByRole('heading', { name }, { timeout: 3_000 });
  return within(heading.closest('li')!);
}

/** The catalog with DataForSEO's consumer-app surfaces published too. */
function consumerCatalogHandler() {
  const scraped = (['chatgpt_search', 'gemini_consumer'] as const).map((logical_engine) => ({
    logical_engine,
    routes: [
      {
        transport_provider: 'dataforseo',
        transport_model: `${logical_engine}-scraper`,
        retrieval_enabled: null,
        reasoning_effort: null,
        surface_kind: 'llm_scraper',
      },
    ],
  }));
  return http.get('/api/v1/provider-catalog', () =>
    HttpResponse.json({
      ...providerCatalogFixture,
      engines: [...providerCatalogFixture.engines, ...scraped],
    }),
  );
}

describe('ProviderSettings', () => {
  it('lists each provider once, with the engines it measures and nothing unconnectable', async () => {
    mswServer.use(
      consumerCatalogHandler(),
      http.get('/api/v1/provider-connections', () => HttpResponse.json([])),
    );

    renderWithProviders(<ProviderSettings />);

    const dataforseo = await row('DataForSEO');
    expect(
      dataforseo.getByText('ChatGPT Search · Gemini · Google AI Overview'),
    ).toBeInTheDocument();
    expect((await row('OpenAI')).getByText(`ChatGPT API · ${CHATGPT_MODEL}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Anthropic' })).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(4);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    // Credentials are asked for on demand, not repeated down the page.
    expect(screen.queryByLabelText(/api login/i)).toBeNull();
  });

  it('saves one DataForSEO login for every surface it measures', async () => {
    const user = userEvent.setup();
    let createdBody: Record<string, unknown> | null = null;
    mswServer.use(
      consumerCatalogHandler(),
      http.get('/api/v1/provider-connections', () => HttpResponse.json([])),
      http.post('/api/v1/provider-connections', async ({ request }) => {
        createdBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(connection({ transport_provider: 'dataforseo' }), {
          status: 201,
        });
      }),
      http.post(`/api/v1/provider-connections/${CONNECTION_ID}/test`, () =>
        HttpResponse.json({
          connection_id: CONNECTION_ID,
          status: 'ok',
          error_code: '',
          detail: '',
          latency_ms: 42,
          logical_engine: 'chatgpt_search',
          transport_provider: 'dataforseo',
          transport_model: 'chatgpt_search-scraper',
          tested_at: '2026-07-15T00:00:00Z',
        }),
      ),
    );

    renderWithProviders(<ProviderSettings />);
    const dataforseo = await row('DataForSEO');
    await user.click(dataforseo.getByRole('button', { name: 'Connect DataForSEO' }));

    // One login and one password on the whole page.
    expect(screen.getAllByLabelText(/api login/i)).toHaveLength(1);
    await user.type(dataforseo.getByLabelText(/api login/i), 'team@example.com');
    await user.type(dataforseo.getByLabelText(/api password/i), 'secret');
    await user.click(dataforseo.getByRole('button', { name: /save credentials/i }));

    await waitFor(() =>
      expect(createdBody).toEqual({
        transport_provider: 'dataforseo',
        api_login: 'team@example.com',
        api_password: 'secret',
        routes: ['chatgpt_search', 'gemini_consumer', 'google_ai_overview'].map(
          (logical_engine) => ({ logical_engine, is_default: false }),
        ),
      }),
    );
    // A verified save collapses the row.
    await waitFor(() => expect(dataforseo.queryByLabelText(/api login/i)).toBeNull());
  });

  it('keeps a saved-but-unprobed key unverified, then connects after a probe', async () => {
    const user = userEvent.setup();
    let created = false;
    let probes = 0;
    let verified = false;
    mswServer.use(
      catalogHandler(),
      http.get('/api/v1/provider-connections', () =>
        HttpResponse.json(created ? [connection()] : []),
      ),
      http.post('/api/v1/provider-connections', () => {
        created = true;
        return HttpResponse.json(connection(), { status: 201 });
      }),
      http.get('/api/v1/provider-connections/states', () =>
        HttpResponse.json({
          workspace_id: WORKSPACE_ID,
          providers: [
            {
              key: 'chatgpt',
              label: 'ChatGPT',
              // The whole point: a stored key alone is NOT connected.
              state: verified ? 'connected' : 'missing',
              safe_reason: verified ? null : 'verification required',
              grant_key: 'provider.openai',
              latest_probe: null,
            },
          ],
        }),
      ),
      http.post(`/api/v1/provider-connections/${CONNECTION_ID}/test`, () => {
        // The save's own probe fails; the explicit retry succeeds.
        probes += 1;
        const ok = probes > 1;
        verified = ok;
        return HttpResponse.json({
          connection_id: CONNECTION_ID,
          status: ok ? 'ok' : 'failed',
          error_code: ok ? '' : 'timeout',
          detail: ok ? 'Connection succeeded' : 'Provider timed out',
          latency_ms: 42,
          logical_engine: 'chatgpt',
          transport_provider: 'openai',
          transport_model: CHATGPT_MODEL,
          tested_at: '2026-07-15T00:00:00Z',
        });
      }),
    );

    renderWithProviders(<ProviderSettings />);
    const openai = await row('OpenAI');
    await user.click(openai.getByRole('button', { name: 'Connect OpenAI' }));
    await user.type(openai.getByPlaceholderText(/paste your api key/i), 'sk-test-key');
    await user.click(openai.getByRole('button', { name: /save key/i }));

    expect(await openai.findByText('Provider timed out')).toBeInTheDocument();
    expect(await openai.findByText('Not verified')).toBeInTheDocument();

    await user.click(openai.getByRole('button', { name: /test connection/i }));
    expect(await openai.findByText(/connection succeeded/i)).toBeInTheDocument();
    expect(await openai.findByText('Connected')).toBeInTheDocument();
  });

  it('surfaces a failed connection test', async () => {
    const user = userEvent.setup();
    mswServer.use(
      catalogHandler(),
      http.get('/api/v1/provider-connections', () => HttpResponse.json([connection()])),
      failedTestHandler(),
    );

    renderWithProviders(<ProviderSettings />);
    const openai = await row('OpenAI');
    await user.click(await openai.findByRole('button', { name: 'Manage OpenAI' }));
    await user.click(openai.getByRole('button', { name: /test connection/i }));

    expect(await openai.findByText(/invalid api key/i)).toBeInTheDocument();
  });

  it('never renders the stored secret — key input is empty and write-only', async () => {
    const user = userEvent.setup();
    mswServer.use(
      catalogHandler(),
      http.get('/api/v1/provider-connections', () => HttpResponse.json([connection()])),
    );

    renderWithProviders(<ProviderSettings />);
    const openai = await row('OpenAI');
    await user.click(await openai.findByRole('button', { name: 'Manage OpenAI' }));

    const keyInput = openai.getByPlaceholderText(/stored/i) as HTMLInputElement;
    expect(keyInput).toHaveAttribute('type', 'password');
    expect(keyInput.value).toBe('');
  });
});
