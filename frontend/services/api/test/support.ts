import { randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { loadConfig, type ServiceConfig } from '../src/config.ts';
import { ApiError } from '../src/errors.ts';
import { createDatabase, type Database } from '../src/db/database.ts';
import { fixtureWorkspaceName } from './fixture-workspace.ts';

const TEST_SESSION_KEY = 'api-service-test-session-key-0123456789abcdef';
/** The cookie a test sends to act as a fixture user; the app acts as the local user without it. */
export const TEST_SESSION_COOKIE = 'citeladder_session';

/** Tests act as fixture users through a signed test cookie (`ServiceConfig.auth.actingUser`). */
async function actingUser(request: Request): Promise<string | null> {
  const prefix = `${TEST_SESSION_COOKIE}=`;
  const token = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(TEST_SESSION_KEY));
    if (typeof payload.sub === 'string') return payload.sub;
  } catch {
    /* Refused below. */
  }
  throw new ApiError(401, 'Invalid token');
}

/** Deterministic test configuration; never inherits a live environment. */
export function testConfig(overrides: Record<string, string> = {}): ServiceConfig {
  const databaseUrl = process.env.API_TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'API_TEST_DATABASE_URL must name the migrated local database (`pnpm test:api` sets it); the suite writes and deletes fixture rows there.',
    );
  }
  const config = loadConfig({ APP_ENV: 'test', DATABASE_URL: databaseUrl, ...overrides });
  // Set in place: a copy would lose the environment `configEnvironment` keys on this object.
  config.auth.actingUser = actingUser;
  return config;
}

export function testDatabase(config: ServiceConfig = testConfig()): Database {
  return createDatabase(config);
}

export function sessionToken(claims: Record<string, unknown>, key = TEST_SESSION_KEY) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(key));
}

/** Rows created by one test file, removed again in `cleanup`. */
export class Fixtures {
  private readonly users: string[] = [];
  private readonly workspaces: string[] = [];
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async user(options: { active?: boolean; sessionVersion?: number } = {}): Promise<string> {
    const id = randomUUID();
    await this.db
      .insertInto('users')
      .values({
        id,
        email: `${id}@example.test`,
        role: 'user',
        registration_origin: 'operator',
        is_active: options.active ?? true,
        session_version: options.sessionVersion ?? 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    this.users.push(id);
    return id;
  }

  /** A tenant workspace created with its Owner, as workspace creation does. */
  async ownedWorkspace(ownerId: string): Promise<string> {
    const insert = async (trx: Database) => {
      const workspaceId = await this.insertWorkspace(trx, false);
      await this.insertMember(trx, workspaceId, ownerId, 'owner');
      return workspaceId;
    };
    const id = this.db.isTransaction
      ? await insert(this.db)
      : await this.db.transaction().execute(insert);
    this.workspaces.push(id);
    return id;
  }

  /**
   * Another tenant workspace the user joined (a person owns at most one): a
   * fresh Owner holds it and the user is a member with `role`.
   */
  async joinedWorkspace(
    userId: string,
    options: { role?: 'admin' | 'member' | 'viewer' } = {},
  ): Promise<string> {
    const id = await this.ownedWorkspace(await this.user());
    await this.member(id, userId, options.role ?? 'admin');
    return id;
  }

  /** The reserved system workspace kind, which never has members. */
  async systemWorkspace(): Promise<string> {
    const id = await this.insertWorkspace(this.db, true);
    this.workspaces.push(id);
    return id;
  }

  /** Add a member, as an accepted invitation does. */
  async member(workspaceId: string, userId: string, role: string): Promise<void> {
    await this.insertMember(this.db, workspaceId, userId, role);
  }

  private async insertWorkspace(db: Database, system: boolean): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto('workspaces')
      .values({
        id,
        name: fixtureWorkspaceName(id),
        is_system: system,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    return id;
  }

  private async insertMember(
    db: Database,
    workspaceId: string,
    userId: string,
    role: string,
  ): Promise<void> {
    await db
      .insertInto('workspace_members')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        user_id: userId,
        role,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  }

  async cleanup(): Promise<void> {
    if (this.workspaces.length) {
      // The append-only ledger does not cascade; every audit holds prompt runs.
      await this.db
        .deleteFrom('consumable_ledger')
        .where('workspace_id', 'in', this.workspaces)
        .execute();
      await this.db.deleteFrom('workspaces').where('id', 'in', this.workspaces).execute();
    }
    if (this.users.length) {
      await this.db.deleteFrom('users').where('id', 'in', this.users).execute();
    }
  }
}
