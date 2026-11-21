import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CsvImportFileInput } from '@/components/ui/csv-import';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { TreeCheckOption, TreeList } from '@/components/ui/list-row';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { X } from '@/lib/icons';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { downloadCsv } from '@/lib/csv/download';
import { READ_FAILED_MESSAGE, readCsvFileText } from '@/lib/csv/read-file-text';
import { pluralCount } from '@/lib/format';
import {
  CATALOG_SAMPLE,
  MERCHANT_FEED_SAMPLE,
  leftOutCategories,
  type SampleCsv,
} from '@/lib/products/catalog-import';
import type { CatalogImportRequest } from '@citeladder/contracts/commerce-requests';
import type { CatalogImport, CatalogImportStage } from '@citeladder/contracts/commerce-suite';
import { Notice } from '@/components/ui/notice';

type Source = CatalogImportRequest['source'];
const SOURCES = [
  { value: 'shopify', label: 'Shopify store' },
  { value: 'merchant_center', label: 'Merchant Center feed' },
  { value: 'csv', label: 'CSV' },
] as const satisfies readonly { value: Source; label: string }[];

const STATUS_LABEL: Record<CatalogImport['row_outcomes'][number]['status'], string> = {
  created: 'Added',
  updated: 'Updated',
  unchanged: 'Unchanged',
  rejected: 'Rejected',
};

function FilePick({
  label,
  accept,
  file,
  onFile,
  sample,
}: Readonly<{
  label: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
  sample: SampleCsv;
}>) {
  return (
    <Stack gap="compact">
      <CsvImportFileInput label={label} accept={accept} onSelect={(next) => onFile(next ?? null)} />
      {file ? <p className={textRole('body', 'text-ink-2')}>Chosen: {file.name}</p> : null}
      <div>
        <Button
          variant="secondary"
          onClick={() => downloadCsv(sample.filename, sample.columns, sample.rows)}
        >
          Download sample CSV
        </Button>
      </div>
    </Stack>
  );
}

function CategoryReview({
  stage,
  unticked,
  onToggle,
}: Readonly<{
  stage: CatalogImportStage;
  unticked: ReadonlySet<string>;
  onToggle: (key: string) => void;
}>) {
  const leftOut = leftOutCategories(stage.categories, unticked);
  return (
    <Stack>
      <p className={textRole('body', 'text-ink-2')}>
        {pluralCount(stage.products, 'product')} ready from {stage.source_label}
        {stage.rejected ? `; ${pluralCount(stage.rejected, 'row')} cannot be imported` : ''}.
      </p>
      {stage.categories.length ? (
        <Stack gap="compact">
          <h3 className={textRole('subheading')}>Categories</h3>
          <p className={textRole('body', 'text-ink-2')}>
            Clear a category to leave it and the categories under it out of your catalog.
          </p>
          <TreeList label="Proposed categories">
            {stage.categories.map((node) => (
              <TreeCheckOption
                key={node.key}
                label={`${node.name} (${pluralCount(node.product_count, 'product')})`}
                depth={node.depth}
                checked={!leftOut.has(node.key)}
                disabled={leftOut.has(node.key) && !unticked.has(node.key)}
                badge={node.existing ? <Tag>In catalog</Tag> : null}
                onCheckedChange={() => onToggle(node.key)}
              />
            ))}
          </TreeList>
        </Stack>
      ) : (
        <p className={textRole('body', 'text-ink-2')}>The file names no categories.</p>
      )}
    </Stack>
  );
}

function ImportResults({
  result,
  repeated,
}: Readonly<{ result: CatalogImport; repeated: boolean }>) {
  return (
    <Stack>
      {repeated ? (
        <Notice tone="info">This content was imported before; these are its results.</Notice>
      ) : null}
      <p aria-label="Import results" className={textRole('body', 'text-ink-2')}>
        {result.created} added, {result.updated} updated, {result.unchanged} unchanged,{' '}
        {result.rejected} rejected
      </p>
      {result.row_outcomes.length ? (
        <ul className={ledgerClasses()} aria-label="Rows">
          {result.row_outcomes.map((row) => (
            <Inline
              as="li"
              key={row.row_number}
              gap="compact"
              className={ledgerItemClasses('flex-wrap')}
            >
              <span className="text-ink-tertiary tabular-nums">Row {row.row_number}</span>
              {row.status === 'rejected' ? (
                <StatusMark variant="status" value="danger">
                  {STATUS_LABEL[row.status]}
                </StatusMark>
              ) : (
                <Tag>{STATUS_LABEL[row.status]}</Tag>
              )}
              {row.detail ? <span className="text-ink-2">{row.detail}</span> : null}
            </Inline>
          ))}
        </ul>
      ) : null}
    </Stack>
  );
}

