import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { AllFilters } from '@/components/ui/all-filters';
import type { VisibilityTab } from '@/lib/visibility/dashboard';
import { renderWithProviders as render } from '@/test/render';

import { VisibilityActions, useVisibilityFilterMenu } from './visibility-toolbar';

type MenuProps = Parameters<typeof useVisibilityFilterMenu>[0];

function Menu(props: MenuProps) {
  return <AllFilters filters={useVisibilityFilterMenu(props)} />;
}

function renderMenu({
  activeTab = 'trends',
  selectionMode,
  ...overrides
}: Partial<MenuProps> & { activeTab?: VisibilityTab; selectionMode: 'run' | 'range' }) {
  return render(
    <Menu
      activeTab={activeTab}
      selectionMode={selectionMode}
      onChangeSelectionMode={vi.fn()}
      runs={[]}
      selectedRunId={null}
      onSelectMeasurement={vi.fn()}
      engine="all"
      onChangeEngine={vi.fn()}
      promptOptions={[]}
      promptId={null}
      onChangePrompt={vi.fn()}
      range="90d"
      onChangeRange={vi.fn()}
      granularity="run"
      onChangeGranularity={vi.fn()}
      cohort="core"
      onChangeCohort={vi.fn()}
      {...overrides}
    />,
  );
}

/** Opens All filters and checks its entries, in order, by their accessible names. */
async function expectMenu(expected: readonly string[]) {
  await userEvent.setup().click(screen.getByRole('button', { name: /^All filters/ }));
  const items = screen.getAllByRole('menuitem');
  expect(items).toHaveLength(expected.length);
  items.forEach((item, index) => expect(item).toHaveAccessibleName(expected[index]));
}

describe('useVisibilityFilterMenu', () => {
  it('offers a period and a grouping only while every run in a period is pooled', async () => {
    const { unmount } = renderMenu({ selectionMode: 'run' });
    // Beside "Latest run", "Last 90 days" and "Per run" contradicted the selection.
    await expectMenu(['Measurement: Latest run', 'Prompts: Unbranded', 'Surface: All surfaces']);
    unmount();

    renderMenu({ selectionMode: 'range' });
    // They come last, so the filters before them keep their places.
    await expectMenu([
      'Measurement: All runs in period',
      'Prompts: Unbranded',
      'Surface: All surfaces',
      'Period: Last 90 days',
      'Group by: Per run',
    ]);
  });

  it('lists the prompt and answer outcome only where answers are shown', async () => {
    renderMenu({
      activeTab: 'query-fanout',
      selectionMode: 'run',
      promptOptions: [{ id: 'p1', label: 'Best CRM?' }],
      promptId: 'p1',
      onChangeOutcome: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'All filters (1)' })).toBeVisible();
    await expectMenu([
      'Measurement: Latest run',
      'Prompts: Unbranded',
      'Surface: All surfaces',
      'Prompt: Best CRM?',
      'Answer outcome: All answers',
    ]);
  });

  it('pools the period from the measurement filter, and picks a run by id', async () => {
    const user = userEvent.setup();
    const onChangeSelectionMode = vi.fn();
    const onSelectMeasurement = vi.fn();
    renderMenu({
      selectionMode: 'run',
      runs: [{ id: 'run-2', status: 'completed', label: '2 Nov 2026', completedAt: null }],
      onChangeSelectionMode,
      onSelectMeasurement,
    });
    const pick = async (keys: string) => {
      await user.click(screen.getByRole('button', { name: 'All filters' }));
      await user.keyboard(`{ArrowDown}{ArrowRight}${keys}{Enter}`);
    };
    await pick('{ArrowDown}');
    expect(onChangeSelectionMode.mock.calls).toEqual([['range']]);
    await pick('{ArrowDown}{ArrowDown}');
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
