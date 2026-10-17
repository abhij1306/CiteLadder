import type { Project } from '@/lib/api/types';

/**
 * One typed `Project` for every frontend test that needs one.
 *
 * Nine suites used to hand-write the same twenty-field literal, so every
 * schema change meant nine edits and the copies had already drifted (three
 * different `website_url`s, two `industry` values, one `as unknown as Project`
 * cast hiding a competitor missing its `id`). Defaults describe the boring
 * project; pass only the fields a test actually asserts on, so the assertion
 * and the reason for the value stay next to each other.
 */
const PROJECT_FIXTURE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_FIXTURE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_FIXTURE_ID,
    workspace_id: WORKSPACE_FIXTURE_ID,
    name: 'Acme',
    brand_name: 'Acme',
    website_url: 'https://acme.com',
    industry: 'General',
    subindustry: '',
    primary_market: 'US',
    country_code: 'US',
    language_code: 'en',
    benchmark_mode: 'consumer_like',
    default_repetitions: 3,
    brand: { aliases: [] },
    owned_domains: [],
    unintended_domains: [],
    competitors: [],
    prompt_sets: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
