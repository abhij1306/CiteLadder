import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OPPORTUNITY = '22222222-2222-4222-8222-222222222222';
const queryState = vi.hoisted(() => ({ data: null as unknown, error: null as unknown }));

/** The drawer opens on a project route, under the gate's project. */
const projectRoute = { projectSelection: { activeProject: makeProject({ id: PROJECT }) } };

vi.mock('@/lib/api/opportunities', () => ({
  opportunitiesQueries: {
    detail: (_workspaceId: string, opportunityId: string) => ({
      queryKey: ['opportunities', 'detail', opportunityId],
      queryFn: async () => {
        if (queryState.error) throw queryState.error;
        return queryState.data;
      },
    }),
  },
}));

vi.mock('@/components/opportunities/opportunity-evidence-section', () => ({
  OpportunityEvidenceSection: () => null,
}));
vi.mock('@/components/opportunities/opportunity-summary-section', () => ({
  OpportunitySummarySection: () => null,
}));

import { EvidenceDrawer } from './evidence-drawer';

beforeEach(() => {
  queryState.data = null;
  queryState.error = null;
});

describe('EvidenceDrawer authorization and recovery', () => {
  it('does not expose another project’s detail', async () => {
    queryState.data = {
      id: OPPORTUNITY,
      project_id: '33333333-3333-4333-8333-333333333333',
    };

    renderWithProviders(
      <EvidenceDrawer
        opportunityId={OPPORTUNITY}
        projectId={PROJECT}
        open
        onOpenChange={vi.fn()}
      />,
      projectRoute,
    );

    expect(await screen.findByText(/unavailable in the selected project/i)).toBeVisible();
  });

  it('keeps a failed direct detail link dismissible', async () => {
    const onOpenChange = vi.fn();
    queryState.error = new ApiError('Opportunity not found', 404, '');
    const user = userEvent.setup();

    renderWithProviders(
      <EvidenceDrawer
        opportunityId={OPPORTUNITY}
        projectId={PROJECT}
        open
        onOpenChange={onOpenChange}
      />,
      projectRoute,
    );

    expect(await screen.findByText('Opportunity not found')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
