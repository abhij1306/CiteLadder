import { businessModelSchema } from '@citeladder/contracts/project';
import { describe, expect, it } from 'vite-plus/test';

import type { BrandProfile, BusinessMap } from '@citeladder/contracts';
import { BUSINESS_MODEL_CHOICES } from '@/lib/project/identity-facets';

import {
  acceptAll,
  businessDraft,
  mapChanges,
  personaChoices,
  profileChanges,
  showsServiceAreas,
  suggestionCount,
  withField,
  withOfferings,
} from './builder-business';

const NET = 'Golf practice net (self-standing frame, for gardens, and clubs)';
const MAT = 'Hitting mat';
const noSources = {
  description: null,
  positioning: null,
  products_services: null,
  target_audience: null,
};
const profile: BrandProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  project_id: '33333333-3333-4333-8333-333333333333',
  brand_id: '44444444-4444-4444-8444-444444444444',
  description: '',
  positioning: '',
  target_audience: '',
  products_services: [NET, MAT],
  business_context: {
    buyer_roles: ['Club coach'],
    service_areas: ['Leeds'],
    category_terms: ['golf net'],
    business_model: 'd2c_product',
    market_scope: 'regional',
  },
  sources: noSources,
  source_artifact_ids: noSources,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const entry = (value: string, review_state: 'suggested' | 'confirmed') => ({
  value,
  origin: 'model' as const,
  review_state,
  reviewed_by: null,
  reviewed_at: null,
  source: {},
});
const map: BusinessMap = {
  available_offerings: [NET, MAT],
  offerings: [
    {
      offering: NET,
      attributes: [entry('self-standing frame', 'confirmed')],
      situations: [entry('small garden', 'suggested')],
      audiences: [entry('Beginner golfers', 'confirmed')],
      exclusions: [{ first: 'self-standing frame', second: 'small garden' }],
    },
  ],
};
const draft = () => businessDraft(profile, map);

describe('the business step draft', () => {
  it('reads saved knowledge, keeping an offering with commas as one offering', () => {
    const saved = draft();
    expect(saved.offerings).toEqual([NET, MAT]);
    expect(saved).toMatchObject({
      buyerRoles: ['Club coach'],
      serviceAreas: ['Leeds'],
      categoryTerms: ['golf net'],
      jobs: [],
      businessModel: 'd2c_product',
    });
    expect(saved.maps.map((item) => [item.offering, item.situations])).toEqual([
      [NET, [{ value: 'small garden', review_state: 'suggested' }]],
      [MAT, []],
    ]);
    expect(showsServiceAreas(profile.business_context)).toBe(true);
    expect(showsServiceAreas({ market_scope: 'national' })).toBe(false);
  });

  it('sends each owner only what changed', () => {
    const saved = draft();
    expect(profileChanges(saved, saved)).toEqual({});
    expect(mapChanges(saved, saved)).toBeNull();
    const edited = { ...withOfferings(saved, [NET], map), jobs: ['practise at home'] };
    expect(profileChanges(edited, saved)).toEqual({
      products_services: [NET],
      jobs_to_be_done: ['practise at home'],
    });
    expect(mapChanges(edited, saved)).toBeNull();
  });

  it('keeps suggestions suggested and drops exclusions that name a removed entry', () => {
    const saved = draft();
    const [net, mat] = saved.maps;
    if (!net || !mat) throw new Error('fixture maps missing');
    const edited = {
      ...saved,
      maps: [
        { ...net, situations: [] },
        { ...mat, audiences: [{ value: 'Clubs', review_state: 'confirmed' as const }] },
      ],
    };
    expect(mapChanges(edited, saved)).toEqual({
      offerings: [
        {
          offering: NET,
          attributes: [{ value: 'self-standing frame', review_state: 'confirmed' }],
          situations: [],
          audiences: [{ value: 'Beginner golfers', review_state: 'confirmed' }],
          exclusions: [],
        },
        {
          offering: MAT,
          attributes: [],
          situations: [],
          audiences: [{ value: 'Clubs', review_state: 'confirmed' }],
          exclusions: [],
        },
      ],
    });
    expect(personaChoices(edited)).toEqual(['Club coach', 'Beginner golfers', 'Clubs']);
  });

  it('saves an attribute edit on its own, keeping the other offerings as saved', () => {
    const saved = draft();
    const [net, mat] = saved.maps;
    if (!net || !mat) throw new Error('fixture maps missing');
    const edited = {
      ...saved,
      maps: [{ ...net, attributes: [] }, mat],
    };
    expect(mapChanges(edited, saved)).toEqual({
      offerings: [
        {
          offering: NET,
          attributes: [],
          situations: [{ value: 'small garden', review_state: 'suggested' }],
          audiences: [{ value: 'Beginner golfers', review_state: 'confirmed' }],
          exclusions: [],
        },
        { offering: MAT, attributes: [], situations: [], audiences: [], exclusions: [] },
      ],
    });
  });

  it('accepts what discovery inferred and the map suggested, sending an accepted field unchanged', () => {
    const saved = businessDraft(
      {
        ...profile,
        business_context: {
          ...profile.business_context,
          field_sources: {
            buyer_roles: 'inferred',
            service_areas: 'reviewed',
            category_terms: 'reviewed',
            business_model: 'reviewed',
          },
        },
      },
      map,
    );
    expect(saved.suggested).toEqual(['buyerRoles']);
    expect(suggestionCount(saved)).toBe(2);
    const hidden = {
      buyer_roles: 'reviewed',
      category_terms: 'reviewed',
      business_model: 'reviewed',
    };
    const regional = businessDraft(
      { ...profile, business_context: { ...profile.business_context, field_sources: hidden } },
      map,
    );
    const national = businessDraft(
      {
        ...profile,
        business_context: {
          ...profile.business_context,
          market_scope: 'national',
          field_sources: hidden,
        },
      },
      map,
    );
    expect(regional.suggested).toEqual(['serviceAreas']);
    expect(national.suggested).toEqual([]);

    const accepted = acceptAll(saved);
    expect(suggestionCount(accepted)).toBe(0);
    expect(profileChanges(accepted, saved)).toEqual({ buyer_roles: ['Club coach'] });
    expect(mapChanges(accepted, saved)?.offerings?.[0]?.situations).toEqual([
      { value: 'small garden', review_state: 'confirmed' },
    ]);
    const edited = withField(saved, 'buyerRoles', ['Club coach', 'Parent']);
    expect(edited.suggested).toEqual([]);
    expect(profileChanges(edited, saved)).toEqual({ buyer_roles: ['Club coach', 'Parent'] });
  });

  it('labels every business model the API accepts', () => {
    expect(BUSINESS_MODEL_CHOICES.map((choice) => choice.value)).toEqual(
      businessModelSchema.options,
    );
  });
});
