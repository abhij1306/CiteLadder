import type { Selectable } from 'kysely';
import type { ProviderConnections } from '../generated/db-schema.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { ProviderError } from './errors.ts';

type SecretConnection = Pick<Selectable<ProviderConnections>, 'api_key_encrypted'>;

/**
 * The connection's execution secret: the workspace's own key, decrypted.
 * Refused as an auth failure when unreadable. It lives only in the caller's
 * detached context, never in snapshots or logs.
 */
export function connectionSecret(connection: SecretConnection, encryptionKey: string): string {
  let secret: string | null;
  try {
    secret = createSecretCipher(encryptionKey).decrypt(connection.api_key_encrypted);
  } catch {
    secret = null;
  }
  if (secret === null) throw new ProviderError('auth_failure');
  return secret;
}
