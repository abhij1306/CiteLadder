import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import type {
  BrandProfile,
  BusinessMap,
  PromptGenerateResponse,
  SeedQueries,
  Topic,
} from '@/lib/api/types';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { PromptBuilder } from './prompt-builder';

const projectId = '55555555-5555-4555-8555-555555555555';
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NETS = '11111111-1111-4111-8111-111111111111';
const QUERY = '22222222-2222-4222-8222-222222222222';
const OFFERING = 'Golf practice net (for gardens, and clubs)';
const noSources = {
  description: null,
  positioning: null,
  products_services: null,
  target_audience: null,
};
const profile: BrandProfile = {
  id: '33333333-3333-4333-8333-333333333333',
  workspace_id: workspaceId,
  project_id: projectId,
  brand_id: '44444444-4444-4444-8444-444444444444',
  description: '',
  positioning: '',
  products_services: [OFFERING],
  target_audience: '',
  business_context: { buyer_roles: ['Club coach'], market_scope: 'national' },
  sources: noSources,
  source_artifact_ids: noSources,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const map: BusinessMap = { offerings: [], available_offerings: [OFFERING] };
const topic: Topic = {
  id: NETS,
  project_id: projectId,
  parent_id: null,
  name: 'Golf nets',
  description: '',
  origin: 'manual',
  active_count: 0,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const seeds: SeedQueries = {
  sources: [
    {
      source: 'search_console',
      queries: [{ id: QUERY, text: 'best golf net for a small garden', topic_id: NETS }],
    },
  ],
};
const result: PromptGenerateResponse = {
  candidates: [],
  topics: [],
  dropped_duplicates: 0,
  requested_count: 10,
  candidates_generated: 0,
  quality_gate: 'off',
  quality_rejected: 0,
  admission_drops: {},
  shortfall_reason: null,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function serve(sent: { profile?: unknown; confirm?: unknown }) {
  mswServer.use(
    http.get(`/api/v1/projects/${projectId}/brand-profile`, () => HttpResponse.json(profile)),
    http.get(`/api/v1/projects/${projectId}/business-map`, () => HttpResponse.json(map)),
    http.get(`/api/v1/projects/${projectId}/seed-queries`, () => HttpResponse.json(seeds)),
    http.put(`/api/v1/projects/${projectId}/brand-profile`, async ({ request }) => {
      sent.profile = await request.json();
      return HttpResponse.json({
        ...profile,
        business_context: { ...profile.business_context, buyer_roles: ['Club coach', 'Parent'] },
      });
    }),
    http.post(`/api/v1/projects/${projectId}/topics/preview`, () =>
      HttpResponse.json({
        source: 'model',
        topics: [{ name: 'Golf simulator enclosures', offerings: [OFFERING] }],
        overflow: [{ name: 'Hitting mats', offerings: [OFFERING] }],
      }),
    ),
    http.post(`/api/v1/projects/${projectId}/topics/confirm`, async ({ request }) => {
      sent.confirm = await request.json();
      return HttpResponse.json([topic]);
    }),
  );
}

function renderBuilder(
  initialStep: 'business' | 'topics' | 'distribution',
  generate = vi.fn(async () => result),
) {
  const onTopicsChanged = vi.fn(async () => {});
  renderWithProviders(
    <PromptBuilder
      open
      onOpenChange={vi.fn()}
      initialStep={initialStep}
      projectId={projectId}
      workspaceId={workspaceId}
      topics={[topic]}
      hasCompetitors={false}
      generate={generate}
      isGenerating={false}
      onTopicsChanged={onTopicsChanged}
      review={<p>Review list</p>}
    />,
  );
  return { generate, onTopicsChanged };
}

describe('PromptBuilder', () => {
  it('prefills the business step and saves only what changed before moving on', async () => {
    const user = userEvent.setup({ delay: null });
    const sent: { profile?: unknown; confirm?: unknown } = {};
    serve(sent);
    renderBuilder('business');

    // Prefilled from saved knowledge; an offering with commas is one chip.
    const offerings = await screen.findByRole('list', { name: 'What you sell' });
    expect(
      within(offerings)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([OFFERING]);
    expect(screen.queryByRole('group', { name: 'Service areas' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Add to Buyer roles' }), 'Parent{Enter}');
    await user.click(screen.getByRole('button', { name: /Save and continue/ }));
    await waitFor(() => expect(sent.profile).toEqual({ buyer_roles: ['Club coach', 'Parent'] }));
    expect(await screen.findByRole('button', { name: 'Suggest topics' })).toBeVisible();
  });

  it('confirms reviewed topics as one plan, writing nothing before', async () => {
    const user = userEvent.setup({ delay: null });
    const sent: { profile?: unknown; confirm?: unknown } = {};
    serve(sent);
    const { onTopicsChanged } = renderBuilder('topics');

    // Proposals sit beside the existing topic; nothing is written until confirmed.
    await user.click(await screen.findByRole('button', { name: 'Suggest topics' }));
    expect(
      await screen.findByRole('textbox', { name: 'Topic name: Golf simulator enclosures' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Topic name: Golf nets' })).toBeVisible();
    // The offering links confirm will save are shown on the proposal.
    expect(screen.getByText(`Covers ${OFFERING}`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '+1 more' }));
    await user.click(screen.getByRole('button', { name: 'Remove Hitting mats' }));
    expect(sent.confirm).toBeUndefined();
    await user.click(screen.getByRole('button', { name: /Confirm topics/ }));
    await waitFor(() =>
      expect(sent.confirm).toEqual({
        create: [{ name: 'Golf simulator enclosures', offerings: [OFFERING] }],
        rename: [],
        delete: [],
      }),
    );
    await waitFor(() => expect(onTopicsChanged).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeVisible();
  });

  it('generates with every builder field, then lands in review with coverage', async () => {
    const user = userEvent.setup({ delay: null });
    serve({});
    const { generate } = renderBuilder('distribution');

    // Defaults, a persona from step 1 and the connected search source.
    await user.click(await screen.findByRole('checkbox', { name: 'Club coach' }));
    expect(
      await screen.findByRole('checkbox', { name: 'best golf net for a small garden' }),
    ).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /Competitor alternatives/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(generate).toHaveBeenCalledWith({
      count: 10,
      topic_ids: [],
      distribution: {
        branded_share: 0.2,
        comparison_share: 0,
        intent_mix: { informational: 25, commercial: 50, transactional: 25 },
        personas: ['Club coach'],
      },
      seed_source: 'search_console',
    });

    // Step 4: the run lands in review with its coverage.
    expect(await screen.findByText('Review list')).toBeVisible();
    expect(screen.getByText('Coverage by topic')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate more for Golf nets' })).toBeEnabled();
  });
});