function SourceStep({
  source,
  onSource,
  store,
  onStore,
  file,
  onFile,
  readError,
  stageError,
}: Readonly<{
  source: Source;
  onSource: (source: Source) => void;
  store: string;
  onStore: (store: string) => void;
  file: File | null;
  onFile: (file: File | null) => void;
  readError: string | null;
  stageError: Error | null;
}>) {
  return (
    <Stack>
      <Tabs
        items={SOURCES}
        ariaLabel="Product source"
        value={source}
        onValueChange={onSource}
        spaced
      >
        <TabPanel value="shopify">
          <Field label="Store domain" hint="Your domain or .myshopify.com address">
            {(props) => (
              <Input
                {...props}
                value={store}
                placeholder="shop.example.com"
                onChange={(event) => onStore(event.target.value)}
              />
            )}
          </Field>
        </TabPanel>
        <TabPanel value="merchant_center">
          <FilePick
            label="Feed file (CSV, TSV, XML or JSON)"
            accept=".csv,.tsv,.txt,.xml,.json"
            file={file}
            onFile={onFile}
            sample={MERCHANT_FEED_SAMPLE}
          />
        </TabPanel>
        <TabPanel value="csv">
          <Stack gap="compact">
            <FilePick
              label="CSV file"
              accept=".csv,text/csv"
              file={file}
              onFile={onFile}
              sample={CATALOG_SAMPLE}
            />
            <p className={textRole('body', 'text-ink-2')}>
              Title and brand are required. A category is a path such as Footwear &gt; Running.
            </p>
          </Stack>
        </TabPanel>
      </Tabs>
      {readError ? <Notice tone="negative">{readError}</Notice> : null}
      {stageError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(stageError, { action: 'read the products' })}
        />
      ) : null}
    </Stack>
  );
}

export function AddProductsDialog({
  workspaceId,
  projectId,
  open,
  onOpenChange,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const scope = { workspaceId, projectId };
  const stage = useMutation(commerceMutations.stageImport(scope));
  const apply = useMutation(commerceMutations.applyImport(scope));
  const [source, setSource] = useState<Source>('shopify');
  const [store, setStore] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const submitting = useRef(false);
  const selection = useRef(0);
  const release = () => {
    selection.current += 1;
    submitting.current = false;
    setReading(false);
  };

  const reset = () => {
    stage.reset();
    apply.reset();
    setStore('');
    setFile(null);
    setUnticked(new Set());
    setReadError(null);
    release();
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  const staged = stage.data;
  const result = apply.data ?? staged?.result ?? null;
  const ready = source === 'shopify' ? store.trim().length > 0 : file !== null;

  const chooseFile = (next: File | null) => {
    setFile(next);
    setReadError(null);
    release();
  };
  const settled = {
    onSettled: () => {
      submitting.current = false;
    },
  };
  const submit = async () => {
    if (submitting.current) return;
    if (source === 'shopify') {
      submitting.current = true;
      return stage.mutate({ source, store: store.trim() }, settled);
    }
    if (!file) return;
    submitting.current = true;
    const attempt = selection.current;
    setReading(true);
    setReadError(null);
    let content: string;
    try {
      content = await readCsvFileText(file);
    } catch (cause) {
      if (attempt !== selection.current) return;
      release();
      setReadError(cause instanceof Error ? cause.message : READ_FAILED_MESSAGE);
      return;
    }
    if (attempt !== selection.current) return;
    setReading(false);
    stage.mutate({ source, content, filename: file.name }, settled);
  };
  const toggle = (key: string) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  let body;
  let footer;
  if (result) {
    body = <ImportResults result={result} repeated={!apply.data} />;
    footer = (
      <Button variant="primary" onClick={() => close(false)}>
        Done
      </Button>
    );
  } else if (staged) {
    body = (
      <Stack>
        <CategoryReview stage={staged} unticked={unticked} onToggle={toggle} />
        {apply.error ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(apply.error, { action: 'import the products' })}
          />
        ) : null}
      </Stack>
    );
    footer = (
      <>
        <Button variant="secondary" disabled={apply.isPending} onClick={() => stage.reset()}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={apply.isPending || staged.products === 0}
          onClick={() =>
            apply.mutate({
              importId: staged.import_id,
              excluded_categories: [...leftOutCategories(staged.categories, unticked)],
            })
          }
        >
          {apply.isPending ? 'Importing…' : `Import ${pluralCount(staged.products, 'product')}`}
        </Button>
      </>
    );
  } else {
    body = (
      <SourceStep
        source={source}
        onSource={(next) => {
          setSource(next);
          chooseFile(null);
        }}
        store={store}
        onStore={setStore}
        file={file}
        onFile={chooseFile}
        readError={readError}
        stageError={stage.error}
      />
    );
    const busy = reading || stage.isPending;
    footer = (
      <>
        <Button variant="quiet" onClick={() => close(false)}>
          <Icon icon={X} />
          Cancel
        </Button>
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Reading…' : 'Review categories'}
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close} title="Add products" width="wide" footer={footer}>
      {body}
    </Dialog>
  );
}
