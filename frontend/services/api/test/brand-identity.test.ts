import { createHash, randomUUID } from 'node:crypto';

import type {
  brandProfileSchema,
  businessMapSchema,
  competitorSchema,
} from '@citeladder/contracts/project';
import type { observedCompetitorSchema } from '@citeladder/contracts/visibility';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

type BrandProfile = z.infer<typeof brandProfileSchema>;
type BusinessMap = z.infer<typeof businessMapSchema>;
type Competitor = z.infer<typeof competitorSchema>;
type ObservedCompetitor = z.infer<typeof observedCompetitorSchema>;

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const config = testConfig();
const app = createApp(config, db);
const logoAssets: string[] = [];
let t: Tenant;

beforeEach(async () => {
  t = await fixtures.tenant();
});
afterAll(async () => {
  await fixtures.cleanup();
  if (logoAssets.length)
    await db.deleteFrom('brand_logo_assets').where('id', 'in', logoAssets).execute();
  await db.destroy();
});

type Call = {
  method?: string;
  body?: unknown;
  user?: string;
  workspace?: string | null;
  anonymous?: boolean;
  headers?: Record<string, string>;
};

async function request(path: string, options: Call = {}) {
  const token = await sessionToken({ sub: options.user ?? t.userId, ver: 0 });
  const workspace = options.workspace === undefined ? t.workspaceId : options.workspace;
  return app.request(`/api/v1/projects/${t.projectId}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(workspace ? { 'x-workspace-id': workspace } : {}),
      ...(options.anonymous ? {} : { cookie: `${TEST_SESSION_COOKIE}=${token}` }),
      'content-type': 'application/json',
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function call<T>(path: string, options: Call = {}) {
  const response = await request(path, options);
  return { status: response.status, body: (await response.json()) as T };
}

async function brand(): Promise<string> {
  await fixtures.brand(t.projectId, 'Acme');
  const row = await db
    .selectFrom('brands')
    .select('id')
    .where('project_id', '=', t.projectId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A profile as onboarding leaves it: products, a web-evidence field, other context. */
async function profile(
  input: { products?: string[]; businessContext?: Record<string, unknown> } = {},
): Promise<void> {
  const brandId = await brand();
  await db
    .insertInto('brand_profiles')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      brand_id: brandId,
      description: 'From the website.',
      positioning: '',
      products_services: JSON.stringify(input.products ?? ['running shoes', 'sandals']),
      target_audience: '',
      business_context: JSON.stringify(input.businessContext ?? { category: 'footwear' }),
      sources: JSON.stringify({
        description: {
          origin: 'web_evidence',
          review_state: 'unreviewed',
          reviewed_by: null,
          reviewed_at: null,
        },
      }),
      source_artifact_ids: JSON.stringify({ description: randomUUID() }),
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
}

async function readyLogo(owner: 'brands' | 'competitors', ownerId: string, image: Buffer) {
  const id = randomUUID();
  await db
    .insertInto('brand_logo_assets')
    .values({
      id,
      domain: `${id}.example`,
      source_url: `https://${id}.example/favicon.png`,
      status: 'ready',
      content_type: 'image/png',
      image_data: image,
      byte_size: image.length,
      sha256: createHash('sha256').update(image).digest('hex'),
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  logoAssets.push(id);
  await db.updateTable(owner).set({ logo_asset_id: id }).where('id', '=', ownerId).execute();
}

async function suggestion(input: {
  name: string;
  domain: string;
  prompts?: number;
  engines?: number;
  status?: string;
  auditId: string;
}): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('observed_entity_candidates')
    .values({
      id,
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      audit_id: input.auditId,
      name: input.name,
      domain: input.domain,
      qualification_reason: 'Cited across prompts and engines',
      prompt_count: input.prompts ?? 2,
      engine_count: input.engines ?? 2,
      market_relevant: true,
      analyzer_version: 'observed-competitor-v1',
      source_analysis_ids: JSON.stringify([randomUUID()]),
      source_artifact_ids: JSON.stringify([]),
      status: input.status ?? 'pending',
      created_at: new Date(),
    })
    .execute();
  return id;
}

