import { SegmentedControl, type SegmentedOption } from '@/components/ui/tabs';
import { FILTER_TABS, type FilterTab } from '@/lib/demand/signals';

export function DemandSignalFilters({
  activeTab,
  onTabChange,
  tabCounts,
}: Readonly<{
  activeTab: FilterTab;
  onTabChange: (tab: FilterTab) => void;
  tabCounts: ReadonlyMap<FilterTab, number>;
}>) {
  const options = FILTER_TABS.flatMap(({ tab, label }): SegmentedOption<FilterTab>[] => {
    const count = tabCounts.get(tab) ?? 0;
    if (tab === 'branded' && count === 0 && activeTab !== tab) return [];
    return [{ value: tab, label, count }];
  });

  return (
    <SegmentedControl
      value={activeTab}
      onChange={onTabChange}
      options={options}
      ariaLabel="Signal type"
    />
  );
}
