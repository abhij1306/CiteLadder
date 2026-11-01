import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { analyzePage } from '../src/site-health/analysis/analyze-page.ts';
import { extractPageFacts } from '../src/site-health/analysis/facts.ts';
import { isMetadataOrCta } from '../src/site-health/analysis/copy.ts';
import { document, elements } from '../src/web-evidence/html.ts';
import { extractFactsAsync, analyzePageAsync } from '../src/site-health/analysis/off-thread.ts';
import { factSettings } from '../src/site-health/analysis/facts.ts';
import { classify } from '../src/site-health/analysis/page-kinds.ts';
import {
  createsIssue,
  evaluatePageRules,
  type RuleEvaluation,
} from '../src/site-health/analysis/rules.ts';
import { deriveTraits } from '../src/site-health/analysis/traits.ts';
import calibration from './fixtures/site-health/classifier-calibration.json' with { type: 'json' };

const analysis = policy.site_health.page_analysis;
const context = { sitemapMember: false, siteFacts: null, auditTime: null };
const facts = (html: string, url = 'https://example.test/page', contentType = 'text/html') =>
  extractPageFacts(Buffer.from(html), { finalUrl: url, contentType, statusCode: 200 });
const byRule = (rows: RuleEvaluation[]) => new Map(rows.map((row) => [row.rule_id, row]));
const evaluations = (html: string, url?: string) =>
  byRule(analyzePage(facts(html, url), context).evaluations);
const atom = (row: RuleEvaluation, name: string) =>
  (
    row.evidence.atoms as { name: string; outcome: string; evidence: Record<string, unknown> }[]
  ).find((item) => item.name === name)!;
// One copy of each recorded page, shared with the dev seed transports.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/site-health/${name}`, import.meta.url));
const fixtureFacts = (name: string, url: string) =>
  extractPageFacts(fixture(name), { finalUrl: url, contentType: 'text/html' });