describe('brand identity workspace boundaries', () => {
  const routes = [
    ['/brand-profile', 'GET', undefined],
    ['/brand-profile', 'PUT', { description: 'x' }],
    ['/business-map', 'GET', undefined],
    ['/business-map', 'PUT', { offerings: [] }],
    ['/competitor-suggestions', 'GET', undefined],
    [`/competitor-suggestions/${randomUUID()}/accept`, 'POST', undefined],
  ] as const;

  it('requires membership, the project workspace and write capability', async () => {
    const outsider = await fixtures.user();
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    const otherWorkspace = await fixtures.joinedWorkspace(t.userId);
    for (const [path, method, body] of routes) {
      expect((await call(path, { method, body, anonymous: true })).status).toBe(404);
      expect((await call(path, { method, body, user: outsider })).status).toBe(404);
      const foreign = await call<{ error: { message: string } }>(path, {
        method,
        body,
        workspace: otherWorkspace,
      });
      expect(foreign).toMatchObject({
        status: 404,
        body: { error: { message: 'Project not found' } },
      });
      if (method !== 'GET')
        expect((await call(path, { method, body, user: viewer })).status).toBe(403);
    }
  });
});

describe('brand profile', () => {
  it('is missing until the project has one, and a brandless project cannot gain one', async () => {
    expect(await call('/brand-profile')).toMatchObject({
      status: 404,
      body: { error: { message: 'Brand profile not found' } },
    });
    expect(
      (await call('/brand-profile', { method: 'PUT', body: { description: 'x' } })).status,
    ).toBe(404);
  });

  it('confirms first reviews, marks later ones edited, keeps origins and drops stale artifacts', async () => {
    await profile();
    const shown = await call<BrandProfile>('/brand-profile');
    expect(shown.body.sources.description).toMatchObject({ origin: 'web_evidence' });
    expect(shown.body.business_context).toEqual({ category: 'footwear' });

    const edited = await call<BrandProfile>('/brand-profile', {
      method: 'PUT',
      body: {
        description: '  A practical retailer.  ',
        products_services: [' Clothing ', 'Homewares', 'clothing', ' '],
        positioning: null,
      },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      description: 'A practical retailer.',
      products_services: ['Clothing', 'Homewares'],
      positioning: '',
      sources: {
        description: { origin: 'web_evidence', review_state: 'edited', reviewed_by: t.userId },
        products_services: { origin: 'manual', review_state: 'confirmed', reviewed_by: t.userId },
        positioning: null,
        target_audience: null,
      },
      source_artifact_ids: { description: null },
      business_context: { category: 'footwear' },
    });
    expect(edited.body.updated_at > shown.body.updated_at).toBe(true);
    expect(await call<BrandProfile>('/brand-profile')).toMatchObject({ body: edited.body });
  });

  it('reviews identity facets in the business context and keeps the rest of it', async () => {
    await profile({
      businessContext: {
        category: 'footwear',
        category_terms: ['shoes'],
        business_type: 'b2c',
        market_scope: 'local',
        business_map: { offerings: [] },
        field_sources: {
          category: 'inferred',
          category_terms: 'inferred',
          business_type: 'inferred',
        },
      },
    });
    const edited = await call<BrandProfile>('/brand-profile', {
      method: 'PUT',
      body: { category: '  trail running shoes ', buyer_type: 'both' },
    });
    expect(edited.status).toBe(200);
    // Unsupplied facets and other context stay as they were; terms inferred
    // from the replaced category go, and the older `business_type` key gives way.
    expect(edited.body.business_context).toEqual({
      category: 'trail running shoes',
      buyer_type: 'both',
      market_scope: 'local',
      business_map: { offerings: [] },
      field_sources: { category: 'reviewed', buyer_type: 'reviewed' },
    });
    for (const body of [{ category: ' ' }, { market_scope: 'planetary' }]) {
      expect((await call('/brand-profile', { method: 'PUT', body })).status).toBe(422);
    }
  });

  it('creates the profile on the first edit and rejects oversized fields', async () => {
    await brand();
    const created = await call<BrandProfile>('/brand-profile', {
      method: 'PUT',
      body: { target_audience: 'Families' },
    });
    expect(created.body).toMatchObject({
      target_audience: 'Families',
      description: '',
      business_context: {},
      sources: { target_audience: { origin: 'manual', review_state: 'confirmed' } },
    });
    const tooLong = await call('/brand-profile', {
      method: 'PUT',
      body: { description: 'x'.repeat(4_001) },
    });
    expect(tooLong.status).toBe(422);
  });

  it('reads provenance stored without the reviewer keys as unreviewed', async () => {
    await profile();
    // The older stored shape, written before provenance carried the
    // reviewer keys; stored rows keep it, so the reader must accept it.
    await db
      .updateTable('brand_profiles')
      .set({
        sources: JSON.stringify({
          description: { origin: 'ai_suggested', review_state: 'unreviewed' },
        }),
      })
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
    const shown = await call<BrandProfile>('/brand-profile');
    expect(shown.status).toBe(200);
    expect(shown.body.sources.description).toEqual({
      origin: 'ai_suggested',
      review_state: 'unreviewed',
      reviewed_by: null,
      reviewed_at: null,
    });
    // The first edit keeps the origin and rewrites the entry with the full
    // provenance shape, so the stored row is healed by the next write.
    const edited = await call<BrandProfile>('/brand-profile', {
      method: 'PUT',
      body: { description: 'Now reviewed.' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.sources.description).toMatchObject({
      origin: 'ai_suggested',
      review_state: 'edited',
      reviewed_by: t.userId,
      reviewed_at: expect.any(String),
    });
  });
});

describe('business map', () => {
  const suggested = {
    value: 'waterproof',
    origin: 'model',
    review_state: 'suggested',
    reviewed_by: null,
    reviewed_at: null,
    source: { transport_model: 'fake-model' },
  };
  const seeded = {
    category: 'footwear',
    business_map: {
      offerings: [
        {
          offering: 'running shoes',
          attributes: [suggested],
          situations: [],
          audiences: [],
          exclusions: [],
        },
      ],
    },
  };

  it('keeps suggestion provenance across edits and confirms only on request', async () => {
    await profile({ businessContext: seeded });
    const shown = await call<BusinessMap>('/business-map');
    expect(shown.body.available_offerings).toEqual(['running shoes', 'sandals']);
    expect(shown.body.offerings[0]!.attributes[0]!.review_state).toBe('suggested');

    const kept = await call<BusinessMap>('/business-map', {
      method: 'PUT',
      body: {
        offerings: [
          {
            offering: 'Running Shoes',
            attributes: [
              { value: 'waterproof', review_state: 'suggested' },
              { value: 'wide fit', review_state: 'suggested' },
              { value: 'Wide Fit' },
            ],
            situations: [{ value: '  wet trails ' }],
            exclusions: [
              { first: 'wide fit', second: 'wet trails' },
              { first: 'Wet Trails', second: 'Wide fit' },
            ],
          },
        ],
      },
    });
    expect(kept.status).toBe(200);
    const [offering] = kept.body.offerings;
    expect(offering!.offering).toBe('running shoes');
    expect(offering!.attributes).toMatchObject([
      { value: 'waterproof', origin: 'model', review_state: 'suggested' },
      // A new entry is a confirmed manual fact, whatever the request asked.
      { value: 'wide fit', origin: 'manual', review_state: 'confirmed', reviewed_by: t.userId },
    ]);
    expect(offering!.situations.map((entry) => entry.value)).toEqual(['wet trails']);
    expect(offering!.exclusions).toEqual([{ first: 'wide fit', second: 'wet trails' }]);

    const confirmed = await call<BusinessMap>('/business-map', {
      method: 'PUT',
      body: { offerings: [{ offering: 'running shoes', attributes: [{ value: 'Waterproof' }] }] },
    });
    expect(confirmed.body.offerings[0]!.attributes).toMatchObject([
      {
        value: 'Waterproof',
        origin: 'model',
        review_state: 'confirmed',
        reviewed_by: t.userId,
        source: { transport_model: 'fake-model' },
      },
    ]);
    expect(await call<BusinessMap>('/business-map')).toMatchObject({ body: confirmed.body });
    // Only the map key changed; other persisted facts are untouched.
    expect((await call<BrandProfile>('/brand-profile')).body.business_context).toMatchObject({
      category: 'footwear',
    });
  });

  it('rejects unknown or repeated offerings and dangling exclusions without writing', async () => {
    await profile();
    const put = (offerings: unknown[]) =>
      call<{ error: { message: string } }>('/business-map', { method: 'PUT', body: { offerings } });
    expect(await put([{ offering: 'laptops' }])).toMatchObject({
      status: 422,
      body: { error: { message: `"laptops" is not one of this brand's offerings` } },
    });
    expect((await put([{ offering: 'sandals' }, { offering: 'Sandals' }])).status).toBe(422);
    const dangling = await put([
      {
        offering: 'sandals',
        attributes: [{ value: 'light' }],
        exclusions: [{ first: 'light', second: 'heavy' }],
      },
    ]);
    expect(dangling.status).toBe(422);
    expect((await put([{ offering: 'sandals', attributes: [{ value: '  ' }] }])).status).toBe(422);
    expect((await call<BusinessMap>('/business-map')).body.offerings).toEqual([]);
  });
});

describe('competitor suggestions', () => {
  it('lists pending suggestions by evidence strength', async () => {
    const auditId = await fixtures.audit(t);
    const weak = await suggestion({ name: 'Weak', domain: 'weak.example', auditId });
    const strong = await suggestion({
      name: 'Strong',
      domain: 'strong.example',
      prompts: 5,
      auditId,
    });
    await suggestion({ name: 'Done', domain: 'done.example', status: 'accepted', auditId });
    const listed = await call<ObservedCompetitor[]>('/competitor-suggestions');
    expect(listed.body.map((row) => row.id)).toEqual([strong, weak]);
    expect(listed.body[0]).toMatchObject({ audit_id: auditId, source_artifact_ids: [] });
  });

  it('reuses a tracked competitor, adds new ones within the ceiling, and records the decision', async () => {
    const auditId = await fixtures.audit(t);
    const existing = await fixtures.competitor(t.projectId, {
      name: 'Globex',
      domains: ['globex.example'],
    });
    const byName = await suggestion({ name: 'GLOBEX', domain: 'globex.co', auditId });
    const reused = await call<Competitor>(`/competitor-suggestions/${byName}/accept`, {
      method: 'POST',
    });
    expect(reused.body).toMatchObject({ id: existing, name: 'Globex' });

    const fresh = await suggestion({ name: 'Initech', domain: 'initech.example', auditId });
    const added = await call<Competitor>(`/competitor-suggestions/${fresh}/accept`, {
      method: 'POST',
    });
    expect(added.body).toMatchObject({
      name: 'Initech',
      aliases: ['Initech'],
      domains: ['initech.example'],
      logo_url: null,
    });
    expect((await call<ObservedCompetitor[]>('/competitor-suggestions')).body).toEqual([]);

    for (const name of ['Three', 'Four', 'Five'])
      await fixtures.competitor(t.projectId, { name, domains: [`${name}.example`] });
    const overflow = await suggestion({ name: 'Six', domain: 'six.example', auditId });
    const refused = await call(`/competitor-suggestions/${overflow}/accept`, { method: 'POST' });
    expect(refused.status).toBe(409);
    const competitors = await db
      .selectFrom('competitors')
      .select('name')
      .where('project_id', '=', t.projectId)
      .execute();
    expect(competitors).toHaveLength(5);
    expect(
      (await call(`/competitor-suggestions/${randomUUID()}/accept`, { method: 'POST' })).status,
    ).toBe(404);
  });

  it('never adds a competitor twice when the same suggestion is accepted concurrently', async () => {
    const auditId = await fixtures.audit(t);
    const id = await suggestion({ name: 'Hooli', domain: 'hooli.example', auditId });
    const [one, two] = await Promise.all([
      call<Competitor>(`/competitor-suggestions/${id}/accept`, { method: 'POST' }),
      call<Competitor>(`/competitor-suggestions/${id}/accept`, { method: 'POST' }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.id).toBe(two.body.id);
  });
});

describe('logos', () => {
  const png = Buffer.from('89504e470d0a1a0a6173736574', 'hex');

  it('serves cached marks through the path project, with validators and sandboxing', async () => {
    const brandId = await brand();
    const competitorId = await fixtures.competitor(t.projectId, { name: 'Globex' });
    await readyLogo('brands', brandId, png);
    await readyLogo('competitors', competitorId, png);
    // A second workspace the caller joined: an <img> sends no workspace header.
    const owner = await fixtures.user();
    const second = await fixtures.ownedWorkspace(owner);
    await fixtures.member(second, t.userId, 'viewer');
    await db
      .updateTable('projects')
      .set({ workspace_id: second })
      .where('id', '=', t.projectId)
      .execute();

    const served = await request('/logo', { workspace: null });
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);
    const etag = `"${createHash('sha256').update(png).digest('hex')}"`;
    expect(Object.fromEntries(served.headers)).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=86400',
      'content-security-policy': "default-src 'none'; sandbox",
      etag,
      'x-content-type-options': 'nosniff',
    });
    const unchanged = await request('/logo', {
      workspace: null,
      headers: { 'if-none-match': etag },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('etag')).toBe(etag);
    const competitor = await request(`/competitors/${competitorId}/logo`, { workspace: null });
    expect(competitor.status).toBe(200);

    const outsider = await fixtures.user();
    expect((await request('/logo', { workspace: null, user: outsider })).status).toBe(404);
  });

  it('is missing until an asset is ready', async () => {
    await fixtures.brand(t.projectId, 'Acme', true);
    expect((await request('/logo')).status).toBe(404);
    expect((await request(`/competitors/${randomUUID()}/logo`)).status).toBe(404);
  });
});
