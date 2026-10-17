/** Fixture construction through the identity, project, prompt and provider owners. */
import type { Database } from '../db/database.ts';
import type { ServiceConfig } from '../config.ts';
import { devSeed } from '../config/dev-seed.ts';
import { LOCAL_USER_EMAIL, ensureLocalAccount } from '../auth/local.ts';
import { projectCreate } from '../projects/inputs.ts';
import { createProject } from '../projects/service.ts';
import { createPromptSet } from '../prompts/prompt-sets.ts';
import { createPrompt, promptInput } from '../prompts/prompts.ts';
import { createConnection } from '../providers/connections.ts';
import { createConnectionInput } from '../providers/inputs.ts';
import { providerSettings } from '../providers/config.ts';
import { randomUUID } from 'node:crypto';

async function project(db: Database, workspaceId: string, userId: string, agency: boolean) {
  const input = projectCreate.parse(
    agency
      ? {
          name: 'CamperCo Awnings',
          brand_name: 'CamperCo',
          website_url: 'https://camperco.example.com',
          country_code: 'AU',
          language_code: 'en-AU',
          benchmark_mode: 'forced_grounded',
          products_services: ['RV camper awnings'],
          description: 'Retractable RV awnings for hot climates.',
          brand: { aliases: ['Camper Co'] },
          owned_domains: ['camperco.example.com'],
          competitors: [{ name: 'OutbackShade', domains: ['outbackshade.example.com'] }],
        }
      : {
          name: 'Acme Outdoor - US Backpacks',
          brand_name: 'Acme Outdoor Co.',
          website_url: 'https://acme-outdoor.example',
          country_code: 'US',
          language_code: 'en-US',
          benchmark_mode: 'controlled_localized',
          default_repetitions: 2,
          description: 'Evidence-grounded outdoor packs and travel gear.',
          positioning: 'Durable mid-market packs for multi-day travel.',
          products_services: [
            'Hiking backpacks',
            'Travel backpacks',
            'Waterproof backpack',
            'Outdoor gear shops',
          ],
          target_audience: 'Travelers and hikers planning multi-day trips.',
          brand: { aliases: ['Acme', 'Acme Outdoor'] },
          owned_domains: ['acme-outdoor.example'],
          unintended_domains: ['acme-outdoor.blogspot.example'],
          competitors: [
            { name: 'Trail Co', aliases: ['TrailCo'], domains: ['trail-co.example'] },
            { name: 'Summit Gear', aliases: ['Summit'], domains: ['summit-gear.example'] },
          ],
        },
  );
  const existing = await db
    .selectFrom('projects')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('name', '=', input.name)
    .executeTakeFirst();
  const projectId = existing?.id ?? (await createProject(db, workspaceId, userId, input)).id;
  const set = await db
    .selectFrom('prompt_sets')
    .select('prompt_sets.id')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .where('projects.workspace_id', '=', workspaceId)
    .where('projects.id', '=', projectId)
    .executeTakeFirst();
  const setId =
    set?.id ??
    (
      await createPromptSet(db, workspaceId, {
        project_id: projectId,
        name: agency ? 'Awning Prompts' : 'Core Discovery Set',
        description: '',
      })
    ).id;
  const specs = agency
    ? devSeed.agencyPrompts.map(([text, intent]) => [text, intent, 'active', 'manual'] as const)
    : devSeed.prompts;
  for (const [text, intent, status, origin] of specs) {
    const present = await db
      .selectFrom('prompts')
      .select('id')
      .where('prompt_set_id', '=', setId)
      .where('text', '=', text)
      .executeTakeFirst();
    if (present) continue;
    const prompt = await createPrompt(
      db,
      workspaceId,
      setId,
      promptInput.parse({
        text,
        intent,
        theme: agency ? 'awnings' : 'backpacks',
        enabled: status !== 'archived',
      }),
    );
    // Proposed/archived/imported rows are explicit fixtures; activation is never inferred.
    await db
      .updateTable('prompts')
      .set({ status, origin })
      .where('id', '=', prompt.id)
      .where('prompt_set_id', '=', setId)
      .execute();
  }
  return { workspaceId, projectId, setId };
}

