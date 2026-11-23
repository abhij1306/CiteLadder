import { describe, expect, it } from 'vite-plus/test';

import {
  formatCount,
  formatCountry,
  formatDisplayDate,
  formatDisplayTimestamp,
  formatPercent,
  isOwnHost,
  ownOrigin,
  readableUrl,
  sharedOrigin,
  shortUrlTitle,
  urlCellText,
} from './format';

describe('readableUrl', () => {
  it('decodes a doubly encoded path to what a reader expects', () => {
    expect(readableUrl('https://shop.test/Women%2527s-Clothing/Tops%2520%2526%2520Tees')).toBe(
      "https://shop.test/Women's-Clothing/Tops & Tees",
    );
  });

  it('keeps a malformed escape as text instead of failing', () => {
    expect(readableUrl('/sale-100%-off')).toBe('/sale-100%-off');
  });
});

describe('shortUrlTitle', () => {
  it('names a page by its host and its last path segment', () => {
    expect(
      shortUrlTitle(
        'https://www.bestandless.com.au/Categories/Women/Women%2527s-Clothing/Women%2527s-Dresses/WR3458_PAISLEY?colour=blue',
      ),
    ).toBe('bestandless.com.au/…/WR3458_PAISLEY');
    expect(shortUrlTitle('https://acme.test/pricing')).toBe('acme.test/pricing');
    expect(shortUrlTitle('https://acme.test/')).toBe('acme.test');
  });

  it('only makes text that is not a web address readable', () => {
    expect(shortUrlTitle('best crm for small teams')).toBe('best crm for small teams');
    expect(shortUrlTitle('mailto:sales%40acme.test')).toBe('mailto:sales@acme.test');
  });
});

describe('formatPercent', () => {
  it('prints one decimal for every rate, so 92.0% sits beside 10.0%', () => {
    expect([0.92, 0.1, 0.1234, 0, 1].map(formatPercent)).toEqual([
      '92.0%',
      '10.0%',
      '12.3%',
      '0.0%',
      '100.0%',
    ]);
    expect(formatPercent(null)).toEqual({ absent: 'not_measured' });
  });
});

describe('counts', () => {
  it('groups thousands with no stray spaces and never abbreviates', () => {
    expect([0, 999, 50_000, 1_162_000].map(formatCount)).toEqual([
      '0',
      '999',
      '50,000',
      '1,162,000',
    ]);
  });
});

describe('dates and times', () => {
  it('prints a date and a date-time in the display zone, never naming the zone', () => {
    const at = '2026-11-14T11:33:00Z';
    expect(formatDisplayDate(at, 'Asia/Kolkata')).toBe('Nov 14, 2026');
    expect(formatDisplayTimestamp(at, 'Asia/Kolkata')).toBe('Nov 14, 2026, 05:03 PM');
    expect(formatDisplayTimestamp(at, 'Europe/Paris')).toBe('Nov 14, 2026, 12:33 PM');
    expect(formatDisplayTimestamp(at, 'Not/A_Zone')).toBe('Nov 14, 2026, 11:33 AM');
    expect(formatDisplayTimestamp(at, 'Not/A_Zone')).toBe('Nov 14, 2026, 11:33 AM');
  });
});

describe('formatCountry', () => {
  it('names a Search Console alpha-3 code in any case and prints an unknown code upper-case', () => {
    expect(['usa', 'CAN', 'gbr', 'deu', 'xkk', 'zzz', 'qqq'].map(formatCountry)).toEqual([
      'United States',
      'Canada',
      'United Kingdom',
      'Germany',
      'Kosovo',
      'ZZZ',
      'QQQ',
    ]);
  });
});

describe('URL cells', () => {
  it('keeps the origin only for a host other than the project’s own', () => {
    expect(ownOrigin('https://acme.test/guide', 'https://www.acme.test')).toBe('https://acme.test');
    expect(ownOrigin('https://other.test/guide', 'https://acme.test')).toBeNull();
    expect(ownOrigin('https://acme.test/guide', null)).toBeNull();
    expect(isOwnHost('WWW.acme.test', 'https://acme.test/')).toBe(true);
    expect(isOwnHost('acme.test.evil.test', 'https://acme.test/')).toBe(false);
  });

  it('drops the origin a whole column shares and keeps it when the origins differ', () => {
    const urls = ['https://www.shop.test/journal/a', 'https://www.shop.test/'];
    const origin = sharedOrigin(urls);
    expect(origin).toBe('https://www.shop.test');
    expect(urls.map((url) => urlCellText(url, origin))).toEqual(['/journal/a', '/']);
    expect(sharedOrigin([...urls, 'https://other.test/x'])).toBeNull();
    expect(sharedOrigin(['/relative/path'])).toBeNull();
    expect(urlCellText('https://other.test/Women%27s', origin)).toBe("https://other.test/Women's");
    expect(urlCellText('https://www.shop.test.evil.test/a', origin)).toBe(
      'https://www.shop.test.evil.test/a',
    );
  });
});
