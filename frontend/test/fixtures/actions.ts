import { PROJECT } from '@/test/agent-chat-fixture';

export function actionItem(id: string, label: string, projectId = PROJECT) {
  return {
    id,
    project_id: projectId,
    target_kind: 'page',
    target_label: label,
    target_url: null,
    target_prompt_id: null,
    origin: 'evidence',
    status: 'open',
    measurement: null,
    priority_score: 1,
    priority_band: 'low',
    families: [] as string[],
    approach: 'improve_page',
    goal: 'own_pages',
    grouping: 'improve_pages',
    skill_id: 'gsc_optimize',
    member_count: 1,
    declarable_member_count: 1,
    handoff: { context: 'action', message: `Work on ${label}.` },
    evidence_cleared_at: null,
    created_at: '2026-09-25T10:00:00Z',
    updated_at: '2026-09-25T10:00:00Z',
  };
}

export function actionDetail(id: string, label: string, projectId = PROJECT) {
  return {
    ...actionItem(id, label, projectId),
    diagnosis: {},
    members: [],
    member_measurement: {},
    declarable_since: '2026-01-01T00:00:00Z',
    declaration: null,
  };
}

export function actionsPage(
  items: readonly unknown[] = [],
  counts: Readonly<{ status_counts?: Record<string, number>; next_cursor?: string | null }> = {},
) {
  return {
    items,
    next_cursor: counts.next_cursor ?? null,
    status_counts: counts.status_counts ?? {},
  };
}
