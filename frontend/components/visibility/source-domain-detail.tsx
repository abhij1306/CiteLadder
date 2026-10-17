'use client';

import { TabPanel, Tabs } from '@/components/ui/tabs';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { SourceBreadcrumb } from '@/components/visibility/source-breadcrumb';
import { SourcesPanel } from '@/components/visibility/visibility-sources';
import { SourcePrompts } from '@/components/visibility/source-prompts';
import type { SourceFilters } from '@/components/visibility/source-rows';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';

const TABS = [
  { value: 'urls', label: 'URLs' },
  { value: 'prompts', label: 'Prompts' },
] as const;

/**
 * One domain's own page: its cited URLs, and the prompts that reached it.
 *
 * The URLs tab is the same inventory component the tab above renders, narrowed
 * to this publisher. Reusing it rather than writing a second table is what
 * keeps "citation rate" meaning the same thing on both screens — two
 * implementations of one column is how two screens start disagreeing.
 */
export function SourceDomainDetail({
  domain,
  filters,
  queries,
  onBack,
  onOpenUrl,
}: Readonly<{
  domain: string;
  filters: SourceFilters;
  queries: SourceQueries;
  onBack: () => void;
  onOpenUrl: (url: string) => void;
}>) {
  const [tab, setTab] = useUrlState('source_view', optionalStringUrlCodec);
  const active = tab === 'prompts' ? 'prompts' : 'urls';
  return (
    <div className="grid gap-[var(--workspace-gap)]">
      <SourceBreadcrumb trail={[{ label: 'Sources', onClick: onBack }]} current={domain} />
      <Tabs
        value={active}
        onValueChange={(value) => setTab(value === 'urls' ? null : value)}
        items={TABS.map((entry) => ({ value: entry.value, label: entry.label }))}
        ariaLabel="Domain views"
        rootClassName="grid gap-[var(--workspace-gap)]"
      >
        <TabPanel value={active} className="focus-ring">
          {active === 'prompts' ? (
            <SourcePrompts filters={filters} queries={queries} domain={domain} />
          ) : (
            <SourcesPanel
              dimension="url"
              domain={domain}
              filters={filters}
              queries={queries}
              onOpenUrl={onOpenUrl}
            />
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
