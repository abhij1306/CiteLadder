/**
 * Transaction-scoped PostgreSQL advisory locks keyed by entity.
 *
 * A key is the personalized 8-byte BLAKE2b of the 4-byte big-endian namespace
 * and the entity UUID's bytes, read as a signed big-endian integer. Both
 * so every writer of an entity derives the same key, and
 * `pg_advisory_xact_lock` releases it at COMMIT/ROLLBACK.
 */
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

/** The signed 64-bit lock key for one entity of a lock family. */
function advisoryLockKey(family: LockFamily, id: string): bigint {
  const input = new Uint8Array(20);
  new DataView(input.buffer).setUint32(0, family.namespace);
  input.set(uuidBytes(id), 4);
  // BLAKE2b personalization is 16 bytes; a shorter `person` is zero-padded.
  const personalization = new Uint8Array(16);
  personalization.set(new TextEncoder().encode(family.person));
  const digest = blake2b(input, { dkLen: 8, personalization });
  return new DataView(digest.buffer, digest.byteOffset, 8).getBigInt64(0);
}

/** Block until this transaction holds the entity's lock. */
export async function advisoryXactLock(
  db: Database,
  family: LockFamily,
  id: string,
): Promise<void> {
  const key = advisoryLockKey(family, id).toString();
  await sql`select pg_advisory_xact_lock(${key}::bigint)`.execute(db);
}

/** A lock keyed by subject text: the signed 8-byte SHA-256 prefix of `subject`. */
export async function subjectXactLock(db: Database, subject: string): Promise<void> {
  const key = createHash('sha256').update(subject).digest().readBigInt64BE(0).toString();
  await sql`select pg_advisory_xact_lock(${key}::bigint)`.execute(db);
}
