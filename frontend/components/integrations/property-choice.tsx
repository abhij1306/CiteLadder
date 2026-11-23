import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import { List, RefreshCw } from '@/lib/icons';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import {
  integrationsMutations,
  type IntegrationConnection,
  type IntegrationProperty,
  type IntegrationProvider,
} from '@/lib/api/integrations';

import { PROVIDER_META } from '@/components/settings/grant-model';

import { ownPropertiesFirst } from './data-sources';
import { Notice } from '@/components/ui/notice';

const onlyItem = <T,>(items: readonly T[]) => (items.length === 1 ? items[0] : undefined);

function suggestedProperty(provider: IntegrationProvider, properties: IntegrationProperty[]) {
  const matching = properties.filter((property) => property.matches_project === true);
  return onlyItem(matching) ?? (provider === 'ga4' ? onlyItem(properties) : undefined) ?? null;
}

export function usePropertyChoice({
  provider,
  connection,
  projectId,
  autoStart,
}: Readonly<{
  provider: IntegrationProvider;
  connection: IntegrationConnection;
  projectId: string;
  autoStart: boolean;
}>): { action: ReactNode; body: ReactNode } {
  const source = PROVIDER_META[provider];
  const [showAll, setShowAll] = useState(false);
  const discovery = useMutation(
    integrationsMutations.discoverProperties(connection.workspace_id, connection.id),
  );
  const discover = () => discovery.mutate(projectId);
  const select = useMutation(
    integrationsMutations.createMapping(connection.workspace_id, connection.id),
  );
  const choose = (propertyRef: string) =>
    select.mutate({ provider, property_ref: propertyRef, project_id: projectId });
  const pendingRef = select.isPending ? (select.variables?.property_ref ?? null) : null;
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    discovery.mutate(projectId);
  }, [autoStart, discovery, projectId]);

  if (!discovery.isSuccess) return discoveryStatus({ noun: source.noun, discovery, discover });
  const properties = ownPropertiesFirst(discovery.data);
  if (properties.length === 0)
    return {
      action: null,
      body: (
        <Notice tone="info">
          This account has no {source.noun}. Add and verify the site in {source.console}, then{' '}
          <Button variant="quiet" onClick={discover}>
            <Icon icon={RefreshCw} />
            check again
          </Button>
        </Notice>
      ),
    };
  const suggested = suggestedProperty(provider, properties);
  const listed = !suggested || showAll;
  return {
    action: suggested ? (
      <SuggestionButtons
        label={`${suggested.label} for ${source.label}`}
        suggestedLabel={suggested.label}
        offerOthers={!listed && properties.length > 1}
        onShowAll={() => setShowAll(true)}
        onUse={() => choose(suggested.property_ref)}
        pending={pendingRef === suggested.property_ref}
        disabled={select.isPending}
      />
    ) : null,
    body:
      listed || select.isError ? (
        <Stack gap="compact">
          {listed ? (
            <PropertyList
              source={source}
              properties={properties}
              pendingRef={pendingRef}
              onSelect={choose}
            />
          ) : null}
          <SaveFailure error={select.error} />
        </Stack>
      ) : null,
  };
}

function SaveFailure({ error }: Readonly<{ error: Error | null }>) {
  if (!error) return null;
  return (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(error, { action: 'save the property' })}
    />
  );
}

function SuggestionButtons({
  label,
  suggestedLabel,
  offerOthers,
  onShowAll,
  onUse,
  pending,
  disabled,
}: Readonly<{
  label: string;
  suggestedLabel: string;
  offerOthers: boolean;
  onShowAll: () => void;
  onUse: () => void;
  pending: boolean;
  disabled: boolean;
}>) {
  return (
    <>
      {offerOthers ? (
        <Button variant="quiet" onClick={onShowAll}>
          <Icon icon={List} />
          Choose another
        </Button>
      ) : null}
      <Button
        variant="secondary"
        onClick={onUse}
        pending={pending}
        pendingLabel="Importing…"
        disabled={disabled}
        aria-label={`Use ${label}`}
      >
        Use {suggestedLabel}
      </Button>
    </>
  );
}

function discoveryStatus({
  noun,
  discovery,
  discover,
}: Readonly<{
  noun: string;
  discovery: { isIdle: boolean; isPending: boolean; error: unknown };
  discover: () => void;
}>): { action: ReactNode; body: ReactNode } {
  if (discovery.isIdle)
    return {
      action: (
        <Button variant="secondary" onClick={discover}>
          Choose {noun}
        </Button>
      ),
      body: null,
    };
  if (discovery.isPending)
    return {
      action: null,
      body: <Skeleton variant="list" rows={2} label={`Loading your ${noun}s…`} />,
    };
  return {
    action: null,
    body: (
      <Notice
        kind="mutation"
        notice={mutationNoticeForError(discovery.error, { action: `load your ${noun}s` })}
        recovery={
          <Button variant="secondary" onClick={discover}>
            Try again
          </Button>
        }
      />
    ),
  };
}

function PropertyList({
  source,
  properties,
  pendingRef,
  onSelect,
}: Readonly<{
  source: { noun: string; label: string };
  properties: IntegrationProperty[];
  pendingRef: string | null;
  onSelect: (propertyRef: string) => void;
}>) {
  return (
    <Stack as="ul" gap="tight" aria-label={`${source.noun}s`}>
      {properties.map((property) => {
        const foreign = property.matches_project === false;
        return (
          <Inline as="li" key={property.property_ref} gap="compact">
            <span className="min-w-0 flex-1">
              <span className={textRole('body', 'text-ink-2 block truncate')}>
                {property.label}
              </span>
              <span className="type-caption block truncate">
                {foreign ? 'Belongs to a different site' : property.property_ref}
              </span>
            </span>
            <Button
              variant="secondary"
              disabled={foreign || pendingRef !== null}
              pending={pendingRef === property.property_ref}
              pendingLabel="Importing…"
              onClick={() => onSelect(property.property_ref)}
              aria-label={`Use ${property.label} for ${source.label}`}
            >
              Use
            </Button>
          </Inline>
        );
      })}
    </Stack>
  );
}
