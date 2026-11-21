import { useState } from 'react';

import { ProjectEditPanel } from '@/components/projects/project-edit-panel';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Absence } from '@/components/ui/absence';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { SettingField, SettingRow, SettingRows, SettingsGroup } from '@/components/ui/setting-row';
import { StateBlock } from '@/components/ui/state-block';
import { Textarea } from '@/components/ui/textarea';
import { Pencil } from '@/lib/icons';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { Project } from '@citeladder/contracts';
import { BUYER_TYPE_CHOICES, MARKET_SCOPE_CHOICES } from '@/lib/project/identity-facets';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { SaveFoot } from './save-foot';
import type { BrandProfileForm } from './use-brand-profile-form';
import { Notice } from '@/components/ui/notice';

function ProfileSaveNotices({ form }: Readonly<{ form: BrandProfileForm }>) {
  if (form.error)
    return (
      <Notice
        kind="mutation"
        notice={mutationNoticeForError(form.error, { action: 'save the brand profile' })}
      />
    );
  return form.notice ? <Notice tone="positive">{form.notice}</Notice> : null;
}

function ProfileSaveFoot({ form }: Readonly<{ form: BrandProfileForm }>) {
  return (
    <SaveFoot
      label="Save brand knowledge"
      changed={form.dirty}
      saving={form.saving}
      onSave={form.save}
    />
  );
}

export function CompanyFactsCard({ form }: Readonly<{ form: BrandProfileForm }>) {
  const { draft, identity, saving } = form;
  return (
    <SettingsGroup title="Company facts">
      <ProfileSaveNotices form={form} />
      <SettingRows foot={<ProfileSaveFoot form={form} />}>
        <SettingField label="Category">
          {(field) => (
            <Textarea
              {...field}
              rows={2}
              disabled={saving}
              value={identity.category}
              onChange={(event) =>
                form.setIdentity({
                  ...identity,
                  category: event.target.value.replaceAll('\n', ' '),
                })
              }
            />
          )}
        </SettingField>
        <FacetChoice
          label="Who buys it"
          value={identity.buyer_type}
          options={BUYER_TYPE_CHOICES}
          disabled={saving}
          onPick={(buyer_type) => form.setIdentity({ ...identity, buyer_type })}
        />
        <FacetChoice
          label="Where they buy it"
          value={identity.market_scope}
          options={MARKET_SCOPE_CHOICES}
          disabled={saving}
          onPick={(market_scope) => form.setIdentity({ ...identity, market_scope })}
        />
        <SettingField label="Target audience">
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              disabled={saving}
              value={draft.target_audience}
              onChange={(event) => form.setDraft({ ...draft, target_audience: event.target.value })}
            />
          )}
        </SettingField>
        <SettingField label="Description">
          {(field) => (
            <Textarea
              {...field}
              rows={4}
              disabled={saving}
              value={draft.description}
              onChange={(event) => form.setDraft({ ...draft, description: event.target.value })}
            />
          )}
        </SettingField>
        <SettingField label="Positioning">
          {(field) => (
            <Textarea
              {...field}
              rows={4}
              disabled={saving}
              value={draft.positioning}
              onChange={(event) => form.setDraft({ ...draft, positioning: event.target.value })}
            />
          )}
        </SettingField>
      </SettingRows>
    </SettingsGroup>
  );
}

function FacetChoice<T extends string>({
  label,
  value,
  options,
  disabled,
  onPick,
}: Readonly<{
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  disabled: boolean;
  onPick: (value: T) => void;
}>) {
  return (
    <SettingField inline label={label}>
      {(field) => (
        <Select<T | ''>
          id={field.id}
          ariaLabel={label}
          aria-describedby={field['aria-describedby']}
          value={value ?? ''}
          placeholder="Not set"
          options={options}
          disabled={disabled}
          onValueChange={(next) => {
            if (next) onPick(next);
          }}
        />
      )}
    </SettingField>
  );
}

export function TrackedCompetitorsCard({ project }: Readonly<{ project: Project }>) {
  const mayEdit = useWorkspaceCapability('write');
  const [editing, setEditing] = useState(false);
  return (
    <SettingsGroup
      title="Tracked competitors"
      action={
        mayEdit ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Icon icon={Pencil} />
            Edit competitors
          </Button>
        ) : null
      }
    >
      {(project.competitors ?? []).length === 0 ? (
        <StateBlock kind="empty" inline message="No competitors tracked yet." />
      ) : (
        <SettingRows label="Tracked competitors">
          {(project.competitors ?? []).map((competitor) => (
            <SettingRow
              key={`${competitor.name}:${competitor.domains[0] ?? ''}`}
              label={
                <Inline as="span">
                  <BrandMark
                    name={competitor.name}
                    logoUrl={competitor.logo_url}
                    websiteUrl={competitor.domains[0]}
                  />
                  <span className="truncate">{competitor.name}</span>
                </Inline>
              }
              value={
                competitor.domains.length ? (
                  competitor.domains.join(', ')
                ) : (
                  <Absence state="not_set" />
                )
              }
            />
          ))}
        </SettingRows>
      )}
      {editing ? <ProjectEditPanel project={project} open onOpenChange={setEditing} /> : null}
    </SettingsGroup>
  );
}
