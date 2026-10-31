import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import type { ActionDeclaration } from '@/lib/api/actions';
import { localDay } from '@/lib/opportunities/declaration-date';

import { MarkImplementedButton } from './action-declaration';
import { DeclarationStatus } from './declaration-status';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-25T10:00:00Z';
const selection = {
  activeProjectId: PROJECT,
  activeProject: { id: PROJECT } as never,
  status: 'ready' as const,
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const daysAgo = (days: number) => {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return at;
};

describe('Mark implemented', () => {
  it('declares the chosen go-live day and refuses one outside the window', async () => {
    const posted: { declared_implemented_at: string }[] = [];
    mswServer.use(
      http.post(`/api/v1/actions/${ACTION}/declaration`, async ({ request }) => {
        posted.push((await request.json()) as { declared_implemented_at: string });
        return HttpResponse.json({ error: { message: 'stop here' } }, { status: 409 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <MarkImplementedButton
        workspaceId={WORKSPACE}
        revision={null}
        action={{
          id: ACTION,
          members: [{ id: MEMBER, title: 'Missing structured data' } as never],
          member_measurement: { [MEMBER]: null },
          declarable_since: daysAgo(30).toISOString(),
        }}
      />,
      { projectSelection: selection },
    );
    await user.click(screen.getByRole('button', { name: 'Mark implemented' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark implemented' });
    const field = within(dialog).getByLabelText('Go-live date');
    const submit = within(dialog).getByRole('button', { name: 'Declare implemented' });

    await user.clear(field);
    await user.type(field, localDay(daysAgo(40)));
    expect(submit).toBeDisabled();

    const day = localDay(daysAgo(3));
    await user.clear(field);
    await user.type(field, day);
    await user.click(submit);
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(localDay(new Date(posted[0]!.declared_implemented_at))).toBe(day);
  });
});

describe('Declaration status', () => {
  const declaration = (checks: ActionDeclaration['checks']): ActionDeclaration => ({
    id: '44444444-4444-4444-8444-444444444444',
    action_id: ACTION,
    output_revision_id: null,
    member_opportunity_ids: [MEMBER],
    opportunity_snapshot_id: '55555555-5555-4555-8555-555555555555',
    target_site_url_ids: [],
    target_external_url: null,
    declared_implemented_at: NOW,
    expected_checks: [],
    state: 'observed',
    limitations: [],
    verification_events: [],
    legs: [
      {
        leg: 'next_crawl',
        state: 'observed',
        due_at: null,
        last_evidence_at: NOW,
        source_id: null,
      },
    ],
    checks,
    measured_until: NOW,
    created_at: NOW,
  });
  const pageCheck = (state: ActionDeclaration['checks'][number]['state']) => ({
    index: 0,
    kind: 'site_rule',
    leg: 'next_crawl' as const,
    state,
    reason: state === 'unavailable' ? 'page_not_analyzed' : null,
    observed_at: NOW,
    source_kind: 'site_crawl',
    source_id: null,
    subject: 'Missing structured data',
  });

  it("links a prompt check to that prompt's history", () => {
    const promptId = '33333333-3333-4333-8333-333333333333';
    renderWithProviders(
      <DeclarationStatus
        declaration={declaration([
          {
            ...pageCheck('met'),
            kind: 'visibility_metric',
            leg: 'next_visibility_run',
            subject: 'best crm for agencies',
            prompt_id: promptId,
          },
        ])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(screen.getByRole('link', { name: 'best crm for agencies' })).toHaveAttribute(
      'href',
      expect.stringMatching(new RegExp(`^/prompts/${promptId}(\\?|$)`)),
    );
  });

  it('offers a crawl while a page check lacks a met reading, and says why', () => {
    const { unmount } = renderWithProviders(
      <DeclarationStatus
        declaration={declaration([pageCheck('unavailable')])}
        workspaceId={WORKSPACE}
      />,
      { projectSelection: selection },
    );
    expect(screen.getByText(/The page was not read in that crawl/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run crawl now' })).toBeEnabled();
    unmount();

    renderWithProviders(
      <DeclarationStatus declaration={declaration([pageCheck('met')])} workspaceId={WORKSPACE} />,
      { projectSelection: selection },
    );
    expect(screen.queryByRole('button', { name: 'Run crawl now' })).not.toBeInTheDocument();
  });
});
