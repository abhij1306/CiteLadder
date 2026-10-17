import { describe, expect, it } from 'vite-plus/test';

import { evidenceFacts } from './issue-evidence';

// Every evidence blob below is a verbatim row from a real persisted crawl
// (hiutdenim.co.uk, 200 pages) — the shapes these formatters have to survive.
describe('evidenceFacts', () => {
  it('names the absent notations rather than restating the title', () => {
    expect(
      evidenceFacts('aeo.structured_data_present', {
        types: [],
        block_count: 0,
        has_json_ld: false,
        has_microdata: false,
      }),
    ).toEqual(['JSON-LD', 'Microdata']);
    expect(
      evidenceFacts('aeo.open_graph_present', {
        has_og_title: false,
        property_count: 0,
        has_og_description: false,
      }),
    ).toEqual(['og:title', 'og:description']);
    expect(
      evidenceFacts('technical.canonical_present', { present: false, canonical_url: '' }),
    ).toEqual(['<link rel="canonical">']);
  });

  it('lists the failing link targets for the emitted link rules', () => {
    const evidence = {
      failing_targets: [{ url: 'https://example.test/gone', status_code: 404 }],
      rate_limited_targets: [],
    };
    for (const rule of ['technical.broken_internal_link', 'technical.sitemap_url_unreachable'])
      expect(evidenceFacts(rule, evidence)).toEqual(['https://example.test/gone → 404']);
  });

  it('spells redirects as where they land, and an abandoned one as a loop', () => {
    const evidence = {
      failing_targets: [
        { url: 'https://example.test/old', final_url: 'https://example.test/new', hops: 1 },
        { url: 'https://example.test/older', final_url: 'https://example.test/new', hops: 3 },
        { url: 'https://example.test/loop', reason: 'redirect_limit' },
      ],
    };
    for (const rule of ['technical.internal_link_redirect', 'technical.redirect_chain'])
      expect(evidenceFacts(rule, evidence)).toEqual([
        'https://example.test/old → https://example.test/new',
        'https://example.test/older → https://example.test/new (3 hops)',
        'https://example.test/loop → redirect loop',
      ]);
  });

  it('names the canonical target’s state and the duplicate pages', () => {
    expect(
      evidenceFacts('technical.canonical_integrity', {
        reason: 'canonical_chain',
        target_url: 'https://example.test/a',
        target_canonical_url: 'https://example.test/b',
      }),
    ).toEqual(['https://example.test/a → canonical https://example.test/b']);
    expect(
      evidenceFacts('technical.duplicate_content', {
        reason: 'exact_duplicate',
        duplicates: [{ url: 'https://example.test/copy', match: 'exact', distance: 0 }],
      }),
    ).toEqual(['https://example.test/copy (exact)']);
    expect(
      evidenceFacts('technical.sitemap_lastmod', {
        reason: 'sitemap_lastmod_stale',
        sitemap_lastmod: '2025-01-01',
        page_dates: ['2026-09-01'],
      }),
    ).toEqual(['lastmod 2025-01-01', 'page dated 2026-09-01']);
    expect(
      evidenceFacts('technical.client_side_redirect', {
        reason: 'meta_refresh_redirect',
        target_url: 'https://example.test/new',
      }),
    ).toEqual(['<meta http-equiv="refresh"> → https://example.test/new']);
  });

  it('stays silent about the signal that passed', () => {
    expect(
      evidenceFacts('aeo.content_date_present', { has_published: true, has_modified: false }),
    ).toEqual(['dateModified']);
  });

  it('names the missing currency without inventing an expiry requirement', () => {
    expect(
      evidenceFacts('aeo.offer_freshness_signal', {
        offer: true,
        reason: 'offer_currency_missing',
        currency: [],
        timestamp: '',
        expiry_state: 'not_declared',
      }),
    ).toEqual(['priceCurrency']);
  });

  it('distinguishes absent offers from an expired declared offer', () => {
    expect(
      evidenceFacts('aeo.offer_freshness_signal', {
        offer: false,
        currency: [],
        timestamp: '',
        reason: 'offer_state_missing',
      }),
    ).toEqual(['Offer']);
    expect(
      evidenceFacts('aeo.offer_freshness_signal', {
        offer: true,
        currency: ['USD'],
        timestamp: '2025-01-01',
        expiry_state: 'expired',
      }),
    ).toEqual(['priceValidUntil 2025-01-01 (expired)']);
  });

  it('reports incomplete structures only as precisely as the evidence allows', () => {
    expect(
      evidenceFacts('aeo.organization_identity', { has_organization: true, identities: [] }),
    ).toEqual(['Organization identity incomplete (name and URL required)']);
    expect(evidenceFacts('aeo.listing_item_facts', { item_fact_count: 0, items: [] })).toEqual([
      'No listing item with both title and URL',
    ]);
    expect(
      evidenceFacts('aeo.heading_hierarchy', { reason: 'heading_outline_unavailable' }),
    ).toEqual(['heading outline unavailable']);
  });

  it('shows observed AEO heading skips and preserves unknown historical evidence', () => {
    expect(
      evidenceFacts('aeo.heading_hierarchy', {
        skips: [
          { from: 1, to: 3 },
          { from: 3, to: 5 },
          { from: 1, to: 3 },
        ],
      }),
    ).toEqual(['h1 → h3 ×2', 'h3 → h5']);
    expect(evidenceFacts('aeo.heading_hierarchy', { skips: [] })).toEqual([]);
  });

  it('identifies each offending control by selector, never by ordinal', () => {
    expect(
      evidenceFacts('web.accessibility_form_names', {
        control_count: 16,
        missing_accessible_name: 2,
        missing_control_descriptors: [
          { id: '', tag: 'input', name: 'q', type: 'search', ordinal: 5 },
          { id: '', tag: 'select', name: '', type: 'select', ordinal: 16 },
        ],
      }),
    ).toEqual(['input[name="q"]', 'select']);
  });

  it('prefers an id, then a name, then a type when naming a control', () => {
    expect(
      evidenceFacts('web.accessibility_form_names', {
        missing_control_descriptors: [
          { tag: 'input', id: 'search', name: 'q', type: 'text' },
          { tag: 'input', id: '', name: '', type: 'email' },
          { tag: 'textarea', id: '', name: '', type: 'textarea' },
        ],
      }),
    ).toEqual(['input[id="search"]', 'input[type="email"]', 'textarea']);
  });

  it('produces selectors that locate controls with CSS-special attribute values', () => {
    const root = document.createElement('div');
    const identified = document.createElement('input');
    identified.id = 'search:input';
    const named = document.createElement('input');
    named.name = 'a"b\\c\nd';
    root.append(identified, named);
    const selectors = evidenceFacts('web.accessibility_form_names', {
      missing_control_descriptors: [
        { tag: 'input', id: identified.id },
        { tag: 'input', name: named.name },
      ],
    });
    expect(root.querySelector(selectors[0]!)).toBe(identified);
    expect(root.querySelector(selectors[1]!)).toBe(named);
  });

  it('tallies a repeated heading skip instead of repeating the line', () => {
    expect(
      evidenceFacts('web.accessibility_heading_order', {
        level_skips: 4,
        heading_levels: [1, 4, 1, 4, 1, 4, 3, 5],
        skips: [
          { to: 4, from: 1, scope: 'full_document' },
          { to: 4, from: 1, scope: 'full_document' },
          { to: 4, from: 1, scope: 'full_document' },
          { to: 5, from: 3, scope: 'full_document' },
        ],
      }),
    ).toEqual(['h1 → h4 ×3', 'h3 → h5']);
  });

  it('writes missing schema properties in dotted schema.org notation', () => {
    expect(
      evidenceFacts('aeo.schema_required_valid', {
        schema_type: 'Product',
        expected_types: ['Product'],
        missing: ['offers.priceCurrency', 'offers.availability'],
        checked_blocks: 1,
      }),
    ).toEqual(['Product.offers.priceCurrency', 'Product.offers.availability']);
  });

  it('states a schema mismatch as expected versus found', () => {
    expect(
      evidenceFacts('aeo.schema_matches_content', {
        expected_types: ['Product'],
        found_types: ['Article'],
      }),
    ).toEqual(['Product expected, Article found']);
  });

  it('names only the unmet atoms of a composite contract', () => {
    expect(
      evidenceFacts('aeo.product_answer_facts', {
        threshold: 'all_required_and_applicable',
        atoms: [
          { name: 'identity', outcome: 'missing', required: true },
          { name: 'offer', outcome: 'satisfied', required: true },
          { name: 'availability', outcome: 'missing', required: true },
          { name: 'variants', outcome: 'not_applicable', required: false },
        ],
      }),
    ).toEqual(['identity', 'availability']);
  });

  it('keeps the numbers that ARE the finding', () => {
    expect(evidenceFacts('technical.ttfb_band', { ttfb_ms: 828, threshold_ms: 800 })).toEqual([
      '828 ms · budget 800 ms',
    ]);
    expect(
      evidenceFacts('web.accessibility_image_alt', {
        image_count: 12,
        missing_alt: 3,
        decorative_alt: 1,
      }),
    ).toEqual(['alt ×3']);
  });

  it('falls back to the evaluator reason when a check is about a relationship', () => {
    expect(
      evidenceFacts('aeo.question_headings', { reason: 'no_question_answer_relationships' }),
    ).toEqual(['no question answer relationships']);
  });

  it('never leaks identifiers through the unknown-rule fallback', () => {
    expect(
      evidenceFacts('architecture.something_new', {
        count: 2,
        site_url_ids: ['e123eceb-5eeb-48ef-9942-74b056817a0e'],
        evaluation_id: 'a3dc635f-ee46-4014-bf3e-2dd700458c29',
      }),
    ).toEqual(['count 2']);
  });

  it('says nothing when nothing can be said without inventing it', () => {
    expect(evidenceFacts('aeo.product_brand_identity', { brands: [], visible_brands: [] })).toEqual(
      ['brand'],
    );
    expect(evidenceFacts('technical.unknown_rule', {})).toEqual([]);
  });
});
