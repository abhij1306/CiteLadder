import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { z } from 'zod';

import reference from '../config/dataforseo-locations.json' with { type: 'json' };
import { ConfigError } from '../config/config-error.ts';
import { dataforseo, enginesOfKind } from '../config/providers.ts';

const locationPaths = dataforseo.constants.locations_paths;
export type SearchSurface = keyof typeof locationPaths;
const hasLocationPaths = (engine: string): engine is SearchSurface =>
  Object.hasOwn(locationPaths, engine);
const observedEngines: readonly string[] = enginesOfKind('search_ai', 'llm_scraper');
export const searchSurfaces: readonly SearchSurface[] = Object.keys(locationPaths)
  .filter(hasLocationPaths)
  .filter((surface) => observedEngines.includes(surface));
if (
  searchSurfaces.length !== observedEngines.length ||
  searchSurfaces.length !== Object.keys(locationPaths).length
)
  throw new ConfigError(
    'Every observed provider route needs exactly one DataForSEO locations list',
  );
export const isSearchSurface = (value: string): value is SearchSurface =>
  hasLocationPaths(value) && searchSurfaces.includes(value);

export const searchLanguageOf = (language: string) =>
  language.trim().split(/[-_]/u)[0]!.toLowerCase();

const countries = new Set(MARKET_COUNTRIES.map(({ value }) => value));
const languages = new Set(MARKET_LANGUAGES.map(({ value }) => searchLanguageOf(value)));
const languageList = z.array(z.string().refine((code) => languages.has(code)));

export const locationsFileSchema = z.object({
  source: z.string(),
  generated_at: z.string().nullable(),
  languages: z.record(z.enum(searchSurfaces), languageList),
  countries: z.record(
    z.string().refine((code) => countries.has(code), 'Not a market country'),
    z.object({ location_code: z.int().positive(), surfaces: z.array(z.enum(searchSurfaces)) }),
  ),
});
export type LocationsFile = z.infer<typeof locationsFileSchema>;

const locations = locationsFileSchema.parse(reference);
const byCode = new Map(
  Object.values(locations.countries).map((entry) => [entry.location_code, entry]),
);

export function surfaceMarkets(surface: SearchSurface) {
  return Object.entries(locations.countries)
    .filter(([, entry]) => entry.surfaces.includes(surface))
    .map(([country_code, entry]) => ({ country_code, location_code: entry.location_code }));
}

function locationCodeOf(country: string): number {
  return locations.countries[country.trim().toUpperCase()]?.location_code ?? 0;
}

function searchLanguageFor(country: string, language: string): string {
  const entry = locations.countries[country.trim().toUpperCase()];
  const code = searchLanguageOf(language);
  return entry?.surfaces.some((surface) => locations.languages[surface].includes(code)) ? code : '';
}

export function searchContext(country: string, language: string) {
  return {
    serp_location_code: locationCodeOf(country),
    serp_language_code: searchLanguageFor(country, language),
  };
}

export function surfaceSupports(
  surface: SearchSurface,
  locationCode: number,
  language: string,
): boolean {
  return (
    (byCode.get(locationCode)?.surfaces.includes(surface) ?? false) &&
    locations.languages[surface].includes(language)
  );
}
