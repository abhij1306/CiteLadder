/**
 * Operator CLI: regenerate the reviewed DataForSEO locations file.
 *
 * Fetches each search surface's location and language lists (free DataForSEO
 * list endpoints) with the DataForSEO login in DATAFORSEO_API_LOGIN /
 * DATAFORSEO_API_PASSWORD, keeps the market countries, and writes
 * `src/config/dataforseo-locations.json` for review. Never runs at request
 * time or in CI.
 *
 *   pnpm dataforseo:locations            # write the file
 *   pnpm dataforseo:locations --dry-run  # print it instead
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { resolveSettingSpec } from '../config.ts';
import { providerPolicy } from '../providers/config.ts';
import { searchPolicy } from '../search-surfaces/dataforseo.ts';
import {
  buildLocationsFile,
  serializeLocationsFile,
  surfaceLists,
} from '../search-surfaces/locations-file.ts';
import type { SearchSurface } from '../search-surfaces/locations.ts';

const OUTPUT = new URL('../config/dataforseo-locations.json', import.meta.url);
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

// Maintainer tool: regenerates the bundled location lists from a DataForSEO account.
const login = (process.env.DATAFORSEO_API_LOGIN ?? '').trim();
const password = process.env.DATAFORSEO_API_PASSWORD ?? '';
if (!login || !password)
  throw new Error('Set DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD to fetch the lists');
const base = String(resolveSettingSpec(providerPolicy.dataforseo.base_url));
const credentials = Buffer.from(`${login}:${password}`).toString('base64');
const authorization = `Basic ${credentials}`;

async function fetchList(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, base), { headers: { authorization } });
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  return response.json();
}

async function fetchSurface(surface: SearchSurface) {
  const paths = searchPolicy.constants.locations_paths[surface];
  return surfaceLists(await fetchList(paths.locations), await fetchList(paths.languages));
}
const lists = {
  google_ai_overview: await fetchSurface('google_ai_overview'),
  chatgpt_search: await fetchSurface('chatgpt_search'),
  gemini_consumer: await fetchSurface('gemini_consumer'),
};
const text = serializeLocationsFile(
  buildLocationsFile(lists, new Date().toISOString().slice(0, 10)),
);
if (values['dry-run']) process.stdout.write(text);
else {
  writeFileSync(OUTPUT, text);
  process.stdout.write(`Wrote ${OUTPUT.pathname}; review the diff before committing.\n`);
}
