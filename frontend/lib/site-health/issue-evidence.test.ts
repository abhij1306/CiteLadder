import { describe, expect, it } from 'vite-plus/test';

import { evidenceFacts, evidenceLead } from './issue-evidence';
import { siteLevelEvidence } from './site-level-evidence';

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
    expect(evidenceFacts('technical.sitemap_url_unreachable', evidence)).toEqual([
      'https://example.test/gone → 404',
    ]);
    // A link on the page reads as its path, under a lead naming where it is.
    expect(evidenceFacts('technical.broken_internal_link', evidence)).toEqual(['/gone → 404']);
    expect(evidenceLead('technical.broken_internal_link')).toBe('Broken links on this page:');
  });

  it('collapses quick-view query variants of one link into one fact', () => {
    // A store testimonials page: each product link also appears as `?qv=…`.
    const broken = {
      failing_targets: [
        { url: 'https://www.acme.com/products/launch-monitor-copy', status_code: 404 },
        {
          url: 'https://www.acme.com/products/launch-monitor-copy?qv=wtOxjLNNI',
          status_code: 404,
        },
        {
          url: 'https://www.acme.com/products/replacement-poles-pro-v2',
          status_code: 404,
        },
      ],
    };
    expect(evidenceFacts('technical.broken_internal_link', broken)).toEqual([
      '/products/launch-monitor-copy → 404 (+1 variant)',
      '/products/replacement-poles-pro-v2 → 404',
    ]);
  });

  it('labels a redirecting link as a link on the page, naming a link back to the page itself', () => {
    const page = 'https://www.acme.com/products/pro-series-net';
    const evidence = {
      failing_targets: [
        {
          url: 'https://www.acme.com/products/pro-series-v2-8w-x-7-6h',
          final_url: page,
          hops: 1,
        },
        {
          url: 'https://www.acme.com/products/pro-series-v2-8w-x-7-6h?qv=2OzuEOe-o',
          final_url: `${page}?qv=2OzuEOe-o`,
          hops: 1,
        },
        {
          url: 'https://www.acme.com/products/pro-series-v2-8w-x-7-6h?qv=3YGN4AHYY',
          final_url: `${page}?qv=3YGN4AHYY`,
          hops: 1,
        },
        {
          url: 'https://www.acme.com/collections/old',
          final_url: 'https://www.acme.com/collections/new',
          hops: 2,
        },
      ],
    };
    expect(evidenceFacts('technical.internal_link_redirect', evidence, { pageUrl: page })).toEqual([
      '/products/pro-series-v2-8w-x-7-6h → this page (+2 variants)',
      '/collections/old → /collections/new (2 hops)',
    ]);
    expect(evidenceLead('technical.internal_link_redirect')).toBe(
      'Links on this page that redirect:',
    );
    expect(evidenceLead('technical.redirect_chain')).toBeNull();
  });

  it('names a noindex directive and why the page was meant to be indexed', () => {
    // A store collection page, verbatim minus context ids and the store name.
    expect(
      evidenceFacts('technical.indexable', {
        noindex: true,
        nofollow: false,
        canonical_url: 'https://www.acme.com/collections/all-store-products',
        intent_source: 'sitemap_membership',
        indexing_intent: 'intended_index',
        canonical_matches_final_url: true,
      }),
    ).toEqual(['noindex', 'listed in sitemap.xml']);
    expect(
      evidenceFacts('technical.indexable', {
        noindex: true,
        nofollow: true,
        intent_source: 'page_directive',
      }),
    ).toEqual(['noindex, nofollow']);
  });

  it('reads a site-level architecture finding as the pages it names', () => {
    const evidence = {
      count: 11,
      pages: [
        {
          url: 'https://www.acme.com/blogs/news/june-contest-winner-announced',
          title: 'June - "Win-a-Net" Contest Winner Announced',
          page_kind: 'article',
          site_url_id: 'a80abae1-a069-4f97-a5bd-76d3fc7d041a',
          depth_from_home: 5,
        },
      ],
      coverage_state: 'complete',
    };
    expect(evidenceFacts('architecture.excessive_depth', evidence)).toEqual([
      '/blogs/news/june-contest-winner-announced (5 clicks)',
    ]);
    expect(evidenceFacts('architecture.orphan_pages', evidence)).toEqual([
      '/blogs/news/june-contest-winner-announced',
    ]);
    expect(siteLevelEvidence('architecture.excessive_depth', evidence)).toEqual({
      kind: 'pages',
      total: 11,
      pages: [
        {
          siteUrlId: 'a80abae1-a069-4f97-a5bd-76d3fc7d041a',
          url: 'https://www.acme.com/blogs/news/june-contest-winner-announced',
          title: 'June - "Win-a-Net" Contest Winner Announced',
          pageKind: 'article',
          clicksFromHome: 5,
        },
      ],
      sections: [],
    });
    expect(
      siteLevelEvidence('architecture.unhubbed_page_kind', {
        count: 1,
        page_kinds: [{ page_kind: 'product', page_count: 40, site_url_ids: [] }],
      }),
    ).toEqual({ kind: 'page_kinds', pageKinds: [{ pageKind: 'product', pageCount: 40 }] });
    expect(siteLevelEvidence('technical.indexable', { noindex: true })).toBeNull();
  });

  it('reads unreachable pages as the sections they sit in', () => {
    const evidence = {
      count: 159,
      pages: [],
      sections: [
        {
          path_prefix: '/blogs/testimonials',
          page_count: 158,
          example_url: 'https://shop.example/blogs/testimonials',
        },
        {
          path_prefix: '/collections/junior',
          page_count: 1,
          example_url: 'https://shop.example/collections/junior',
        },
      ],
    };
    expect(evidenceFacts('architecture.unreachable_from_home', evidence)).toEqual([
      '/blogs/testimonials (158 pages)',
      '/collections/junior (1 page)',
    ]);
    expect(evidenceLead('architecture.unreachable_from_home')).toBe('Unreachable sections:');
  });

  it('reads a sitewide link finding as each link, where it lands, and the pages carrying it', () => {
    const page = {
      site_url_id: 'a80abae1-a069-4f97-a5bd-76d3fc7d041a',
      url: 'https://shop.example/',
      title: 'Example Shop',
      page_kind: 'homepage',
      artifact_id: '0b1c6a42-5a50-4f3c-9d8e-2f6f1f0c0e11',
    };
    const evidence = {
      count: 438,
      targets: [
        {
          url: 'https://shop.example/collections/trail-shoes',
          final_url: 'https://shop.example/collections/running/',
          hops: 1,
          linking_page_count: 438,
          pages: [page],
        },
      ],
    };
    expect(evidenceFacts('technical.sitewide_link_redirect', evidence)).toEqual([
      '/collections/trail-shoes → /collections/running/ (on 438 pages)',
    ]);
    expect(
      evidenceFacts('technical.sitewide_broken_link', {
        count: 6,
        targets: [
          { url: 'https://example.test/gone', status_code: 404, linking_page_count: 6, pages: [] },
        ],
      }),
    ).toEqual(['/gone → 404 (on 6 pages)']);
    expect(siteLevelEvidence('technical.sitewide_link_redirect', evidence)).toEqual({
      kind: 'link_targets',
      total: 438,
      targets: [
        {
          url: 'https://shop.example/collections/trail-shoes',
          outcome: {
            kind: 'redirect',
            finalUrl: 'https://shop.example/collections/running/',
            hops: 1,
          },
          pageCount: 438,
          pages: [
            {
              siteUrlId: 'a80abae1-a069-4f97-a5bd-76d3fc7d041a',
              url: 'https://shop.example/',
              title: 'Example Shop',
              pageKind: 'homepage',
              clicksFromHome: null,
            },
          ],
        },
      ],
    });
    // An unrecorded count stays unknown rather than reading as no pages.
    expect(
      siteLevelEvidence('technical.sitewide_broken_link', { reason: 'unchecked_targets' }),
    ).toEqual({ kind: 'link_targets', total: null, targets: [] });
  });

  it('spells redirects as where they land, and an abandoned one as a loop', () => {
    const evidence = {
      failing_targets: [
        { url: 'https://example.test/old', final_url: 'https://example.test/new', hops: 1 },
        { url: 'https://example.test/older', final_url: 'https://example.test/new', hops: 3 },
        { url: 'https://example.test/loop', reason: 'redirect_limit' },
      ],
    };
    expect(evidenceFacts('technical.redirect_chain', evidence)).toEqual([
      'https://example.test/old → https://example.test/new',
      'https://example.test/older → https://example.test/new (3 hops)',
      'https://example.test/loop → redirect loop',
    ]);
    expect(evidenceFacts('technical.internal_link_redirect', evidence)).toEqual([
      '/old → /new',
      '/older → /new (3 hops)',
      '/loop → redirect loop',
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
