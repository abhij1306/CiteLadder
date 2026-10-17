import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { commerceApi } from '@/lib/api/commerce';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import type { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';

import type { CommerceQueries } from './commerce-queries';
import { TargetDetail } from './target-detail';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_A = '22222222-2222-4222-8222-222222222222';
const PRODUCT_B = '33333333-3333-4333-8333-333333333333';

function shelfResponse(target: CommerceTarget, visibility: number) {
  return {
    target,
    snapshot: {
      product_visibility: visibility,
      share_of_shelf: null,
      average_shelf_position: null,
      first_position_win_rate: null,
      successful_execution_count: 2,
      recognized_slot_count: 0,
      ranked_execution_count: 0,
      measured_at: '2026-01-01T00:00:00Z',
    },
    holders: [],
    unresolved_count: 0,
    actions: [],
  };
}

// Competitors and buyer prompts are not target-scoped queries — the whole
// project's rows load once and are re-filtered per target — so a static
// settled result stands in for them here; only `shelf` is a real, network-
// backed query, which is the one piece this fix touches.
const emptyRowsQuery = { data: [], isPending: false, isError: false } as never;
const staticDiscovery = {
  tasks: [],
  discover: { isPending: false, mutate: vi.fn() },
} as unknown as ReturnType<typeof useCompetitorDiscovery>;

/**
 * Drives `TargetDetail` with a real, MSW-backed `shelf` query — the one
 * Commerce read keyed by the selection — while `catalog`, `competitors`, and
 * `buyerPrompts` stay static. Re-rendering with a new `target` is what
 * `CommerceWorkspace` does on a catalog click.
 */
function ShelfHarness({ target, label }: Readonly<{ target: CommerceTarget; label: string }>) {
  const shelf = useQuery({
    queryKey: queryKeys.commerce.shelf(PROJECT_ID, target),
    queryFn: ({ signal }) => commerceApi.shelf(PROJECT_ID, target, { signal }),
  });
  const queries: CommerceQueries = {
    catalog: emptyRowsQuery,
    competitors: emptyRowsQuery,
    buyerPrompts: emptyRowsQuery,
    shelf,
  };
  return (
    <TargetDetail
      projectId={PROJECT_ID}
      target={target}
      label={label}
      queries={queries}
      discovery={staticDiscovery}
    />
  );
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('TargetDetail', () => {
  /**
   * The bug this pins: clicking a second target used to blank the shelf card
   * to a skeleton the instant the click landed, then pop back once the new
   * target's numbers arrived — a collapse-then-grow the reader reads as a
   * flicker. `shelf` is the only Commerce read keyed by the selection, so it
   * is the only one with somewhere to lag; holding it keeps the panel on
   * product A, marked busy, until product B's read actually settles, then
   * swaps every card in the panel together rather than mixing A's numbers
   * with B's already-refiltered competitors and prompts.
   */
  it('keeps the first target on screen, with no blank state, until the second settles — then swaps as one piece', async () => {
    const productB: CommerceTarget = { kind: 'product', id: PRODUCT_B };
    let holdB = false;
    let releaseB!: () => void;
    const bSettled = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/commerce/ai-shelf`, async ({ request }) => {
        const targetId = new URL(request.url).searchParams.get('target_id');
        if (targetId === PRODUCT_B) {
          holdB = true;
          await bSettled;
          return HttpResponse.json(shelfResponse(productB, 0.9));
        }
        return HttpResponse.json(shelfResponse({ kind: 'product', id: PRODUCT_A }, 0.5));
      }),
    );

    const { rerender } = renderWithProviders(
      <ShelfHarness target={{ kind: 'product', id: PRODUCT_A }} label="Product A" />,
    );

    expect(await screen.findByRole('heading', { name: '50.0%' })).toBeVisible();

    rerender(<ShelfHarness target={productB} label="Product B" />);
    await waitFor(() => expect(holdB).toBe(true));

    // Still product A's heading and content — no skeleton stood in for it,
    // and no "Product B" caption sits over A's numbers while B is in flight.
    expect(screen.getByRole('heading', { name: '50.0%' })).toBeVisible();
    expect(screen.getByLabelText('Updating target detail')).toBeInTheDocument();

    act(() => releaseB());

    await waitFor(() => expect(screen.getByRole('heading', { name: '90.0%' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '50.0%' })).not.toBeInTheDocument();

    // The held target is adjusted DURING render, which loops if the query
    // result is not referentially stable across renders it did not cause.
    // Re-rendering the same selection repeatedly is what proves it settles.
    rerender(<ShelfHarness target={productB} label="Product B" />);
    rerender(<ShelfHarness target={productB} label="Product B" />);
    expect(screen.getByRole('heading', { name: '90.0%' })).toBeVisible();
    expect(screen.queryByLabelText('Updating target detail')).not.toBeInTheDocument();
  });

  it('starts the next target with an empty manual prompt', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT_ID}/commerce/ai-shelf`, ({ request }) => {
        const id = new URL(request.url).searchParams.get('target_id') ?? PRODUCT_A;
        return HttpResponse.json(shelfResponse({ kind: 'product', id }, 0.5));
      }),
    );
    const { rerender } = renderWithProviders(
      <ShelfHarness target={{ kind: 'product', id: PRODUCT_A }} label="Product A" />,
    );
    await screen.findByRole('heading', { name: '50.0%' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Manual buyer prompt' }), {
      target: { value: 'waterproof trail shoe under 100' },
    });

    rerender(<ShelfHarness target={{ kind: 'product', id: PRODUCT_B }} label="Product B" />);

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Manual buyer prompt' })).toHaveValue(''),
    );
  });
});
