/**
 * Builds the reviewed DataForSEO locations file from DataForSEO's own
 * location and language lists, one pair per search surface. Pure: the
 * operator CLI fetches the lists and writes the result for review.
 */
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { z } from 'zod';

import { compareText } from '../text-order.ts';

import {
  locationsFileSchema,
  SEARCH_SURFACES,
  searchLanguageOf,
  type LocationsFile,
  type SearchSurface,
} from './locations.ts';

const locationRow = z.looseObject({
  location_code: z.int(),
  country_iso_code: z.string().nullish(),
  location_type: z.string().nullish(),
});
const languageRow = z.looseObject({ language_code: z.string() });
/** DataForSEO's envelope: one task whose result is the list. */
const listEnvelope = <Row extends z.ZodType>(row: Row) =>
  z.looseObject({
    status_code: z.literal(20000),
    tasks: z
      .array(z.looseObject({ status_code: z.literal(20000), result: z.array(row).nullable() }))
      .min(1),
  });
const locationsEnvelope = listEnvelope(locationRow);
const languagesEnvelope = listEnvelope(languageRow);

export type SurfaceLists = {
  locations: z.infer<typeof locationRow>[];
  languages: z.infer<typeof languageRow>[];
};

/** One surface's lists from DataForSEO's two response bodies; anything else throws. */
export function surfaceLists(locations: unknown, languages: unknown): SurfaceLists {
  return {
    locations: locationsEnvelope.parse(locations).tasks.flatMap((task) => task.result ?? []),
    languages: languagesEnvelope.parse(languages).tasks.flatMap((task) => task.result ?? []),
  };
}

const candidateLanguages = [
  ...new Set(MARKET_LANGUAGES.map(({ value }) => searchLanguageOf(value))),
].sort(compareText);

function countryCode(lists: SurfaceLists, country: string): number | null {
  const row = lists.locations.find(
    (location) =>
      location.location_type === 'Country' && location.country_iso_code?.toUpperCase() === country,
  );
  return row?.location_code ?? null;
}

/**
 * Every market country at least one surface supports, with its location code
 * and those surfaces, and each surface's market languages. A surface offering
 * none of them supports no country. A country whose surfaces disagree on its
 * location code is refused for review.
 */
export function buildLocationsFile(
  lists: Record<SearchSurface, SurfaceLists>,
  generatedAt: string,
): LocationsFile {
  const languages = {
    google_ai_overview: offeredLanguages(lists.google_ai_overview),
    chatgpt_search: offeredLanguages(lists.chatgpt_search),
    gemini_consumer: offeredLanguages(lists.gemini_consumer),
  };
  const countries: LocationsFile['countries'] = {};
  for (const { value: country } of [...MARKET_COUNTRIES].sort((a, b) =>
    compareText(a.value, b.value),
  )) {
    const entry: LocationsFile['countries'][string] = { location_code: 0, surfaces: [] };
    for (const surface of SEARCH_SURFACES) {
      const code = countryCode(lists[surface], country);
      if (code === null || !languages[surface].length) continue;
      if (entry.location_code && entry.location_code !== code)
        throw new Error(`Surfaces disagree on the location code for ${country}`);
      entry.location_code = code;
      entry.surfaces.push(surface);
    }
    if (entry.location_code) countries[country] = entry;
  }
  return locationsFileSchema.parse({
    source: 'DataForSEO locations and languages lists, fetched by `pnpm dataforseo:locations`.',
    generated_at: generatedAt,
    languages,
    countries,
  });
}

/** The market languages a surface's language list offers. */
function offeredLanguages(lists: SurfaceLists): string[] {
  const offered = new Set(lists.languages.map((row) => row.language_code.toLowerCase()));
  return candidateLanguages.filter((language) => offered.has(language));
}

const PRINT_WIDTH = 100;

/**
 * Two-space JSON with each string list on one line when it fits the
 * formatter's print width, as the formatter writes it.
 */
export function serializeLocationsFile(file: LocationsFile): string {
  return `${JSON.stringify(file, null, 2).replace(
    /^( *)("[^"\n]*": )?\[\n((?: *"[^"\n]*",?\n)+) *\]/gmu,
    (block: string, indent: string, key: string | undefined, items: string) => {
      const line = `${indent}${key ?? ''}[${items.trim().replaceAll(/,\n */gu, ', ')}]`;
      return line.length <= PRINT_WIDTH ? line : block;
    },
  )}\n`;
}
