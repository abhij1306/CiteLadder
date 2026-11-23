import type { AgentMessage, AgentOutput } from '@/lib/api/agent';

export const AGENT_MODELS = {
  options: [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  ],
  default_model: 'claude-haiku-5-5',
  default_reasoning_effort: 'medium',
} as const;
export const CHAT_MODEL = {
  id: 'claude-haiku-5-5',
  reasoning_effort: 'medium',
  locked: false,
} as const;

export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const CHAT = '22222222-2222-4222-8222-222222222222';
export const OUTPUT = '33333333-3333-4333-8333-333333333333';
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
    title: 'Pricing page edits',
    body,
    source_refs: ['citeladder://opportunity/66666666-6666-4666-8666-666666666666'],
    web_sources: [] as { url: string; title: string }[],
    created_at: NOW,
  };
}

type DetailRun = {
  status: string;
  error_code?: string;
  progress?: {
    ordinal: number;
    status: string;
    tool: string | null;
    target?: string | null;
    run_attempt?: number;
  }[];
};

const DEFAULT_RUN: DetailRun = { status: 'succeeded' };

export function detail(latest: ReturnType<typeof revision>, run: DetailRun = DEFAULT_RUN) {
  return {
    chat: {
      id: CHAT,
      project_id: PROJECT,
      action_id: null,
      origin: 'chat',
      target_label: null,
      title: 'Improve pricing snippet',
      turn_count: 1,
      output_kind: 'page_edits',
      last_activity_at: NOW,
      created_at: NOW,
      running: false,
    },
    pinned_skill_id: null,
    model: CHAT_MODEL,
    context: {},
    messages: [
      {
        id: '77777777-7777-4777-8777-777777777771',
        sequence: 1,
        role: 'user',
        content: 'Improve our pricing page snippet.',
        mentions: [] as AgentMessage['mentions'],
        attachments: [] as AgentMessage['attachments'],
        proposals: [] as AgentMessage['proposals'],
        views: [] as AgentMessage['views'],
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
        attachments: [] as AgentMessage['attachments'],
        proposals: [] as AgentMessage['proposals'],
        views: [] as AgentMessage['views'],
        skill_id: 'gsc_optimize',
        skill_source: 'model',
        evidence_refs: [],
        steps: [
          { kind: 'model', ordinal: 1 },
          { kind: 'skill', skill_id: 'gsc_optimize' },
          {
            kind: 'tool',
            ordinal: 1,
            tool: 'read_integration_status',
            status: 'completed',
            call_id: 'call_1',
          },
          { kind: 'model', ordinal: 2 },
        ],
        created_at: NOW,
      },
    ],
    latest_run: {
      id: RUN,
      status: run.status,
      skill_id: 'gsc_optimize',
      skill_source: 'model',
      steps_used: 2,
      error_code: run.error_code ?? '',
      error_detail: '',
      created_at: NOW,
      completed_at: NOW,
      progress: (run.progress ?? []).map((step) => ({
        call_id: null,
        run_attempt: 1,
        target: null,
        ...step,
      })),
    },
    outputs: [
      {
        id: OUTPUT,
        number: 1,
        message_id: '77777777-7777-4777-8777-777777777772' as string | null,
        action_id: null as string | null,
        kind: 'page_edits',
        skill_id: 'gsc_optimize',
        format_id: null,
        target_kind: null,
        target_label: null,
        named_target: null as AgentOutput['named_target'],
        latest_revision: latest,
      },
    ],
  };
}

export function pageChatPhases(reply: string) {
  const base = detail(revision(REV1, 1, 'agent', 'Body.'));
  const request = base.messages[0]!;
  const reading = {
    ...base,
    chat: { ...base.chat, turn_count: 0, output_kind: null },
    messages: [request],
    outputs: [],
    latest_run: null,
    page_fetch: { status: 'reading' },
  };
  const fetched = {
    ...reading,
    chat: { ...reading.chat, turn_count: 1, output_kind: 'page' },
    page_fetch: { status: 'done', outcome: 'fetched', fetched_at: NOW },
    latest_run: {
      ...base.latest_run,
      id: '99999999-9999-4999-8999-999999999992',
      status: 'queued',
      completed_at: null,
    },
    outputs: [
      {
        ...base.outputs[0]!,
        kind: 'page',
        message_id: null,
        latest_revision: { ...revision(REV1, 1, 'agent', 'Fetched body.'), author: 'fetch' },
      },
    ],
  };
  const answered = {
    ...fetched,
    messages: [request, { ...base.messages[1]!, content: reply }],
    latest_run: { ...fetched.latest_run, status: 'succeeded', completed_at: NOW },
  };
  return { reading, fetched, answered };
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
  workflows: [{ id: 'internal_links', label: 'Internal links' }],
  output_kinds: [
    {
      kind: 'page_edits',
      label: 'Page edits',
      refinements: ['Make it shorter'],
      next: [{ workflow_id: 'internal_links', prompt: 'Plan internal links that support' }],
    },
  ],
  models: AGENT_MODELS,
  limits: {
    message_max_chars: 50000,
    mentions_max: 5,
    attachments_max: 3,
    attachment_max_chars: 40000,
    attachments_total_max_chars: 40000,
  },
};
