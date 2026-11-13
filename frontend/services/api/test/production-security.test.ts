import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, secretIsWeak } from '../src/config.ts';
import { productionEnv } from './production-config.ts';

/** Every non-empty secret-named value `.env.example` ships, commented examples included. */
function exampleSecrets(): Record<string, string> {
  const secretName = /(?:SECRET|PASSWORD|PEPPER|SALT|TOKEN|_KEY)(?:_PREVIOUS)?$/u;
  const text = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
  const secrets: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const [, name, value] = /^#?\s*([A-Z][A-Z0-9_]*)=(.+)$/u.exec(line.trim()) ?? [];
    if (name && value && secretName.test(name) && !/^(?:NEXT_)?PUBLIC_/u.test(name))
      secrets[name] = value.trim();
  }
  return secrets;
}

function startupRefusal(env: Record<string, string>): string {
  try {
    loadConfig(env);
    return 'started';
  } catch (error) {
    return error instanceof ConfigError ? error.message : String(error);
  }
}

describe('deployment environment admission (AR-1)', () => {
  const withoutAppEnv = Object.fromEntries(
    Object.entries(productionEnv).filter(([name]) => name !== 'APP_ENV'),
  );

  it('refuses to start without APP_ENV instead of falling back to development', () => {
    expect(startupRefusal(withoutAppEnv)).toBe(
      'APP_ENV must be set to one of development, test, production',
    );
  });

  it.each(['', 'prod', 'Production', 'staging', 'local'])(
    'refuses to start with the unknown APP_ENV %j',
    (APP_ENV) => {
      expect(startupRefusal({ ...withoutAppEnv, APP_ENV })).toBe(
        'app_env must be one of development, test, production',
      );
    },
  );

  it('starts each known environment', () => {
    expect(
      ['development', 'test', 'production'].map(
        (APP_ENV) => loadConfig({ ...withoutAppEnv, APP_ENV }).appEnv,
      ),
    ).toEqual(['development', 'test', 'production']);
  });
});

describe('.env.example secrets', () => {
  const secrets = exampleSecrets();

  it('fails every shipped secret against the production strength policy', () => {
    const admitted = Object.entries(secrets)
      .filter(([, value]) => !secretIsWeak(value))
      .map(([name]) => name);
    expect(admitted).toEqual([]);
  });

  it('treats a template value as weak by its shape', () => {
    for (const value of [
      'replace-with-a-long-random-value-0123456789',
      '<your-64-byte-random-secret>',
    ])
      expect(secretIsWeak(value)).toBe(true);
  });

  it('admits a deployment-grade secret that only contains a policy word', () => {
    expect(secretIsWeak('kV8-qZ3n-Lw7-Rt2-secret-Hy6-Pm4-Xc9-Jd1')).toBe(false);
  });
});

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
