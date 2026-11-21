import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { FilterBar } from '@/components/ui/filter-bar';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import type { VisibilityView } from '@/lib/visibility/dashboard';
import { chooseFilterOption } from '@/test/all-filters';
import { renderWithProviders as render } from '@/test/render';

import { VisibilityActions, useVisibilityFilterMenu } from './visibility-toolbar';

type MenuProps = Parameters<typeof useVisibilityFilterMenu>[0];

function Row(props: MenuProps) {
  return <FilterBar filters={useVisibilityFilterMenu(props)} />;
}

function renderRow({
  view = 'insights',
  selectionMode,
  ...overrides
}: Partial<MenuProps> & { view?: VisibilityView; selectionMode: 'run' | 'range' }) {
  return render(
    <Row
      view={view}
      selectionMode={selectionMode}
      runs={[]}
      selectedRunId={null}
      onSelectMeasurement={vi.fn()}
      engine="all"
      onChangeEngine={vi.fn()}
      promptOptions={[]}
      promptId={null}
      onChangePrompt={vi.fn()}
      range="90d"
      onSelectPeriod={vi.fn()}
      granularity="run"
      onChangeGranularity={vi.fn()}
      cohort="core"
      onChangeCohort={vi.fn()}
      {...overrides}
    />,
  );
}

function rowChips(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-haspopup') === 'menu')
    .map((button) => button.getAttribute('aria-label') ?? '')
    .filter((name) => !name.startsWith('Filters'));
}

async function filtersMenu(): Promise<string[]> {
  await userEvent.setup().click(screen.getByRole('button', { name: /^Filters/ }));
  return screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? '');
}

const MARKETS: ProjectMarket[] = [
  {
    id: null,
    label: 'United States',
    country_code: 'US',
    language_code: 'en',
    is_default: true,
    created_at: null,
  },
  {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Germany',
    country_code: 'DE',
    language_code: 'de',
    is_default: false,
    created_at: null,
  },
];
const TOPICS = [{ id: 't1', name: 'Pricing' }];

describe('useVisibilityFilterMenu', () => {
  it('gives each filter its own chip while the row has room, and Filters only to two or more', async () => {
    const topics = { topics: TOPICS, onChangeTopic: vi.fn() };
    const markets = { markets: MARKETS, onChangeMarket: vi.fn() };
    const { unmount } = renderRow({ selectionMode: 'run', ...topics });
    expect(rowChips()).toEqual([
      'Measurement: Latest run',
      'Engines: All engines',
      'Prompts: Unbranded',
      'Topic: All topics',
    ]);
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    unmount();

    const pooled = renderRow({ selectionMode: 'range', range: '30d', ...topics });
    expect(rowChips()).toEqual([
      'Measurement: Last 30 days',
      'Engines: All engines',
      'Prompts: Unbranded',
      'Topic: All topics',
      'Group by: Per run',
    ]);
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    pooled.unmount();

    renderRow({ view: 'competitor', selectionMode: 'range', range: '30d', ...topics, ...markets });
    expect(rowChips()).toEqual([
      'Measurement: Last 30 days',
      'Engines: All engines',
      'Market: United States',
      'Topic: All topics',
    ]);
    expect(await filtersMenu()).toEqual(['Prompts: Unbranded', 'Group by: Per run']);
  });

  it('draws a fifth filter left alone as its own chip rather than a one-entry Filters', () => {
    const markets = { markets: MARKETS, onChangeMarket: vi.fn() };
    const { unmount } = renderRow({
      selectionMode: 'run',
      ...markets,
      topics: TOPICS,
      topic: 't1',
      onChangeTopic: vi.fn(),
    });
    expect(rowChips()).toEqual([
      'Measurement: Latest run',
      'Engines: All engines',
      'Market: United States',
      'Prompts: Unbranded',
      'Topic: Pricing',
    ]);
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    unmount();

    const perception = renderRow({ view: 'perception', selectionMode: 'run', cohort: 'all' });
    expect(rowChips()).toEqual([
      'Measurement: Latest run',
      'Engines: All engines',
      'Prompts: All prompts',
    ]);
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
    perception.unmount();

    renderRow({
      view: 'competitors',
      selectionMode: 'run',
      cohort: 'all',
      ...markets,
      topics: TOPICS,
      onChangeTopic: vi.fn(),
    });
    expect(rowChips()).toEqual([
      'Measurement: Latest run',
      'Engines: All engines',
      'Market: United States',
      'Topic: All topics',
      'Prompts: All prompts',
    ]);
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });

  it('lists the prompt and answer outcome in Filters only where answers are shown', async () => {
    renderRow({
      view: 'query-fanout',
      selectionMode: 'run',
      promptOptions: [{ id: 'p1', label: 'Best CRM?' }],
      promptId: 'p1',
      onChangeOutcome: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Prompt filter' })).toBeVisible();
    expect(await filtersMenu()).toEqual(['Prompt: Best CRM?', 'Answer outcome: All answers']);
  });

  it('names the latest run at the row’s end while the measurement shows only its icon', () => {
    const runs = [
      { id: 'run-2', status: 'completed' as const, label: '2 Nov 2026', completedAt: null },
    ];
    const { unmount } = renderRow({ selectionMode: 'run', runs });
    expect(screen.getByText('Latest run · 2 Nov 2026')).toBeVisible();
    unmount();
    renderRow({ selectionMode: 'run', runs, selectedRunId: 'run-2' });
    expect(screen.queryByText(/Latest run ·/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Measurement: 2 Nov 2026' })).toBeVisible();
  });

  it('pools a period from the measurement chip, and picks a run by id', async () => {
    const user = userEvent.setup();
    const onSelectPeriod = vi.fn();
    const onSelectMeasurement = vi.fn();
    renderRow({
      selectionMode: 'run',
      runs: [{ id: 'run-2', status: 'completed', label: '2 Nov 2026', completedAt: null }],
      onSelectPeriod,
      onSelectMeasurement,
    });
    await chooseFilterOption(user, 'Measurement', 'Last 12 months');
    expect(onSelectPeriod.mock.calls).toEqual([['1y']]);
    await chooseFilterOption(user, 'Measurement', '2 Nov 2026');
    expect(onSelectMeasurement.mock.calls).toEqual([['run-2']]);
  });
});

describe('VisibilityActions', () => {
  it('links the metrics help to the FAQ and offers no export', () => {
    render(<VisibilityActions />);
    expect(screen.getByRole('link', { name: 'About these metrics' })).toHaveAttribute(
      'href',
      '/faq',
    );
    expect(screen.queryByRole('button', { name: /export/iu })).toBeNull();
  });
});
