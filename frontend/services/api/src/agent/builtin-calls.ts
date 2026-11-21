import type { Database } from '../db/database.ts';
import type { ToolCall } from '../models/conversation.ts';
import { authorize } from './access.ts';
import {
  editDocument,
  loadSkill,
  saveDocument,
  suggestEdits,
  EDIT_DOCUMENT,
  LOAD_SKILL,
  SUGGEST_EDITS,
  type BuiltinOutcome,
} from './builtin-tools.ts';
import type { SkillCatalog } from './contracts.ts';
import { knownActions, proposeDeclaration, PROPOSE_DECLARATION } from './proposals.ts';
import type { Turn } from './runtime.ts';
import type { TurnState } from './turn-budget.ts';
import { documentStep } from './turn-state.ts';

/**
 * Runs one built-in call and records its step. Every built-in but
 * `propose_declaration` changes the turn's state before this returns, so
 * built-ins called in one response apply in the order written.
 */
export function runBuiltin(
  db: Database,
  catalog: SkillCatalog,
  { turn, state, call }: { turn: Turn; state: TurnState; call: ToolCall },
): Promise<BuiltinOutcome> {
  if (call.name === PROPOSE_DECLARATION)
    return db.transaction().execute(async (trx) => {
      await authorize(trx, turn.scope);
      const proposal = {
        scope: turn.scope,
        known: knownActions(turn.manifest, state.read),
        documents: turn.documents,
      };
      return proposeDeclaration(trx, proposal, state, call.input);
    });
  if (call.name === LOAD_SKILL) {
    const before = state.skill;
    const outcome = loadSkill(catalog, state, call.input, turn.budget);
    if (outcome.ok && state.skill && before?.id !== state.skill.id)
      state.steps.push({ kind: 'skill', skill_id: state.skill.id });
    return Promise.resolve(outcome);
  }
  if (call.name === SUGGEST_EDITS) {
    const outcome = suggestEdits(catalog, state, call.input, turn.budget);
    if (outcome.ok) state.steps.push({ kind: 'suggestion' });
    return Promise.resolve(outcome);
  }
  const edit = call.name === EDIT_DOCUMENT;
  const outcome = edit
    ? editDocument(catalog, state, call.input, turn.budget)
    : saveDocument(catalog, state, call.input, turn.budget);
  if (outcome.ok && outcome.document)
    state.steps.push(documentStep(turn, state, { number: outcome.document, edit }));
  return Promise.resolve(outcome);
}
