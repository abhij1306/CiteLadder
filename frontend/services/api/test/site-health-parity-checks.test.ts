import { describe, expect, it } from 'vitest';

import { extractPageFacts } from '../src/site-health/analysis/facts.ts';
import { sitemapValid } from '../src/site-health/analysis/finalize.ts';
import { evaluatePageRules, type RuleEvaluation } from '../src/site-health/analysis/rules.ts';
import {
  httpOriginFacts,
  httpOriginUrl,
  probeFailureCode,
  probeHttpOrigin,
} from '../src/site-health/http-origin.ts';
import { siteFetchSettings, tlsCertificateCode } from '../src/site-health/page-fetch.ts';
import type { WebsiteFetcher } from '../src/safe-fetch.ts';
import { PageAcquirer } from '../src/web-evidence/acquisition.ts';

const URL_ = 'https://example.test/guides/setup';
const extract = (body: string, head = '') =>
  extractPageFacts(Buffer.from(`<html><head>${head}</head><body>${body}</body></html>`), {
    finalUrl: URL_,
    contentType: 'text/html',
    statusCode: 200,
  });
const judged = (ruleId: string, pageKind: string, body: string, head = '', extra = {}) => {
  const row: RuleEvaluation = evaluatePageRules({
    ...extract(body, head),
    page_kind: pageKind,
    ...extra,
  }).find((item) => item.rule_id === ruleId)!;
  return [row.outcome, row.reason_code];
};
const ld = (raw: string) => `<script type="application/ld+json">${raw}</script>`;
const prose = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
const MAIN = `<main><h1>Setup guide</h1><p>${prose(40)}</p></main>`;

describe('invalid JSON-LD', () => {
  const VALID = ld('{"@context":"https://schema.org","@type":"Article","headline":"Setup"}');
  const BROKEN = ld('{"@context":"https://schema.org","@type":"Article",');

  it('reports a broken block as invalid and never as missing structured data', () => {
    expect(judged('aeo.structured_data_valid', 'article', MAIN, BROKEN)).toEqual(['missing', '']);
    expect(judged('aeo.structured_data_present', 'article', MAIN, BROKEN)).toEqual([
      'not_applicable',
      'structured_data_invalid',
    ]);
    expect(judged('aeo.structured_data_valid', 'article', MAIN, VALID + BROKEN)[0]).toBe('missing');
    expect(judged('aeo.structured_data_present', 'article', MAIN, VALID + BROKEN)[0]).toBe(
      'satisfied',
    );
    expect(judged('aeo.structured_data_valid', 'article', MAIN, VALID)[0]).toBe('satisfied');
    expect(judged('aeo.structured_data_present', 'article', MAIN, '')[0]).toBe('missing');
    expect(
      judged('aeo.structured_data_valid', 'article', MAIN, '', {
        structured_data: { count: 0, declared_types: [] },
      })[0],
    ).toBe('unknown');
  });
});

describe('unparseable sitemaps', () => {
  const judgedSitemap = (sitemap: Record<string, unknown>) => {
    const row = sitemapValid({ sampleMode: false, sitemap: { fetched: false, ...sitemap } });
    return [row.outcome, row.reason_code];
  };
  it('keeps a walk that read nothing unknown, not out of scope', () => {
    expect(judgedSitemap({ file_count: 0, invalid_count: 0, unread_count: 2 })).toEqual([
      'unknown',
      'sitemap_unavailable',
    ]);
    expect(judgedSitemap({ file_count: 3, invalid_count: 0, unread_count: 1 })[0]).toBe('unknown');
    expect(judgedSitemap({ file_count: 3, invalid_count: 0, unread_count: 0 })[0]).toBe(
      'satisfied',
    );
    expect(judgedSitemap({ file_count: 0, invalid_count: 0, unread_count: 0 })).toEqual([
      'not_applicable',
      'no_sitemap',
    ]);
    expect(judgedSitemap({ file_count: 0, invalid_count: 1, unread_count: 1 })[0]).toBe('missing');
  });
});

