/**
 * Citation matches: which AI-answer citations in selected visibility audits
 * come from a domain that links to the project (a published referring-domain
 * dataset). The result is an immutable derived dataset identified by its exact
 * inputs, so repeating a selection returns the dataset already derived.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { compareText, stripTrailing } from '../text-order.ts';
import type { Scope } from './reads.ts';
import { datasetView } from './views.ts';

const PARENT_KIND = 'referring_domains';
const DERIVED_KIND = 'citation_matches';
const ROW_KIND = 'citation_match';
const PARSER_VERSION = 'citation-match-1';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Lower-cased, dot-trimmed and without a leading `www.`. */
function comparableDomain(value: string): string {
  let domain = stripTrailing(value.trim().toLowerCase(), '.');
  while (domain.startsWith('.')) domain = domain.slice(1);
  return domain.startsWith('www.') ? domain.slice('www.'.length) : domain;
}

function hostnameOf(url: string): string {
  return URL.parse(url)?.hostname ?? '';
}

type Citation = {
  id: string;
  audit_id: string;
  artifact_id: string;
  domain: string;
  url: string;
  resolved_url: string | null;
  canonical_url: string | null;
  title: string;
  classification: string;
  analyzer_version: string;
};

/** A citation's best URL: canonical, then resolved, then as cited. */
const citedUrl = (citation: Citation) =>
  citation.canonical_url || citation.resolved_url || citation.url;

/**
 * The derivation's identity: the parent and every audit and citation it
 * reviewed, sorted. Stored derivations were keyed by this exact JSON.
 */
function selectionHash(parentId: string, auditIds: string[], citationIds: string[]): string {
  return sha256(
    JSON.stringify({ audit_ids: auditIds, citation_ids: citationIds, parent_dataset_id: parentId }),
  );
}

/**
 * Matches are only as complete as the referring domains they were read against:
 * an unknown list stays unknown, a cut one is partial, and only a complete list
 * with no match is a definite empty.
 */
function matchCoverage(parent: { coverage: string; truncated: boolean }, matches: number) {
  if (parent.coverage === 'unknown') return 'unknown';
  if (parent.truncated || parent.coverage === 'partial') return 'partial';
  return matches > 0 ? 'complete' : 'empty';
}

export function deriveCitationMatches(
  db: Database,
  scope: Scope,
  parentDatasetId: string,
  auditIds: readonly string[],
) {
  return db.transaction().execute(async (trx) => {
    // Locking the parent serializes concurrent derivations of it.
    const parent = await scope.workspace
      .selectFrom(trx, 'search_intelligence_datasets')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('id', '=', parentDatasetId)
      .where('dataset_kind', '=', PARENT_KIND)
      .where('status', '=', 'published')
      .forUpdate()
      .executeTakeFirst();
    if (parent === undefined) throw notFound('Published referring-domain dataset');

    const selected = [...new Set(auditIds.map((id) => id.toLowerCase()))].sort(compareText);
    const audits = await scope.workspace
      .selectFrom(trx, 'audits')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .where('id', 'in', selected)
      .execute();
    if (audits.length !== selected.length)
      throw new ApiError(422, 'One or more visibility audits are unavailable', {
        code: asApiErrorCode('audit_not_found'),
      });

    const [linking, citations] = await Promise.all([
      scope.workspace
        .selectFrom(trx, 'search_intelligence_rows')
        .select('domain')
        .where('project_id', '=', scope.projectId)
        .where('dataset_id', '=', parent.id)
        .where('domain', '!=', '')
        .execute(),
      scope.workspace
        .selectFrom(trx, 'citations')
        .select([
          'id',
          'audit_id',
          'artifact_id',
          'domain',
          'url',
          'resolved_url',
          'canonical_url',
          'title',
          'classification',
          'analyzer_version',
        ])
        .where('audit_id', 'in', selected)
        .orderBy('audit_id')
        .orderBy('id')
        .execute(),
    ]);
    const linkingDomains = new Set(linking.map((row) => comparableDomain(row.domain)));
    const matches = citations.flatMap((citation) => {
      const domain = comparableDomain(citation.domain || hostnameOf(citedUrl(citation)));
      return linkingDomains.has(domain) ? [{ citation, domain }] : [];
    });

    const citationIds = citations.map((citation) => citation.id).sort(compareText);
    const scopeHash = selectionHash(parent.id, selected, citationIds);
    const existing = await scope.workspace
      .selectFrom(trx, 'search_intelligence_datasets')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('parent_dataset_id', '=', parent.id)
      .where('scope_hash', '=', scopeHash)
      .where('status', '=', 'published')
      .executeTakeFirst();
    if (existing !== undefined) return datasetView(existing);

    const now = new Date();
    const derived = await trx
      .insertInto('search_intelligence_datasets')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspace.workspaceId,
        project_id: scope.projectId,
        run_id: parent.run_id,
        parent_dataset_id: parent.id,
        dataset_kind: DERIVED_KIND,
        scope_hash: scopeHash,
        target_domain: parent.target_domain,
        target_hostname: parent.target_hostname,
        target_origin: parent.target_origin,
        comparison_origin: parent.comparison_origin,
        location_code: null,
        language_code: '',
        status: 'published',
        coverage: matchCoverage(parent, matches.length),
        requested_rows: citations.length,
        raw_rows_received: citations.length,
        unique_rows_saved: matches.length,
        provider_total: null,
        truncated: false,
        summary: JSON.stringify({
          selected_audits: selected.length,
          citations_reviewed: citations.length,
          matches: matches.length,
        }),
        provider_filters: JSON.stringify({
          audit_ids: selected,
          citation_ids: citationIds,
          research_scope: datasetView(parent).research_scope,
        }),
        parser_version: PARSER_VERSION,
        collection_started_at: now,
        collection_ended_at: now,
        published_at: now,
        created_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (matches.length > 0) {
      await trx
        .insertInto('search_intelligence_rows')
        .values(
          matches.map(({ citation, domain }) => ({
            id: randomUUID(),
            workspace_id: scope.workspace.workspaceId,
            project_id: scope.projectId,
            dataset_id: derived.id,
            call_id: null,
            provider_row_key: sha256(citation.id),
            row_kind: ROW_KIND,
            keyword: '',
            domain,
            url: citedUrl(citation),
            intent: '',
            auxiliary: JSON.stringify({
              citation_id: citation.id,
              audit_id: citation.audit_id,
              artifact_id: citation.artifact_id,
              title: citation.title,
              classification: citation.classification,
              analyzer_version: citation.analyzer_version,
            }),
            created_at: now,
          })),
        )
        .execute();
    }
    return datasetView(derived);
  });
}
