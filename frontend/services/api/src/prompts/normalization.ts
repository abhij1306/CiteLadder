/**
 * Prompt-text identity: the per-set dedupe key.
 *
 * Writers compute this persisted hash before insertion; schema fixtures
 * supply it explicitly.
 */
import { policy } from '../config.ts';
import { collapseIdentityWhitespace, hash } from '../traffic/normalization.ts';

const TRAILING = new Set(policy.prompts.trailing_punctuation);

/** Lower-case, collapse whitespace, and strip trailing punctuation. */
function normalizePromptText(text: string): string {
  const characters = [...collapseIdentityWhitespace(text).toLowerCase()];
  let end = characters.length;
  while (end > 0 && TRAILING.has(characters[end - 1]!)) end -= 1;
  return characters.slice(0, end).join('');
}

/** sha256 hex digest of the normalized text: the dedupe key. */
export const promptTextHash = (text: string): string => hash(normalizePromptText(text));
