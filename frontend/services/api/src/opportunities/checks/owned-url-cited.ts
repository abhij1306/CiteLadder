import { sql } from 'kysely';
import { z } from 'zod';
import { parseContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';
import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record } from '../../db/json.ts';
import { parseUuid } from '../../http/uuid.ts';
import { canonicalPage } from '../../page-identity.ts';
import { compareText } from '../../text-order.ts';
import {
  evidenceScope,
  observedAt,
  selectedRuns,
  type RunSelection,
} from '../../visibility/selection.ts';
import { outcome } from '../verification-decisions.ts';
import type { Scope } from '../sources.ts';
import type { CheckModule, CheckOf, FreezeContext, MemberCheck, MemberFacts } from './kind.ts';
import { once, type ReadContext } from './read-context.ts';

type Check = CheckOf<'owned_url_cited'>;

const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compareText);

const canonical = (url: string) => canonicalPage(url) ?? url;

const selection = (scope: Scope, auditId: string | null): RunSelection => ({
  ...scope,
  marketId: null,
  auditId,
  auditIds: null,
  logicalEngine: null,
  cohort: policy.visibility.all_cohort,
  fromAt: null,
  toAt: null,
});

function gapOf(member: MemberFacts) {
  const gap = parseContentGapEvidence(member.rule_id, member.evidence);
  if (!gap) return null;
  const promptIds = sorted(
    gap.evidence.prompts.flatMap((prompt) => {
      const id = prompt.text === null ? null : parseUuid(prompt.id);
      return id ? [id] : [];
    }),
  );
  if (!promptIds.length) return null;
  if (gap.rule_id === 'content_gap_new_page')
    return {
      promptIds,
      lineageId: gap.evidence.lineage_id,
      page: null,
      from: gap.evidence.window.start,
    };
  const siteUrlId = parseUuid(gap.evidence.site_url_id);
  if (!siteUrlId) return null;
  return {
    promptIds,
    lineageId: gap.evidence.lineage_id,
    page: { url: canonical(gap.evidence.url), siteUrlId },
    from: gap.evidence.window.start,
  };
}

async function baseline(db: Database, scope: Scope, promptIds: string[], from: string, to: string) {
  const rows = await evidenceScope(db, selection(scope, null))
    .innerJoin('citations as c', 'c.analysis_id', 'ra.id')
    .select(['audit.id as audit_id', 'c.url', 'c.canonical_url'])
    .where('c.workspace_id', '=', scope.workspaceId)
    .where('c.is_owned', '=', true)
    .where('snapshot.prompt_id', 'in', promptIds)
    .where(observedAt, '>=', sql<Date>`${from}::timestamptz`)
    .where(observedAt, '<=', sql<Date>`${to}::timestamptz`)
    .execute();
  return {
    audits: sorted(rows.map((row) => row.audit_id)),
    urls: sorted(rows.map((row) => canonical(row.canonical_url ?? row.url))),
  };
}

const refsSchema = z.object({
  target_site_url_id: z.uuid().nullish(),
  prompt_reference: z.object({ prompt_ids: z.array(z.uuid()).min(1) }).nullish(),
});

async function analyzedPage({ db, scope, outputRevisionId }: FreezeContext): Promise<Check | null> {
  if (!outputRevisionId) return null;
  const chat = await db
    .selectFrom('agent_output_revisions as revision')
    .innerJoin('agent_outputs as output', 'output.id', 'revision.output_id')
    .innerJoin('agent_chats as chat', 'chat.id', 'output.chat_id')
    .select('chat.context_refs')
    .where('revision.id', '=', outputRevisionId)
    .where('revision.workspace_id', '=', scope.workspaceId)
    .where('output.workspace_id', '=', scope.workspaceId)
    .where('chat.workspace_id', '=', scope.workspaceId)
    .where('chat.project_id', '=', scope.projectId)
    .executeTakeFirst();
  const refs = refsSchema.safeParse(record(chat?.context_refs));
  const siteUrlId = refs.success ? refs.data.target_site_url_id : null;
  const promptIds = refs.success ? refs.data.prompt_reference?.prompt_ids : undefined;
  if (!siteUrlId || !promptIds) return null;
  const page = await db
    .selectFrom('site_urls')
    .select('normalized_url')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', siteUrlId)
    .executeTakeFirst();
  if (!page) return null;
  return {
    kind: 'owned_url_cited',
    prompt_ids: sorted(promptIds),
    lineage_id: null,
    expectation: { target: 'page', url: canonical(page.normalized_url), site_url_id: siteUrlId },
  };
}

