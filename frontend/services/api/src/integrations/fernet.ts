import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Fernet wire format with the existing configured-secret SHA-256 derivation. */
export function createSecretCipher(secret: string) {
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const signing = key.subarray(0, 16);
  const encryption = key.subarray(16);
  return {
    encrypt(value: string): string {
      const header = Buffer.alloc(9);
      header[0] = 0x80;
      header.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 1);
      const iv = randomBytes(16);
      // Fernet requires CBC + PKCS7 with encrypt-then-HMAC, the standard Fernet token format.
      const cipher = createCipheriv('aes-128-cbc', encryption, iv); // NOSONAR: authenticated Fernet wire format.
      const body = Buffer.concat([header, iv, cipher.update(value, 'utf8'), cipher.final()]);
      const mac = createHmac('sha256', signing).update(body).digest();
      const encoded = Buffer.concat([body, mac])
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_');
      return encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    },
    decrypt(value: string): string {
      try {
        if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(value)) throw new Error('Invalid Fernet encoding');
        const token = Buffer.from(value, 'base64url');
        if (token.length < 73 || token[0] !== 0x80 || (token.length - 57) % 16 !== 0) {
          throw new Error('Invalid Fernet framing');
        }
        const body = token.subarray(0, -32);
        const mac = createHmac('sha256', signing).update(body).digest();
        if (!timingSafeEqual(mac, token.subarray(-32))) throw new Error('Invalid Fernet MAC');
        // Verify the HMAC before decrypting; callers receive only the sanitized catch message.
        const decipher = createDecipheriv('aes-128-cbc', encryption, token.subarray(9, 25)); // NOSONAR: authenticated Fernet wire format.
        return new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat([decipher.update(token.subarray(25, -32)), decipher.final()]),
        );
      } catch {
        throw new Error('Invalid encrypted credential');
      }
    },
  };
}
