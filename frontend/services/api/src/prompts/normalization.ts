import { policy } from '../config.ts';
import { hash } from '../crypto-text.ts';
import { collapseIdentityWhitespace } from '../traffic/normalization.ts';

const TRAILING = new Set(policy.prompts.trailing_punctuation);

function normalizePromptText(text: string): string {
  const characters = [...collapseIdentityWhitespace(text).toLowerCase()];
  let end = characters.length;
  while (end > 0 && TRAILING.has(characters[end - 1]!)) end -= 1;
  return characters.slice(0, end).join('');
}

export const promptTextHash = (text: string): string => hash(normalizePromptText(text));