describe('direct answers beyond FAQ pages', () => {
  const answered = `<main><h1>Setup</h1><h2>What is Acme?</h2><p>${prose(30)}</p></main>`;
  const unanswered = '<main><h1>Setup</h1><h2>What is Acme?</h2></main>';
  it.each(['article', 'guide', 'how_to', 'docs', 'comparison', 'alternative'])(
    'checks question headings on %s pages',
    (kind) => {
      expect(judged('aeo.answer_first', kind, answered)[0]).toBe('satisfied');
      expect(judged('aeo.answer_first', kind, unanswered)).toEqual([
        'missing',
        'question_answer_missing',
      ]);
      expect(judged('aeo.answer_first', kind, MAIN)).toEqual([
        'not_applicable',
        'no_question_headings',
      ]);
    },
  );
  it('keeps an FAQ without questions unknown and other page kinds out of scope', () => {
    expect(judged('aeo.answer_first', 'faq', MAIN)[0]).toBe('unknown');
    expect(judged('aeo.answer_first', 'product', unanswered)).toEqual([
      'not_applicable',
      'other_page_kind',
    ]);
  });
});

describe('headings and length advisories', () => {
  it('flags a page with no H1 at all, not one with several', () => {
    expect(judged('technical.h1_present', 'product', `<main><p>${prose(40)}</p></main>`)).toEqual([
      'missing',
      '',
    ]);
    expect(judged('technical.h1_present', 'product', `${MAIN}<h1>Second</h1>`)[0]).toBe(
      'satisfied',
    );
  });

  it('holds titles and meta descriptions to the configured length range', () => {
    const title = (value: string) =>
      judged('technical.title_length', 'article', MAIN, `<title>${value}</title>`);
    expect(title('Setup')).toEqual(['missing', 'too_short']);
    expect(title('How to set up Acme in five minutes')[0]).toBe('satisfied');
    expect(title(prose(20))).toEqual(['missing', 'too_long']);
    expect(title('   ')).toEqual(['not_applicable', 'empty_title']);
    const meta = (value: string) =>
      judged(
        'technical.meta_description_length',
        'article',
        MAIN,
        `<meta name="description" content="${value}">`,
      );
    expect(meta('Short.')).toEqual(['missing', 'too_short']);
    expect(meta(prose(14))[0]).toBe('satisfied');
    expect(meta(prose(40))).toEqual(['missing', 'too_long']);
  });

  it('flags thin content pages and leaves other page kinds out', () => {
    expect(judged('aeo.thin_content', 'article', MAIN)).toEqual(['missing', '']);
    const long = `<main><h1>Setup</h1><p>${prose(120)}</p><p>${prose(120)}</p><p>${prose(120)}</p></main>`;
    expect(judged('aeo.thin_content', 'article', long)[0]).toBe('satisfied');
    expect(judged('aeo.thin_content', 'product', MAIN)).toEqual([
      'not_applicable',
      'other_page_kind',
    ]);
  });

  it('keeps paragraph lengths in the facts and flags a paragraph over the limit', () => {
    const body = `<main><h1>Setup</h1><p>${prose(160)}</p><p>${prose(20)}</p></main>`;
    expect(extract(body).primary_paragraph_word_counts).toEqual([160, 20]);
    expect(judged('aeo.long_paragraphs', 'article', body)).toEqual(['missing', '']);
    expect(judged('aeo.long_paragraphs', 'article', MAIN)[0]).toBe('satisfied');
    const kept = Array.from({ length: 200 }, () => 20);
    expect(
      judged('aeo.long_paragraphs', 'article', MAIN, '', { primary_paragraph_word_counts: kept }),
    ).toEqual(['unknown', 'paragraphs_truncated']);
  });
});

