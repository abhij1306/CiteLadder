import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
import { productionEnv } from './production-config.ts';

describe('production startup admission', () => {
  it('starts with strong, independent application secrets', () => {
    expect(loadConfig(productionEnv).appEnv).toBe('production');
  });

  it.each([
    ['ENCRYPTION_KEY', 'changeme', 'ENCRYPTION_KEY'],
    ['REFERRAL_HASH_SALT', 'a'.repeat(64), 'REFERRAL_HASH_SALT'],
    ['API_KEY_PEPPER', 'replace-with-a-32-byte-minimum-api-key-pepper', 'API_KEY_PEPPER'],
    ['ENCRYPTION_KEY', productionEnv.API_KEY_PEPPER, 'independent'],
    ['MCP_TOKEN', 'short-token', 'MCP_TOKEN'],
  ])('refuses unsafe %s configuration', (name, value, reason) => {
    expect(() => loadConfig({ ...productionEnv, [name]: value })).toThrow(reason);
  });

  it('accepts a strong MCP token and an unset one', () => {
    expect(
      loadConfig({
        ...productionEnv,
        MCP_TOKEN: 'mcp-fixture-token-with-enough-variety-0123456789',
      }).appEnv,
    ).toBe('production');
    expect(loadConfig({ ...productionEnv, MCP_TOKEN: '' }).appEnv).toBe('production');
  });

  it('binds loopback unless HOST says otherwise', () => {
    expect(loadConfig(productionEnv).host).toBe('127.0.0.1');
    expect(loadConfig({ ...productionEnv, HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it('reports violations without disclosing the secret', () => {
    try {
      loadConfig({ ...productionEnv, ENCRYPTION_KEY: 'changeme' });
      expect.fail('startup should refuse a weak encryption key');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain('changeme');
    }
  });
});