describe('page checklist', () => {
  it('keeps blog archives separate from authored articles and product categories', () => {
    const cards = Array.from(
      { length: 9 },
      (_, index) =>
        `<article><h3><a href='/blog/post-${index}'>Post ${index}</a></h3><p>Card summary.</p></article>`,
    ).join('');
    const page = facts(
      `<main><h1>Practical guides</h1><div>
      <section><div><h2>Topics</h2><p>Choose a topic to explore.</p><a href='/contact'>Contact</a></div></section>
      <section><div><h2>Latest articles</h2><div>${cards}</div></div></section>
      <section><div><h2>Start here</h2><p>Read our introduction.</p><a href='/intro'>Introduction</a></div></section>
    </div></main>`,
      'https://example.test/blog',
    );
    const result = analyzePage(page, context);
    expect(result.assessment.page_kind).toBe('editorial_index');
    expect(page.primary_heading_outline.map((heading) => heading.text)).toEqual([
      'Practical guides',
      'Topics',
      'Latest articles',
      'Start here',
    ]);
    expect(page.primary_content_text).toContain('Choose a topic');
    expect(page.primary_content_text).not.toContain('Card summary');
    const rows = byRule(result.evaluations);
    for (const id of [
      'aeo.visible_attribution',
      'aeo.source_support_present',
      'aeo.listing_item_facts',
    ])
      expect(rows.get(id)!.outcome, id).toBe('not_applicable');
    expect(rows.get('aeo.heading_hierarchy')!.outcome).toBe('satisfied');
    expect(rows.get('aeo.listing_answer_set')!.outcome).toBe('satisfied');
  });

  it('preserves a page-identity wrapper instead of treating linked sections as cards', () => {
    const page = facts(`<main><div>
      <section><div><h1>Guide library</h1><a href='/start'>Start</a></div></section>
      <section><div><h2>Topics</h2><a href='/topics'>Topics</a></div></section>
      <section><div><h2>Contact</h2><a href='/contact'>Contact</a></div></section>
    </div></main>`);
    expect(page.primary_heading_outline.map((heading) => heading.text)).toEqual([
      'Guide library',
      'Topics',
      'Contact',
    ]);
  });

  it('keeps a filtered editorial archive out of commerce checks and does not trust Blog markup alone', () => {
    const page = facts(
      `<main><h1>Latest articles</h1><section><p role='status'>9 results</p>
      <div class='collection-grid'>${Array.from({ length: 9 }, (_, index) => `<article><a href='/blog/post-${index}'>Post ${index}</a></article>`).join('')}</div>
    </section></main>`,
      'https://example.test/en/blog/',
    );
    const result = analyzePage(page, context);
    expect(result.assessment.page_kind).toBe('editorial_index');
    expect(result.assessment.evidence.classified_by).toBe('primary_listing_structure');
    expect(byRule(result.evaluations).get('aeo.listing_item_facts')!.outcome).toBe(
      'not_applicable',
    );
    expect(
      classify('https://example.test/unknown', { structured_data: { types: ['Blog'] } }).page_kind,
    ).toBe('other');
  });

  it('does not infer authorship from an editorial URL alone but checks an observed article body', () => {
    const prose =
      'This article explains how teams can review their website evidence and choose practical improvements with a clear record of their observations.';
    const inspect = (body: string) =>
      evaluations(
        `<main><h1>Website notes</h1>${body}</main>`,
        'https://example.test/blog/website-notes',
      );
    const unconfirmed = inspect(`<p>${prose}</p>`);
    const authored = inspect(`<article><h2>Review evidence</h2><p>${prose}</p></article>`);
    for (const id of ['aeo.visible_attribution', 'aeo.source_support_present']) {
      expect(unconfirmed.get(id)!.outcome).toBe('unknown');
      expect(createsIssue(unconfirmed.get(id)!)).toBe(false);
      expect(authored.get(id)!.outcome).toBe('missing');
      expect(createsIssue(authored.get(id)!)).toBe(true);
    }
  });

  it('reads a Title-Case heading as an author only inside an author container', () => {
    const legal = facts(
      `<main><h1>Privacy policy</h1><p class='updated'>Updated 2026-09-24</p>
      <h2>Overview</h2><p>We describe what we collect.</p><h2>Subprocessors</h2><p>Hosting.</p></main>`,
      'https://example.test/privacy',
    );
    expect(legal.authorship.visible_byline).toBe('');
    expect(analyzePage(legal, context).assessment.evidence.classified_by).not.toBe(
      'byline_and_date',
    );
    const authored = facts(
      `<main><h1>Notes</h1><div class='author-card'><h3>Jane Doe</h3></div><p>Body.</p></main>`,
    );
    expect(authored.authorship.visible_byline).toBe('Jane Doe');
  });

  it('reports actual primary heading skips and abstains when the outline is unavailable', () => {
    const headings = (body: string) =>
      evaluations(`<main><h1>Notes</h1>${body}</main>`, 'https://example.test/blog/notes').get(
        'aeo.heading_hierarchy',
      )!;
    expect(headings('<h2>First</h2><h3>Detail</h3><h2>Second</h2>').outcome).toBe('satisfied');
    const skipped = headings('<h3>First</h3><h5>Detail</h5>');
    expect(skipped.outcome).toBe('missing');
    expect(skipped.evidence.skips).toEqual([
      { from: 1, to: 3, text: 'First' },
      { from: 3, to: 5, text: 'Detail' },
    ]);
    const page = facts('<main><h1>Notes</h1></main>', 'https://example.test/blog/notes');
    for (const outline of [
      undefined,
      [],
      [{ text: 'Unknown level' }],
      [{ level: 0, text: 'Invalid level' }],
      [{ level: 7, text: 'Invalid level' }],
      [{ level: 2.5, text: 'Fractional level' }],
      [
        { level: 1, text: 'Known' },
        { level: 'bad', text: 'Unknown' },
      ],
    ]) {
      const row = byRule(
        analyzePage({ ...page, primary_heading_outline: outline }, context).evaluations,
      ).get('aeo.heading_hierarchy')!;
      expect(row.outcome).toBe('unknown');
      expect(createsIssue(row)).toBe(false);
    }
  });

  it('keeps interpretation off the calling loop while preserving page outcomes', async () => {
    const body = Buffer.from(
      '<main><h1>Widgets</h1><p>Widgets make workshop repairs easier.</p></main>',
    );
    const delivery = { finalUrl: 'https://example.test/page', contentType: 'text/html' };
    let timerRan = false;
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerRan = true;
        resolve();
      }, 0);
    });
    const extracted = await extractFactsAsync(body, delivery, factSettings({}));
    expect(timerRan).toBe(true);
    await timer;
    const interpreted = await analyzePageAsync(extracted, context);
    expect(interpreted).toEqual(
      analyzePage(extractPageFacts(body, delivery, factSettings({})), context),
    );
  });

  it('returns each concurrent interpretation to its own caller on the shared pool', async () => {
    const pages = ['/products/a', '/blog/b', '/pricing', '/contact', '/faq', '/about'].map(
      (path) => `https://example.test${path}`,
    );
    const body = (url: string) =>
      Buffer.from(
        `<html><head><title>${url}</title></head><body><main><h1>${url}</h1></main></body></html>`,
      );
    const results = await Promise.all(
      pages.map((url) =>
        extractFactsAsync(body(url), { finalUrl: url, contentType: 'text/html' }, factSettings({})),
      ),
    );
    expect(results.map((facts) => facts.title)).toEqual(pages);
  });

  it.each(['février 12, 2026', 'Март १२, २०२६'])(
    'excludes Unicode date metadata %s from prose',
    (date) => {
      const root = document(
        Buffer.from(`<main><p>${date}</p><p>Useful workshop advice.</p></main>`),
      );
      const paragraphs = [...elements(root, 'p')];
      expect(paragraphs.map(isMetadataOrCta)).toEqual([true, false]);
    },
  );

  it('retains prose that resembles a date without a month name', () => {
    const root = document(Buffer.from('<main><p>Product 12, 2026</p></main>'));
    expect(isMetadataOrCta([...elements(root, 'p')][0]!)).toBe(false);
  });

  it('does not mistake a protocol-relative host for a trust path', () => {
    const trust = (url: string) =>
      byRule(
        evaluatePageRules({
          ...facts(
            '<main><h1>Welcome</h1><p>We make useful workshop equipment for everyone.</p></main>',
          ),
          page_kind: 'homepage',
          site: {},
          links: { anchors: [{ is_internal: true, url, anchor_text: 'Browse' }] },
        }),
      ).get('aeo.trust_path_present')!;
    expect(trust('//privacy.example.test/shop').outcome).toBe('missing');
    expect(trust('//privacy.example.test/about').outcome).toBe('satisfied');
  });
  it('scores reported web failures on any page kind and still admits an unscored finding', () => {
    const result = analyzePage(
      facts(
        "<html><head><title>Page</title></head><body><main><a href='/missing'>Missing</a></main></body></html>",
      ),
      context,
    );
    expect(result.assessment.page_kind).toBe('other');
    const rows = byRule(result.evaluations);
    for (const id of [
      'technical.title_present',
      'web.accessibility_document_language',
      'web.mobile_viewport',
    ])
      expect(rows.get(id)!.score_roles).toContain('web_fundamentals');
    // Advisory: shown as an issue, never scored.
    const meta = rows.get('technical.meta_description_present')!;
    expect(meta.outcome).toBe('missing');
    expect(meta.score_roles).toEqual([]);
    expect(createsIssue(meta)).toBe(true);
  });

  it('never penalizes a purpose that only the URL suggests', () => {
    const rows = evaluations(
      '<html><head><title>Widget story</title></head><body><main><h1>Widget story</h1><p>How we designed the widget over three years of testing with customers.</p></main></body></html>',
      'https://example.test/products/widget-story',
    );
    for (const id of ['aeo.product_answer_facts', 'aeo.offer_freshness_signal'])
      expect(createsIssue(rows.get(id)!), id).toBe(false);
    const listing = evaluations(
      '<html><head><title>Summer story</title></head><body><main><h1>Summer story</h1><p>How the summer range came together after a year of sketches and fittings.</p></main></body></html>',
      'https://example.test/collections/summer-story',
    );
    expect(listing.get('aeo.listing_answer_set')!.evidence.reason).toBe('page_kind_unconfirmed');
  });

  it('requires a public price unless an explicit pricing action makes the product quote-led', () => {
    const product = (action: string) =>
      evaluations(
        `<html><head><title>Widget</title></head><body><main><h1>Widget</h1>${action}</main></body></html>`,
        'https://example.test/products/widget',
      );
    const priced = product('<button>Add to cart</button>').get('aeo.product_answer_facts')!;
    expect(priced.outcome).toBe('missing');
    expect(atom(priced, 'offer').outcome).toBe('missing');

    const quoted = product("<p>Built for your team.</p><a href='/quote'>Request a quote</a>");
    expect(atom(quoted.get('aeo.product_answer_facts')!, 'offer').outcome).toBe('satisfied');
    expect(quoted.get('aeo.product_answer_facts')!.evidence.quote_led).toBe(true);
    expect(quoted.get('aeo.offer_freshness_signal')!.outcome).toBe('not_applicable');

    for (const [label, quoteLed] of [
      ['Request a Quote', true],
      ['GET A QUOTE', true],
      ['Request pricing', true],
      ['Customer quotes', false],
      ['Read our quote policy', false],
    ] as const)
      expect(
        product(`<button>Add to cart</button><a href='/quotes'>${label}</a>`).get(
          'aeo.product_answer_facts',
        )!.evidence.quote_led,
        label,
      ).toBe(quoteLed);
  });

  it('keeps delivery failures on a truncated page but abstains on content absence', () => {
    const page = facts(
      '<html><body><main><h1>Page</h1><p>Observed content.</p></main></body></html>',
      'http://example.test/page',
    );
    page.extraction.truncated = true;
    const rows = byRule(analyzePage(page, context).evaluations);
    expect(rows.get('technical.https')!.outcome).toBe('missing');
    expect(rows.get('technical.https')!.reason_code).not.toBe('extraction_truncated');
    expect(rows.get('technical.title_present')).toMatchObject({
      outcome: 'unknown',
      reason_code: 'extraction_truncated',
    });
  });

  it('distinguishes an empty collection from one that was never captured', () => {
    const items = (body: string) =>
      atom(
        evaluations(
          `<html><head><title>Products</title></head><body><main><h1>Products</h1>${body}</main></body></html>`,
          'https://example.test/collections/products',
        ).get('aeo.listing_answer_set')!,
        'item_set',
      ).evidence;
    const empty = items('<p>No products found.</p>');
    const uncaptured = items('');
    expect(empty.empty_state).toBe(true);
    expect(uncaptured.empty_state).toBe(false);
  });

  it('separates authored offer-expiry faults from an unavailable audit time', () => {
    const freshness = (expiry: string, auditTime: string | null, quoteLed = false) =>
      byRule(
        evaluatePageRules({
          page_kind: 'product',
          has_html: true,
          structured_data: {
            product: { price: ['100'], price_currency: ['USD'], price_valid_until: [expiry] },
          },
          audit_time: auditTime,
          cta_text: quoteLed ? ['Request a quote'] : [],
        }),
      ).get('aeo.offer_freshness_signal')!;
    for (const [expiry, auditTime, quoteLed, outcome, reason] of [
      ['2026-10-01', null, false, 'unknown', 'audit_time_unavailable'],
      ['bad-date', null, false, 'missing', 'invalid_expiry'],
      ['2026-01-01', '2026-09-12T00:00:00Z', false, 'missing', 'expired'],
      ['2026-10-01', '2026-09-12T00:00:00Z', false, 'satisfied', undefined],
      ['', null, false, 'not_applicable', 'expiry_not_declared'],
      ['bad-date', null, true, 'not_applicable', 'quote_led_offer'],
    ] as const) {
      const row = freshness(expiry, auditTime, quoteLed);
      expect([row.outcome, row.evidence.reason], `${expiry} ${auditTime} ${quoteLed}`).toEqual([
        outcome,
        reason,
      ]);
    }
  });

  it('needs an available answer region before a question counts as answered', () => {
    const rows = evaluations(
      '<html><head><title>FAQ</title></head><body><main><h1>FAQ</h1><h2>What is it?</h2></main></body></html>',
      'https://example.test/faq',
    );
    expect(rows.get('aeo.question_headings')!.outcome).toBe('satisfied');
    expect(rows.get('aeo.answer_first')!.outcome).toBe('missing');
  });

  it('reads robots.txt absence as an advisory only on the site root', () => {
    const robots = (site: unknown) =>
      byRule(evaluatePageRules(site === undefined ? {} : { site })).get(
        'technical.robots_txt_present',
      )!;
    const root = (fetched: boolean, status: string, code: number) =>
      robots({
        robots: { fetched, status, status_code: code, url: 'https://example.com/robots.txt' },
      });
    expect(root(true, 'fetched', 200).outcome).toBe('satisfied');
    expect(root(false, 'fetched', 200).outcome).toBe('unknown');
    const missing = root(false, 'not_found', 404);
    expect(missing.outcome).toBe('missing');
    expect(createsIssue(missing)).toBe(true);
    // Unreadable is not evidence of absence.
    const unreadable = root(false, 'fetch_failed', 503);
    expect(unreadable.outcome).toBe('unknown');
    expect(createsIssue(unreadable)).toBe(false);
    expect(robots(undefined).outcome).toBe('not_applicable');
  });

  it('never reports an unrequested llms.txt as missing, and never scores it', () => {
    const llms = (fetched: boolean, present: boolean) =>
      byRule(
        evaluatePageRules({
          site: { llms_txt: { fetched, present, url: 'https://example.com/llms.txt' } },
        }),
      ).get('aeo.llms_txt_present')!;
    const unrequested = llms(false, false);
    expect(unrequested.outcome).toBe('unknown');
    expect(createsIssue(unrequested)).toBe(false);
    const absent = llms(true, false);
    expect(absent.outcome).toBe('missing');
    expect(absent.score_roles).toEqual([]);
  });
});

