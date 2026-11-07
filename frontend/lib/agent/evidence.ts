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
