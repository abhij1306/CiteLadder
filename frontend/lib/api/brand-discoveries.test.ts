import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';

import { brandDiscoveriesApi, type BrandDiscoveryCompletion } from './brand-discoveries';

const DISCOVERY_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const completion: BrandDiscoveryCompletion = {
  name: 'Acme',
  profile: {
    description: 'A commerce platform',
    positioning: 'Reliable product data',
    products_services: ['Product feeds'],
    target_audience: 'Retailers',
    industry: 'Commerce software',
    business_type: 'b2b',
    price_tier: 'premium',
    field_confidence: {},
    category: 'product feed management platform',
    category_options: [],
    category_aliases: [],
    category_terms: ['product feed management'],
    jobs_to_be_done: [],
    sector: 'Software',
    business_model: 'b2b_saas',
    secondary_business_models: [],
    market_scope: 'global',
    buyer_register: 'research_comparative',
    buyer_roles: [],
    service_areas: [],
    knowledge_strength: 'strong',
  },
  domains: ['acme.example'],
  competitors: [{ name: 'Globex', aliases: [], domains: ['globex.example'] }],
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('brand discovery completion contract', () => {
  it('sends the confirmed review once with its idempotency key', async () => {
    let body: unknown;
    let idempotencyKey: string | null = null;
    mswServer.use(
      http.post(`/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, async ({ request }) => {
        body = await request.json();
        idempotencyKey = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          discovery_id: DISCOVERY_ID,
          project_id: PROJECT_ID,
          warnings: [],
        });
      }),
    );

    await expect(
      brandDiscoveriesApi.complete(DISCOVERY_ID, completion, 'complete-once'),
    ).resolves.toEqual({
      discovery_id: DISCOVERY_ID,
      project_id: PROJECT_ID,
      warnings: [],
    });
    expect(idempotencyKey).toBe('complete-once');
    expect(body).toEqual(completion);
  });
});
