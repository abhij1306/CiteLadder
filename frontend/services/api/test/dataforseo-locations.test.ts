import { describe, expect, it } from 'vitest';

import {
  buildLocationsFile,
  serializeLocationsFile,
  surfaceLists,
} from '../src/search-surfaces/locations-file.ts';
import { searchContext, surfaceSupports } from '../src/search-surfaces/locations.ts';

const envelope = (result: unknown[]) => ({
  status_code: 20000,
  tasks: [{ status_code: 20000, result }],
});
const country = (code: number, iso: string) => ({
  location_code: code,
  location_name: iso,
  country_iso_code: iso,
  location_type: 'Country',
});
const lists = (locations: unknown[], languages: string[]) =>
  surfaceLists(
    envelope(locations),
    envelope(languages.map((language_code) => ({ language_name: language_code, language_code }))),
  );

describe('the DataForSEO locations file', () => {
  it('keeps market countries per surface and each surface’s market languages', () => {
    const file = buildLocationsFile(
      {
        google_ai_overview: lists(
          [
            country(2724, 'ES'),
            country(2392, 'JP'),
            { location_code: 1023191, country_iso_code: 'US', location_type: 'City' },
            country(2004, 'AF'),
          ],
          ['es', 'ja', 'en', 'zh-TW', 'he'],
        ),
        chatgpt_search: lists([country(2724, 'ES')], ['es', 'en']),
        gemini_consumer: lists([country(2724, 'ES')], ['xx']),
      },
      '2026-10-10',
    );
    expect(file.languages).toEqual({
      google_ai_overview: ['en', 'es', 'ja'],
      chatgpt_search: ['en', 'es'],
      gemini_consumer: [],
    });
    expect(file.countries).toEqual({
      ES: { location_code: 2724, surfaces: ['google_ai_overview', 'chatgpt_search'] },
      JP: { location_code: 2392, surfaces: ['google_ai_overview'] },
    });
    expect(file.generated_at).toBe('2026-10-10');
  });

  it('refuses surfaces that disagree on a country location code', () => {
    expect(() =>
      buildLocationsFile(
        {
          google_ai_overview: lists([country(2724, 'ES')], ['es']),
          chatgpt_search: lists([country(9999, 'ES')], ['es']),
          gemini_consumer: lists([], []),
        },
        '2026-10-10',
      ),
    ).toThrow('Surfaces disagree on the location code for ES');
  });

  it('refuses a list response DataForSEO did not complete', () => {
    expect(() => surfaceLists({ status_code: 40100, tasks: [] }, envelope([]))).toThrow();
  });

  it('writes a list on one line only when it fits the print width', () => {
    const text = serializeLocationsFile({
      source: 'test',
      generated_at: '2026-10-10',
      languages: {
        google_ai_overview: [
          'ar',
          'da',
          'de',
          'en',
          'es',
          'fi',
          'fr',
          'hi',
          'it',
          'ja',
          'ko',
          'nl',
          'pl',
        ],
        chatgpt_search: ['en'],
        gemini_consumer: [],
      },
      countries: { ES: { location_code: 2724, surfaces: ['chatgpt_search'] } },
    });
    expect(text).toBe(
      [
        '{',
        '  "source": "test",',
        '  "generated_at": "2026-10-10",',
        '  "languages": {',
        '    "google_ai_overview": [',
        ...['ar', 'da', 'de', 'en', 'es', 'fi', 'fr', 'hi', 'it', 'ja', 'ko', 'nl'].map(
          (code) => `      "${code}",`,
        ),
        '      "pl"',
        '    ],',
        '    "chatgpt_search": ["en"],',
        '    "gemini_consumer": []',
        '  },',
        '  "countries": {',
        '    "ES": {',
        '      "location_code": 2724,',
        '      "surfaces": ["chatgpt_search"]',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });
});

describe('search contexts from the reviewed file', () => {
  it('maps a market language to its primary subtag', () => {
    expect(searchContext('de', 'de')).toEqual({
      serp_location_code: 2276,
      serp_language_code: 'de',
    });
    expect(searchContext('BR', 'pt-BR')).toEqual({
      serp_location_code: 2076,
      serp_language_code: 'pt',
    });
    expect(searchContext('GB', 'en-GB')).toEqual({
      serp_location_code: 2826,
      serp_language_code: 'en',
    });
  });

  it('leaves a language no surface lists unmeasurable', () => {
    expect(searchContext('JP', 'zh')).toEqual({ serp_location_code: 2392, serp_language_code: '' });
    expect(surfaceSupports('chatgpt_search', 2392, 'zh')).toBe(false);
  });

  it('supports a language per surface, not per country', () => {
    expect(surfaceSupports('chatgpt_search', 2076, 'pt')).toBe(true);
    expect(surfaceSupports('gemini_consumer', 2076, 'pt')).toBe(false);
    expect(surfaceSupports('gemini_consumer', 0, 'en')).toBe(false);
  });
});
