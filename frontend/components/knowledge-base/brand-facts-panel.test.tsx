import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { BrandFactList } from '@citeladder/contracts/fact-checking';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { BrandFactsPanel } from './brand-facts-panel';

const projectId = '55555555-5555-4555-8555-555555555555';
const workspaceId = '66666666-6666-4666-8666-666666666666';
const factId = '77777777-7777-4777-8777-777777777777';

const list: BrandFactList = {
  enabled: true,
  facts: [
    {
      id: factId,
      topic: 'pricing',
      statement: 'Pro costs $59 per month.',
      source_url: null,
      status: 'confirmed',
      revision: 2,
      updated_at: '2026-10-10T00:00:00Z',
    },
  ],
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('BrandFactsPanel', () => {
  it('keeps an edited fact open with its draft when the save is refused', async () => {
    const user = userEvent.setup({ delay: null });
    mswServer.use(
      http.patch(`/api/v1/projects/${projectId}/brand-facts/${factId}`, () =>
        HttpResponse.json(
          { error: { message: 'This fact changed since it was loaded; reload and try again' } },
          { status: 409 },
        ),
      ),
      http.get(`/api/v1/projects/${projectId}/brand-facts`, () => HttpResponse.json(list)),
    );
    renderWithProviders(
      <BrandFactsPanel workspaceId={workspaceId} projectId={projectId} list={list} mayEdit />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const draft = screen.getByRole('textbox', { name: 'Edit fact' });
    await user.clear(draft);
    await user.type(draft, 'Pro costs $69 per month.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit fact' })).toHaveValue(
      'Pro costs $69 per month.',
    );
  });
});