describe('HTTP origin and TLS certificate failures', () => {
  const page = (status: number, url: string, chain: { status: number; to: string }[] = []) => ({
    kind: 'page' as const,
    page: {
      url,
      status,
      contentType: 'text/html',
      body: Buffer.alloc(0),
      redirectChain: chain.map((hop) => ({ from: 'http://example.test/', ...hop })),
    },
  });
  const failure = (code: string, cause?: Error) =>
    Object.assign(new Error(code, cause ? { cause } : undefined), cause ? {} : { code });
  const failed = (error: unknown) => ({ kind: 'error' as const, code: probeFailureCode(error) });
  const root = (
    probe: ReturnType<typeof httpOriginFacts> | null,
    finalUrl = 'https://example.test/',
  ) => {
    const row = evaluatePageRules({
      has_html: true,
      delivery: { final_url: finalUrl },
      site: probe ? { http_origin: probe } : {},
    }).find((item) => item.rule_id === 'technical.http_redirects_to_https')!;
    return [row.outcome, row.reason_code];
  };
  const probe = 'http://example.test/';

  it('maps what the http:// probe observed to the rule outcome', () => {
    expect(httpOriginUrl('https://example.test')).toBe(probe);
    expect(httpOriginUrl('http://example.test')).toBe(probe);
    expect(httpOriginUrl('https://example.test:8443')).toBeNull();
    expect(
      root(
        httpOriginFacts(
          probe,
          page(200, 'https://example.test/', [{ status: 301, to: 'https://example.test/' }]),
        ),
      ),
    ).toEqual(['satisfied', '']);
    expect(root(httpOriginFacts(probe, page(200, probe)))).toEqual([
      'missing',
      'http_served_without_redirect',
    ]);
    expect(
      root(
        httpOriginFacts(
          probe,
          page(200, 'http://www.example.test/', [{ status: 301, to: 'http://www.example.test/' }]),
        ),
      )[0],
    ).toBe('missing');
    expect(root(httpOriginFacts(probe, failed(failure('ECONNREFUSED'))))[0]).toBe('satisfied');
    for (const code of ['ETIMEDOUT', 'ECONNRESET'])
      expect(root(httpOriginFacts(probe, failed(failure(code))))).toEqual([
        'unknown',
        'http_origin_unread',
      ]);
    expect(root(httpOriginFacts(null, { kind: 'error', code: '' }))).toEqual([
      'unknown',
      'no_http_origin',
    ]);
    expect(root(null)).toEqual(['unknown', 'insufficient_evidence']);
    expect(root(httpOriginFacts(probe, page(200, probe)), probe)).toEqual([
      'not_applicable',
      'root_not_https',
    ]);
  });

  it('reads a refused http:// port at its robots.txt as nothing served over HTTP', async () => {
    const sent: string[] = [];
    const refuse: WebsiteFetcher = async (url) => {
      sent.push(url);
      throw failure('ECONNREFUSED');
    };
    const settings = siteFetchSettings({});
    const acquisition = { ...settings.acquisition, robotsAttempts: 1 };
    const facts = await probeHttpOrigin(
      {
        signal: new AbortController().signal,
        fetcher: {
          settings: { ...settings, acquisition },
          acquirer: new PageAcquirer(async () => {}, refuse, acquisition, 0),
        },
      },
      'https://example.test',
    );
    expect(facts).toEqual({ state: 'unanswered', url: probe, error_code: 'ECONNREFUSED' });
    expect(root(facts)).toEqual(['satisfied', '']);
    expect(sent).toEqual(['http://example.test/robots.txt']);
  });

  it('names a certificate failure and its reason instead of a failed connection', () => {
    expect(tlsCertificateCode(failure('CERT_HAS_EXPIRED'))).toBe('tls_cert_expired');
    expect(
      tlsCertificateCode(failure('fetch failed', failure('ERR_TLS_CERT_ALTNAME_INVALID'))),
    ).toBe('tls_cert_hostname_mismatch');
    expect(tlsCertificateCode(failure('ECONNREFUSED'))).toBeNull();
    expect(httpOriginFacts(probe, failed(failure('CERT_HAS_EXPIRED')))).toEqual({
      state: 'failed',
      url: probe,
      error_code: 'tls_cert_expired',
    });
  });
});
