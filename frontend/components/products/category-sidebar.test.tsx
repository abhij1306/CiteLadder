import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { fireEvent, screen, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';
import { commerceQueries } from '@/lib/api/commerce';

import { CategorySidebar } from './category-sidebar';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ROAD = '22222222-2222-4222-8222-222222222222';
const TRAIL = '33333333-3333-4333-8333-333333333333';
const FLATS = '44444444-4444-4444-8444-444444444444';
const projectRoute = { projectSelection: { activeProject: makeProject({ id: PROJECT_ID }) } };

function Harness({
  category,
  onCategory,
}: Readonly<{ category: string | null; onCategory: (id: string | null) => void }>) {
  const query = useQuery(commerceQueries.catalog({ workspaceId: null, projectId: PROJECT_ID }));
  return <CategorySidebar query={query} category={category} onCategory={onCategory} />;
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function serveCatalog() {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT_ID}/commerce/catalog`, () =>
      HttpResponse.json({
        products: [],
        product_total: 1240,
        categories: [
          { id: ROAD, name: 'Road shoes', parent_id: null, product_count: 812 },
          { id: TRAIL, name: 'Trail shoes', parent_id: null, product_count: 0 },
          { id: FLATS, name: 'Racing flats', parent_id: ROAD, product_count: 0 },
        ],
        projection: { applicability: 'applicable', in_flight: 0, failed: 0 },
      }),
    ),
  );
}

describe('CategorySidebar', () => {
  it('lists every category under its parent with its product count and narrows the table to one', async () => {
    serveCatalog();
    const onCategory = vi.fn();
    renderWithProviders(<Harness category={null} onCategory={onCategory} />, projectRoute);

    const list = await screen.findByRole('list', { name: 'Categories' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['All categories1,240', 'Road shoes812', 'Racing flats0', 'Trail shoes0']);
    expect(within(list).getByRole('button', { name: /All categories/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(within(list).getByRole('button', { name: /Trail shoes/ }));
    expect(onCategory).toHaveBeenCalledWith(TRAIL);
  });

  it('opens the chosen category’s own page', async () => {
    serveCatalog();
    renderWithProviders(<Harness category={ROAD} onCategory={vi.fn()} />, projectRoute);

    const link = await screen.findByRole('link', { name: /Open Road shoes/ });
    expect(new URL(link.getAttribute('href')!, 'https://app.test').pathname).toBe(
      `/products/${ROAD}`,
    );
    expect(screen.getByRole('button', { name: /Road shoes/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
