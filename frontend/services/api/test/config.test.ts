import { businessModelSchema } from '@citeladder/contracts/project';
import { describe, expect, it, vi } from 'vitest';
import auditRuntime from '../src/config/audits.json' with { type: 'json' };
import trafficRuntime from '../src/config/traffic.json' with { type: 'json' };

import { ConfigError, loadConfig, policy, resolveSettingSpec } from '../src/config.ts';
import { poolOptions } from '../src/db/database.ts';
import { productionEnv } from './production-config.ts';

it('lets the brand profile edit every business model discovery can resolve', () => {
  expect(businessModelSchema.options).toEqual(policy.discovery.constants.business_models);
});

describe('loadConfig', () => {
  it('reports missing provider routes as configuration failures during composition', async () => {
    vi.resetModules();
    vi.doMock('../src/config/audits.json', () => ({
      default: {
        ...auditRuntime,
        route_policies: { ...auditRuntime.route_policies, unregistered: {} },
      },
    }));
    try {
      await expect(import('../src/config/audits.ts')).rejects.toThrow(
        'Audit engine unregistered has no provider route',
      );
    } finally {
      vi.doUnmock('../src/config/audits.json');
      vi.resetModules();
    }
  });

  it('derives unavailable performance dimensions from excluded acquisition datasets', async () => {
    vi.resetModules();
    vi.doMock('../src/config/traffic.json', () => ({
      default: {
        ...trafficRuntime,
        PERFORMANCE_DIMENSION_DATASETS: {
          ...trafficRuntime.PERFORMANCE_DIMENSION_DATASETS,
          unavailable: 'gsc_search_appearance_daily',
        },
      },
    }));
    try {
      const { traffic } = await import('../src/config/connected-data.ts');
      expect(traffic.PERFORMANCE_UNAVAILABLE_DIMENSIONS).toContain('unavailable');
    } finally {
      vi.doUnmock('../src/config/traffic.json');
      vi.resetModules();
    }
  });
  it('refuses invalid JEV thresholds and destinations before accepting work', () => {
    expect(() => loadConfig({ JEV_FAIL_BELOW: '0.5', JEV_FLAG_BELOW: '0.3' })).toThrow(
      'Invalid JEV thresholds',
    );
    expect(() =>
      loadConfig({ JEV_DUPLICATE_FAIL_AT: '0.5', JEV_DUPLICATE_FLAG_AT: '0.7' }),
    ).toThrow('Invalid JEV thresholds');
    expect(() => loadConfig({ JEV_BASE_URL: 'http://example.test' })).toThrow('JEV_BASE_URL');
    expect(() => loadConfig({ JEV_BASE_URL: 'not-a-url' })).toThrow(ConfigError);
    for (const baseUrl of ['https://example.test?token=fixture', 'https://example.test#fragment'])
      expect(() => loadConfig({ JEV_BASE_URL: baseUrl })).toThrow(ConfigError);
    expect(() => loadConfig({ JEV_TIMEOUT_SECONDS: '61' })).toThrow(ConfigError);
  });
  it('resolves native abuse budgets with case-insensitive aliases and positive integer bounds', () => {
    const spec = policy.abuse.crawl_create_limit;
    expect(resolveSettingSpec(spec, { abuse_crawl_create_limit: '7' })).toBe(7);
    for (const value of ['0', '-1', '1.5']) {
      expect(() => resolveSettingSpec(spec, { ABUSE_CRAWL_CREATE_LIMIT: value })).toThrow(
        ConfigError,
      );
    }
  });

  it('uses native config defaults when the environment is silent', () => {
    const config = loadConfig({});
    expect(config.database.poolSize).toBe(policy.settings.db_pool_size.default);
  });

  it('matches environment names case-insensitively.', () => {
    expect(loadConfig({ db_pool_size: '7' }).database.poolSize).toBe(7);
  });

  it('rejects a value at an exported exclusive maximum', () => {
    const spec = { env: ['BOUNDED'], type: 'float', default: 1, exclusive_maximum: 672 };
    expect(resolveSettingSpec(spec, { BOUNDED: '671.5' })).toBe(671.5);
    expect(() => resolveSettingSpec(spec, { BOUNDED: '672' })).toThrow(ConfigError);
  });

  it('enforces field bounds and literal values', () => {
    expect(() => loadConfig({ DB_POOL_SIZE: '51' })).toThrow(ConfigError);
    expect(() => loadConfig({ DB_POOL_SIZE: 'twenty' })).toThrow(ConfigError);
    expect(() => loadConfig({ DB_SSL_MODE: 'prefer' })).toThrow(ConfigError);
  });

  it('refuses placeholder secrets outside development', () => {
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrow(/ENCRYPTION_KEY/u);
    const config = loadConfig(productionEnv);
    expect(poolOptions(config).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('carries the backend timeouts into the pool', () => {
    const options = poolOptions(loadConfig({ DB_STATEMENT_TIMEOUT_MS: '9000' }));
    expect(options.statement_timeout).toBe(9000);
    expect(options.max).toBe(
      policy.settings.db_pool_size.default + policy.settings.db_max_overflow.default,
    );
  });
});
