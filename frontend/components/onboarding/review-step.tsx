import { useState } from 'react';
import { Plus } from 'lucide-react';

import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import {
  ChecklistField,
  type ChecklistEditor,
  type ChecklistItem,
} from '@/components/ui/checklist-field';
import { Icon } from '@/components/ui/icon';
import type { ReviewCompetitor, ReviewDomain } from '@/lib/onboarding/forms';

function competitorUrl(competitor: ReviewCompetitor): string {
  const domain = competitor.domains.find(Boolean);
  if (!domain) return '';
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

/** A manual choice, not yet named: it opens in the identity editor immediately. */
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
    // Kept for assistive tech and tests: the visible row is a control, so it
    // cannot also be the link to the competitor's site.
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
  /** Why Create project waits on the websites. */
  domainNote?: string;
  /** Why Create project waits on the competitors. */
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
    // Cancelling a choice that was never named removes it, freeing its slot.
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
        help="Auto-verified from your domain."
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
        help="Pick the brands to compare against in every answer."
        count={`${selectedCompetitors} of ${maximumCompetitors ?? '…'}`}
        note={competitorNote}
        empty="No competitors were confirmed. Add the companies you lose deals to."
        items={competitors.map((competitor) => competitorItem(competitor, competitorLimitReached))}
        onToggle={(id) => onToggleCompetitor(indexOf(id))}
        editor={editor}
        editingId={editingId}
        onEditingChange={setEditing}
        footer={
          <Button variant="ghost" onClick={onAddCompetitor} disabled={competitorLimitReached}>
            <Icon icon={Plus} />
            Add
          </Button>
        }
      />
    </>
  );
}
