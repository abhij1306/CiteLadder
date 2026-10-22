'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Save, X } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import { humanizeApiError } from '@/lib/api/errors';
import { projectsApi, type BusinessMapUpdateInput } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { BusinessMap } from '@/lib/api/types';

type Draft = BusinessMapUpdateInput['offerings'][number];
type Dimension = 'attributes' | 'situations' | 'audiences';

const DIMENSIONS: ReadonlyArray<{ key: Dimension; label: string; placeholder: string }> = [
  { key: 'attributes', label: 'Attributes', placeholder: 'e.g. waterproof' },
  { key: 'situations', label: 'Situations and constraints', placeholder: 'e.g. wet trails' },
  { key: 'audiences', label: 'Audiences', placeholder: 'e.g. beginner runners' },
];

const sameValue = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** One draft per confirmed offering, seeded from the persisted map. */
function toDrafts(map: BusinessMap): Draft[] {
  return map.available_offerings.map((offering) => {
    const saved = map.offerings.find((item) => sameValue(item.offering, offering));
    const entries = (key: Dimension) =>
      (saved?.[key] ?? []).map(({ value, review_state }) => ({ value, review_state }));
    return {
      offering,
      attributes: entries('attributes'),
      situations: entries('situations'),
      audiences: entries('audiences'),
      exclusions: saved?.exclusions ?? [],
    };
  });
}

function suggestionSource(map: BusinessMap, offering: string, key: Dimension, value: string) {
  const saved = map.offerings.find((item) => sameValue(item.offering, offering));
  return saved?.[key].find((entry) => sameValue(entry.value, value))?.origin;
}

/**
 * Per-offering facts that ground prompt generation. Model suggestions are
 * shown as such until confirmed; unknown facts are simply left empty.
 */
export function BusinessMapEditor({
  projectId,
  workspaceId,
}: Readonly<{
  projectId: string;
  workspaceId: string;
}>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.projects.businessMap(projectId),
    queryFn: ({ signal }) => projectsApi.getBusinessMap(projectId, { signal, workspaceId }),
  });
  if (query.isPending) return <QueryState kind="loading" />;
  if (query.isError)
    return (
      <QueryState
        kind="error"
        {...readErrorProps(query)}
        fallback="The business map could not be loaded."
      />
    );
  return (
    <BusinessMapForm
      key={projectId}
      map={query.data}
      onSave={(input) => projectsApi.updateBusinessMap(projectId, input, { workspaceId })}
      onSaved={(next) => queryClient.setQueryData(queryKeys.projects.businessMap(projectId), next)}
    />
  );
}

function BusinessMapForm({
  map,
  onSave,
  onSaved,
}: Readonly<{
  map: BusinessMap;
  onSave: (input: BusinessMapUpdateInput) => Promise<BusinessMap>;
  onSaved: (next: BusinessMap) => void;
}>) {
  const [drafts, setDrafts] = useState(() => toDrafts(map));
  const mutation = useMutation({
    mutationFn: () => onSave({ offerings: drafts }),
    onSuccess: (next) => {
      // Reseed from the saved map so drafts show its canonical values.
      setDrafts(toDrafts(next));
      onSaved(next);
    },
  });

  if (!map.available_offerings.length) {
    return (
      <Alert tone="info">
        Add products and services under Audience &amp; Offerings first; the business map describes
        each one.
      </Alert>
    );
  }

  const update = (index: number, next: Draft) =>
    setDrafts((prev) => prev.map((draft, i) => (i === index ? next : draft)));

  return (
    <Stack gap="workspace">
      <Inline className="flex-wrap justify-between">
        <p className={textRole('body', 'text-secondary')}>
          Describe each offering so generated prompts cover real buyer situations. Leave anything
          you are unsure of empty.
        </p>
        <Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Icon icon={Save} />
          {mutation.isPending ? 'Saving…' : 'Save business map'}
        </Button>
      </Inline>
      {mutation.isError ? (
        <Alert tone="danger">{humanizeApiError(mutation.error).message}</Alert>
      ) : null}
      {mutation.isSuccess ? <Alert tone="success">Business map saved.</Alert> : null}
      {drafts.map((draft, index) => (
        <OfferingEditor
          key={draft.offering}
          draft={draft}
          map={map}
          disabled={mutation.isPending}
          onChange={(next) => update(index, next)}
        />
      ))}
    </Stack>
  );
}

