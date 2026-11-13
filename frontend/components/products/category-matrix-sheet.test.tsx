import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import type { BuyerPrompt } from '@citeladder/contracts/commerce-suite';

import { CategoryMatrixSheet } from './category-matrix-sheet';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const route = { projectSelection: { activeProject: makeProject({ id: PROJECT_ID }) } };

function prompt(n: number, overrides: Partial<BuyerPrompt>): BuyerPrompt {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    prompt_set_id: '33333333-3333-4333-8333-333333333333',
    target: { kind: 'category', id: CATEGORY_ID },
    text: `prompt ${n}`,
    branded: false,
    buyer_stage: '',
    context: '',
    enabled: false,
    approved_at: null,
    ...overrides,
  };
}

const rows = [
  prompt(1, { text: 'rain jacket for cycling', context: 'Cyclist', buyer_stage: 'consideration' }),
  prompt(2, { text: 'best cycling shell under 150', context: 'Cyclist', buyer_stage: 'decision' }),
  prompt(3, { text: 'packable jacket for a hike', context: 'Hiker', buyer_stage: 'consideration' }),
  prompt(4, { text: 'Acme shell vs rival shell', buyer_stage: 'decision', branded: true }),
];

function renderSheet() {
  return renderWithProviders(
    <CategoryMatrixSheet
      projectId={PROJECT_ID}
      categoryId={CATEGORY_ID}
      categoryLabel="Rain jackets"
      rows={rows}
      open
      onOpenChange={() => {}}
    />,
    route,
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('CategoryMatrixSheet', () => {
  it('shows contexts × stages coverage and the branded count', () => {
    renderSheet();
    expect(screen.getByLabelText('Matrix coverage')).toHaveTextContent(
      '2 contexts × 2 stages (3 of 4 filled) · 1 branded',
    );
    expect(screen.getByText('Acme shell vs rival shell')).toBeVisible();
  });

  it('generates the category matrix without a count or hero flag', async () => {
    let body: unknown = null;
    mswServer.use(
      http.post(
        `/api/v1/projects/${PROJECT_ID}/commerce/buyer-prompts/generate`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json([], { status: 201 });
        },
      ),
    );
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Generate matrix' }));
    await waitFor(() => expect(body).toEqual({ targets: [{ kind: 'category', id: CATEGORY_ID }] }));
  });

  it('shows why generation was refused and retries it with the same idempotency key', async () => {
    const keys: (string | null)[] = [];
    let refuse = true;
    mswServer.use(
      http.post(`/api/v1/projects/${PROJECT_ID}/commerce/buyer-prompts/generate`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return refuse
          ? HttpResponse.json(
              {
                error: {
                  code: 'execution_credentials_unavailable',
                  message: 'No model provider key is configured',
                },
              },
              { status: 409 },
            )
          : HttpResponse.json([], { status: 201 });
      }),
    );
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Generate matrix' }));

    expect(await screen.findByText('No model provider key is configured')).toBeVisible();

    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Generate matrix' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByText('No model provider key is configured')).toBeNull(),
    );
    // A new request after a success gets a new key.
    fireEvent.click(screen.getByRole('button', { name: 'Generate matrix' }));
    await waitFor(() => expect(keys).toHaveLength(3));

    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('approves one prompt at a time', async () => {
    let body: unknown = null;
    mswServer.use(
      http.patch(
        `/api/v1/projects/${PROJECT_ID}/commerce/buyer-prompts/${rows[0]!.id}`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ ...rows[0], enabled: true });
        },
      ),
    );
    renderSheet();
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]!);
    await waitFor(() => expect(body).toEqual({ approved: true }));
  });
});