async function providers(
  db: Database,
  workspaceId: string,
  userId: string,
  encryptionKey: string,
  agency: boolean,
) {
  const engines = agency ? (['gemini'] as const) : (['chatgpt', 'claude', 'gemini'] as const);
  const transport = { chatgpt: 'openai', claude: 'anthropic', gemini: 'google' } as const;
  for (const engine of engines) {
    const label = `${engine} (dev key)`;
    const existing = await db
      .selectFrom('provider_connections')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('label', '=', label)
      .executeTakeFirst();
    if (existing) continue;
    const row = await createConnection(
      db,
      workspaceId,
      userId,
      createConnectionInput.parse({
        label,
        transport_provider: transport[engine],
        api_key: `dev-fake-key-for-${engine}`,
        routes: [{ logical_engine: engine, is_default: true }],
      }),
      encryptionKey,
      providerSettings({}),
    );
    // Fixture readiness only: all execution below has an explicit recorded transport.
    await db
      .updateTable('provider_connections')
      .set({ last_test_status: 'ok', last_tested_at: new Date() })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', row.id)
      .execute();
  }
}

/** A seeded identity that owns one workspace; it never signs in. */
async function seedIdentity(db: Database, email: string) {
  const existing = await db
    .selectFrom('users')
    .innerJoin('workspace_members', 'workspace_members.user_id', 'users.id')
    .select(['users.id', 'workspace_members.workspace_id'])
    .where('users.email', '=', email)
    .where('workspace_members.role', '=', 'owner')
    .executeTakeFirst();
  if (existing) return { email, user_id: existing.id, workspace_id: existing.workspace_id };
  const now = new Date();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('users')
      .values({
        id: userId,
        email,
        hashed_password: null,
        role: 'user',
        is_active: true,
        registration_origin: 'operator',
        session_version: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await trx
      .insertInto('workspaces')
      .values({ id: workspaceId, name: email, created_at: now, updated_at: now })
      .execute();
    await trx
      .insertInto('workspace_members')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        user_id: userId,
        role: 'owner',
        created_at: now,
        updated_at: now,
      })
      .execute();
  });
  return { email, user_id: userId, workspace_id: workspaceId };
}

export async function seedStatic(db: Database, _config: ServiceConfig, encryptionKey: string) {
  const local = await ensureLocalAccount(db);
  const main = { email: LOCAL_USER_EMAIL, user_id: local.userId, workspace_id: local.workspaceId };
  // A second workspace the local user administers, as an agency would.
  const agency = await seedIdentity(db, devSeed.agencyEmail);
  for (const [identity, name] of [
    [main, devSeed.workspace],
    [agency, devSeed.agencyWorkspace],
  ] as const)
    await db
      .updateTable('workspaces')
      .set({ name, updated_at: new Date() })
      .where('id', '=', identity.workspace_id)
      .where('is_system', '=', false)
      .execute();
  const now = new Date();
  await db
    .insertInto('workspace_members')
    .values({
      id: randomUUID(),
      workspace_id: agency.workspace_id,
      user_id: main.user_id,
      role: 'admin',
      created_at: now,
      updated_at: now,
    })
    .onConflict((c) => c.columns(['workspace_id', 'user_id']).doNothing())
    .execute();
  const primary = await project(db, main.workspace_id, main.user_id, false);
  const secondary = await project(db, agency.workspace_id, agency.user_id, true);
  await providers(db, main.workspace_id, main.user_id, encryptionKey, false);
  await providers(db, agency.workspace_id, agency.user_id, encryptionKey, true);
  return { main, agency, primary, secondary };
}
export type StaticSeed = Awaited<ReturnType<typeof seedStatic>>;
