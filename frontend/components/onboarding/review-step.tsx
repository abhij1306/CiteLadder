import { useState } from 'react';

import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import {
  ChecklistField,
  type ChecklistEditor,
  type ChecklistItem,
} from '@/components/ui/checklist-field';
import { Icon } from '@/components/ui/icon';
import { Plus } from '@/lib/icons';
import type { ReviewCompetitor, ReviewDomain } from '@/lib/onboarding/forms';

function competitorUrl(competitor: ReviewCompetitor): string {
  const domain = competitor.domains.find(Boolean);
  if (!domain) return '';
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function isBlank(competitor: ReviewCompetitor): boolean {
  return competitor.name === '' && competitor.domains.length === 0;
}

function competitorItem(competitor: ReviewCompetitor, limitReached: boolean): ChecklistItem {
  const primaryDomain = competitor.domains.find(Boolean) || '';
  const displayName = competitor.name || primaryDomain || 'New competitor';
  const url = competitorUrl(competitor);
  return {
    id: competitor.id,
    label: displayName,
    meta: primaryDomain && primaryDomain !== displayName ? primaryDomain : undefined,
    leading: <BrandMark name={displayName} websiteUrl={primaryDomain} />,
    checked: competitor.selected,
    disabled: limitReached,
    editable: true,
    extra: url ? (
      <a href={url} target="_blank" rel="noreferrer" className="sr-only">
        {url}
      </a>
    ) : null,
  };
}

export function ReviewStep({
  domains,
  competitors,
  onToggleDomain,
  onToggleCompetitor,
  onEditCompetitor,
  onRemoveCompetitor,
  onAddCompetitor,
  maximumCompetitors,
  domainNote,
  competitorNote,
}: Readonly<{
  domains: ReviewDomain[];
  competitors: ReviewCompetitor[];
  onToggleDomain: (index: number) => void;
  onToggleCompetitor: (index: number) => void;
  onEditCompetitor: (index: number, name: string, domain: string) => void;
  onRemoveCompetitor: (index: number) => void;
  onAddCompetitor: () => void;
  maximumCompetitors: number | undefined;
  domainNote?: string;
  competitorNote?: string;
}>) {
  const [editing, setEditing] = useState<string | null>(null);
  const selectedDomains = domains.filter((item) => item.selected).length;
  const selectedCompetitors = competitors.filter((item) => item.selected).length;
  const competitorLimitReached =
    maximumCompetitors === undefined || selectedCompetitors >= maximumCompetitors;
  const indexOf = (id: string) => competitors.findIndex((item) => item.id === id);
  const editingId = editing ?? competitors.find(isBlank)?.id ?? null;

  const editor: ChecklistEditor<'name' | 'domain'> = {
    fields: [
      { key: 'name', label: () => 'Competitor name', placeholder: 'Competitor name' },
      { key: 'domain', label: (item) => `Website for ${item.label}`, placeholder: 'acme.com' },
    ],
    values: (item) => {
      const competitor = competitors[indexOf(item.id)];
      return {
        name: competitor?.name ?? '',
        domain: competitor?.domains.find(Boolean) ?? '',
      };
    },
    onSave: (id, values) => onEditCompetitor(indexOf(id), values.name, values.domain),
    onCancel: (id) => {
      const competitor = competitors[indexOf(id)];
      if (competitor && isBlank(competitor)) onRemoveCompetitor(indexOf(id));
    },
    editLabel: (item) => `Edit website for ${item.label}`,
  };

  return (
    <>
      <ChecklistField
        label="Your websites"
        count={domains.length > 0 ? `${selectedDomains} of ${domains.length}` : undefined}
        note={domainNote}
        empty="No websites were found."
        items={domains.map((entry) => ({
          id: entry.domain,
          label: entry.domain,
          checked: entry.selected,
        }))}
        onToggle={(id) => onToggleDomain(domains.findIndex((entry) => entry.domain === id))}
      />

      <ChecklistField
        label="Competitors"
        count={`${selectedCompetitors} of ${maximumCompetitors ?? '…'}`}
        note={competitorNote}
        empty="No competitors were confirmed."
        items={competitors.map((competitor) => competitorItem(competitor, competitorLimitReached))}
        onToggle={(id) => onToggleCompetitor(indexOf(id))}
        editor={editor}
        editingId={editingId}
        onEditingChange={setEditing}
        footer={
          <Button variant="quiet" onClick={onAddCompetitor} disabled={competitorLimitReached}>
            <Icon icon={Plus} />
            Add
          </Button>
        }
      />
    </>
  );
}
