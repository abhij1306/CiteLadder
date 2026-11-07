/** The one Unicode case fold for matching and identity text. */
import { policy } from './config.ts';

const overrides: Record<string, string> = policy.dataforseo.casefold_overrides;

/** Full case folding: each character's fold override, else its lower case. */
export function casefold(value: string): string {
  return Array.from(value, (char) => overrides[char] ?? char.toLowerCase()).join('');
}
