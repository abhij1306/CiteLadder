import assert from 'node:assert/strict';
import test from 'node:test';

import { boundaryFindings, REPO_ROOT, trackedFiles } from './oss-boundary.mjs';

const rules = (files) => boundaryFindings(files).map(({ rule, path }) => `${rule}:${path}`);

test('the repository holds no hosted-only files or dependencies', () => {
  assert.deepEqual(boundaryFindings(trackedFiles(REPO_ROOT)), []);
});

test('flags the website, billing, login and hosting paths a change could bring along', () => {
  assert.deepEqual(
    rules([
      { path: 'frontend/apps/marketing/src/main.tsx' },
      { path: 'frontend/components/marketing/hero.tsx' },
      { path: 'frontend/apps/docs/index.md' },
      { path: 'frontend/components/billing/plan-card.tsx' },
      { path: 'frontend/services/api/src/billing/invoices.ts' },
      { path: 'frontend/services/api/src/routes/billing.ts' },
      { path: 'frontend/components/auth/sign-in-form.tsx' },
      { path: '.github/workflows/gcp-deploy.yml' },
      { path: 'frontend/apps/app/wrangler.jsonc' },
      { path: 'infra/main.tf' },
    ]),
    [
      'marketing-or-docs-site:frontend/apps/marketing/src/main.tsx',
      'marketing-or-docs-site:frontend/components/marketing/hero.tsx',
      'marketing-or-docs-site:frontend/apps/docs/index.md',
      'billing:frontend/components/billing/plan-card.tsx',
      'billing:frontend/services/api/src/billing/invoices.ts',
      'billing:frontend/services/api/src/routes/billing.ts',
      'login:frontend/components/auth/sign-in-form.tsx',
      'hosting-infra:.github/workflows/gcp-deploy.yml',
      'hosting-infra:frontend/apps/app/wrangler.jsonc',
      'hosting-infra:infra/main.tf',
    ],
  );
});

test('leaves product code that only shares a word with the hosted product', () => {
  assert.deepEqual(
    rules([
      { path: 'frontend/services/api/src/models/pricing.ts' },
      { path: 'frontend/services/api/src/audits/repricing.ts' },
      { path: 'frontend/components/ai-traffic/gcp-pull-setup.tsx' },
      { path: 'frontend/services/api/src/crawl-logs/gcp-client.ts' },
      { path: '.github/workflows/ci.yml' },
      { path: '.env.example' },
    ]),
    [],
  );
});

test('flags committed env files and keys, but not the settings template', () => {
  assert.deepEqual(
    rules([
      { path: '.env' },
      { path: 'frontend/.env.production' },
      { path: 'certs/server.pem' },
      { path: 'service-account-prod.json' },
      { path: '.env.example' },
    ]),
    [
      'secret-file:.env',
      'secret-file:frontend/.env.production',
      'secret-file:certs/server.pem',
      'secret-file:service-account-prod.json',
    ],
  );
});

test('flags payment, deploy and analytics dependencies in any manifest', () => {
  const manifest = JSON.stringify({
    dependencies: { stripe: '1', zod: '4' },
    devDependencies: { wrangler: '4', vitest: '5' },
  });
  assert.deepEqual(
    boundaryFindings([{ path: 'frontend/package.json', text: manifest }]).map(
      ({ detail }) => detail,
    ),
    [
      'dependencies has stripe, which only the hosted product uses',
      'devDependencies has wrangler, which only the hosted product uses',
    ],
  );
});
