import { expect, it } from 'vitest';
import { loadConfig, policy } from '../src/config.ts';
import { validateSiteHealthCatalog } from '../src/config/site-health/validation.ts';
import { classifierVersion } from '../src/config/site-health.ts';
import { projectWebsiteRoot } from '../src/site-health/planner-policy.ts';

it.each([
  { SITE_HEALTH_MAX_ATTEMPTS: '0' },
  { SITE_HEALTH_MAX_ATTEMPTS: '-1' },
  { SITE_HEALTH_MAX_FRONTIER_URLS: '-1' },
  { SITE_HEALTH_RATE_LIMIT_COOLDOWN_SECONDS: '0' },
  { SITE_HEALTH_ROBOTS_CACHE_TTL_SECONDS: 'nan' },
  { SITE_HEALTH_SAMPLE_URL_LIMIT: '-1' },
  { SITE_HEALTH_SAMPLE_URL_LIMIT: '11', SITE_HEALTH_SAMPLE_DISCOVERY_URL_CAP: '10' },
  { SITE_HEALTH_AUTOMATIC_PAGE_LIMIT: '501', SITE_HEALTH_MAX_DISCOVERY_URLS: '500' },
  { SITE_HEALTH_HEARTBEAT_INTERVAL_SECONDS: '120', SITE_HEALTH_LEASE_TTL_SECONDS: '120' },
  { SITE_HEALTH_STALLED_CRAWL_RECONCILE_SECONDS: '120' },
  { SITE_HEALTH_GLOBAL_CONCURRENCY: '1', SITE_HEALTH_PER_HOST_CONCURRENCY: '2' },
  {
    SITE_HEALTH_ANALYSIS_DEPENDENCY_RETRY_SECONDS: '20',
    SITE_HEALTH_ANALYSIS_DEPENDENCY_RETRY_MAX_SECONDS: '10',
  },
  { SITE_HEALTH_ACQUISITION_POLICY_VERSION: ' ' },
])('refuses invalid crawl configuration before admitting work: %j', (env) => {
  expect(() => loadConfig({ APP_ENV: 'test', ...env })).toThrow();
});

it('keeps disabled samples and optional cadence/backstop controls valid', () => {
  expect(() =>
    loadConfig({
      APP_ENV: 'test',
      SITE_HEALTH_SAMPLE_URL_LIMIT: '0',
      SITE_HEALTH_SAMPLE_DISCOVERY_URL_CAP: '0',
      SITE_HEALTH_STALLED_CRAWL_RECONCILE_SECONDS: '0',
      SITE_HEALTH_OVERDUE_CRAWL_SECONDS: '0',
      SITE_HEALTH_LIVE_SCORE_REFRESH_PAGE_INTERVAL: '0',
      SITE_HEALTH_MONITORED_SEED_STAGGER_SECONDS: '0',
    }),
  ).not.toThrow();
});

it('refuses a catalog change that breaks triggered siblings or weighted pillar coverage', () => {
  const s = policy.site_health;
  const validate = (rules = s.rule_catalog, pillars = s.reads.aeo_check_pillar) =>
    validateSiteHealthCatalog(
      rules,
      s.reads.readiness_dimension_weights,
      pillars,
      s.reads.content_addressable_check_fields,
    );
  const triggered = s.rule_catalog.find((rule) => rule.kind_evidence === 'triggered')!;
  expect(() =>
    validate(
      s.rule_catalog.map((rule) =>
        rule === triggered ? { ...rule, triggered_by: 'missing.absence_rule' } : rule,
      ),
    ),
  ).toThrow('expectation sibling');
  expect(() =>
    validate(
      s.rule_catalog,
      Object.fromEntries(
        Object.entries(s.reads.aeo_check_pillar).filter(([, pillar]) => pillar !== 'structure'),
      ) as typeof s.reads.aeo_check_pillar,
    ),
  ).toThrow('pillar');
});

it('scores every visible page and site-root check and never a hidden diagnostic', () => {
  const s = policy.site_health;
  const validate = (rules: typeof s.rule_catalog) =>
    validateSiteHealthCatalog(
      rules,
      s.reads.readiness_dimension_weights,
      s.reads.aeo_check_pillar,
      s.reads.content_addressable_check_fields,
    );
  const replace = (ruleId: string, change: Partial<(typeof s.rule_catalog)[number]>) =>
    s.rule_catalog.map((rule) => (rule.rule_id === ruleId ? { ...rule, ...change } : rule));
  expect(() => validate(s.rule_catalog)).not.toThrow();
  expect(() =>
    validate(replace('technical.hsts_present', { score_roles: ['web_fundamentals'] })),
  ).toThrow('visible finding');
  expect(() =>
    validate(replace('technical.title_present', { score_roles: ['aeo_readiness'] })),
  ).toThrow('pillar disagree');
  expect(() => validate(replace('technical.h1_present', { finding_class: 'advisory' }))).toThrow(
    'Invalid Site Health rule policy: technical.h1_present',
  );
  for (const ruleId of ['technical.h1_present', 'technical.robots_txt_present'])
    expect(() => validate(replace(ruleId, { score_roles: [] }))).toThrow(
      `Unscored check ${ruleId}`,
    );
  expect(() =>
    validate(replace('technical.canonical_integrity', { score_roles: [] })),
  ).not.toThrow();
});

it('scopes a crawl to its own tenant of a shared hosting suffix', () => {
  expect(projectWebsiteRoot('https://acme.github.io/').domain).toBe('acme.github.io');
  expect(projectWebsiteRoot('https://www.example.com/').domain).toBe('example.com');
});

it('versions the classifier by every input it reads', () => {
  const routes = [['product', '/products?/']];
  const base = classifierVersion('sh-classifier-1', [{}, routes]);
  expect(classifierVersion('sh-classifier-1', [{}, routes])).toBe(base);
  expect(classifierVersion('sh-classifier-1', [{}, [['product', '/p/']]])).not.toBe(base);
  expect(base.startsWith('sh-classifier-1+')).toBe(true);
});
