import { expect, test } from '@playwright/test';

import { FIXTURE_PROJECT, stubAuthedShell } from './helpers/app-fixture';

const DISCOVERY_ID = '33333333-3333-4333-8333-333333333333';

const catalog = {
  maximum_competitors: 5,
  industries: ['General', 'Education', 'Professional Services'],
  subindustries: { General: [], Education: [], 'Professional Services': [] },
};

const readyDiscovery = {
  id: DISCOVERY_ID,
  workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  project_id: null,
  status: 'ready',
  progress: {
    phase: 'preparing_review',
    completed_steps: 3,
    total_steps: 4,
    pages_read: 1,
    competitors_found: 2,
  },
  input_data: {
    brand_name: 'Acme Academy',
    website_url: 'https://www.acme-academy.example/',
    industry: 'Education',
    subindustry: '',
    primary_market: 'IN',
    language_code: 'en',
  },
  profile: {
    description: 'A co-educational day cum boarding school in Dehradun, India.',
    positioning: 'A day and boarding school for families in Dehradun.',
    products_services: ['Education'],
    target_audience: 'Families',
    industry: 'Education',
    business_type: 'b2c',
    price_tier: 'unknown',
    field_confidence: {},
  },
  domains: ['acme-academy.example'],
  competitors: [
    {
      name: 'The Doon School',
      aliases: [],
      domains: ['doonschool.com'],
    },
    {
      name: "Welham Girls' School",
      aliases: [],
      domains: ['welhamgirls.com'],
    },
  ],
  evidence: [],
  warnings: [],
  error_code: '',
  created_at: '2026-08-09T00:00:00Z',
  updated_at: '2026-08-09T00:00:01Z',
};

test('onboarding advances through a prompt-free review with sequential progress', async ({
  page,
}) => {
  await stubAuthedShell(
    page,
    [
      ['**/api/v1/brand-discovery-catalog', catalog],
      ['**/api/v1/brand-discoveries', readyDiscovery],
      [`**/api/v1/brand-discoveries/${DISCOVERY_ID}`, readyDiscovery],
    ],
    [],
  );

  await page.goto('/onboarding');
  await expect(page.locator('[data-brand-canvas]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Setup progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Let's get started" })).toBeVisible();

  await page.getByLabel(/^Brand name/).fill('Acme Academy');
  await page.getByLabel(/^Website/).fill('acme-academy.example');
  await page.getByRole('button', { name: 'Continue' }).click();
  const discoveryHeading = page.getByRole('heading', { name: 'Finding what to track' });
  await expect(discoveryHeading).toBeVisible();

  const progress = page.getByRole('progressbar', { name: /steps complete/ });
  await expect(progress).not.toHaveAttribute('aria-valuenow', '4');
  await expect(progress).toHaveAttribute('aria-valuenow', '4', { timeout: 4_000 });

  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Does this look right?' })).toBeVisible();
  await expect(page.getByText('Online Footprint & Peers')).toHaveCount(0);
  await expect(page.getByText('AI Discovered')).toHaveCount(0);
  await expect(page.getByText('acme-academy.example')).toBeVisible();
  await expect(page.getByText('The Doon School')).toBeVisible();
  await expect(page.getByText(/Starting Prompts/i)).toHaveCount(0);
});

test('first creation opens the project and keeps new projects available', async ({ page }) => {
  let created = false;
  await stubAuthedShell(
    page,
    [
      ['**/api/v1/brand-discovery-catalog', catalog],
      ['**/api/v1/brand-discoveries', readyDiscovery],
      [`**/api/v1/brand-discoveries/${DISCOVERY_ID}`, readyDiscovery],
      [`**/api/v1/projects/${FIXTURE_PROJECT.id}`, FIXTURE_PROJECT],
    ],
    [],
  );
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({ json: created ? [FIXTURE_PROJECT] : [] }),
  );
  await page.route(`**/api/v1/brand-discoveries/${DISCOVERY_ID}/complete`, (route) => {
    created = true;
    return route.fulfill({
      json: {
        discovery_id: DISCOVERY_ID,
        project_id: FIXTURE_PROJECT.id,
        warnings: [],
      },
    });
  });
  await page.goto('/projects');
  await page.getByLabel(/^Brand name/).fill('Acme Academy');
  await page.getByLabel(/^Website/).fill('acme-academy.example');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('radio', { name: 'Other', exact: true }).click();
  await page.getByLabel(/describe what you sell/i).fill('boarding school');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(`/projects?project=${FIXTURE_PROJECT.id}`);
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toHaveCount(0);

  for (let visit = 0; visit < 2; visit += 1) {
    await page.getByRole('button', { name: FIXTURE_PROJECT.brand_name, exact: true }).click();
    await page.getByRole('menuitem', { name: 'New project' }).click();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Brand name/)).toHaveValue('');
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(`/projects?project=${FIXTURE_PROJECT.id}`);
  }
});
