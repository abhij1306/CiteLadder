import { businessModelSchema } from '@citeladder/contracts/project';
import { describe, expect, it, vi } from 'vitest';
import auditRuntime from '../src/config/audits.json' with { type: 'json' };
import trafficRuntime from '../src/config/traffic.json' with { type: 'json' };

import { ConfigError, loadConfig, policy, resolveSettingSpec } from '../src/config.ts';
import { poolOptions } from '../src/db/database.ts';
import { productionEnv } from './production-config.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';

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
    expect(() =>
      loadConfig({ APP_ENV: 'test', JEV_FAIL_BELOW: '0.5', JEV_FLAG_BELOW: '0.3' }),
    ).toThrow('Invalid JEV thresholds');
    expect(() =>
      loadConfig({ APP_ENV: 'test', JEV_DUPLICATE_FAIL_AT: '0.5', JEV_DUPLICATE_FLAG_AT: '0.7' }),
    ).toThrow('Invalid JEV thresholds');
    expect(() => loadConfig({ APP_ENV: 'test', JEV_BASE_URL: 'http://example.test' })).toThrow(
      'JEV_BASE_URL',
    );
    expect(() => loadConfig({ APP_ENV: 'test', JEV_BASE_URL: 'not-a-url' })).toThrow(ConfigError);
    for (const baseUrl of ['https://example.test?token=fixture', 'https://example.test#fragment'])
      expect(() => loadConfig({ APP_ENV: 'test', JEV_BASE_URL: baseUrl })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_ENV: 'test', JEV_TIMEOUT_SECONDS: '61' })).toThrow(ConfigError);
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
    const config = loadConfig({ APP_ENV: 'test' });
    expect(config.database.poolSize).toBe(policy.settings.db_pool_size.default);
  });

  it('validates every owner setting at startup and hands owners the startup values', () => {
    // Settings no startup field reads still refuse a bad value before any work.
    expect(() => loadConfig({ APP_ENV: 'test', INTEGRATION_LEASE_TTL_SECONDS: '0' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ APP_ENV: 'test', RUNNER_DB_POOL_SIZE: '5' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ APP_ENV: 'test', ANALYTICS_HEARTBEAT_INTERVAL_SECONDS: '100000' }),
    ).toThrow('heartbeat_interval_seconds');
    const config = loadConfig({
      APP_ENV: 'test',
      ANALYTICS_TASK_MAX_ATTEMPTS: '7',
      RUNNER_BUDGET_SECONDS: '90',
    });
    expect(loadWorkerSettings(config.settings).taskMaxAttempts).toBe(7);
    expect(config.execution.budgetSeconds).toBe(90);
  });

  it('matches environment names case-insensitively.', () => {
    expect(loadConfig({ APP_ENV: 'test', db_pool_size: '7' }).database.poolSize).toBe(7);
  });

  it('rejects a value at an exported exclusive maximum', () => {
    const spec = { env: ['BOUNDED'], type: 'float', default: 1, exclusive_maximum: 672 };
    expect(resolveSettingSpec(spec, { BOUNDED: '671.5' })).toBe(671.5);
    expect(() => resolveSettingSpec(spec, { BOUNDED: '672' })).toThrow(ConfigError);
  });

  it('enforces field bounds and literal values', () => {
    expect(() => loadConfig({ APP_ENV: 'test', DB_POOL_SIZE: '51' })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_ENV: 'test', DB_POOL_SIZE: 'twenty' })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_ENV: 'test', DB_SSL_MODE: 'prefer' })).toThrow(ConfigError);
  });

  it('refuses placeholder secrets outside development', () => {
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrow(/ENCRYPTION_KEY/u);
    const config = loadConfig(productionEnv);
    expect(poolOptions(config).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('carries the backend timeouts into the pool', () => {
    const options = poolOptions(loadConfig({ APP_ENV: 'test', DB_STATEMENT_TIMEOUT_MS: '9000' }));
    expect(options.statement_timeout).toBe(9000);
    expect(options.max).toBe(
      policy.settings.db_pool_size.default + policy.settings.db_max_overflow.default,
    );
  });

  it('sizes the API pool from its own settings even when it starts runner jobs', () => {
    const config = loadConfig({
      APP_ENV: 'test',
      DB_POOL_SIZE: '9',
      DB_MAX_OVERFLOW: '1',
      RUNNER_DB_POOL_SIZE: '3',
    });
    expect(poolOptions(config).max).toBe(10);
    expect(poolOptions(config, { execution: true }).max).toBe(3);
  });
});
