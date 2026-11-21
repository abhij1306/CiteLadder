import { policy } from './config.ts';

const overrides: Record<string, string> = policy.dataforseo.casefold_overrides;

export function casefold(value: string): string {
  return Array.from(value, (char) => overrides[char] ?? char.toLowerCase()).join('');
}
