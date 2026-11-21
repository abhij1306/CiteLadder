import { createHash } from 'node:crypto';

export function cspScriptHash(text: string): `sha256-${string}` {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}
