import { isRecordKind, RECORD_KINDS, recordScreen } from '@citeladder/contracts/record-kinds';

const FALLBACK_LABEL = 'CiteLadder record';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EvidenceGroup = { label: string; count: number; href: string | null };

function parse(ref: string): { kind: string; id: string } {
  if (!ref.startsWith('citeladder://')) return { kind: '', id: '' };
  const [kind = '', id = ''] = ref.slice('citeladder://'.length).split('/');
  return { kind, id };
}

export type DatedEvidence = {
  key: string;
  label: string;
  at: string | null;
  basis: 'observed' | 'inferred';
  href: string | null;
};

type ActionEvidenceSource = {
  members: readonly { id: string; title: string; updated_at: string }[];
  declaration: {
    checks: readonly {
      observed_at: string | null;
      source_kind: string | null;
      source_id: string | null;
    }[];
  } | null;
};

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
  for (const check of action.declaration?.checks ?? []) {
    if (!check.source_kind || !check.source_id) continue;
    const found = reading(check.source_kind, check.source_id, check.observed_at);
    if (!records.has(found.key)) records.set(found.key, found);
  }
  return [...records.values()];
}

export function citedActions<T extends { id: string }>(
  refs: readonly string[],
  actions: readonly T[],
): T[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  return [...new Set(refs)].flatMap((ref) => {
    const { kind, id } = parse(ref);
    const action = kind === 'action' ? byId.get(id) : undefined;
    return action ? [action] : [];
  });
}

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
