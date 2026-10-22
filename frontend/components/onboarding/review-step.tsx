'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { FlowGroup } from '@/components/onboarding/flow-shell';
import { EntityRow } from '@/components/onboarding/choice-controls';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReviewCompetitor, ReviewDomain } from '@/lib/onboarding/forms';

function competitorUrl(competitor: ReviewCompetitor): string {
  const domain = competitor.domains.find(Boolean);
  if (!domain) return '';
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function CompetitorRow({
  competitor,
  disabled,
  onToggle,
  onEdit,
  onRemove,
}: Readonly<{
  competitor: ReviewCompetitor;
  disabled: boolean;
  onToggle: () => void;
  onEdit: (name: string, domain: string) => void;
  onRemove: () => void;
}>) {
  const primaryDomain = competitor.domains.find(Boolean) || '';
  const displayName = competitor.name || primaryDomain || 'New competitor';

  // A manual choice opens in the identity editor immediately.
  const [isEditing, setIsEditing] = useState(
    competitor.name === '' && competitor.domains.length === 0,
  );
  const [draft, setDraft] = useState(primaryDomain);
  const [draftName, setDraftName] = useState(competitor.name);

  const save = () => {
    const trimmed = draft.trim();
    const name = draftName.trim();
    if (!trimmed || !name) return;
    onEdit(name, trimmed);
    setIsEditing(false);
  };
  const cancel = () => {
    if (!competitor.name && !primaryDomain) {
      onRemove();
      return;
    }
    setDraft(primaryDomain);
    setDraftName(competitor.name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <li className="flow-entity">
        <Input
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- Add and Edit explicitly reveal this field.
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Competitor name"
          aria-label="Competitor name"
          className="my-1.5"
        />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') cancel();
          }}
          placeholder="acme.com"
          aria-label={`Website for ${displayName}`}
          className="my-1.5"
        />
        <Button type="button" onClick={save} disabled={!draft.trim() || !draftName.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </li>
    );
  }

  const url = competitorUrl(competitor);
  return (
    <EntityRow
      name={displayName}
      meta={primaryDomain && primaryDomain !== displayName ? primaryDomain : undefined}
      selected={competitor.selected}
      disabled={disabled}
      onToggle={onToggle}
      leading={<BrandLogo name={displayName} websiteUrl={primaryDomain} size="md" />}
      onEdit={() => {
        setDraft(primaryDomain);
        setDraftName(competitor.name);
        setIsEditing(true);
      }}
      editLabel={`Edit website for ${displayName}`}
      trailing={
        // Kept for assistive tech and tests: the visible row is a control, so
        // it cannot also be the link to the competitor's site.
        url ? (
          <a href={url} target="_blank" rel="noreferrer" className="sr-only">
            {url}
          </a>
        ) : null
      }
    />
  );
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
}: Readonly<{
  domains: ReviewDomain[];
  competitors: ReviewCompetitor[];
  onToggleDomain: (index: number) => void;
  onToggleCompetitor: (index: number) => void;
  onEditCompetitor: (index: number, name: string, domain: string) => void;
  onRemoveCompetitor: (index: number) => void;
  onAddCompetitor: () => void;
  maximumCompetitors: number | undefined;
}>) {
  const selectedDomains = domains.filter((item) => item.selected).length;
  const selectedCompetitors = competitors.filter((item) => item.selected).length;
  const competitorLimitReached =
    maximumCompetitors === undefined || selectedCompetitors >= maximumCompetitors;

  return (
    <>
      <FlowGroup
        className="flow-review-card flow-review-wide flow-review-sites"
        title="Your websites"
        meta={domains.length > 0 ? `${selectedDomains} of ${domains.length}` : undefined}
        help="Auto-verified from your domain."
      >
        {domains.length === 0 ? (
          <p className="flow-help">No websites were found.</p>
        ) : (
          <ul className="flow-entity-list flow-website-chips">
            {domains.map((entry, index) => (
              <EntityRow
                key={entry.domain}
                name={entry.domain}
                selected={entry.selected}
                onToggle={() => onToggleDomain(index)}
              />
            ))}
          </ul>
        )}
      </FlowGroup>

      <FlowGroup
        className="flow-review-card flow-review-wide"
        title="Competitors"
        meta={`${selectedCompetitors} of ${maximumCompetitors ?? '…'}`}
        help="Pick the brands to compare against in every answer."
        action={
          <Button variant="ghost" onClick={onAddCompetitor} disabled={competitorLimitReached}>
            <Plus className="size-3.5" aria-hidden />
            Add
          </Button>
        }
      >
        {competitors.length === 0 ? (
          <p className="flow-help">
            No competitors were confirmed. Add the companies you lose deals to.
          </p>
        ) : (
          <ul className="flow-entity-list flow-competitor-chips">
            {competitors.map((competitor, index) => (
              <CompetitorRow
                key={competitor.id}
                competitor={competitor}
                disabled={competitorLimitReached}
                onToggle={() => onToggleCompetitor(index)}
                onEdit={(name, domain) => onEditCompetitor(index, name, domain)}
                onRemove={() => onRemoveCompetitor(index)}
              />
            ))}
          </ul>
        )}
      </FlowGroup>
    </>
  );
}
