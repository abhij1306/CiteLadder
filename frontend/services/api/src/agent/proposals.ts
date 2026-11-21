import { agentProposalSchema, type AgentProposal } from '@citeladder/contracts/agent';
import { z } from 'zod';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { argumentProblem } from '../mcp/tools.ts';
import { declarableMembers } from '../opportunities/actions.ts';
import { ruleCheckKind } from '../opportunities/checks/registry.ts';
import type { BuiltinOutcome } from './builtin-tools.ts';
import type { Scope } from './contracts.ts';
import type { ChatDocument } from './outputs.ts';
import { stepText } from './sources.ts';
import type { TurnState } from './turn-budget.ts';

export const PROPOSE_DECLARATION = 'propose_declaration';
const ACTION_REF = 'citeladder://action/';
const DAY_MS = 86_400_000;

export const proposeDeclarationArguments = z.strictObject({
  action_id: z
    .string()
    .describe(
      'The Action’s citeladder://action/ reference or id: the chat’s Action, one the person mentioned, or one a read this turn returned.',
    ),
  document: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe(
      'The number of the saved document whose current revision shipped; omit it for work done outside CiteLadder.',
    ),
  go_live_day: z.iso
    .date()
    .nullish()
    .describe('The day it went live (YYYY-MM-DD), only when the person said.'),
  deployment_reference: z
    .string()
    .max(500)
    .nullish()
    .describe('What shipped it (a release, pull request or commit), only when the person said.'),
});

export const PROPOSE_DESCRIPTION =
  'When the person says a change is live or asks whether to mark an Action implemented, propose the declaration instead of describing the steps: the app shows a card under your reply, and only the person’s click declares it. Never propose one otherwise. The Action must be the chat’s Action, one they mentioned or one a read returned this turn.';

export type ProposalTurn = {
  scope: Scope;
  known: ReadonlySet<string>;
  documents: readonly ChatDocument[];
};

export function knownActions(
  manifest: { action: { id: string } | null; mentions: readonly { id: string }[] },
  read: readonly string[],
): Set<string> {
  const refs = read.flatMap((ref) =>
    ref.startsWith(ACTION_REF) ? [ref.slice(ACTION_REF.length)] : [],
  );
  return new Set([
    ...(manifest.action ? [manifest.action.id] : []),
    ...manifest.mentions.map((action) => action.id),
    ...refs,
  ]);
}

type Eligibility =
  | { kind: 'unknown' }
  | { kind: 'refused'; reason: string }
  | { kind: 'declarable'; label: string };

async function eligibility(db: Database, scope: Scope, actionId: string): Promise<Eligibility> {
  const action = await db
    .selectFrom('actions')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (!action) return { kind: 'unknown' };
  const declared = await db
    .selectFrom('opportunity_implementation_events')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('action_id', '=', actionId)
    .executeTakeFirst();
  if (declared) return { kind: 'refused', reason: 'It is already declared implemented.' };
  if (!policy.opportunity.actions.ACTION_DECLARABLE_STATUSES.includes(action.status))
    return { kind: 'refused', reason: 'Only a new or in-progress Action can be declared.' };
  const { members } = await declarableMembers(db, action);
  if (!members.length) return { kind: 'refused', reason: 'No finding targets it.' };
  if (members.some((member) => ruleCheckKind(member.rule_id) === 'contextual_link'))
    return {
      kind: 'refused',
      reason:
        'Its links are declared by selecting the implemented ones in Site Health, Internal links; point the person there.',
    };
  return { kind: 'declarable', label: action.target_label };
}

function dayProblem(day: string | null | undefined, now: Date) {
  if (!day) return null;
  const min = new Date(
    now.getTime() - policy.opportunity.opportunities.VERIFICATION_WINDOW_DAYS * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  const max = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  return day < min || day > max ? `Give a go_live_day from ${min} to today, or omit it.` : null;
}

function shippedRevision(
  turn: ProposalTurn,
  state: Pick<TurnState, 'staged'>,
  number: number | null | undefined,
  actionId: string,
) {
  if (!number) return { ok: true as const, revision: null };
  const document = turn.documents.find(({ output }) => output.number === number);
  if (!document)
    return {
      ok: false as const,
      text: `This chat has no saved Document ${number}. Omit document for work done outside CiteLadder.`,
    };
  if (state.staged.has(number))
    return {
      ok: false as const,
      text: `Document ${number} changes in this turn, so it cannot have shipped yet. Propose the declaration once the person has shipped it.`,
    };
  if (document.output.action_id !== actionId)
    return {
      ok: false as const,
      text: `Document ${number} is not this Action’s document. Omit document, or name this Action’s document.`,
    };
  return {
    ok: true as const,
    revision: { id: document.revision.id, number: document.revision.number },
  };
}

export async function proposeDeclaration(
  db: Database,
  turn: ProposalTurn,
  state: Pick<TurnState, 'staged' | 'proposals' | 'steps'>,
  input: unknown,
  now = new Date(),
): Promise<BuiltinOutcome> {
  const parsed = proposeDeclarationArguments.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const { document, go_live_day: day, deployment_reference: reference } = parsed.data;
  const given = parsed.data.action_id.trim().toLowerCase();
  const actionId = given.startsWith(ACTION_REF) ? given.slice(ACTION_REF.length) : given;
  const unseen = {
    ok: false,
    text: 'Propose a declaration only for the chat’s Action, one the person mentioned, or one a read returned this turn. Read the Action first.',
  };
  if (!turn.known.has(actionId)) return unseen;
  const checked = await eligibility(db, turn.scope, actionId);
  if (checked.kind === 'unknown') return unseen;
  if (checked.kind === 'refused')
    return {
      ok: false,
      text: `This Action cannot be declared now. ${checked.reason} Tell the person instead of proposing it.`,
    };
  const problem = dayProblem(day, now);
  if (problem) return { ok: false, text: problem };
  const shipped = shippedRevision(turn, state, document, actionId);
  if (!shipped.ok) return shipped;
  // Checked after the last await: calls in one response run concurrently.
  if (state.proposals.some((proposal) => proposal.action_id === actionId))
    return {
      ok: false,
      text: 'This Action’s declaration is already proposed in this turn. Reply now.',
    };
  const proposal: AgentProposal = agentProposalSchema.parse({
    kind: 'declaration',
    action_id: actionId,
    revision: shipped.revision,
    go_live_day: day ?? null,
    deployment_reference: reference?.trim() || null,
  });
  state.proposals.push(proposal);
  state.steps.push({ kind: 'proposal', label: stepText(checked.label) });
  return {
    ok: true,
    text: 'Proposed: a card under your reply lets the person mark this Action implemented. It is not declared until they confirm. Reply briefly; do not say it is declared.',
  };
}