describe('primary schema entity', () => {
  const listing = (jsonLd: unknown, url = 'https://acme.test/blog', pageKind = 'category') => {
    const page = facts(
      `<html><head><title>Index</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><main><h1>Index</h1><p>Entries.</p></main></body></html>`,
      url,
    );
    const types = (page.structured_data.blocks as { type: string }[]).map((block) => block.type);
    return { page, types, rows: byRule(evaluatePageRules({ ...page, page_kind: pageKind })) };
  };
  const blog = {
    '@id': 'https://acme.test/blog',
    url: 'https://acme.test/blog',
    name: 'Acme Blog',
  };

  it('binds an explicitly default-ported document to the same schema entity', () => {
    const { rows } = listing({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      ...blog,
      url: 'https://acme.test:443/blog',
      dateModified: '2026-09-09',
    });
    expect(rows.get('aeo.schema_required_valid')!.outcome).toBe('satisfied');
  });

  it('reads a Blog index, including its modified date and freshness', () => {
    const { page, types, rows } = listing({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      ...blog,
      dateModified: '2026-09-09',
      blogPost: [{ '@type': 'BlogPosting', headline: 'A post', url: 'https://acme.test/blog/a' }],
    });
    expect(types).toContain('Blog');
    expect((page.dates as { modified: string }).modified).toBe('2026-09-09');
    expect(rows.get('aeo.schema_required_valid')!.outcome).toBe('satisfied');
  });

  it('treats a multi-type object and same-@id objects as one entity, not competing candidates', () => {
    const multi = listing({
      '@context': 'https://schema.org',
      '@type': ['CollectionPage', 'Blog'],
      ...blog,
      dateModified: '2026-09-09',
    });
    expect(multi.types).toEqual(['CollectionPage', 'Blog']);
    expect(multi.rows.get('aeo.schema_required_valid')!.outcome).toBe('satisfied');

    const sameId = listing({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      ...blog,
      dateModified: '2026-09-09',
      isPartOf: { '@type': 'Blog', ...blog },
    });
    expect(sameId.types).toEqual(['CollectionPage', 'Blog']);
    expect(sameId.rows.get('aeo.schema_required_valid')!.outcome).toBe('satisfied');
  });

  it('holds an entity to the contract it satisfies, not its first declared type', () => {
    const { rows } = listing({
      '@context': 'https://schema.org',
      '@type': ['ItemList', 'Blog'],
      ...blog,
      dateModified: '2026-09-09',
    });
    expect(rows.get('aeo.schema_required_valid')).toMatchObject({
      outcome: 'satisfied',
      evidence: { schema_type: 'Blog', missing: [] },
    });
  });

  it('keeps a nested Blog reference inert on a blog post', () => {
    const { types, rows } = listing(
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: 'A post',
        author: { '@type': 'Person', name: 'Someone' },
        datePublished: '2026-09-01',
        url: 'https://acme.test/blog/a',
        isPartOf: { '@type': 'Blog', ...blog },
      },
      'https://acme.test/blog/a',
      'article',
    );
    expect(types).toEqual(['BlogPosting', 'Blog']);
    expect(rows.get('aeo.schema_required_valid')!.outcome).toBe('satisfied');
  });

  it('picks a homepage Organization over its WebSite and ignores a nested parent organization', () => {
    const organization = {
      '@type': 'Organization',
      '@id': 'https://acme.test/#organization',
      name: 'Acme',
      url: 'https://acme.test/',
      parentOrganization: { '@type': 'Organization', name: 'Holding', url: 'https://hold.test/' },
    };
    const { rows } = listing(
      {
        '@context': 'https://schema.org',
        '@graph': [
          organization,
          {
            '@type': 'WebSite',
            name: 'Acme',
            url: 'https://acme.test/',
            publisher: { '@type': 'Organization', '@id': 'https://acme.test/#organization' },
          },
        ],
      },
      'https://acme.test/',
      'homepage',
    );
    expect(rows.get('aeo.schema_required_valid')).toMatchObject({
      outcome: 'satisfied',
      evidence: { schema_type: 'Organization', missing: [] },
    });
  });
});

