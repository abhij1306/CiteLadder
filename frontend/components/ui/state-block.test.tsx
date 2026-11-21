import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';

import { Button } from './button';
import { Card } from './card';
import { Masthead } from './masthead';
import { MastheadPrimary, PageEmptyOfferProvider } from './masthead-actions';
import { StateBlock, screenState } from './state-block';

type Coverage = Readonly<{ crawled_pages: number | null }>;
type MeasuredCoverage = Readonly<{ crawled_pages: number }>;

const isMeasured = (data: Coverage): data is MeasuredCoverage => data.crawled_pages !== null;

function CoverageScreen({ load }: Readonly<{ load: () => Promise<Coverage> }>) {
  const read = screenState(useQuery({ queryKey: ['coverage'], queryFn: load }), {
    subject: 'crawl coverage',
    shape: { kind: 'figures', count: 1 },
    hasMeasurement: isMeasured,
    notMeasured: { description: 'Coverage appears after the first crawl finishes.' },
  });
  if (read.kind === 'state') return <StateBlock {...read.state} />;
  return <p>{`${read.data.crawled_pages} pages crawled`}</p>;
}

function inTurn(...outcomes: Array<() => Promise<Coverage>>) {
  let next = 0;
  return () => outcomes[next++]?.() ?? Promise.reject(new Error('No answer left'));
}

function renderScreen(load: () => Promise<Coverage>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CoverageScreen load={load} />
    </QueryClientProvider>,
  );
  return client;
}

describe('screenState with StateBlock', () => {
  it('shows loading while the read is pending', async () => {
    renderScreen(() => new Promise<Coverage>(() => {}));

    expect(await screen.findByRole('status', { name: 'Loading crawl coverage…' })).toBeVisible();
  });

  it('says what failed to load and retries exactly that read', async () => {
    const load = inTurn(
      () => Promise.reject(new ApiError('Service unavailable', 503, '', 'request-7')),
      () => Promise.resolve({ crawled_pages: 12 }),
    );
    const user = userEvent.setup();
    renderScreen(load);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't load crawl coverageThe request failed or timed out.Retry",
    );
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('12 pages crawled')).toBeVisible();
  });

  it('says "No measurements yet", not zero, when the answer holds no measurement', async () => {
    renderScreen(() => Promise.resolve({ crawled_pages: null }));

    expect(await screen.findByRole('heading', { name: 'No measurements yet' })).toBeVisible();
    expect(screen.getByText('Coverage appears after the first crawl finishes.')).toBeVisible();
    expect(screen.queryByText(/pages crawled/)).not.toBeInTheDocument();
  });

  it('renders an observed zero as the measured value', async () => {
    renderScreen(() => Promise.resolve({ crawled_pages: 0 }));

    expect(await screen.findByText('0 pages crawled')).toBeVisible();
    expect(screen.queryByText('No measurements yet')).not.toBeInTheDocument();
  });

  it('reports a failed refetch instead of the stale answer', async () => {
    const load = inTurn(
      () => Promise.resolve({ crawled_pages: 4 }),
      () => Promise.reject(new Error('Network down')),
    );
    const client = renderScreen(load);
    expect(await screen.findByText('4 pages crawled')).toBeVisible();

    await client.refetchQueries({ queryKey: ['coverage'] });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load crawl coverage");
    expect(screen.queryByText('4 pages crawled')).not.toBeInTheDocument();
  });
});

describe('StateBlock empty states', () => {
  it('names an empty read with a page-level heading by default and offers its action', () => {
    render(
      <StateBlock
        kind="empty"
        heading="No prompts yet"
        description="Add a prompt to start measuring."
        action={<button type="button">Add prompt</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No prompts yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add prompt' })).toBeInTheDocument();
  });

  it('holds the view primary on the page, stepping the masthead primary down only while it shows', () => {
    const view = (state: ReactNode) => (
      <PageEmptyOfferProvider>
        <Masthead
          title="Prompts"
          actions={
            <MastheadPrimary>
              <Button variant="primary">Run audit</Button>
            </MastheadPrimary>
          }
        />
        {state}
      </PageEmptyOfferProvider>
    );
    const demoted = () =>
      screen.getByRole('button', { name: 'Run audit' }).closest('[data-demoted]') !== null;
    const offered = () =>
      screen.getByRole('button', { name: 'Add prompts' }).closest('[data-state-offer]') !== null;
    const empty = (
      <StateBlock kind="empty" heading="No prompts yet" action={<Button>Add prompts</Button>} />
    );

    const { rerender } = render(view(empty));
    expect([offered(), demoted()]).toEqual([true, true]);

    rerender(view(<Card>{empty}</Card>));
    expect([offered(), demoted()]).toEqual([false, false]);

    rerender(view(empty));
    expect(demoted()).toBe(true);
    rerender(view(<StateBlock kind="loading" />));
    expect(demoted()).toBe(false);
    rerender(view(<StateBlock kind="empty" heading="No prompts yet" />));
    expect(demoted()).toBe(false);
  });

  it("keeps the page's level inside a Card that renders no title of its own", () => {
    render(
      <Card>
        <StateBlock kind="empty" heading="No sources yet" />
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No sources yet' })).toBeInTheDocument();
  });

  it("names a disabled action's reason as visible text the control is described by", () => {
    render(
      <StateBlock
        kind="empty"
        heading="Run your first site crawl"
        action={
          <button type="button" disabled aria-describedby="crawl-note">
            Run new crawl
          </button>
        }
        actionNote={{ id: 'crawl-note', text: "Your role can't start a crawl." }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Run new crawl' })).toHaveAccessibleDescription(
      "Your role can't start a crawl.",
    );
    expect(screen.getByText("Your role can't start a crawl.")).toBeVisible();
  });

  it('offers to clear the filters when a filtered read matches nothing', async () => {
    let cleared = 0;
    const user = userEvent.setup();
    render(<StateBlock kind="filtered" onClear={() => (cleared += 1)} />);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cleared).toBe(1);
  });
});
