import { z } from 'zod';

/**
 * Measurement markets: the countries and languages a project can be measured
 * from. One list feeds the setup and project pickers, the market editor and
 * the API's validation, so the UI never offers a market the API rejects.
 * Which search surfaces support each country is the API's reviewed DataForSEO
 * locations file, not this list.
 */
export type MarketOption = { value: string; label: string };

export const MARKET_COUNTRIES: readonly MarketOption[] = [
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'IE', label: 'Ireland' },
  { value: 'DE', label: 'Germany' },
  { value: 'AT', label: 'Austria' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgium' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'ES', label: 'Spain' },
  { value: 'PT', label: 'Portugal' },
  { value: 'IT', label: 'Italy' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'PL', label: 'Poland' },
  { value: 'IN', label: 'India' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'SG', label: 'Singapore' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'IL', label: 'Israel' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'AR', label: 'Argentina' },
  { value: 'CL', label: 'Chile' },
  { value: 'CO', label: 'Colombia' },
];

export const MARKET_LANGUAGES: readonly MarketOption[] = [
  { value: 'en', label: 'English' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es', label: 'Spanish' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'pl', label: 'Polish' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
];

const labelOf = (options: readonly MarketOption[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

/** "Germany · German": a market's display name from its country and language. */
export function marketLabel(market: { country_code: string; language_code: string }): string {
  const parts = [
    market.country_code && labelOf(MARKET_COUNTRIES, market.country_code.toUpperCase()),
    market.language_code && labelOf(MARKET_LANGUAGES, market.language_code),
  ];
  return parts.filter(Boolean).join(' · ') || 'Default market';
}

const known = (options: readonly MarketOption[]) => new Set(options.map(({ value }) => value));
const countries = known(MARKET_COUNTRIES);
const languages = known(MARKET_LANGUAGES);

const marketCountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => countries.has(value), 'Unsupported market country');
const marketLanguageSchema = z
  .string()
  .trim()
  .refine((value) => languages.has(value), 'Unsupported market language');

/** A project's measurement market; the project default has `id: null`. */
export const projectMarketSchema = z.object({
  id: z.uuid().nullable(),
  label: z.string(),
  country_code: z.string(),
  language_code: z.string(),
  is_default: z.boolean(),
  created_at: z.string().nullable(),
});
export type ProjectMarket = z.infer<typeof projectMarketSchema>;

export const projectMarketCreateSchema = z.object({
  country_code: marketCountrySchema,
  language_code: marketLanguageSchema,
  label: z.string().trim().max(64).default(''),
});
export type ProjectMarketCreate = z.input<typeof projectMarketCreateSchema>;

/** The market a run measured, frozen at admission. */
export const auditMarketSchema = z.object({
  id: z.uuid().nullable(),
  country_code: z.string(),
  language_code: z.string(),
});