describe('page traits', () => {
  it.each([
    [
      'contact_page.html',
      'https://northgate.example/contact-us',
      ['local_intent', 'contact_intent'],
    ],
    ['faq_accordion.html', 'https://northgate.example/faq', ['has_faq']],
    [
      'guide_no_howto.html',
      'https://northgate.example/guides/re-oiling-an-oak-table',
      ['procedural'],
    ],
    ['flat_category_listing.html', 'https://northgate.example/womens-dresses', ['listing']],
    [
      'broken_pdp_schema_mismatch.html',
      'https://northgate.example/oak-dining-tables/ilkley',
      ['has_variants'],
    ],
    ['docs_reference.html', 'https://northgate.example/docs/api/orders', []],
    [
      'trailco_about.html',
      'https://www.trail-co.example/pages/about',
      ['about_intent', 'company_profile_intent'],
    ],
  ])('%s carries exactly its observed traits in config order', (name, url, expected) => {
    expect(deriveTraits(url, fixtureFacts(name, url))).toEqual(expected);
  });

  it('never reads the page kind, so a product keeps an FAQ observation', () => {
    const url = 'https://northgate.example/faq';
    const page = fixtureFacts('faq_accordion.html', url);
    for (const kind of ['product', 'article', 'other', 'trust_policy'])
      expect(deriveTraits(url, { ...page, page_kind: kind })).toEqual(deriveTraits(url, page));

    const productUrl = 'https://northgate.example/oak-dining-tables/ilkley';
    const pairs = [
      'How long does delivery take?',
      'Can I return a made-to-measure piece?',
      'Do you deliver outside the UK?',
    ];
    const product = {
      ...fixtureFacts('broken_pdp_schema_mismatch.html', productUrl),
      question_answer_relationships: pairs.map((question) => ({
        question,
        answer: 'Yes.',
        answer_state: 'available',
      })),
    };
    expect(classify(productUrl, product).page_kind).toBe('product');
    expect(deriveTraits(productUrl, product)).toEqual(
      expect.arrayContaining(['has_faq', 'has_variants']),
    );
  });

  it('reads an FAQ from answered pairs, not from descriptive headings', () => {
    const url = 'https://northgate.example/blog/kiln-dried-oak';
    expect(deriveTraits(url, fixtureFacts('article_no_schema.html', url))).not.toContain('has_faq');
    const answered = ['What is Acme?', 'How does Acme work?', 'Can Acme export?'].map(
      (question) => ({
        question,
        answer: 'An answer.',
        answer_state: 'available',
      }),
    );
    expect(
      deriveTraits('https://example.test/page', { question_answer_relationships: answered }),
    ).toContain('has_faq');
  });

  it('derives variants from form context rather than variant evidence', () => {
    const traits = (fields: string[], control: boolean, variants: string[]) =>
      deriveTraits('https://example.test/widget', {
        form_fields: fields,
        entity: { product: { has_variant_control: control } },
        structured_data: { product: { variants } },
      });
    expect(traits(['Finish'], false, [])).toContain('has_variants');
    expect(traits([], true, ['Blue'])).not.toContain('has_variants');
    expect(traits(['Resize'], true, ['Blue'])).not.toContain('has_variants');
  });

  it('treats malformed persisted facts and counts as absent evidence', () => {
    for (const malformed of [
      {},
      { headings: 'nope', entity: 5, structured_data: null },
      { entity: { listing: { largest_card_list_size: 'many' } } },
      { entity: { location: { address_entity_count: 'two', has_phone: true } } },
      { ordered_list_steps: 'six' },
      { ordered_list_steps: { a: 1 } },
      { ordered_list_steps: [1, 2, 3] },
      { ordered_list_steps: null },
    ])
      expect(deriveTraits('https://x.example/', malformed)).toEqual([]);
    expect(deriveTraits('', {})).toEqual([]);
    expect(deriveTraits('not a url', {})).toEqual([]);
  });

  it('needs a real step sequence and bound collection evidence', () => {
    const steps = analysis.traits.procedural_min_steps;
    expect(deriveTraits('https://x.example/', { ordered_list_steps: steps - 1 })).not.toContain(
      'procedural',
    );
    for (const value of [steps, String(steps)])
      expect(deriveTraits('https://x.example/', { ordered_list_steps: value })).toContain(
        'procedural',
      );

    const size = analysis.entity.listing_min_card_items;
    const listing = (collection: unknown) =>
      deriveTraits('https://x.example/', {
        entity: {
          listing: {
            largest_card_list_size: size,
            ...(collection === undefined ? {} : { collection_evidence: collection }),
          },
        },
      });
    expect(listing(undefined)).not.toContain('listing');
    expect(listing({ container: {} })).not.toContain('listing');
    expect(listing({ container: { item_count: 0 } })).not.toContain('listing');
    expect(listing({ container: { item_count: size } })).toContain('listing');
  });

  it('matches intent routes by exact segment and accepts a reply channel for contact', () => {
    const bare = { title: '', headings: { h1_texts: [] } };
    expect(deriveTraits('https://x.example/about/', bare)).toContain('about_intent');
    expect(deriveTraits('https://x.example/aboutery', bare)).not.toContain('about_intent');
    expect(deriveTraits('https://x.example/contact-us', bare)).toContain('contact_intent');
    expect(
      deriveTraits('https://x.example/anything', {
        ...bare,
        contact_points: [{ channel: 'email', value: 'a@x.example' }],
      }),
    ).toContain('contact_intent');
  });

  it.each([
    ['https://example.com/about-us', 'About Us', true],
    ['https://example.com/our-company', 'Our Company', true],
    ['https://example.com/company-history', 'Company History', false],
    ['https://example.com/contact', 'Contact Us', false],
    ['https://example.com/team', 'Our Team', false],
    ['https://example.com/about-us', 'About Acme', true],
    ['https://example.com/', 'Acme Global', false],
  ])('company profile intent on %s titled %s is %s', (url, title, expected) => {
    const traits = deriveTraits(url, { title, headings: { h1_texts: [title] } });
    expect(traits.includes('company_profile_intent')).toBe(expected);
  });
});

