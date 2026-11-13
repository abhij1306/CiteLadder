/**
 * Record references (`citeladder://<kind>/<id>`) as a reader sees them: a
 * labelled source and, where the product has one, the screen that shows it
 * (the contracts' record-kind table). The references come from persisted
 * replies and revisions; this never resolves or fetches a record.
 */
import { isRecordKind, RECORD_KINDS, recordScreen } from '@citeladder/contracts/record-kinds';

const FALLBACK_LABEL = 'CiteLadder record';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EvidenceGroup = { label: string; count: number; href: string | null };

function parse(ref: string): { kind: string; id: string } {
  if (!ref.startsWith('citeladder://')) return { kind: '', id: '' };
  const [kind = '', id = ''] = ref.slice('citeladder://'.length).split('/');
  return { kind, id };
}

/**
 * One record behind an Action, dated. `observed`: a reading CiteLadder took
 * (a crawl, a visibility run, a Search Console window). `inferred`: a finding a
 * rule derived from readings. `at` is the persisted time the record carries;
 * null when none was stored, never a guess.
 */
export type DatedEvidence = {
  key: string;
  label: string;
  at: string | null;
  basis: 'observed' | 'inferred';
  href: string | null;
};

type ActionEvidenceSource = {
  members: readonly { id: string; title: string; updated_at: string }[];
  cohort: { crawl_id: string; crawl_completed_at: string | null } | null;
  declaration: {
    checks: readonly {
      observed_at: string | null;
      source_kind: string | null;
      source_id: string | null;
    }[];
  } | null;
};

/** A reading's record: its kind's label and screen, or the generic label for an unknown kind. */
function reading(kind: string, id: string, at: string | null): DatedEvidence {
  const known = isRecordKind(kind);
  return {
    key: `${kind}/${id}`,
    label: known ? RECORD_KINDS[kind].label : FALLBACK_LABEL,
    at,
    basis: 'observed',
    href: known ? recordScreen(kind, (name) => (name === 'id' ? id : '')) : null,
  };
}

/**
 * The records behind an Action as its read returned them: each finding, the
 * crawl an issue family was read from, and each reading a declared check
 * took. Dates are the read's persisted timestamps; nothing is resolved here.
 */
export function actionEvidence(action: ActionEvidenceSource): DatedEvidence[] {
  const records = new Map<string, DatedEvidence>();
  for (const member of action.members)
    records.set(`opportunity/${member.id}`, {
      key: `opportunity/${member.id}`,
      label: member.title,
      at: member.updated_at,
      basis: 'inferred',
      href: null,
    });
  if (action.cohort) {
    const crawl = reading('site_crawl', action.cohort.crawl_id, action.cohort.crawl_completed_at);
    records.set(crawl.key, crawl);
  }
  for (const check of action.declaration?.checks ?? []) {
    if (!check.source_kind || !check.source_id) continue;
    const found = reading(check.source_kind, check.source_id, check.observed_at);
    if (!records.has(found.key)) records.set(found.key, found);
  }
  return [...records.values()];
}

/**
 * References grouped by kind, in first-cited order. A group links to its
 * screen; a single record links to its own page when its id alone builds one.
 */
export function groupEvidence(refs: readonly string[]): EvidenceGroup[] {
  const groups = new Map<string, { kind: string; ids: string[] }>();
  for (const ref of new Set(refs)) {
    const { kind, id } = parse(ref);
    const label = isRecordKind(kind) ? RECORD_KINDS[kind].label : FALLBACK_LABEL;
    const group = groups.get(label) ?? { kind, ids: [] };
    group.ids.push(id);
    groups.set(label, group);
  }
  return [...groups].map(([label, { kind, ids }]) => {
    if (!isRecordKind(kind)) return { label, count: ids.length, href: null };
    const single = ids.length === 1 && UUID.test(ids[0] ?? '') ? ids[0] : undefined;
    const href = single
      ? recordScreen(kind, (name) => (name === 'id' ? single : ''))
      : RECORD_KINDS[kind].screen;
    return { label, count: ids.length, href };
  });
}
