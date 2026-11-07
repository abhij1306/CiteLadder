'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Inline, Stack } from '@/components/ui/layout';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import { humanizeApiError } from '@/lib/api/errors';
import {
  integrationsMutations,
  type IntegrationConnection,
  type IntegrationProperty,
  type IntegrationProvider,
} from '@/lib/api/integrations';

import { PROVIDER_META } from '@/components/settings/grant-model';

import { ownPropertiesFirst } from './data-sources';

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
  const [showAll, setShowAll] = useState(false);
  const discovery = useMutation(
    integrationsMutations.discoverProperties(connection.workspace_id, connection.id),
  );
  // Discovery names the project, so its own properties are marked.
  const discover = () => discovery.mutate(projectId);
  const select = useMutation(
    integrationsMutations.createMapping(connection.workspace_id, connection.id),
  );
  const choose = (propertyRef: string) =>
    select.mutate({ provider, property_ref: propertyRef, project_id: projectId });
  const pendingRef = select.isPending ? (select.variables?.property_ref ?? null) : null;
  // Returning from consent, the list is what the user came back for.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    discovery.mutate(projectId);
  }, [autoStart, discovery, projectId]);

  if (!discovery.isSuccess)
    return <DiscoveryStatus noun={source.noun} discovery={discovery} discover={discover} />;
  const properties = ownPropertiesFirst(discovery.data);
  if (properties.length === 0)
    return (
      <Callout tone="neutral">
        This account has no {source.noun}. Add and verify the site in {source.console}, then{' '}
        <Button variant="ghost" onClick={discover}>
          check again
        </Button>
      </Callout>
    );
  const suggested = suggestedProperty(provider, properties);
  return (
    <Stack gap="compact">
      {suggested ? (
        <Inline className="flex-wrap">
          <Button
            variant="primary"
            onClick={() => choose(suggested.property_ref)}
            pending={pendingRef === suggested.property_ref}
            pendingLabel="Importing…"
            disabled={select.isPending}
            aria-label={`Use ${suggested.label} for ${source.label}`}
          >
            Use {suggested.label}
          </Button>
          {properties.length > 1 && !showAll ? (
            <Button variant="ghost" onClick={() => setShowAll(true)}>
              Choose another
            </Button>
          ) : null}
        </Inline>
      ) : null}
      {suggested && !showAll ? null : (
        <PropertyList
          source={source}
          properties={properties}
          pendingRef={pendingRef}
          onSelect={choose}
        />
      )}
      {select.isError ? (
        <Callout tone="negative">{humanizeApiError(select.error).message}</Callout>
      ) : null}
    </Stack>
  );
}

/** Discovery before it has a list: the button, progress, or the failure with a retry. */
function DiscoveryStatus({
  noun,
  discovery,
  discover,
}: Readonly<{
  noun: string;
  discovery: { isIdle: boolean; isPending: boolean; error: unknown };
  discover: () => void;
}>) {
  if (discovery.isIdle)
    return (
      <div>
        <Button variant="secondary" onClick={discover}>
          Choose {noun}
        </Button>
      </div>
    );
  if (discovery.isPending)
    return (
      <Inline as="output" className="type-caption">
        <Spinner /> Loading your {noun}s…
      </Inline>
    );
  return (
    <Callout tone="negative">
      Could not load your {noun}s. {humanizeApiError(discovery.error).message}{' '}
      <Button variant="ghost" onClick={discover}>
        Try again
      </Button>
    </Callout>
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
    <Stack as="ul" gap="tight" aria-label={`${source.noun}s`}>
      {properties.map((property) => {
        const foreign = property.matches_project === false;
        return (
          <Inline as="li" key={property.property_ref} gap="compact">
            <span className="min-w-0 flex-1">
              <span className={textRole('label', 'block truncate')}>{property.label}</span>
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