type CalibrationCase = (typeof calibration.cases)[number];
const EMPTY_COLLECTION = {
  container: { tag: '', label: '', item_count: 0, distinct_targets: 0 },
  affordances: [],
  items: [],
};
function calibrationFacts(item: CalibrationCase) {
  const fixtureCase = item.fixture as {
    kind: string;
    html?: string;
    facts?: Record<string, unknown>;
  };
  if (fixtureCase.kind === 'html') return facts(fixtureCase.html!, item.url, item.content_type);
  const stored = structuredClone(fixtureCase.facts!);
  return {
    ...stored,
    has_html: item.content_type.startsWith('text/html'),
    delivery: {
      ...(stored.delivery as object),
      final_url: item.url,
      content_type: item.content_type,
    },
  };
}

describe('classifier calibration corpus', () => {
  it('covers every page kind and each abstention is deliberate', () => {
    expect(new Set(calibration.cases.map((item) => item.expected.page_kind))).toEqual(
      new Set(analysis.classification.page_kinds),
    );
    expect(new Set(calibration.cases.map((item) => item.id)).size).toBe(calibration.cases.length);
    for (const item of calibration.cases)
      if (item.deliberate_abstention) expect(item.expected.page_kind, item.id).toBe('other');
  });

  it.each(calibration.cases.map((item) => [item.id, item] as const))('%s', (_id, item) => {
    const page = calibrationFacts(item);
    const result = analyzePage(page, context);
    const evidence = result.assessment.evidence;
    const expected = item.expected;
    expect(result.assessment.page_kind).toBe(expected.page_kind);
    expect(result.traits).toEqual(expected.traits);
    expect(evidence.classified_by).toBe(expected.deciding_signal);
    expect(expected.allowed_deciding_tiers).toContain(evidence.tier);
    expect(expected.allowed_confidence).toContain(evidence.confidence);
    expect(evidence.other_reason).toBe(expected.other_reason);
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(4096);
    if (
      item.id.startsWith('searchable_blog_detail_') ||
      item.id === 'searchable_blog_root_without_collection'
    )
      expect(
        (page as { entity: { listing: { collection_evidence: unknown } } }).entity.listing
          .collection_evidence,
      ).toEqual(EMPTY_COLLECTION);
  });
});

