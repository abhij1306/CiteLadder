import { http, HttpResponse } from 'msw';

export const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
export const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_ID = '33333333-3333-4333-8333-333333333333';
export const CHATGPT_MODEL = 'gpt-6.1-terra';

const scraped = (logical_engine: string, label: string, model: string) => ({
  logical_engine,
  label,
  routes: [
    {
      transport_provider: 'dataforseo',
      transport_model: model,
      retrieval_enabled: null,
      reasoning_effort: null,
      surface_kind: 'llm_scraper',
    },
  ],
});

export const providerCatalogFixture = {
  transports: ['openai', 'anthropic', 'google', 'dataforseo'],
  engines: [
    scraped('chatgpt_search', 'ChatGPT Search', 'chat_gpt-llm-scraper'),
    scraped('gemini_consumer', 'Gemini', 'gemini-llm-scraper'),
    {
      logical_engine: 'chatgpt',
      label: 'ChatGPT API',
      routes: [
        {
          transport_provider: 'openai',
          transport_model: 'gpt-6.1-terra',
          retrieval_enabled: true,
          reasoning_effort: 'low',
          surface_kind: 'llm',
        },
      ],
    },
    {
      logical_engine: 'gemini',
      label: 'Gemini API',
      routes: [
        {
          transport_provider: 'google',
          transport_model: 'gemini-3.6-flash',
          retrieval_enabled: true,
          reasoning_effort: 'low',
          surface_kind: 'llm',
        },
      ],
    },
    {
      logical_engine: 'claude',
      label: 'Claude API',
      routes: [
        {
          transport_provider: 'anthropic',
          transport_model: 'claude-sonnet-5-5',
          retrieval_enabled: true,
          reasoning_effort: 'low',
          surface_kind: 'llm',
        },
      ],
    },
    {
      logical_engine: 'google_ai_overview',
      label: 'Google AI Overview',
      routes: [
        {
          transport_provider: 'dataforseo',
          transport_model: 'google-organic-serp',
          retrieval_enabled: null,
          reasoning_effort: null,
          surface_kind: 'search_ai',
        },
      ],
    },
    {
      logical_engine: 'google_ai_mode',
      label: 'Google AI Mode',
      routes: [
        {
          transport_provider: 'dataforseo',
          transport_model: 'google-ai-mode-serp',
          retrieval_enabled: null,
          reasoning_effort: null,
          surface_kind: 'search_ai',
        },
      ],
    },
  ],
};

export function connection(overrides: Record<string, unknown> = {}) {
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
        id: ROUTE_ID,
        logical_engine: 'chatgpt',
        transport_provider: 'openai',
        transport_model: CHATGPT_MODEL,
        is_default: false,
        active: true,
      },
    ],
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

export function catalogHandler() {
  return http.get('/api/v1/provider-catalog', () => HttpResponse.json(providerCatalogFixture));
}

export function failedTestHandler() {
  return http.post(`/api/v1/provider-connections/${CONNECTION_ID}/test`, () =>
    HttpResponse.json({
      connection_id: CONNECTION_ID,
      status: 'failed',
      error_code: 'auth_failure',
      detail: 'Invalid API key',
      latency_ms: 10,
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      transport_model: CHATGPT_MODEL,
      tested_at: '2026-07-15T00:00:00Z',
    }),
  );
}