async function freezeGap(member: MemberFacts, context: FreezeContext): Promise<Check | null> {
  const gap = gapOf(member);
  if (!gap) return null;
  const frozen = {
    kind: 'owned_url_cited' as const,
    prompt_ids: gap.promptIds,
    lineage_id: gap.lineageId,
  };
  if (gap.page)
    return {
      ...frozen,
      expectation: { target: 'page', url: gap.page.url, site_url_id: gap.page.siteUrlId },
    };
  const before = await baseline(
    context.db,
    context.scope,
    gap.promptIds,
    gap.from,
    context.declaredAt,
  );
  return {
    ...frozen,
    expectation: {
      target: 'new_page',
      baseline_from: gap.from,
      baseline_audit_ids: before.audits,
      baseline_urls: before.urls,
    },
  };
}

async function citedInRun(ctx: ReadContext, auditId: string, check: Check) {
  const d = ctx.declaration;
  const scope = { workspaceId: d.workspace_id, projectId: d.project_id };
  const ran = await ctx.db
    .selectFrom('audit_prompt_snapshots')
    .select('prompt_id')
    .where('audit_id', '=', auditId)
    .where('prompt_id', 'in', check.prompt_ids)
    .executeTakeFirst();
  if (!ran) return 'prompts_not_in_run' as const;
  const rows = await evidenceScope(ctx.db, selection(scope, auditId))
    .leftJoin('citations as c', (join) =>
      join
        .onRef('c.analysis_id', '=', 'ra.id')
        .on('c.workspace_id', '=', d.workspace_id)
        .on('c.is_owned', '=', true),
    )
    .select(['ra.id', 'c.url', 'c.canonical_url'])
    .where('snapshot.prompt_id', 'in', check.prompt_ids)
    .execute();
  if (!rows.length) return 'no_answers' as const;
  return new Set(rows.flatMap((row) => (row.url ? [canonical(row.canonical_url ?? row.url)] : [])));
}

function isVisibilityRun(ctx: ReadContext, auditId: string) {
  const d = ctx.declaration;
  const scope = { workspaceId: d.workspace_id, projectId: d.project_id };
  return once(ctx, `visibility_run:${auditId}`, async () => {
    const run = await selectedRuns(ctx.db, selection(scope, auditId))
      .select('audit.id')
      .where('audit.market_id', 'is', null)
      .executeTakeFirst();
    return run !== undefined;
  });
}

export const ownedUrlCitedCheck: CheckModule<'owned_url_cited'> = {
  kind: 'owned_url_cited',
  leg: policy.opportunity.actions.LEG_VISIBILITY_RUN,
  sources: ['audit'],
  measurable: (member) => gapOf(member) !== null,
  async freeze(members, context) {
    const checks: MemberCheck[] = [];
    for (const member of members) {
      const check = await freezeGap(member, context); // NOSONAR
      if (check) checks.push({ member, check });
    }
    const analyzed = await analyzedPage(context);
    if (analyzed) checks.push({ member: null, check: analyzed });
    return checks;
  },
  async read(ctx, source, check) {
    if (!(await isVisibilityRun(ctx, source.id))) return null;
    const cited = await citedInRun(ctx, source.id, check);
    if (typeof cited === 'string') return outcome(ctx.reading, 'unavailable', cited);
    const { expectation } = check;
    const met =
      expectation.target === 'page'
        ? cited.has(expectation.url)
        : [...cited].some((url) => !expectation.baseline_urls.includes(url));
    return outcome(ctx.reading, met ? 'met' : 'unmet');
  },
  subject: (check) => (check.expectation.target === 'page' ? check.expectation.url : null),
};