describe('site audit regressions', () => {
  const page = (body: string, head = '', url = 'https://example.test/guides/setup') =>
    facts(`<html><head>${head}</head><body>${body}</body></html>`, url);
  const ld = (value: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

  it('treats every host on the site as internal, as the crawl does', () => {
    const anchors = page(
      `<main><h1>Setup</h1><p>Read the <a href="https://docs.example.test/start">docs</a>,
      the <a href="https://www.example.test/pricing">pricing</a>, the <a href="/faq">FAQ</a>
      and <a href="https://example.org/">a partner</a>.</p></main>`,
    ).links.anchors.map((anchor) => [anchor.url, anchor.is_internal]);
    expect(anchors).toEqual([
      ['https://docs.example.test/start', true],
      ['https://www.example.test/pricing', true],
      ['/faq', true],
      ['https://example.org/', false],
    ]);
    // Tenants of a shared hosting suffix are separate sites.
    const tenant = page(
      `<main><h1>Docs</h1><p><a href="https://docs.acme.github.io/">Docs</a> and
      <a href="https://other.github.io/">another project</a>.</p></main>`,
      '',
      'https://acme.github.io/',
    ).links.anchors.map((anchor) => anchor.is_internal);
    expect(tenant).toEqual([true, false]);
  });

  it('keeps hidden-menu and template links apart from rendered anchors', () => {
    const extracted = page(
      `<header><nav><a href="/collections/nets">Nets</a>
      <div hidden class="mega-menu"><a href="/collections/launch-monitors">Launch Monitors</a></div>
      <ul aria-hidden="true"><li><a href="https://www.example.test/collections/mats" rel="nofollow">Mats</a></li></ul>
      </nav></header>
      <main><h1>Setup</h1><p>Read the <a href="/faq">FAQ</a>.</p></main>
      <template><a href="/collections/packages">Packages</a></template>`,
    );
    expect(extracted.links.anchors.map((anchor) => [anchor.url, anchor.region])).toEqual([
      ['/collections/nets', 'nav'],
      ['/faq', 'main'],
    ]);
    expect(extracted.links.unrendered_anchors).toEqual([
      { url: '/collections/launch-monitors', is_internal: true, rel: '' },
      { url: 'https://www.example.test/collections/mats', is_internal: true, rel: 'nofollow' },
      { url: '/collections/packages', is_internal: true, rel: '' },
    ]);
    expect(extracted.link_context).toEqual(['Nets', 'FAQ']);
  });

  it('attaches the links of a numbered reference list as sources', () => {
    const items = ['openai.com', 'crossref.org', 'arxiv.org', 'aclanthology.org']
      .map((host) => `<li><span><a href="https://${host}/paper">${host} paper</a></span></li>`)
      .join('');
    const cards = ['partner.org', 'vendor.org', 'agency.org']
      .map((host) => `<li><div><a href="https://${host}/post">Related ${host}</a></div></li>`)
      .join('');
    const support = page(
      `<main><article><h1>Can ChatGPT find citations?</h1>
      <p>Language models often cite sources that do not exist when asked for references.</p>
      <h2>Sources</h2><ol class="sources">${items}</ol><ul class="related">${cards}</ul>
      </article></main>`,
    ).source_support;
    expect(support.attached_sources.map((source) => [source.domain, source.relationship])).toEqual([
      ['openai.com', 'references_section'],
      ['crossref.org', 'references_section'],
      ['arxiv.org', 'references_section'],
      ['aclanthology.org', 'references_section'],
    ]);
  });

  it('opens a sources section from a heading that leads with a configured name', () => {
    const domains = (heading: string) =>
      page(
        `<main><article><h1>Comparing visibility tools</h1>
        <p>Teams compare tools by the engines they track and how often they refresh.</p>
        <h2>${heading}</h2><ol><li><a href="https://openai.com/paper">OpenAI</a></li>
        <li><a href="https://arxiv.org/paper">arXiv</a></li></ol></article></main>`,
      ).source_support.attached_sources.map((source) => [source.domain, source.relationship]);
    const attached = [
      ['openai.com', 'references_section'],
      ['arxiv.org', 'references_section'],
    ];
    expect(domains('Sources and review date')).toEqual(attached);
    expect(domains('References and further reading')).toEqual(attached);
    expect(domains('Resourceful teams')).toEqual([]);
  });

  it('reads a breadcrumb trail only from BreadcrumbList markup, not a hub ItemList', () => {
    const list = (type: string) => ({
      '@type': type,
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: 'https://example.test/compare/a' },
        { '@type': 'ListItem', position: 2, item: 'https://example.test/compare/b' },
      ],
    });
    const blocks = page(
      '<main><h1>Compare</h1></main>',
      ld({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'CollectionPage',
            url: 'https://example.test/compare',
            mainEntity: list('ItemList'),
          },
          list('BreadcrumbList'),
        ],
      }),
      'https://example.test/compare',
    ).structured_data.blocks as { type: string; breadcrumb_items: string[] }[];
    expect(blocks.map((block) => [block.type, block.breadcrumb_items])).toEqual([
      ['CollectionPage', []],
      ['ItemList', []],
      ['BreadcrumbList', ['https://example.test/compare/a', 'https://example.test/compare/b']],
    ]);
  });

  it('counts markup of any schema.org type as structured data', () => {
    const outcome = (head: string) =>
      byRule(
        evaluatePageRules({
          ...page('<main><h1>Acme</h1><p>Track every project in one place.</p></main>', head),
          page_kind: 'service',
        }),
      ).get('aeo.structured_data_present')!.outcome;
    expect(outcome(ld({ '@context': 'https://schema.org', '@type': 'SoftwareApplication' }))).toBe(
      'satisfied',
    );
    expect(outcome('')).toBe('missing');
  });

  it('reads update meta as the modified date and ignores a listed card date', () => {
    const cards = Array.from(
      { length: 4 },
      (_, index) =>
        `<li><a href="/blog/post-${index}">Post ${index}</a><time datetime="2026-01-0${index + 1}">Jan</time></li>`,
    ).join('');
    const dates = page(
      `<main><h1>Setup</h1><p>Install the agent and connect a project.</p><ul>${cards}</ul></main>`,
      '<meta property="og:updated_time" content="2026-09-01T00:00:00Z">',
    ).dates;
    expect(dates).toEqual({ published: '', modified: '2026-09-01T00:00:00Z' });
  });

  it('accepts a schema name the page shows but flags one it never shows', () => {
    const outcome = (name: string, truncated = false) => {
      const blog = page(
        `<main><p>Blog &amp; guides</p><h1>Practical guides to AI visibility</h1>
        <p>Acme publishes research on how engines cite brands.</p></main>`,
        `<title>AI visibility guides and citation tracking resources | Acme</title>${ld({
          '@context': 'https://schema.org',
          '@type': 'Blog',
          '@id': 'https://acme.test/blog',
          url: 'https://acme.test/blog',
          name,
        })}`,
        'https://acme.test/blog',
      );
      return byRule(
        evaluatePageRules({
          ...blog,
          body: { ...blog.body, truncated },
          page_kind: 'editorial_index',
        }),
      ).get('aeo.schema_matches_content')!.outcome;
    };
    expect(outcome('Acme Blog')).toBe('satisfied');
    expect(outcome('Garden Supplies Catalog')).toBe('missing');
    // The name could sit in text past the stored cap, so it stays unproven.
    expect(outcome('Garden Supplies Catalog', true)).toBe('unknown');
  });
});

