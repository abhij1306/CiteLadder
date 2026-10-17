// @vitest-environment node
//
// Pure logic: no DOM, no window, no React render. The suite-wide jsdom
// default costs a full environment per file and buys nothing here.
import { describe, expect, it } from 'vite-plus/test';

import type { ProviderConnection } from '@/lib/api/types';

import {
  ENGINE_LABELS,
  ENGINE_ORDER,
  TRANSPORT_LABELS,
  buildEngineCards,
  buildProviderGroups,
  connectionForTransport,
  engineLabel,
  isConfigured,
  isVerified,
  mergeRoutePayload,
  transportForEngine,
  transportLabel,
} from './catalog';
import { providerCatalogFixture } from '@/test/provider-catalog-fixture';

/**
 * `lib/providers` had no tests. The load-bearing distinction here is
 * `isConfigured` vs `isVerified`: "we stored a key" is a weaker fact than "the
 * key works", and only the stronger one may offer an engine for a launch. The
 * backend's admission filter skips any BYOK route whose last probe is not `ok`,
 * so a frontend that conflated the two would offer a launch the backend then
 * refuses — the failure this file exists to prevent.
 */
function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    transport_provider: 'openai',
    base_url: null,
    active: true,
    api_key_set: true,
    last_test_status: 'ok',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  } as ProviderConnection;
}

describe('catalog labels', () => {
  it('labels every engine in the display order', () => {
    for (const engine of ENGINE_ORDER) {
      expect(ENGINE_LABELS[engine]).toBeTruthy();
      expect(engineLabel(engine)).toBe(ENGINE_LABELS[engine]);
    }
  });

  it('falls back to the raw key for an unknown engine', () => {
    // A new backend engine must render as its key rather than "undefined".
    expect(engineLabel('perplexity')).toBe('perplexity');
    expect(engineLabel('')).toBe('');
  });

  it('labels known transports and falls back for unknown ones', () => {
    expect(transportLabel('openai')).toBe(TRANSPORT_LABELS.openai);
    expect(transportLabel('cohere')).toBe('cohere');
  });
});

describe('connection lookup', () => {
  it('finds the connection serving a transport', () => {
    const openai = connection({ transport_provider: 'openai' });
    const google = connection({ transport_provider: 'google' });

    expect(connectionForTransport([openai, google], 'google')).toBe(google);
  });

  it('is undefined when no connection serves the transport', () => {
    expect(connectionForTransport([connection()], 'anthropic')).toBeUndefined();
    expect(connectionForTransport([], 'openai')).toBeUndefined();
  });
});

describe('configured vs verified', () => {
  it('treats a stored key as configured', () => {
    expect(isConfigured(connection({ api_key_set: true }))).toBe(true);
  });

  it.each([
    ['no key stored', connection({ api_key_set: false })],
    ['the flag absent', connection({ api_key_set: undefined })],
    ['no connection at all', undefined],
  ])('is not configured with %s', (_name, value) => {
    expect(isConfigured(value)).toBe(false);
  });

  it('verifies a stored key whose latest probe succeeded', () => {
    expect(isVerified(connection({ api_key_set: true, last_test_status: 'ok' }))).toBe(true);
  });

  it.each(['', 'failed', 'error', 'pending'])(
    'does not verify a stored key whose probe status is %j',
    (status) => {
      // Configured but NOT executable: offering this engine produces a launch
      // the backend's admission filter rejects.
      const stored = connection({ api_key_set: true, last_test_status: status });
      expect(isConfigured(stored)).toBe(true);
      expect(isVerified(stored)).toBe(false);
    },
  );

  it('does not verify a successful probe with no key stored', () => {
    expect(isVerified(connection({ api_key_set: false, last_test_status: 'ok' }))).toBe(false);
  });

  it('does not verify a missing connection', () => {
    expect(isVerified(undefined)).toBe(false);
  });
});

describe('mergeRoutePayload', () => {
  it('adds the engine to a connection that has no routes yet', () => {
    expect(mergeRoutePayload(undefined, ['chatgpt'])).toEqual([
      { logical_engine: 'chatgpt', is_default: false },
    ]);
  });

  it('preserves other engines already on the same direct connection', () => {
    const existing = connection({
      routes: [{ logical_engine: 'gemini', is_default: true }],
    } as Partial<ProviderConnection>);

    expect(mergeRoutePayload(existing, ['chatgpt'])).toEqual([
      { logical_engine: 'gemini', is_default: true },
      { logical_engine: 'chatgpt', is_default: false },
    ]);
  });

  it('does not duplicate an engine that is already routed', () => {
    const existing = connection({
      routes: [{ logical_engine: 'chatgpt', is_default: true }],
    } as Partial<ProviderConnection>);

    // Re-adding must not flip the existing route's default flag either.
    expect(mergeRoutePayload(existing, ['chatgpt'])).toEqual([
      { logical_engine: 'chatgpt', is_default: true },
    ]);
  });

  it('routes every engine a shared credential measures in one payload', () => {
    expect(mergeRoutePayload(undefined, ['chatgpt_search', 'gemini_consumer'])).toEqual([
      { logical_engine: 'chatgpt_search', is_default: false },
      { logical_engine: 'gemini_consumer', is_default: false },
    ]);
  });
});

describe('buildProviderGroups', () => {
  const catalog = {
    ...providerCatalogFixture,
    engines: [
      ...providerCatalogFixture.engines,
      ...(['chatgpt_search', 'gemini_consumer'] as const).map((logical_engine) => ({
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
      })),
    ],
  } as unknown as Parameters<typeof buildEngineCards>[0];

  it('asks for each credential once, with every engine it measures', () => {
    const groups = buildProviderGroups(buildEngineCards(catalog));

    expect(
      groups.map((group) => [
        group.transport,
        group.credential_shape,
        group.engines.map((engine) => engine.logical_engine),
      ]),
    ).toEqual([
      ['dataforseo', 'basic', ['chatgpt_search', 'gemini_consumer', 'google_ai_overview']],
      ['openai', 'key', ['chatgpt']],
      ['google', 'key', ['gemini']],
      ['anthropic', 'key', ['claude']],
    ]);
    expect(transportForEngine(groups, 'gemini_consumer')).toBe('dataforseo');
  });

  it('omits an engine the catalog publishes no route for', () => {
    const groups = buildProviderGroups(buildEngineCards(providerCatalogFixture as never));

    // The fixture has no consumer-app routes: DataForSEO measures only AIO.
    expect(groups.find((group) => group.transport === 'dataforseo')?.engines).toHaveLength(1);
    expect(transportForEngine(groups, 'chatgpt_search')).toBeNull();
  });
});
