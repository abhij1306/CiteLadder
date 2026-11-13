import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ChipInput } from '@/components/ui/chip-input';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { Textarea } from '@/components/ui/textarea';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import {
  productEditChanges,
  productEditForm,
  type ProductEditForm,
} from '@/lib/products/product-edit';

type Product = CommerceProductDetail['product'];
type Catalog = NonNullable<Product['catalog']>;

const TEXT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'brand', label: 'Brand' },
  { key: 'canonical_url', label: 'Product URL' },
  { key: 'image_url', label: 'Image URL' },
  { key: 'price', label: 'Price' },
  { key: 'currency', label: 'Currency', hint: 'Three letters, such as USD' },
  { key: 'sku', label: 'SKU' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'mpn', label: 'MPN' },
] as const;

/** The edit drawer: a catalog product's fields, saved as one edit of what changed. */
function ProductEditDrawer({
  scope,
  product,
  catalog,
  open,
  onOpenChange,
}: Readonly<{
  scope: ProjectScope;
  product: Product;
  catalog: Catalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  // The record as the drawer opened on it: a refetch while it is open never
  // turns an untouched field into a change that would overwrite newer data.
  const [initial] = useState(() => productEditForm(product, catalog));
  const [values, setValues] = useState<ProductEditForm>(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation(commerceMutations.editProduct(scope));
  const set = (patch: Partial<ProductEditForm>) =>
    setValues((current) => ({ ...current, ...patch }));
  const setText = (key: (typeof TEXT_FIELDS)[number]['key'], value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const close = (next: boolean) => onOpenChange(next);
  const submit = () => {
    const result = productEditChanges(initial, values);
    if (result.kind === 'invalid') return setInvalid(result.message);
    setInvalid(null);
    if (result.kind === 'unchanged') return close(false);
    save.mutate({ id: product.holder_id, ...result.edit }, { onSuccess: () => close(false) });
  };
  return (
    <Drawer
      open={open}
      onOpenChange={close}
      title="Edit product"
      description="Your edits win over CSV imports and crawls until a later import changes the field."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap="workspace">
          {invalid ? <Callout tone="negative">{invalid}</Callout> : null}
          {save.error ? (
            <MutationNotice
              notice={mutationNoticeForError(save.error, { action: 'save the product' })}
            />
          ) : null}
          {TEXT_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              required={'required' in field}
              hint={'hint' in field ? field.hint : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  value={values[field.key]}
                  onChange={(event) => setText(field.key, event.target.value)}
                />
              )}
            </Field>
          ))}
          <Field label="Description">
            {(props) => (
              <Textarea
                {...props}
                value={values.description}
                onChange={(event) => set({ description: event.target.value })}
              />
            )}
          </Field>
          <ChipInput
            label="Categories"
            items={values.categories.map((value) => ({ value }))}
            onChange={(items) => set({ categories: items.map((item) => item.value) })}
            placeholder="Add a category"
          />
        </Stack>
      </form>
    </Drawer>
  );
}

/**
 * "Add to tracking" for a product the answers showed but nobody approved
 * (CM6): one click approves the AI-observed competitor, so it is matched as
 * an approved competitor from then on.
 */
export function AddToTracking(
  props: Readonly<{ scope: ProjectScope; candidateId: string; name: string }>,
) {
  // Approving a competitor is a write; a role without it is not offered one.
  return useWorkspaceCapability('write') ? <AddToTrackingButton {...props} /> : null;
}

function AddToTrackingButton({
  scope,
  candidateId,
  name,
}: Readonly<{ scope: ProjectScope; candidateId: string; name: string }>) {
  const approve = useMutation(commerceMutations.decideCompetitor(scope));
  return (
    <Stack gap="tight">
      <Button
        aria-label={`Add ${name} to tracking`}
        disabled={approve.isPending}
        onClick={() => approve.mutate({ id: candidateId, decision: 'approved' })}
      >
        {approve.isPending ? 'Adding…' : 'Add to tracking'}
      </Button>
      {approve.error ? (
        <MutationNotice
          notice={mutationNoticeForError(approve.error, { action: 'add the product to tracking' })}
        />
      ) : null}
    </Stack>
  );
}

const ARCHIVED_NOTE =
  'This product is out of your catalog, answer matching and shopping prompts. Its history stays here.';

/**
 * A catalog product's own controls on its page: Edit, and Archive or Restore.
 * An archived product says so first; it keeps its history but leaves the
 * catalog, new matching and shopping prompts until restored.
 */
export function ProductCatalogControls({
  scope,
  product,
  catalog,
}: Readonly<{ scope: ProjectScope; product: Product; catalog: Catalog }>) {
  const [editing, setEditing] = useState(false);
  const lifecycle = useMutation(commerceMutations.setProductLifecycle(scope));
  const archived = catalog.lifecycle_state === 'archived';
  const toggle = () =>
    lifecycle.mutate({
      id: product.holder_id,
      lifecycle_state: archived ? 'active' : 'archived',
    });
  const lifecycleLabel = archived ? 'Restore' : 'Archive';
  // Editing and archiving are writes; a role without them reads the state only.
  const canWrite = useWorkspaceCapability('write');
  if (!canWrite) {
    return archived ? (
      <Callout tone="warning" title="Archived">
        {ARCHIVED_NOTE}
      </Callout>
    ) : null;
  }
  return (
    <Stack gap="compact">
      {archived ? (
        <Callout
          tone="warning"
          title="Archived"
          action={
            <Button onClick={toggle} disabled={lifecycle.isPending}>
              Restore
            </Button>
          }
        >
          {ARCHIVED_NOTE}
        </Callout>
      ) : null}
      {lifecycle.error ? (
        <MutationNotice
          notice={mutationNoticeForError(lifecycle.error, {
            action: `${lifecycleLabel.toLowerCase()} the product`,
          })}
        />
      ) : null}
      <Inline gap="compact">
        <Button onClick={() => setEditing(true)}>Edit product</Button>
        {archived ? null : (
          <Button variant="ghost" onClick={toggle} disabled={lifecycle.isPending}>
            {lifecycle.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        )}
      </Inline>
      {/* Mounted while open, so each edit starts from the record as last read. */}
      {editing ? (
        <ProductEditDrawer
          scope={scope}
          product={product}
          catalog={catalog}
          open
          onOpenChange={setEditing}
        />
      ) : null}
    </Stack>
  );
}
