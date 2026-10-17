import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type { BrandProfile } from '@/lib/api/types';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { BrandProfilePanel } from './brand-profile-panel';

const projectId = '55555555-5555-4555-8555-555555555555';

const profile: BrandProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '66666666-6666-4666-8666-666666666666',
  project_id: projectId,
  brand_id: '22222222-2222-4222-8222-222222222222',
  description: '',
  positioning: '',
  products_services: [],
  target_audience: '',
  business_context: {},
  sources: {
    description: null,
    positioning: null,
    products_services: null,
    target_audience: null,
  },
  source_artifact_ids: {
    description: null,
    positioning: null,
    products_services: null,
    target_audience: null,
  },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('BrandProfilePanel', () => {
  it('keeps saving unavailable while the workspace is unresolved', () => {
    renderWithProviders(<BrandProfilePanel projectId={projectId} profile={profile} />, {
      projectSelection: { activeWorkspaceId: null },
    });
    expect(screen.getByRole('button', { name: 'Save brand knowledge' })).toBeDisabled();
  });
  it('saves direct edits as manual knowledge', async () => {
    const user = userEvent.setup({ delay: null });
    const onSaved = vi.fn();
    let requestBody: unknown;
    mswServer.use(
      http.put(`/api/v1/projects/${projectId}/brand-profile`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({
          ...profile,
          description: 'A value-focused family retailer.',
          sources: {
            ...profile.sources,
            description: {
              origin: 'manual',
              review_state: 'confirmed',
              reviewed_by: null,
              reviewed_at: null,
            },
          },
        });
      }),
    );

    renderWithProviders(
      <BrandProfilePanel projectId={projectId} profile={profile} onSaved={onSaved} />,
    );
    await user.type(screen.getByLabelText('Description'), 'A value-focused family retailer.');
    await user.click(screen.getByRole('tab', { name: 'Audience & Offerings' }));
    await user.type(screen.getByLabelText('Products and services'), 'Clothing,');
    expect(screen.getByLabelText('Products and services')).toHaveValue('Clothing,');
    await user.click(screen.getByRole('button', { name: /save brand knowledge/i }));

    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
    expect(requestBody).toMatchObject({
      description: 'A value-focused family retailer.',
      products_services: ['Clothing'],
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('edits the confirmed category, buyer and market after onboarding', async () => {
    const user = userEvent.setup({ delay: null });
    let requestBody: unknown;
    mswServer.use(
      http.put(`/api/v1/projects/${projectId}/brand-profile`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(profile);
      }),
    );
    renderWithProviders(
      <BrandProfilePanel
        projectId={projectId}
        profile={{
          ...profile,
          business_context: { category: 'feed software', buyer_type: 'b2b' },
        }}
      />,
    );

    const category = screen.getByLabelText(/what you sell/i);
    expect(category).toHaveValue('feed software');
    expect(screen.getByRole('radio', { name: 'Businesses' })).toBeChecked();
    await user.clear(category);
    await user.type(category, 'product feed management platform');
    await user.click(screen.getByRole('radio', { name: 'Worldwide' }));
    await user.click(screen.getByRole('button', { name: /save brand knowledge/i }));

    await waitFor(() =>
      expect(requestBody).toMatchObject({
        category: 'product feed management platform',
        market_scope: 'global',
      }),
    );
    // Untouched facets and fields are not resubmitted, so they are not marked reviewed.
    expect(requestBody).toEqual({
      category: 'product feed management platform',
      market_scope: 'global',
    });
  });

  it('sends a cleared category so the save fails instead of silently reverting', async () => {
    const user = userEvent.setup({ delay: null });
    let requestBody: unknown;
    mswServer.use(
      http.put(`/api/v1/projects/${projectId}/brand-profile`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ error: { message: 'category is required' } }, { status: 422 });
      }),
    );
    renderWithProviders(
      <BrandProfilePanel
        projectId={projectId}
        profile={{ ...profile, business_context: { category: 'feed software' } }}
      />,
    );
    await user.clear(screen.getByLabelText(/what you sell/i));
    await user.click(screen.getByRole('button', { name: /save brand knowledge/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(requestBody).toEqual({ category: '' });
    expect(screen.getByLabelText(/what you sell/i)).toHaveValue('');
  });

  it('locks profile fields while a save is pending', async () => {
    const user = userEvent.setup({ delay: null });
    let finishSave: (() => void) | undefined;
    mswServer.use(
      http.put(`/api/v1/projects/${projectId}/brand-profile`, async () => {
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
        return HttpResponse.json({ ...profile, description: 'Submitted description.' });
      }),
    );

    renderWithProviders(<BrandProfilePanel projectId={projectId} profile={profile} />);
    const description = screen.getByLabelText('Description');
    await user.type(description, 'Submitted description.');
    await user.click(screen.getByRole('button', { name: /save brand knowledge/i }));

    await waitFor(() => expect(description).toBeDisabled());
    expect(screen.getByLabelText('Positioning')).toBeDisabled();
    finishSave?.();
    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
  });

  it('uses accessible tabs, preserves the draft, and shows tracked competitors', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <BrandProfilePanel
        projectId={projectId}
        profile={profile}
        competitors={[
          { name: 'Northstar', logo_url: 'https://assets.test/northstar.png', domains: [] },
          { name: 'Contoso', logo_url: null, domains: ['contoso.test'] },
        ]}
        competitorSuggestions={<p>Observed candidate</p>}
      />,
    );

    const factsTab = screen.getByRole('tab', { name: 'Facts & Positioning' });
    expect(factsTab).toHaveAttribute('aria-selected', 'true');
    await user.type(screen.getByLabelText('Description'), 'Draft description');

    factsTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Audience & Offerings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.type(screen.getByLabelText('Target audience'), 'Growth teams');

    await user.click(screen.getByRole('tab', { name: 'Facts & Positioning' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Draft description');

    await user.click(screen.getByRole('tab', { name: 'Competitors' }));
    expect(screen.getByText('Northstar')).toBeVisible();
    expect(screen.getByText('Northstar').parentElement?.querySelector('img')).toBeInTheDocument();
    expect(screen.getByText('Contoso')).toBeVisible();
    expect(screen.getByText('Observed candidate')).toBeVisible();
  });
});