describe('unscored visibility checks', () => {
  const rule = (ruleId: string, extra: Record<string, unknown>) =>
    byRule(
      evaluatePageRules({
        has_html: true,
        delivery: { final_url: 'https://www.example.test/guides/setup' },
        ...extra,
      }),
    ).get(ruleId)!;
  const outcome = (row: RuleEvaluation) => [row.outcome, row.evidence.reason];

  it('judges recency from the newest declared date at audit time', () => {
    const recency = (published: string, modified: string, auditTime: string | null) =>
      outcome(
        rule('aeo.content_recency', {
          page_kind: 'guide',
          authored_content: true,
          dates: { published, modified },
          audit_time: auditTime,
        }),
      );
    const audit = '2026-10-07T00:00:00Z';
    expect(recency('2023-01-01', '2026-03-01', audit)).toEqual(['satisfied', undefined]);
    expect(recency('2024-01-01', '', audit)).toEqual(['missing', 'content_not_recent']);
    // The missing date is the date check's finding, not a stale page.
    expect(recency('', '', audit)).toEqual(['not_applicable', 'no_content_date']);
    expect(recency('someday', '', audit)).toEqual(['unknown', 'content_date_unparseable']);
    expect(recency('2026-01-01', '', null)).toEqual(['unknown', 'audit_time_unavailable']);
    expect(recency('2027-06-01', '', audit)).toEqual(['unknown', 'content_date_in_future']);
  });

  it('counts only entity profiles on other sites', () => {
    const profiles = (sameAs: string[] | null) =>
      outcome(
        rule('aeo.entity_profiles', {
          site: {},
          structured_data: {
            blocks: sameAs ? [{ type: 'Organization', name: 'Example', same_as: sameAs }] : [],
          },
        }),
      );
    expect(profiles(['https://www.wikidata.org/wiki/Q1', 'https://example.test/about'])).toEqual([
      'satisfied',
      undefined,
    ]);
    expect(profiles(['https://example.test/about', 'https://blog.example.test/'])[0]).toBe(
      'missing',
    );
    expect(profiles(null)).toEqual(['not_applicable', 'no_expected_type_block']);
  });

  it('flags a sitemap URL whose canonical names another page', () => {
    const sitemap = (member: boolean, canonical: string, listed?: string) =>
      rule('technical.sitemap_canonical', {
        sitemap_member: member,
        canonical_url: canonical,
        sitemap_url: listed,
      });
    expect(outcome(sitemap(true, '/guides/setup/?utm_source=x'))).toEqual(['satisfied', undefined]);
    // A listed URL that redirects to a self-canonical page is the redirect check's finding.
    expect(outcome(sitemap(true, '/guides/setup', 'https://www.example.test/old-setup'))).toEqual([
      'satisfied',
      undefined,
    ]);
    expect(outcome(sitemap(false, '/guides/other'))).toEqual(['not_applicable', 'not_in_sitemap']);
    const conflict = sitemap(true, '/guides/other');
    expect(outcome(conflict)).toEqual(['missing', 'sitemap_lists_non_canonical']);
    // Visible as an issue, never part of a score.
    expect([createsIssue(conflict), conflict.score_applicability]).toEqual([true, false]);
  });

  it("blocks a noindex page only when the owner's policy says index it", () => {
    const facts = (member: boolean, policy = '') => ({
      robots: { noindex: true },
      canonical_url: '/guides/setup',
      sitemap_member: member,
      indexing_policy: policy,
    });
    // Shopify lists every collection in its sitemap, including the ones it noindexes on purpose.
    expect(outcome(rule('technical.indexable', facts(true)))).toEqual([
      'not_applicable',
      'intentional_non_indexing',
    ]);
    expect(outcome(rule('technical.indexable', facts(false, 'index')))).toEqual([
      'missing',
      undefined,
    ]);
    // The sitemap conflict stays visible as its own unscored issue.
    const listed = rule('technical.sitemap_noindex', facts(true));
    expect(outcome(listed)).toEqual(['missing', 'sitemap_lists_noindex']);
    expect([createsIssue(listed), listed.score_applicability]).toEqual([true, false]);
    expect(outcome(rule('technical.sitemap_noindex', facts(false)))).toEqual([
      'not_applicable',
      'not_in_sitemap',
    ]);
  });

  it('flags a sitemap URL that redirects, but not a reordered query string', () => {
    const listed = (url?: string, member = true) =>
      outcome(rule('technical.sitemap_redirect', { sitemap_member: member, sitemap_url: url }));
    expect(listed('https://www.example.test/old-setup')).toEqual([
      'missing',
      'sitemap_lists_redirect',
    ]);
    expect(listed('https://example.test/guides/setup')).toEqual([
      'missing',
      'sitemap_lists_redirect',
    ]);
    expect(listed('https://www.example.test/guides/setup')).toEqual(['satisfied', undefined]);
    expect(listed(undefined, false)).toEqual(['not_applicable', 'not_in_sitemap']);
    const query = byRule(
      evaluatePageRules({
        has_html: true,
        delivery: { final_url: 'https://www.example.test/list?b=2&a=1&utm_source=mail' },
        sitemap_member: true,
        sitemap_url: 'https://www.example.test/list?a=1&b=2',
      }),
    ).get('technical.sitemap_redirect')!;
    expect(outcome(query)).toEqual(['satisfied', undefined]);
  });

  it('holds the sitemap lastmod against the audit time and the page dates', () => {
    const audit = '2026-10-07T00:00:00Z';
    const lastmod = (value: string | undefined, dates: Record<string, string>, member = true) =>
      outcome(
        rule('technical.sitemap_lastmod', {
          sitemap_member: member,
          sitemap_lastmod: value,
          dates: { published: '', modified: '', ...dates },
          audit_time: audit,
        }),
      );
    expect(lastmod('2026-09-01', { modified: '2026-09-01T10:00:00+05:30' })).toEqual([
      'satisfied',
      undefined,
    ]);
    expect(lastmod('2025-01-01', { modified: '2026-09-01' })).toEqual([
      'missing',
      'sitemap_lastmod_stale',
    ]);
    expect(lastmod('2026-12-31', { modified: '2026-09-01' })).toEqual([
      'missing',
      'sitemap_lastmod_in_future',
    ]);
    expect(lastmod('last tuesday', {})).toEqual(['missing', 'sitemap_lastmod_unparseable']);
    expect(lastmod('2026-09-01', {})).toEqual(['unknown', 'page_date_unavailable']);
    expect(lastmod(undefined, { modified: '2026-09-01' })).toEqual([
      'not_applicable',
      'no_sitemap_lastmod',
    ]);
    expect(lastmod('2026-09-01', {}, false)).toEqual(['not_applicable', 'not_in_sitemap']);
  });

  it('flags meta refresh and script-only redirects from the page markup', () => {
    const redirect = (html: string) => {
      const row = evaluations(html).get('technical.client_side_redirect')!;
      return [row.outcome, row.evidence.reason, row.evidence.target_url];
    };
    expect(
      redirect('<html><head><meta http-equiv="Refresh" content="0; URL=\'/new\'"></head></html>'),
    ).toEqual(['missing', 'meta_refresh_redirect', 'https://example.test/new']);
    // A refresh with no target, or to the page itself, only reloads it.
    expect(redirect('<html><head><meta http-equiv="refresh" content="300"></head></html>')).toEqual(
      ['satisfied', undefined, undefined],
    );
    expect(
      redirect('<html><head><meta http-equiv="refresh" content="5;url=/page"></head></html>'),
    ).toEqual(['satisfied', undefined, undefined]);
    expect(
      redirect('<html><body><script>window.location.href = "/app";</script></body></html>'),
    ).toEqual(['missing', 'script_redirect', undefined]);
    // Script navigation on a page with real content is a click handler, not a redirect.
    const article = `<html><body><p>${'Useful words about setup. '.repeat(20)}</p><script>
      button.onclick = () => { location.assign('/next'); };</script></body></html>`;
    expect(redirect(article)).toEqual(['satisfied', undefined, undefined]);
  });
});
