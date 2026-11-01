import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { pdfText } from './pdf-text.ts';
import { prompt as trackedPrompt, promptSet } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { type Tenant, VisibilityFixtures } from './visibility-fixtures.ts';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const measuredAt = new Date('2026-09-08T21:30:00Z');
const CONFIGURATION = {
  brand_name: 'Acme Corp',
  brand_aliases: [],
  owned_domains: ['acme.example'],
  competitors: ['Globex'],
  country_code: 'US',
  language_code: 'en',
  benchmark_mode: 'consumer_like',
  panel_hash: 'panel-1',
  engine_routes: {
    chatgpt: { transport_provider: 'test', transport_model: 'test' },
    claude: { transport_provider: 'test', transport_model: 'test' },
  },
  measurement_policy: { retrieval_enabled: true, max_output_tokens: 1000, answer_instruction: '' },
};

describe('Overview PDF', () => {
  const config = testConfig();
  const db = testDatabase(config);
  const fixtures = new VisibilityFixtures(db);
  const app = createApp(config, db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });

  async function headers(tenant: Pick<Tenant, 'userId' | 'workspaceId'>) {
    return {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
    };
  }
  async function saveLayout(tenant: Tenant, keys: readonly string[]) {
    const response = await app.request(`/api/v1/projects/${tenant.projectId}/overview/layout`, {
      method: 'PUT',
      headers: { ...(await headers(tenant)), 'content-type': 'application/json' },
      body: JSON.stringify({
        widgets: keys.map((key) => ({ key, size: 'half' })),
        expected_version: 0,
      }),
    });
    expect(response.status).toBe(200);
  }
  async function reportBytes(tenant: Tenant) {
    const response = await app.request(`/api/v1/projects/${tenant.projectId}/overview/report.pdf`, {
      headers: await headers(tenant),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    return new Uint8Array(await response.arrayBuffer());
  }
  async function reportText(tenant: Tenant) {
    return (await pdfText(await reportBytes(tenant))).join(' ');
  }
  async function consumerProject() {
    const tenant = await fixtures.tenant();
    await db
      .updateTable('projects')
      .set({ benchmark_mode: 'consumer_like' })
      .where('id', '=', tenant.projectId)
      .execute();
    return tenant;
  }

  it('prints the saved layout in order with a readable date and no internal identifiers', async () => {
    const tenant = await consumerProject();
    const unmeasured = await reportText(tenant);
    expect(unmeasured).toContain('No completed measurement yet.');
    expect(unmeasured).toContain('Ranked actions');

    const auditId = await fixtures.audit(tenant, { completedAt: measuredAt });
    await fixtures.metricSnapshot(tenant, auditId, { visibilityScore: 0, metrics: {} });
    await saveLayout(tenant, ['company_facts', 'project_state']);
    const text = await reportText(tenant);
    expect(text).toContain('Measured 8 September 2026, 21:30 UTC');
    expect(text.indexOf('Company facts')).toBeLessThan(text.indexOf('Project state'));
    expect(text).not.toContain('Ranked actions');
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain('2026-09-08T');

    const stranger = await fixtures.tenant();
    const foreign = await app.request(`/api/v1/projects/${tenant.projectId}/overview/report.pdf`, {
      headers: await headers(stranger),
    });
    expect(foreign.status).toBe(404);
  });

  it('sets headline figure digits in the figure face and the words in the text face', async () => {
    const tenant = await consumerProject();
    const auditId = await fixtures.audit(tenant, { completedAt: measuredAt });
    await fixtures.metricSnapshot(tenant, auditId, { visibilityScore: 0, metrics: {} });
    await saveLayout(tenant, ['project_state']);
    const embedded = Buffer.from(await reportBytes(tenant)).toString('latin1');
    expect(embedded).toMatch(/\/BaseFont \/[A-Z]{6}\+JetBrainsMono-Medium/u);
    expect(embedded).toMatch(/\/BaseFont \/[A-Z]{6}\+LexendDeca-Regular/u);
  });

  it('reads a first run in plain words, naming engines, targets and competitors', async () => {
    const tenant = await consumerProject();
    await db
      .updateTable('projects')
      .set({ industry: 'General' })
      .where('id', '=', tenant.projectId)
      .execute();
    await fixtures.brand(tenant.projectId, 'Acme Corp');
    await fixtures.competitor(tenant.projectId, { name: 'Globex', domains: ['globex.example'] });
    const brand = await db
      .selectFrom('brands')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('brand_profiles')
      .values({
        id: randomUUID(),
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        brand_id: brand.id,
        description: '',
        positioning: 'Low-cost investing for first-time investors',
        target_audience: 'Young professionals',
        products_services: JSON.stringify(['Index funds', 'Financial planning']),
        business_context: JSON.stringify({}),
        sources: JSON.stringify([]),
        source_artifact_ids: JSON.stringify([]),
        created_at: measuredAt,
        updated_at: measuredAt,
      })
      .execute();
    const auditId = await fixtures.audit(tenant, {
      completedAt: measuredAt,
      configuration: CONFIGURATION,
    });
    const prompt = 'Which index fund is best for first-time investors?';
    await trackedPrompt(db, await promptSet(db, tenant.projectId), prompt);
    for (const engine of ['chatgpt', 'claude'])
      await fixtures.execution(tenant, {
        auditId,
        engine,
        promptIndex: 0,
        promptText: prompt,
        analysis: { brandMentioned: false, score: { competitors_mentioned: ['Globex'] } },
      });
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: prompt,
      composite: 20,
    });
    const aggregate = {
      total_completed: 4,
      brand_mention_count: 1,
      owned_citation_response_count: 1,
      brand_mention_rate: 0.25,
      owned_citation_rate: 0.25,
      competitor_mention_rate: { Globex: 0.75 },
      competitor_citation_rate: { Globex: 0.5 },
      share_of_voice: { mention_counts: { 'Acme Corp': 1, Globex: 3 } },
      coverage: { requested: 4, failed: 0, not_run: 0 },
    };
    await fixtures.metricSnapshot(tenant, auditId, {
      metrics: { ...aggregate, per_engine: { chatgpt: aggregate, claude: aggregate } },
    });
    const opportunity = (input: {
      severity: string;
      priority: number;
      title: string;
      targetUrl?: string;
      theme?: string;
    }) => ({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      opportunity_type: 'visibility',
      rule_id: `rule-${input.priority}`,
      rule_version: '1',
      analyzer_version: 'test',
      formula_version: 'opp-formula-1',
      severity: input.severity,
      priority_score: input.priority,
      title: input.title,
      remediation: '',
      target_key: `target-${input.priority}`,
      target_url: input.targetUrl ?? null,
      target_theme: input.theme ?? null,
      created_at: measuredAt,
      updated_at: measuredAt,
    });
    await db
      .insertInto('opportunities')
      .values([
        opportunity({
          severity: 'high',
          priority: 90,
          title: 'Owned page not cited for target prompt',
          targetUrl: 'https://acme.example/pricing',
        }),
        opportunity({
          severity: 'medium',
          priority: 40,
          title: 'Brand absent on high-value prompt',
          theme: 'index_funds',
        }),
      ])
      .execute();

    const text = await reportText(tenant);
    expect(text).toContain('ChatGPT API and Claude API');
    expect(text).toContain(
      'No comparison yet: changes appear once a second run uses the same prompts and engines.',
    );
    expect(text).toContain('Next action · High priority');
    expect(text).toContain('Page: https://acme.example/pricing');
    expect(text).toContain('Brand absent on high-value prompt');
    expect(text).toContain('Medium priority');
    expect(text).toContain('2nd');
    expect(text).toContain('of 2 brands');
    expect(text).toContain('of answers cite you · 2 engines');
    expect(text).toContain('1 prompt measured');
    expect(text).toContain('0 actions resolved so far.');
    // Ligatures stay out of the text layer, so "first" and "Offerings" copy and search intact.
    expect(text).toContain('first-time investors');
    expect(text).toContain('Offerings');
    expect(text).toContain('Financial planning');
    expect(text).toContain('Globex');
    // The generic industry placeholder, raw engine keys, codes and IDs never print.
    expect(text).not.toContain('General');
    expect(text).not.toMatch(/\b(chatgpt|claude)\b/u);
    expect(text).not.toMatch(/\((s)\)|Unknown|opp-formula|Formula/u);
    expect(text).not.toMatch(UUID);
  });

  it('prints every library widget heading as not available before any measurement', async () => {
    const tenant = await consumerProject();
    await saveLayout(tenant, [
      'visibility_trend',
      'share_of_voice',
      'top_movers',
      'retrieval',
      'perception',
      'ai_traffic',
      'search_console',
    ]);
    const text = await reportText(tenant);
    for (const heading of [
      'Visibility over time',
      'Share of voice',
      'Top movers',
      'Retrieved versus cited',
      'Perception',
      'AI Traffic',
      'Search Console',
    ])
      expect(text).toContain(heading);
  });
});
