import { createHmac, hkdfSync } from 'node:crypto';
import { z } from 'zod';
import { policy } from '../config.ts';
import { createSecretCipher } from '../integrations/fernet.ts';

const credential = z.object({ login: z.string().min(1), password: z.string().min(1) });
const stripCharacters = new Set(Array.from(policy.dataforseo.strip_characters));
/** Password changes and connection IDs do not split a provider account's quota pool. */
export function dataforseoAccountIdentity(encryptedSecret: string, encryptionKey: string) {
  return dataforseoSecretIdentity(
    createSecretCipher(encryptionKey).decrypt(encryptedSecret),
    encryptionKey,
  );
}
/** The quota-pool identity of a decrypted DataForSEO login pair. */
export function dataforseoSecretIdentity(packed: string, encryptionKey: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(packed);
  } catch {
    throw new Error('Stored DataForSEO credential is unreadable');
  }
  const result = credential.safeParse(payload);
  if (!result.success) throw new Error('Stored DataForSEO credential is unreadable');
  const overrides: Record<string, string> = policy.dataforseo.casefold_overrides;
  const characters = Array.from(result.data.login);
  let start = 0,
    end = characters.length;
  while (start < end && stripCharacters.has(characters[start]!)) start += 1;
  while (end > start && stripCharacters.has(characters[end - 1]!)) end -= 1;
  const login = characters
    .slice(start, end)
    .map((char) => overrides[char] ?? char.toLowerCase())
    .join('');
  const key = hkdfSync(
    'sha256',
    Buffer.from(encryptionKey, 'utf8'),
    Buffer.alloc(0),
    Buffer.from('citeladder:dataforseo:account-identity:v1'),
    32,
  );
  return createHmac('sha256', Buffer.from(key)).update(login, 'utf8').digest('hex');
}
