/**
 * The reviewed DataForSEO locations file: which measurement countries each
 * search surface supports, at which location code, and the market languages
 * each surface offers (DataForSEO lists languages per surface, not per
 * country, so they are stored once).
 *
 * The file is written by the operator CLI (`pnpm dataforseo:locations`) and
 * reviewed in a pull request; nothing here calls DataForSEO. A country absent
 * from the file, or a surface absent for a country, is unsupported there.
 */
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { z } from 'zod';

import reference from '../config/dataforseo-locations.json' with { type: 'json' };
import { ConfigError } from '../config/config-error.ts';
import { dataforseo, enginesOfKind } from '../config/providers.ts';

const locationPaths = dataforseo.constants.locations_paths;
/** A routed engine DataForSEO observes: one with a DataForSEO locations list. */
export type SearchSurface = keyof typeof locationPaths;
const hasLocationPaths = (engine: string): engine is SearchSurface =>
  Object.hasOwn(locationPaths, engine);
const observedEngines: readonly string[] = enginesOfKind('search_ai', 'llm_scraper');
/**
 * The observed surfaces: the provider routes whose surface kind is observed,
 * in the reviewed locations file's order.
 */
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

/** The DataForSEO language for a market language tag: its primary subtag (`pt-BR` is `pt`). */
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

/** The DataForSEO location code of a market country, or 0 when no surface supports it. */
function locationCodeOf(country: string): number {
  return locations.countries[country.trim().toUpperCase()]?.location_code ?? 0;
}

/** The search language a country is measured in, or '' when no surface offers it there. */
function searchLanguageFor(country: string, language: string): string {
  const entry = locations.countries[country.trim().toUpperCase()];
  const code = searchLanguageOf(language);
  return entry?.surfaces.some((surface) => locations.languages[surface].includes(code)) ? code : '';
}

/** A country and language's project search context; 0 and '' where no surface supports it. */
export function searchContext(country: string, language: string) {
  return {
    serp_location_code: locationCodeOf(country),
    serp_language_code: searchLanguageFor(country, language),
  };
}

/** Whether `surface` can measure at this location code in this DataForSEO language. */
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
