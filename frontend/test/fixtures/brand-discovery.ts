import type { BrandDiscovery } from '@/lib/api/brand-discoveries';

export const DISCOVERY_ID = '11111111-1111-4111-8111-111111111111';

export function discovery(
  status: BrandDiscovery['status'],
  phase: BrandDiscovery['progress']['phase'],
) {
  return {
    id: DISCOVERY_ID,
    workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project_id: null,
    status,
    progress: {
      phase,
      completed_steps: status === 'ready' ? 4 : 2,
      total_steps: 4,
      pages_read: 3,
      competitors_found: 1,
    },
    input_data: {
      brand_name: 'Acme',
      website_url: 'https://acme.example',
      industry: 'Software',
      subindustry: 'Analytics',
      primary_market: 'US',
      language_code: 'en',
    },
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
      category_aliases: ['feed management software'],
      category_terms: ['product feed management', 'marketplace integrations'],
      jobs_to_be_done: ['list products on marketplaces'],
      sector: 'Software',
      business_model: 'b2b_saas',
      secondary_business_models: [],
      market_scope: 'global',
      buyer_register: 'research_comparative',
      buyer_roles: ['ecommerce manager'],
      service_areas: [],
      knowledge_strength: 'strong',
    },
    domains: ['acme.example'],
    competitors: [
      {
        name: 'Globex',
        aliases: [],
        domains: ['globex.example'],
      },
    ],
    evidence: [],
    warnings: [],
    error_code: '',
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
  } satisfies BrandDiscovery;
}
