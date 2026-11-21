import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Absence } from '@/components/ui/absence';
import { Dialog } from '@/components/ui/dialog';
import { StatusMark } from '@/components/ui/status-mark';
import { Stack } from '@/components/ui/layout';
import { OptionRow } from '@/components/ui/list-row';
import {
  integrationsMutations,
  integrationsQueries,
  type IntegrationConnection,
  type IntegrationProperty,
} from '@/lib/api/integrations';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { ClampText } from '@/components/ui/clamp-text';
import { textRole } from '@/components/ui/typography';
import { activeMappingFor, ownPropertiesFirst } from '@/components/integrations/data-sources';
import { PROVIDER_META } from '@/components/settings/grant-model';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

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

export function useActiveMapping(
  workspaceId: string,
  connectionId: string,
  projectId: string | null,
) {
  const query = useQuery(integrationsQueries.mappings(workspaceId, connectionId));
  return activeMappingFor(query.data, projectId);
}

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

function DiscoveryState({
  pending,
  error,
  properties,
  noun,
}: Readonly<{
  pending: boolean;
  error: Error | null;
  properties: readonly IntegrationProperty[] | undefined;
  noun: string;
}>) {
  if (pending)
    return <StateBlock kind="loading" label={`Loading ${noun}s…`} shape={{ kind: 'list' }} />;
  if (error)
    return (
      <Notice
        kind="mutation"
        notice={mutationNoticeForError(error, { action: 'load your properties from the provider' })}
      />
    );
  if (properties?.length !== 0) return null;
  return <Notice tone="info">No {noun} on this account.</Notice>;
}

export function SelectedPropertyMark({
  connection,
}: Readonly<{ connection: IntegrationConnection }>) {
  const { activeProject } = useProjectContext();
  const mappings = useQuery(integrationsQueries.mappings(connection.workspace_id, connection.id));
  if (mappings.isPending)
    return (
      <span aria-hidden className={textRole('code')}>
        {' '}
      </span>
    );
  if (mappings.isError) return <Absence state="unavailable" label="Property unavailable" />;
  const selected = activeMappingFor(mappings.data, activeProject?.id ?? null)?.property_ref ?? '';
  if (!selected)
    return (
      <StatusMark variant="status" value="warning">
        No property selected
      </StatusMark>
    );
  return <ClampText className={textRole('code', 'text-ink-2')}>{selected}</ClampText>;
}

export function usePropertyPicker(connection: IntegrationConnection) {
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

  const selectMutation = useMutation(
    integrationsMutations.createMapping(connection.workspace_id, connection.id),
  );
  const selectProperty = (propertyRef: string) => {
    if (!activeProject) return;
    selectMutation.mutate(
      { provider: connection.provider, property_ref: propertyRef, project_id: activeProject.id },
      { onSuccess: () => setOpen(false) },
    );
  };

  const selected = activeMapping?.property_ref ?? '';
  const noun = PROVIDER_META[connection.provider].noun;
  const verb = selected ? 'Change' : 'Select';
  const openPicker = () => {
    if (discovery.isPending) return;
    discovery.reset();
    setOpen(true);
    discovery.mutate(activeProject?.id);
  };

  const dialog = mayDiscover ? (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!selectMutation.isPending) setOpen(next);
      }}
      title={`Choose a ${noun}`}
    >
      <Stack gap="compact">
        {!activeProject ? <Notice tone="warning">No active project.</Notice> : null}
        <DiscoveryState
          pending={discovery.isPending}
          error={discovery.error}
          properties={discovery.data}
          noun={noun}
        />
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
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(selectMutation.error, { action: 'save the property' })}
          />
        ) : null}
      </Stack>
    </Dialog>
  ) : null;

  return {
    allowed: mayDiscover,
    verb,
    label: `${verb} ${noun}`,
    pending: discovery.isPending,
    open: openPicker,
    dialog,
  };
}
