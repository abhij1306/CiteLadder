import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentDeclarationProposalSchema, type AgentProposal } from '@citeladder/contracts/agent';
import type { Actor } from '../auth/actor.ts';
import { findWorkspaceMember } from '../auth/workspace.ts';
import { changePreviewSchema, type ChangePreview } from '../changes/kind.ts';
import {
  CHANGE_KINDS,
  changeKinds,
  kindLines,
  memberOf,
  type ChangeKind,
} from '../changes/kinds.ts';
import { policy, type ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { argumentProblem } from '../mcp/tools.ts';
import type { BuiltinOutcome } from './builtin-tools.ts';
import { payloadShape } from './payload-shape.ts';
import { agentPolicy, type Scope } from './contracts.ts';
import { stepText } from './sources.ts';
import type { TurnState } from './turn-budget.ts';

export const PROPOSE_CHANGE = 'propose_change';

const NOT_PROPOSED = ['declare_implemented'] as const satisfies readonly ChangeKind[];
export type AgentChangeKind = Exclude<ChangeKind, (typeof NOT_PROPOSED)[number]>;
const notProposed = memberOf(NOT_PROPOSED);
export const AGENT_CHANGE_KINDS = CHANGE_KINDS.filter(
  (kind): kind is AgentChangeKind => !notProposed(kind),
);
export const isAgentChangeKind = memberOf(AGENT_CHANGE_KINDS);

const storedProposalSchema = z.discriminatedUnion('kind', [
  agentDeclarationProposalSchema,
  z.strictObject({
    kind: z.literal('change'),
    change: z.string(),
    payload: z.json(),
    preview: changePreviewSchema,
  }),
]);
export type StoredProposal = z.infer<typeof storedProposalSchema>;
export const storedProposals = z.array(storedProposalSchema);

export const proposeChangeArguments = z.strictObject({
  kind: z.enum(AGENT_CHANGE_KINDS).describe('The kind of change, from the list above.'),
  payload: z
    .record(z.string(), z.json())
    .optional()
    .describe(
      'The change itself, in its kind’s shape. Omit it to get the shape; nothing is proposed.',
    ),
});

export const PROPOSE_CHANGE_DESCRIPTION = [
  'Propose one change to the project’s data for the person to confirm: the app shows it as a card under your reply, and only their click makes it, as them. Propose only what the person asked for or agreed to; use ids from your reads. A paid change spends nothing until the click. Each call is checked as a dry run: a refusal tells you what to correct. To learn a kind’s payload shape, call with the kind alone; a payload that does not fit is refused with the shape.',
  'Kinds, by area:',
  ...kindLines(isAgentChangeKind),
].join('\n');

export async function memberActor(
  db: Database,
  scope: Pick<Scope, 'workspaceId' | 'userId'>,
  lock?: 'share',
): Promise<Actor> {
  const member = await findWorkspaceMember(db, scope.userId, scope.workspaceId, lock);
  if (!member) throw notFound('Workspace');
  return {
    kind: 'member',
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    role: member.role,
    scopes: 'all',
  };
}

export function proposalLimit(state: Pick<TurnState, 'proposals'>): BuiltinOutcome | null {
  if (state.proposals.length < agentPolicy.max_proposals_per_turn) return null;
  return {
    ok: false,
    text: `At most ${agentPolicy.max_proposals_per_turn} changes can be proposed in one turn. Reply now; the person can ask for more.`,
  };
}

function bounded(preview: ChangePreview): ChangePreview {
  const rowsMax = agentPolicy.proposal_preview_rows_max;
  const chars = agentPolicy.proposal_preview_value_max_chars;
  const clip = (text: string) => (text.length > chars ? `${text.slice(0, chars - 1)}…` : text);
  const rows = preview.rows.map((row) => ({ label: row.label, value: clip(row.value) }));
  if (rows.length <= rowsMax) return { ...preview, rows };
  const hidden = rows.length - rowsMax + 1;
  const run = longestRun(rows);
  const [start, end] =
    run.length > hidden
      ? [run.start + run.length - hidden, run.start + run.length]
      : [rowsMax - 1, rows.length];
  return {
    ...preview,
    rows: [...rows.slice(0, start), { label: 'More', value: `${hidden} more` }, ...rows.slice(end)],
  };
}

function longestRun(rows: readonly { label: string }[]) {
  let best = { start: 0, length: 0 };
  let start = 0;
  let label = rows[0]?.label;
  for (const [index, row] of rows.entries()) {
    if (row.label !== label) [start, label] = [index, row.label];
    if (index - start + 1 > best.length) best = { start, length: index - start + 1 };
  }
  return best;
}

function refusal(error: unknown): BuiltinOutcome {
  if (error instanceof z.ZodError) return { ok: false, text: argumentProblem(error) };
  if (error instanceof ApiError && error.code === policy.workspaces.forbidden_code)
    return {
      ok: false,
      text: 'The person’s role cannot make this change. Tell them instead of proposing it.',
    };
  if (error instanceof ApiError && error.status >= 400 && error.status < 500)
    return {
      ok: false,
      text: `This change would be refused now: ${error.message.replace(/\.$/u, '')}. Correct it, or tell the person why it cannot be made.`,
    };
  throw error;
}

export async function proposeChange(
  db: Database,
  config: ServiceConfig,
  { scope, state }: { scope: Scope; state: Pick<TurnState, 'proposals' | 'steps'> },
  input: unknown,
): Promise<BuiltinOutcome> {
  const parsed = proposeChangeArguments.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const { kind, payload: proposed } = parsed.data;
  const entry = changeKinds[kind];
  if (proposed === undefined)
    return {
      ok: true,
      text: `Nothing proposed. The ${kind} payload is ${payloadShape(entry.proposal)}`,
    };
  const full = proposalLimit(state);
  if (full) return full;
  const checked = entry.proposal.safeParse(proposed);
  if (!checked.success)
    return {
      ok: false,
      text: `${argumentProblem(checked.error)}. The ${kind} payload is ${payloadShape(entry.proposal)}`,
    };
  const context = { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId };
  const change = { id: randomUUID(), projectId: scope.projectId };
  let staged;
  try {
    staged = await entry.stage(context, await memberActor(db, scope), change, proposed);
  } catch (error) {
    return refusal(error);
  }
  const filled = proposalLimit(state);
  if (filled) return filled;
  state.proposals.push({
    kind: 'change',
    change: kind,
    payload: z.json().parse(staged.payload),
    preview: bounded(staged.preview),
  });
  state.steps.push({ kind: 'change', label: stepText(staged.preview.title) });
  const job = staged.preview.opens
    ? ' Once confirmed it starts and runs on its own; nothing waits for it.'
    : '';
  return {
    ok: true,
    text: `Proposed: a card under your reply shows “${staged.preview.title}”. Nothing has changed until the person confirms it.${job} Reply briefly; never say it is done.`,
  };
}

type Outcome = { proposal_index: number; state: string; reason: string | null };

export function proposalViews(stored: unknown, outcomes: readonly Outcome[]): AgentProposal[] {
  const decided = new Map<number, 'executed' | 'dismissed'>();
  const refused = new Map<number, string>();
  for (const row of outcomes)
    if (row.state === 'executed' || row.state === 'dismissed')
      decided.set(row.proposal_index, row.state);
    else if (row.state === 'refused' && row.reason) refused.set(row.proposal_index, row.reason);
    else refused.delete(row.proposal_index);
  return storedProposals.parse(stored).map((proposal, index): AgentProposal => {
    if (proposal.kind === 'declaration') return proposal;
    const { title, rows, spend, opens } = proposal.preview;
    const outcome = isAgentChangeKind(proposal.change)
      ? (decided.get(index) ?? 'open')
      : 'unavailable';
    const refusal = outcome === 'open' ? (refused.get(index) ?? null) : null;
    return { kind: 'change', index, title, rows, spend, opens, outcome, refusal };
  });
}
