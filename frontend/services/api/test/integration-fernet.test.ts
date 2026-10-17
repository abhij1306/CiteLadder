import { describe, expect, it } from 'vitest';

import { createSecretCipher } from '../src/integrations/fernet.ts';

describe('integration credential encryption', () => {
  it('decrypts a stored Fernet token', () => {
    const cipher = createSecretCipher('citeladder integration interop test key');
    expect(
      cipher.decrypt(
        'gAAAAABqyiQGOpYb4v9En9C8276d1M-QNTRF17wNL_fVWRgnTzM2IR6N_DI4nLEL-CSzXyTxAQk_i9usNgSBaQcxBEOB86vyCUPrw1hx1toohfu0xB-eUaHvFZe9l2ou491qFsmlDx7m',
      ),
    ).toBe('stored integration refresh token');
  });

  it('rejects a modified token before decrypting it', () => {
    const cipher = createSecretCipher('citeladder integration interop test key');
    const token = cipher.encrypt('refresh token');
    const changed = `${token.slice(0, 12)}${token[12] === 'A' ? 'B' : 'A'}${token.slice(13)}`;
    expect(() => cipher.decrypt(changed)).toThrow('Invalid encrypted credential');
  });
});