function OfferingEditor({
  draft,
  map,
  disabled,
  onChange,
}: Readonly<{
  draft: Draft;
  map: BusinessMap;
  disabled: boolean;
  onChange: (next: Draft) => void;
}>) {
  const headingId = `business-map-${draft.offering.replaceAll(/\W+/g, '-')}`;
  const allValues = DIMENSIONS.flatMap(({ key }) => draft[key].map((entry) => entry.value));

  const setEntries = (key: Dimension, entries: Draft[Dimension]) => {
    const remaining = new Set(
      DIMENSIONS.flatMap((dimension) =>
        (dimension.key === key ? entries : draft[dimension.key]).map((entry) =>
          entry.value.toLocaleLowerCase(),
        ),
      ),
    );
    // An exclusion that names a removed entry no longer means anything.
    const exclusions = draft.exclusions.filter(
      (pair) =>
        remaining.has(pair.first.toLocaleLowerCase()) &&
        remaining.has(pair.second.toLocaleLowerCase()),
    );
    onChange({ ...draft, [key]: entries, exclusions });
  };

  return (
    <Stack
      as="section"
      gap="workspace"
      aria-labelledby={headingId}
      className={panelClasses({ tone: 'well' })}
    >
      <h3 id={headingId} className={textRole('itemTitle')}>
        {draft.offering}
      </h3>
      {DIMENSIONS.map(({ key, label, placeholder }) => (
        <EntryList
          key={key}
          label={label}
          placeholder={placeholder}
          entries={draft[key]}
          originOf={(value) => suggestionSource(map, draft.offering, key, value)}
          disabled={disabled}
          onChange={(entries) => setEntries(key, entries)}
        />
      ))}
      <ExclusionEditor
        values={allValues}
        exclusions={draft.exclusions}
        disabled={disabled}
        onChange={(exclusions) => onChange({ ...draft, exclusions })}
      />
    </Stack>
  );
}

function EntryList({
  label,
  placeholder,
  entries,
  originOf,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  placeholder: string;
  entries: Draft[Dimension];
  originOf: (value: string) => string | undefined;
  disabled: boolean;
  onChange: (entries: Draft[Dimension]) => void;
}>) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canAdd = trimmed !== '' && !entries.some((entry) => sameValue(entry.value, trimmed));
  const add = () => {
    if (!canAdd) return;
    onChange([...entries, { value: trimmed, review_state: 'confirmed' }]);
    setValue('');
  };
  return (
    <Stack gap="compact">
      <span className={textRole('label')}>{label}</span>
      {entries.length ? (
        <Stack as="ul" gap="tight" aria-label={label}>
          {entries.map((entry) => (
            <Inline as="li" key={entry.value} className="type-body text-foreground">
              <span>{entry.value}</span>
              {entry.review_state === 'suggested' ? (
                <>
                  <Badge>{originOf(entry.value) === 'model' ? 'AI suggested' : 'Suggested'}</Badge>
                  <IconButton
                    icon={Check}
                    label={`Confirm ${entry.value}`}
                    disabled={disabled}
                    onClick={() =>
                      onChange(
                        entries.map((item) =>
                          item === entry ? { ...item, review_state: 'confirmed' } : item,
                        ),
                      )
                    }
                  />
                </>
              ) : null}
              <IconButton
                icon={X}
                label={`Remove ${entry.value}`}
                disabled={disabled}
                onClick={() => onChange(entries.filter((item) => item !== entry))}
              />
            </Inline>
          ))}
        </Stack>
      ) : null}
      <Inline>
        <Input
          value={value}
          placeholder={placeholder}
          aria-label={`Add to ${label}`}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled || !canAdd}>
          <Icon icon={Plus} />
          Add
        </Button>
      </Inline>
    </Stack>
  );
}

function ExclusionEditor({
  values,
  exclusions,
  disabled,
  onChange,
}: Readonly<{
  values: string[];
  exclusions: Draft['exclusions'];
  disabled: boolean;
  onChange: (exclusions: Draft['exclusions']) => void;
}>) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  if (values.length < 2) return null;
  const options = [
    { value: '', label: 'Choose an entry' },
    ...values.map((value) => ({ value, label: value })),
  ];
  const duplicate = exclusions.some(
    (pair) =>
      (sameValue(pair.first, first) && sameValue(pair.second, second)) ||
      (sameValue(pair.first, second) && sameValue(pair.second, first)),
  );
  const canAdd = first !== '' && second !== '' && !sameValue(first, second) && !duplicate;
  return (
    <Stack gap="compact">
      <span className={textRole('label')}>Combinations that never apply</span>
      {exclusions.length ? (
        <Stack as="ul" gap="tight" aria-label="Excluded combinations">
          {exclusions.map((pair) => (
            <Inline
              as="li"
              key={`${pair.first}|${pair.second}`}
              className="type-body text-foreground"
            >
              <span>
                {pair.first} + {pair.second}
              </span>
              <IconButton
                icon={X}
                label={`Remove ${pair.first} + ${pair.second}`}
                disabled={disabled}
                onClick={() => onChange(exclusions.filter((item) => item !== pair))}
              />
            </Inline>
          ))}
        </Stack>
      ) : null}
      <Inline className="flex-wrap">
        <Select value={first} onValueChange={setFirst} ariaLabel="First entry" options={options} />
        <Select
          value={second}
          onValueChange={setSecond}
          ariaLabel="Second entry"
          options={options}
        />
        <Button
          variant="secondary"
          disabled={disabled || !canAdd}
          onClick={() => {
            onChange([...exclusions, { first, second }]);
            setFirst('');
            setSecond('');
          }}
        >
          <Icon icon={Plus} />
          Add exclusion
        </Button>
      </Inline>
    </Stack>
  );
}
