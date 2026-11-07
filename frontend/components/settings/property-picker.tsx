'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Inline, Stack } from '@/components/ui/layout';
import { OptionRow } from '@/components/ui/list-row';
import { QueryState } from '@/components/ui/query-state';
import {
  integrationsMutations,
  integrationsQueries,
  type IntegrationConnection,
  type IntegrationProperty,
} from '@/lib/api/integrations';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { InlineFigure } from '@/components/ui/typography';
import { activeMappingFor, ownPropertiesFirst } from '@/components/integrations/data-sources';
import { PROVIDER_META } from '@/components/settings/grant-model';

/**
 * One selectable row in the picker list.
 *
 * A button rather than a radio: selecting IS the commit here (there is no
 * separate confirm step), so the row must read as an action.
 */
function PropertyOption({
  property,
  selected,
  disabled,
  pending,
  onSelect,
}: Readonly<{
  property: IntegrationProperty;
  selected: boolean;
  disabled: boolean;
  pending: boolean;
  onSelect: () => void;
}>) {
  return (
    <OptionRow
      title={property.label}
      caption={property.property_ref}
      selected={selected}
      pending={pending}
      disabled={disabled}
      onSelect={onSelect}
    />
  );
}

/**
 * The connection's ACTIVE property mapping for `projectId`, or `null`.
 *
 * The mapping — not `connection.account_ref` — is what decides whether a sync
 * produces anything, and one connection can serve several projects, so only
 * the active project's mapping describes this row.
 */
export function useActiveMapping(
  workspaceId: string,
  connectionId: string,
  projectId: string | null,
) {
  const query = useQuery(integrationsQueries.mappings(workspaceId, connectionId));
  return activeMappingFor(query.data, projectId);
}

/**
 * The discovered properties, the project's own first. A property of another
 * site is shown but cannot be chosen: mapping it would be refused.
 */
function PropertyOptions({
  properties,
  selected,
  blocked,
  selecting,
  onSelect,
}: Readonly<{
  properties: IntegrationProperty[];
  selected: string;
  blocked: boolean;
  /** The selection mutation: its variables name the row being imported. */
  selecting: { isPending: boolean; variables?: string };
  onSelect: (propertyRef: string) => void;
}>) {
  const pendingRef = selecting.isPending ? selecting.variables : undefined;
  return ownPropertiesFirst(properties).map((property) => (
    <PropertyOption
      key={property.property_ref}
      property={property}
      selected={property.property_ref === selected}
      disabled={blocked || property.matches_project === false}
      pending={pendingRef === property.property_ref}
      onSelect={() => onSelect(property.property_ref)}
    />
  ));
}

/** The chosen property, or a visible "none selected", and the control to choose one. */
function SelectedProperty({
  selected,
  noun,
  provider,
  canChoose,
  disabled,
  onChoose,
}: Readonly<{
  selected: string;
  noun: string;
  provider: IntegrationConnection['provider'];
  canChoose: boolean;
  disabled: boolean;
  onChoose: () => void;
}>) {
  const verb = selected ? 'Change' : 'Select';
  return (
    <Inline className="flex-wrap">
      {selected ? (
        // A GA4 property is a number; a Search Console property is a site.
        <Badge className="max-w-full truncate">
          {provider === 'ga4' ? <InlineFigure>{selected}</InlineFigure> : selected}
        </Badge>
      ) : (
        <Badge variant="status" value="warning">
          No {noun} selected
        </Badge>
      )}
      {canChoose ? (
        <Button
          variant="ghost"
          onClick={onChoose}
          disabled={disabled}
          data-testid={`select-property-${provider}`}
          aria-label={`${verb} ${noun}`}
        >
          {verb}
        </Button>
      ) : null}
    </Inline>
  );
}

/**
 * Property picker for one integration connection.
 *
 * A connected OAuth grant does not by itself tell a sync WHAT to pull: the
 * worker fetches from the connection's `account_ref`, and derivation resolves
 * that ref back to a project through an active property mapping. Selecting
 * here creates that mapping against the ACTIVE project, which is also what
 * points `account_ref` at the property — so an unselected connection syncs
 * nothing and says so, rather than failing against an empty property id.
 *
 * Options come from the provider itself (`POST …/properties`), never free
 * text, so a ref can't be typed wrong. That call is live and lazy: it runs
 * only once the dialog opens.
 */
export function PropertyPicker({
  connection,
  disabled = false,
}: Readonly<{ connection: IntegrationConnection; disabled?: boolean }>) {
  const { activeProject } = useProjectContext();
  const mayDiscover = useWorkspaceCapability('manage_credentials');
  const activeMapping = useActiveMapping(
    connection.workspace_id,
    connection.id,
    activeProject?.id ?? null,
  );
  const [open, setOpen] = useState(false);

  const discovery = useMutation(
    integrationsMutations.discoverProperties(connection.workspace_id, connection.id),
  );

  // The descriptor refreshes the imported reads: account_ref moved with the mapping.
  const selectMutation = useMutation(
    integrationsMutations.createMapping(connection.workspace_id, connection.id),
  );
  // The options are blocked without a project, so a selection always names one.
  const selectProperty = (propertyRef: string) => {
    if (!activeProject) return;
    selectMutation.mutate(
      { provider: connection.provider, property_ref: propertyRef, project_id: activeProject.id },
      { onSuccess: () => setOpen(false) },
    );
  };

  // The active mapping, never the connection's account_ref — see
  // `useActiveMapping`. A stale account_ref would show a property as chosen
  // while every sync of it fails.
  const selected = activeMapping?.property_ref ?? '';
  const noun = PROVIDER_META[connection.provider].noun;

  return (
    <>
      <SelectedProperty
        selected={selected}
        noun={noun}
        provider={connection.provider}
        canChoose={mayDiscover}
        disabled={disabled || discovery.isPending}
        onChoose={() => {
          if (discovery.isPending) return;
          discovery.reset();
          setOpen(true);
          discovery.mutate(activeProject?.id);
        }}
      />

      <Dialog
        open={open}
        // Hold the dialog open while a selection is in flight, matching the
        // sibling confirm dialog: dismissing mid-mutation would unmount the
        // only surface showing the pending row and any resulting error.
        onOpenChange={(next) => {
          if (!selectMutation.isPending) setOpen(next);
        }}
        title={`Choose a ${noun}`}
        description={
          activeProject
            ? `Data for the selected property is imported into ${activeProject.name}.`
            : 'Select a project before choosing a property.'
        }
      >
        <Stack gap="compact">
          {!activeProject ? (
            <Callout tone="warning">
              No active project. Create or select a project first — a property must be imported into
              one.
            </Callout>
          ) : null}

          {discovery.isPending ? <QueryState kind="loading" label={`Loading ${noun}s…`} /> : null}

          {discovery.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(discovery.error, {
                action: 'load your properties from the provider',
              })}
            />
          ) : null}

          {discovery.data?.length === 0 ? (
            <Callout tone="neutral">
              This account has no {noun} available. Verify the property in the provider&rsquo;s own
              console first, then reopen this dialog.
            </Callout>
          ) : null}

          <Stack gap="tight">
            <PropertyOptions
              properties={discovery.data ?? []}
              selected={selected}
              blocked={!activeProject || selectMutation.isPending}
              selecting={{
                isPending: selectMutation.isPending,
                variables: selectMutation.variables?.property_ref,
              }}
              onSelect={selectProperty}
            />
          </Stack>

          {selectMutation.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(selectMutation.error, { action: 'save the property' })}
            />
          ) : null}
        </Stack>
      </Dialog>
    </>
  );
}
