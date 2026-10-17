import type { AgentMessage } from '@/lib/api/agent';

export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const CHAT = '22222222-2222-4222-8222-222222222222';
const OUTPUT = '33333333-3333-4333-8333-333333333333';
export const REV1 = '44444444-4444-4444-8444-444444444441';
export const REV2 = '44444444-4444-4444-8444-444444444442';
export const RUN = '55555555-5555-4555-8555-555555555555';
export const NOW = '2026-09-25T10:00:00Z';

export function revision(id: string, number: number, author: 'agent' | 'user', body: string) {
  return {
    id,
    number,
    parent_revision_id: number > 1 ? REV1 : null,
    author,
    phase: 'final' as const,
    title: 'Pricing page edits',
    body,
    source_refs: ['citeladder://opportunity/66666666-6666-4666-8666-666666666666'],
    approved_at: null,
    created_at: NOW,
  };
}

type DetailRun = {
  status: string;
  error_code?: string;
  progress?: { ordinal: number; status: string; tool: string | null }[];
};

const DEFAULT_RUN: DetailRun = { status: 'succeeded' };

export function detail(latest: ReturnType<typeof revision>, run: DetailRun = DEFAULT_RUN) {
  return {
    chat: {
      id: CHAT,
      project_id: PROJECT,
      action_id: null,
      target_label: null,
      title: 'Improve pricing snippet',
      turn_count: 1,
      output_kind: 'page_edits',
      output_phase: 'final',
      last_activity_at: NOW,
      created_at: NOW,
      running: false,
    },
    pinned_skill_id: null,
    context: {},
    messages: [
      {
        id: '77777777-7777-4777-8777-777777777771',
        sequence: 1,
        role: 'user',
        content: 'Improve our pricing page snippet.',
        mentions: [] as AgentMessage['mentions'],
        skill_id: null,
        skill_source: null,
        evidence_refs: [],
        steps: [],
        created_at: NOW,
      },
      {
        id: '77777777-7777-4777-8777-777777777772',
        sequence: 2,
        role: 'agent',
        content: 'Here are the edits.',
        mentions: [] as AgentMessage['mentions'],
        skill_id: 'gsc_optimize',
        skill_source: 'model',
        evidence_refs: [],
        steps: [
          { kind: 'model', ordinal: 1 },
          { kind: 'skill', skill_id: 'gsc_optimize' },
          { kind: 'tool', ordinal: 1, tool: 'read_integration_status', status: 'completed' },
          { kind: 'model', ordinal: 2 },
        ],
        created_at: NOW,
      },
    ],
    latest_run: {
      id: RUN,
      status: run.status,
      mode: 'turn',
      skill_id: 'gsc_optimize',
      skill_source: 'model',
      steps_used: 2,
      error_code: run.error_code ?? '',
      error_detail: '',
      created_at: NOW,
      completed_at: NOW,
      progress: (run.progress ?? []).map((step) => ({
        model_attempt_id: RUN,
        tool_attempt_id: null,
        call_id: null,
        run_attempt: 1,
        runtime_version: 'agent-runtime-2',
        protocol_version: 'agent-protocol-1',
        registry_version: 'agent-tools-2',
        skill_catalog_version: 'test-catalog',
        projection_version: 'agent-progress-1',
        ...step,
      })),
    },
    output: {
      id: OUTPUT,
      message_id: '77777777-7777-4777-8777-777777777772',
      action_id: null,
      kind: 'page_edits',
      skill_id: 'gsc_optimize',
      format_id: null,
      target_kind: null,
      target_label: null,
      phase: 'final',
      latest_revision: latest,
    },
  };
}

export const skills = {
  skills: [
    {
      id: 'gsc_optimize',
      label: 'Search Console optimization',
      group: 'owned_site',
      output_kind: 'page_edits',
      description: 'Title and snippet edits.',
    },
  ],
  workflow_groups: [{ id: 'improve', label: 'Improve your site' }],
  workflows: [
    {
      id: 'internal_links',
      group: 'improve',
      label: 'Internal links',
      description: 'Where to link from.',
      skill_id: 'internal_links',
      format_id: null,
      prompt: 'Plan internal links.',
      inputs: [],
    },
  ],
  output_kinds: [
    {
      kind: 'page_edits',
      label: 'Page edits',
      refinements: ['Make it shorter'],
      next: [{ workflow_id: 'internal_links', prompt: 'Plan internal links that support' }],
    },
  ],
};
