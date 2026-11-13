/**
 * Action targets against real PostgreSQL: what a target the Agent names
 * resolves to, what it is refused for, and which pages a declaration covers
 * for each kind. Grouping findings into Actions is covered with the refresh
 * (`search-gap-actions.test.ts`), the issue-family cohort with its family
 * (`issue-family-actions.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import type { ActionTargetKind } from '@citeladder/contracts/actions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/db/database.ts';
import {
  actionTargetOf,
  ActionTargetError,
  declarationTargets,
  namedTarget,
} from '../src/opportunities/targets/registry.ts';
import { actionRow } from './opportunity-fixtures.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const seeds: SiteSeed[] = [];
let own: SiteSeed & { pricing: string };
let other: SiteSeed & { page: string };

async function site(path: string) {
  return db.transaction().execute(async (trx) => {
    const fixtures = new SiteFixtures(trx);
    const seed = await fixtures.crawl();
    seeds.push(seed);
    const page = await fixtures.page(seed, path, { has_html: true });
    return { seed, pageId: page.id };
  });
}

beforeAll(async () => {
  const mine = await site('/pricing');
  own = { ...mine.seed, pricing: mine.pageId };
  const theirs = await site('/other');
  other = { ...theirs.seed, page: theirs.pageId };
});

afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspaceId).execute();
    await db.deleteFrom('users').where('id', '=', seed.userId).execute();
  }
  await db.destroy();
});

const scopeOf = (seed: SiteSeed) => ({ workspaceId: seed.workspaceId, projectId: seed.projectId });

async function storedAction(
  trx: Database,
  seed: SiteSeed,
  kind: ActionTargetKind,
  targetUrl: string | null,
) {
  const row = actionRow(
    { workspace_id: seed.workspaceId, project_id: seed.projectId },
    {
      group_key: `${kind}:${randomUUID()}`,
      target_kind: kind,
      target_label: kind,
      target_url: targetUrl,
    },
  );
  await trx.insertInto('actions').values(row).execute();
  return trx.selectFrom('actions').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
}

const naming = (siteUrlId: string) => ({
  rule_id: 'missing_structured_data',
  evidence: { site_url_id: siteUrlId },
});

describe('a target the Agent names', () => {
  it('is the page Action a finding on that owned page opens', async () => {
    const named = await namedTarget(db, scopeOf(own), 'page', '  https://example.test/pricing ');
    expect(named).toEqual({
      kind: 'page',
      key: 'page:https://example.test/pricing',
      url: 'https://example.test/pricing',
      text: 'https://example.test/pricing',
    });
    const fromFinding = actionTargetOf({
      target: { kind: 'site_page', url: 'https://example.test/pricing' },
      label_hint: null,
      title: 'missing_structured_data',
    });
    expect(fromFinding.group_key).toBe('page:https://example.test/pricing');
  });

  it('is a planned page keyed by its topic', async () => {
    const named = await namedTarget(db, scopeOf(own), 'planned_page', 'Trail Socks');
    expect(named).toEqual({
      kind: 'planned_page',
      key: 'planned:trail-socks',
      url: null,
      text: 'Trail Socks',
    });
  });

  it.each([
    ['product', 'https://example.test/x', 'Unsupported Agent target'],
    ['page', 'pricing', 'Page target must be an absolute URL'],
    ['page', 'ftp://example.test/x', 'Invalid page target'],
    ['page', 'https://elsewhere.test/x', 'Page target is outside the owned domains'],
    ['planned_page', '!!!', 'A planned page needs a topic'],
  ])('refuses a %s target %s', async (kind, text, message) => {
    const refused = namedTarget(db, scopeOf(own), kind, text);
    await expect(refused).rejects.toThrow(ActionTargetError);
    await expect(refused).rejects.toThrow(message);
  });
});

describe('a declaration covers', () => {
  it("the project's own pages its findings name, never another project's", async () => {
    await db.transaction().execute(async (trx) => {
      const action = await storedAction(trx, own, 'product', null);
      const covered = await declarationTargets(
        trx,
        action,
        [naming(own.pricing), naming(other.page), naming(own.pricing)],
        own.root,
      );
      expect(covered).toEqual({
        resolved: true,
        target_site_url_ids: [own.pricing],
        target_external_url: null,
      });
    });
  });

  it("a page Action's own URL when no finding names a crawled page", async () => {
    await db.transaction().execute(async (trx) => {
      const crawled = await storedAction(trx, own, 'page', 'https://example.test/pricing');
      expect(await declarationTargets(trx, crawled, [], own.root)).toEqual({
        resolved: true,
        target_site_url_ids: [own.pricing],
        target_external_url: null,
      });
      const uncrawled = await storedAction(trx, own, 'page', 'https://example.test/never-crawled');
      expect(await declarationTargets(trx, uncrawled, [], own.root)).toEqual({
        resolved: false,
        reason: 'Implementation target is ambiguous or unresolved',
      });
    });
  });

  it("an earned page's publisher page, and nothing without one", async () => {
    await db.transaction().execute(async (trx) => {
      const listed = await storedAction(trx, own, 'earned_page', 'https://review.example/best');
      expect(await declarationTargets(trx, listed, [], own.root)).toEqual({
        resolved: true,
        target_site_url_ids: [],
        target_external_url: 'https://review.example/best',
      });
      const unlisted = await storedAction(trx, own, 'earned_page', null);
      expect(await declarationTargets(trx, unlisted, [], own.root)).toEqual({
        resolved: false,
        reason: 'Implementation target is unresolved',
      });
    });
  });
});
