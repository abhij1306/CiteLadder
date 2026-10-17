'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import { humanizeApiError } from '@/lib/api/errors';
import {
  integrationsApi,
  type IntegrationConnection,
  type IntegrationProperty,
  type IntegrationProvider,
} from '@/lib/api/integrations';

import { PROVIDER_META } from '@/components/settings/grant-model';

import { ownPropertiesFirst, useRefreshAfterMapping } from './data-sources';

const onlyItem = <T,>(items: readonly T[]) => (items.length === 1 ? items[0] : undefined);

/** The one property worth offering as a single click, if any. */
function suggestedProperty(provider: IntegrationProvider, properties: IntegrationProperty[]) {
  const matching = properties.filter((property) => property.matches_project === true);
  return (
    onlyItem(matching) ??
    // GA4 exposes no site to match, so a single property is the only safe suggestion.
    (provider === 'ga4' ? onlyItem(properties) : undefined) ??
    null
  );
}

/**
 * Choose the property a source imports into the project. Discovery is a live
 * provider call, so it starts on request, or by itself when the user has just
 * returned from consent; the project's own property is offered as one click.
 */
export function PropertyChoice({
  provider,
  connection,
  projectId,
  autoStart,
}: Readonly<{
  provider: IntegrationProvider;
  connection: IntegrationConnection;
  projectId: string;
  autoStart: boolean;
}>) {
  const source = PROVIDER_META[provider];
  const refresh = useRefreshAfterMapping();
  const [showAll, setShowAll] = useState(false);
  const discovery = useMutation({
    mutationFn: () =>
      integrationsApi.discoverProperties(connection.id, projectId, {
        workspaceId: connection.workspace_id,
      }),
    retry: false,
  });
  const select = useMutation({
    mutationFn: (propertyRef: string) =>
      integrationsApi.createMapping(
        connection.id,
        { provider, property_ref: propertyRef, project_id: projectId },
        { workspaceId: connection.workspace_id },
      ),
    onSuccess: () => refresh(),
  });
  // Returning from consent, the list is what the user came back for.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    discovery.mutate();
  }, [autoStart, discovery]);

  if (!discovery.isSuccess) return <DiscoveryStatus noun={source.noun} discovery={discovery} />;
  const properties = ownPropertiesFirst(discovery.data);
  if (properties.length === 0)
    return (
      <Alert tone="neutral">
        This account has no {source.noun}. Add and verify the site in {source.console}, then{' '}
        <Button variant="ghost" size="sm" onClick={() => discovery.mutate()}>
          check again
        </Button>
      </Alert>
    );
  const suggested = suggestedProperty(provider, properties);
  return (
    <div className="grid gap-2">
      {suggested ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => select.mutate(suggested.property_ref)}
            pending={select.isPending && select.variables === suggested.property_ref}
            pendingLabel="Importing…"
            disabled={select.isPending}
            aria-label={`Use ${suggested.label} for ${source.label}`}
          >
            Use {suggested.label}
          </Button>
          {properties.length > 1 && !showAll ? (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Choose another
            </Button>
          ) : null}
        </div>
      ) : null}
      {suggested && !showAll ? null : (
        <PropertyList
          source={source}
          properties={properties}
          pendingRef={select.isPending ? (select.variables ?? null) : null}
          onSelect={(propertyRef) => select.mutate(propertyRef)}
        />
      )}
      {select.isError ? (
        <Alert tone="danger">{humanizeApiError(select.error).message}</Alert>
      ) : null}
    </div>
  );
}

/** Discovery before it has a list: the button, progress, or the failure with a retry. */
function DiscoveryStatus({
  noun,
  discovery,
}: Readonly<{
  noun: string;
  discovery: { isIdle: boolean; isPending: boolean; error: unknown; mutate: () => void };
}>) {
  if (discovery.isIdle)
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => discovery.mutate()}>
          Choose {noun}
        </Button>
      </div>
    );
  if (discovery.isPending)
    return (
      <output className="type-caption flex items-center gap-2">
        <Spinner size="sm" /> Loading your {noun}s…
      </output>
    );
  return (
    <Alert tone="danger">
      Could not load your {noun}s. {humanizeApiError(discovery.error).message}{' '}
      <Button variant="ghost" size="sm" onClick={() => discovery.mutate()}>
        Try again
      </Button>
    </Alert>
  );
}

/** Every discovered property; another site's property is shown but cannot be used. */
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
    <ul className="grid gap-1" aria-label={`${source.noun}s`}>
      {properties.map((property) => {
        const foreign = property.matches_project === false;
        return (
          <li key={property.property_ref} className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className={textRole('label', 'block truncate')}>{property.label}</span>
              <span className="type-caption block truncate">
                {foreign ? 'Belongs to a different site' : property.property_ref}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={foreign || pendingRef !== null}
              pending={pendingRef === property.property_ref}
              pendingLabel="Importing…"
              onClick={() => onSelect(property.property_ref)}
              aria-label={`Use ${property.label} for ${source.label}`}
            >
              Use
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
