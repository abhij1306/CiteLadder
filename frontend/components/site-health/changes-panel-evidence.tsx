import type { ChangeObservation } from '@citeladder/contracts';

import { CopyButton } from '@/components/ui/copy-button';
import { Drawer } from '@/components/ui/drawer';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader, treeBranchClasses } from '@/components/ui/workspace';
import {
  CHANGE_EVIDENCE_DEPTH_LIMIT,
  CHANGE_EVIDENCE_LIMIT,
  CHANGE_EVIDENCE_TEXT_LIMIT,
} from '@/lib/config/site-health';
import { changeFieldLabel } from '@/lib/site-health/change-fields';

function boundedText(value: string) {
  return value.length > CHANGE_EVIDENCE_TEXT_LIMIT
    ? `${value.slice(0, CHANGE_EVIDENCE_TEXT_LIMIT)}…`
    : value;
}

function ChangeValue({ value, depth = 0 }: Readonly<{ value: unknown; depth?: number }>) {
  if (value === null || value === undefined || value === '') return <>Not present</>;
  if (Array.isArray(value)) {
    // An observed empty list is not an absent value.
    if (!value.length) return <>0 items</>;
    if (depth >= CHANGE_EVIDENCE_DEPTH_LIMIT)
      return (
        <>
          {value.length} {value.length === 1 ? 'item' : 'items'}
        </>
      );
    return (
      <ul className={treeBranchClasses()}>
        {value.slice(0, CHANGE_EVIDENCE_LIMIT).map((item, index) => (
          <li
            key={index} // NOSONAR -- an immutable evidence array that never reorders and may repeat values; position is the identity
          >
            <ChangeValue value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > CHANGE_EVIDENCE_LIMIT ? (
          <li className="text-ink-muted">
            {value.length - CHANGE_EVIDENCE_LIMIT} more items not shown
          </li>
        ) : null}
      </ul>
    );
  }
  if (typeof value === 'object') return <ChangeRecord value={value} depth={depth} />;
  const text = scalarText(value);
  return text === null ? <>Not present</> : <>{boundedText(text)}</>;
}

/** Persisted evidence is JSON, so anything that is not a container is a scalar. */
function scalarText(value: unknown): string | null {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return null;
  }
}

const CONTENT_FIELD_ORDER = [
  'content_change_classification',
  'content_delta_ratio',
  'comparison_coverage',
  'coverage_reason',
  'sections_added',
  'sections_removed',
  'heading_outline',
  'word_count',
];

const CONTENT_STATE_FIELDS = new Set([
  'content_change_classification',
  'metadata_consistency',
  'comparison_coverage',
  'coverage',
  'coverage_reason',
  'content_delta_measure',
]);

function changeFieldValue(key: string, value: unknown) {
  if (typeof value !== 'string' || !CONTENT_STATE_FIELDS.has(key)) return value;
  return changeFieldLabel(value);
}

function ChangeRecord({ value, depth }: Readonly<{ value: object; depth: number }>) {
  const fields = Object.entries(value);
  if (!fields.length) return <>Not present</>;
  if (depth >= CHANGE_EVIDENCE_DEPTH_LIMIT)
    return (
      <>
        {fields.length} {fields.length === 1 ? 'field' : 'fields'}
      </>
    );
  // Comparison outcomes precede capture details in the bounded content record.
  const rank = (key: string) => {
    const index = CONTENT_FIELD_ORDER.indexOf(key);
    return index < 0 ? CONTENT_FIELD_ORDER.length : index;
  };
  fields.sort(([left], [right]) => rank(left) - rank(right));
  return (
    <dl className={treeBranchClasses()}>
      {fields.slice(0, CHANGE_EVIDENCE_LIMIT).map(([key, item]) => (
        <div key={key}>
          <dt className="text-ink-muted inline">{boundedText(changeFieldLabel(key))}: </dt>
          <dd className="inline [overflow-wrap:anywhere]">
            {key === 'shingles' && Array.isArray(item) ? (
              `${item.length} text fingerprints`
            ) : (
              <ChangeValue value={changeFieldValue(key, item)} depth={depth + 1} />
            )}
          </dd>
        </div>
      ))}
      {fields.length > CHANGE_EVIDENCE_LIMIT ? (
        <div>
          <dt className="sr-only">Additional evidence</dt>
          <dd className="text-ink-muted">
            {fields.length - CHANGE_EVIDENCE_LIMIT} more fields not shown
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function EvidenceValue({ heading, value }: Readonly<{ heading: string; value: unknown }>) {
  return (
    <Stack as="section" aria-label={heading}>
      <EditorialSectionHeader title={heading} />
      <div className={textRole('body', '[overflow-wrap:anywhere]')}>
        <ChangeValue value={value} />
      </div>
    </Stack>
  );
}

/**
 * Where the change was read: each side's page evidence, linked by the crawl
 * that captured it. The implementation event has no readable name in this
 * projection, so its ID stays as a copyable detail.
 */
function EvidenceSources({
  row,
  crawlAId,
  crawlBId,
}: Readonly<{ row: ChangeObservation; crawlAId: string | null; crawlBId: string | null }>) {
  return (
    <Stack as="section" aria-label="Page evidence">
      <EditorialSectionHeader title="Page evidence" />
      <Inline className="flex-wrap">
        {crawlAId && row.source_analysis_a_id ? (
          <TextLink text="body" href={`/site/crawls/${crawlAId}/pages/${row.site_url_id}`}>
            Previous crawl
          </TextLink>
        ) : (
          <span className={textRole('caption')}>Previous crawl: no page evidence</span>
        )}
        {crawlBId && row.source_analysis_b_id ? (
          <TextLink text="body" href={`/site/crawls/${crawlBId}/pages/${row.site_url_id}`}>
            Latest crawl
          </TextLink>
        ) : (
          <span className={textRole('caption')}>Latest crawl: no page evidence</span>
        )}
      </Inline>
      {row.implementation_event_id ? (
        <Inline>
          <span className={textRole('caption')}>Matches a declared implementation</span>
          <CopyButton variant="ghost" value={row.implementation_event_id}>
            Copy event ID
          </CopyButton>
        </Inline>
      ) : null}
    </Stack>
  );
}

/** One change's before and after values, in a drawer so the table never grows. */
export function ChangeEvidenceDrawer({
  row,
  crawlAId,
  crawlBId,
  onClose,
}: Readonly<{
  row: ChangeObservation | undefined;
  crawlAId: string | null;
  crawlBId: string | null;
  onClose: () => void;
}>) {
  return (
    <Drawer
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row ? changeFieldLabel(row.field) : 'Change evidence'}
      eyebrow="Change evidence"
      description={row?.normalized_url}
    >
      {row ? (
        <Stack gap="section">
          <EvidenceValue heading="Before" value={row.before_value} />
          <EvidenceValue heading="After" value={row.after_value} />
          <EvidenceSources row={row} crawlAId={crawlAId} crawlBId={crawlBId} />
        </Stack>
      ) : null}
    </Drawer>
  );
}
