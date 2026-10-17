import { domainToASCII } from 'node:url';
import { getDomain } from 'tldts';
import { websiteIdentity } from '../projects/safe-fetch.ts';
import type { Database } from '../db/database.ts';
import { operatorTransaction } from '../db/operator-transaction.ts';
import { recordSecurityEvent } from '../auth/security-events.ts';
import { requireAdmin } from '../auth/operators.ts';

export function acquisitionDomain(value: string): string {
  if (value === '*') return value;
  if (/[\\/:?#@%\s]/u.test(value))
    throw new Error('Use a bare registrable domain or * for the global stop');
  const ascii = domainToASCII(value).toLowerCase().replace(/\.$/u, '');
  // Bare-host validation precedes the shared URL/registrable-domain normalization.
  if (!ascii || /[^a-z0-9.-]/u.test(ascii))
    throw new Error('Use a bare registrable domain or * for the global stop');
  let domain: string;
  try {
    domain = new URL(websiteIdentity(ascii).url).hostname.replace(/\.$/u, '');
  } catch {
    throw new Error('Use a bare registrable domain or * for the global stop');
  }
  if (
    !domain ||
    domain.length > 253 ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
    !getDomain(domain, { allowPrivateDomains: true })
  )
    throw new Error('Use a bare registrable domain or * for the global stop');
  return domain;
}

export function setAcquisitionControl(
  db: Database,
  input: { actor: string; domain: string; reason: string; resume?: boolean; apply?: boolean },
) {
  const domain = acquisitionDomain(input.domain),
    reason = input.reason.trim();
  if (!reason || reason.length > 255)
    throw new Error('Reason must be between 1 and 255 characters');
  return operatorTransaction(db, input.apply === true, async (trx) => {
    const actor = await requireAdmin(trx, input.actor);
    const values = {
      domain,
      blocked: !input.resume,
      actor_id: actor.id,
      reason,
      updated_at: new Date(),
    };
    await trx
      .insertInto('web_acquisition_controls')
      .values(values)
      .onConflict((conflict) => conflict.column('domain').doUpdateSet(values))
      .execute();
    await recordSecurityEvent(trx, 'acquisition.control', actor.id);
    return { domain, blocked: values.blocked, apply: input.apply === true };
  });
}
