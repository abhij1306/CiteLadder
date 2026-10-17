/**
 * The page evidence the earned-page detector reads, assembled from what the
 * source-page inspector already committed.
 *
 * Each page is judged on its latest successful reading, so a later failed or
 * in-flight read never discards what was already learned. Presence verdicts
 * count only when judged against the roster in force now.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { detectEarnedPageOpportunities } from '../analysis/opportunities/earned-pages.ts';
import type {
  AnalysisEvidence,
  DetectorHit,
  SourcePageEvidence,
  VisibilityEvidence,
} from '../analysis/opportunities/evidence.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import {
  latestReadings,
  pageEntities,
  projectRoster,
  readAt,
  readingPresences,
  type Reading,
  type ReadingPresence,
} from '../source-pages/reading.ts';
import { record } from '../db/json.ts';
import { compareText, scalarText } from '../text-order.ts';

const e = policy.opportunity.earned_actions;
const s = policy.opportunity.source_pages;
/** Which analyses in this audit cited each identified third-party page. */
async function citedByHash(db: Database, workspaceId: string, auditId: string) {
  const rows = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'citations')
    .select(['url_hash', 'analysis_id'])
    .where('audit_id', '=', auditId)
    .where('url_hash', 'is not', null)
    .where('is_owned', 'is', false)
    .execute();
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = grouped.get(row.url_hash!) ?? new Set<string>();
    set.add(row.analysis_id);
    grouped.set(row.url_hash!, set);
  }
  return grouped;
}

/** The audit's answers, indexed once for every page that cites them. */
function answerIndex(visibility: VisibilityEvidence) {
  const byId = new Map(visibility.analyses.map((row) => [row.analysis_id, row]));
  const snapshots = new Map(visibility.prompt_snapshots.map((row) => [row.prompt_index, row]));
  return (analysisIds: Set<string>) => {
    const selected = [...analysisIds].flatMap((id) => byId.get(id) ?? []) as AnalysisEvidence[];
    const indices = [...new Set(selected.map((row) => row.prompt_index))].sort((a, b) => a - b);
    const prompts = indices.flatMap((index) => snapshots.get(index) ?? []);
    return {
      // A deleted prompt keeps its frozen text but has nothing left to measure.
      prompts: prompts.flatMap((row) =>
        row.prompt_id ? [{ prompt_id: row.prompt_id, text: row.text }] : [],
      ),
      themes: [...new Set(prompts.flatMap((row) => row.theme || []))].sort(compareText),
      analysis_ids: selected.map((row) => row.analysis_id).sort(compareText),
      // Descriptive only: every name in an answer attaches to every page it cited.
      answer_competitors: [...new Set(selected.flatMap((row) => row.competitor_names))].sort(
        compareText,
      ),
    };
  };
}

type Page = {
  id: string;
  url_hash: string;
  canonical_url: string;
  registrable_domain: string;
  page_format: string;
  page_format_method: string | null;
  source_class: string | null;
  recurrence_count: number;
};

function pageEvidence(
  page: Page,
  context: {
    snapshot: Reading | undefined;
    presences: Map<string, ReadingPresence[]>;
    answers: ReturnType<typeof answerIndex>;
    analysisIds: Set<string>;
    roster: string;
  },
): SourcePageEvidence {
  const latest = context.snapshot;
  const rows = latest ? (context.presences.get(latest.id) ?? []) : [];
  const extracted = latest?.extracted_chars ?? 0;
  return {
    url_hash: page.url_hash,
    canonical_url: page.canonical_url,
    registrable_domain: page.registrable_domain,
    page_format: page.page_format,
    page_format_method: page.page_format_method,
    source_class: page.source_class,
    snapshot_id: latest?.id ?? null,
    read_at: latest ? readAt(latest) : null,
    extracted_chars: extracted,
    sufficient_coverage: extracted >= s.SOURCE_PAGE_MIN_COVERAGE_CHARS,
    title: scalarText(record(latest?.page_facts).title),
    entities: latest ? pageEntities(latest, rows) : [],
    roster_current: rows.length > 0 && rows.every((row) => row.roster_version === context.roster),
    recurrence_count: page.recurrence_count,
    answer_count: context.analysisIds.size,
    ...context.answers(context.analysisIds),
  };
}

/** Page-keyed earned hits for this audit, over its full answer set. */
export async function earnedPageHits(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  audit: { id: string; configuration: unknown },
  visibility: VisibilityEvidence,
): Promise<DetectorHit[]> {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const cited = await citedByHash(db, scope.workspaceId, audit.id);
  const hashes = [...cited.keys()].sort(compareText);
  if (!hashes.length) return [];
  const pages = await workspace
    .selectFrom(db, 'source_pages')
    .select([
      'id',
      'url_hash',
      'canonical_url',
      'registrable_domain',
      'page_format',
      'page_format_method',
      'source_class',
      'recurrence_count',
    ])
    .where('project_id', '=', scope.projectId)
    .where('url_hash', 'in', hashes)
    .orderBy('recurrence_count', 'desc')
    .orderBy('url_hash')
    .limit(e.EARNED_PAGE_DETECTOR_MAX_PAGES)
    .execute();
  if (!pages.length) return [];
  const snapshots = await latestReadings(
    db,
    scope,
    pages.map((page) => page.id),
  );
  const verdicts = await readingPresences(
    db,
    scope,
    [...snapshots.values()].map((row) => row.id),
  );
  const coverage = await workspace
    .selectFrom(db, 'source_pages')
    .select([
      sql<string>`count(id) filter (where inspection_state = ${s.INSPECTION_INSPECTED})`.as(
        'inspected',
      ),
      sql<string>`count(id)`.as('total'),
    ])
    .where('project_id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  const roster = projectRoster(audit.configuration ?? {});
  const answers = answerIndex(visibility);
  return detectEarnedPageOpportunities({
    pages: pages.map((page) =>
      pageEvidence(page, {
        snapshot: snapshots.get(page.id),
        presences: verdicts,
        answers,
        analysisIds: cited.get(page.url_hash) ?? new Set(),
        roster,
      }),
    ),
    eligible_answers: visibility.analyses.length,
    inspected_pages: Number(coverage.inspected),
    total_pages: Number(coverage.total),
  });
}
