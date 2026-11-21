import { listSuggestions } from '../projects/competitor-suggestions.ts';
import { getCompetitorFocus } from '../visibility/competitor-focus.ts';
import { reference } from './data.ts';
import { competitorsAndDomains } from './evidence.ts';
import { notYetMeasured, oneRun, type Selection } from './evidence-analytics.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

export async function competitorsRead(
  read: ProjectRead,
  args: Selection & { view: 'list' | 'focus' | 'suggestions'; name?: string | null },
): Promise<Evidence> {
  switch (args.view) {
    case 'list':
      return {
        state: 'available',
        view: 'list',
        ...(await competitorsAndDomains(read)),
        artifact_refs: [],
      };
    case 'suggestions': {
      const items = await listSuggestions(read.db, read.scope);
      return {
        state: 'available',
        view: 'suggestions',
        items,
        artifact_refs: [...new Set(items.map((item) => item.audit_id))].map((id) =>
          reference('audit', id),
        ),
      };
    }
    case 'focus': {
      const name = args.name;
      if (!name) throw new McpInputError('view focus needs name');
      const run = await oneRun(read, args);
      if (run.kind === 'none') return run.evidence;
      let focus: Awaited<ReturnType<typeof getCompetitorFocus>>;
      try {
        focus = await getCompetitorFocus(read.db, run.selection, name);
      } catch (error) {
        return notYetMeasured(error, Boolean(args.audit_id));
      }
      if (focus === null)
        throw new McpInputError(`No tracked competitor is named "${name}"; view list names them`);
      const auditId = run.selection.auditId;
      return {
        state: 'available',
        view: 'focus',
        audit_id: auditId,
        ...focus,
        artifact_refs: auditId ? [reference('audit', auditId)] : [],
      };
    }
    default: {
      const unhandled: never = args.view;
      throw new Error(`Unknown competitors view: ${String(unhandled)}`);
    }
  }
}
