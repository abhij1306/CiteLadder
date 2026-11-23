import { createHash } from 'node:crypto';

import { blake2b } from '@noble/hashes/blake2.js';
import { sql } from 'kysely';

import type { Database } from './database.ts';

export type LockFamily = { namespace: number; person: string };

function uuidBytes(id: string): Uint8Array {
  const hex = id.replaceAll('-', '');
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function advisoryLockKey(family: LockFamily, id: string): bigint {
  const input = new Uint8Array(20);
  new DataView(input.buffer).setUint32(0, family.namespace);
  input.set(uuidBytes(id), 4);
  const personalization = new Uint8Array(16);
  personalization.set(new TextEncoder().encode(family.person));
  const digest = blake2b(input, { dkLen: 8, personalization });
  return new DataView(digest.buffer, digest.byteOffset, 8).getBigInt64(0);
}

export async function advisoryXactLock(
  db: Database,
  family: LockFamily,
  id: string,
): Promise<void> {
  const key = advisoryLockKey(family, id).toString();
  await sql`select pg_advisory_xact_lock(${key}::bigint)`.execute(db);
}

function subjectLockKey(subject: string): string {
  return createHash('sha256').update(subject).digest().readBigInt64BE(0).toString();
}

export async function subjectXactLock(db: Database, subject: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(${subjectLockKey(subject)}::bigint)`.execute(db);
}

export async function subjectTryXactLock(db: Database, subject: string): Promise<boolean> {
  const { rows } = await sql<{
    locked: boolean;
  }>`select pg_try_advisory_xact_lock(${subjectLockKey(subject)}::bigint) as locked`.execute(db);
  return rows[0]?.locked === true;
}
