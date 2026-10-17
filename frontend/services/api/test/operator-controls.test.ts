import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { setAcquisitionControl, acquisitionDomain } from '../src/web-evidence/control.ts';
import { authorizeAcquisition } from '../src/web-evidence/acquisition.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase(),
  fixtures = new Fixtures(db);
let admin: string, signer: string;
const email = (id: string) => `${id}@example.test`;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
  admin = await fixtures.user();
  signer = await fixtures.user();
  await db.updateTable('users').set({ role: 'admin' }).where('id', '=', admin).execute();
});
afterAll(async () => {
  await db.deleteFrom('web_acquisition_controls').where('actor_id', '=', admin).execute();
  await db.deleteFrom('security_events').where('actor_id', 'in', [admin, signer]).execute();
  await fixtures.cleanup();
  await db.destroy();
  vi.useRealTimers();
});

it.each([
  'com',
  'co.uk',
  'https://example.com',
  'example.com:443',
  'example.com/path',
  'user@example.com',
  '-bad.test',
  'bad..test',
  '127.0.0.1',
])('refuses invalid stop scope %s', (domain) => {
  expect(() => acquisitionDomain(domain)).toThrow('bare registrable');
});
it('previews and authorizes stop/resume, propagating parent, IDNA and global stops', async () => {
  const input = { actor: email(admin), domain: 'BÜCHER.test.', reason: 'test-only' };
  expect(acquisitionDomain(input.domain)).toBe('xn--bcher-kva.test');
  await expect(
    setAcquisitionControl(db, { ...input, actor: email(signer), apply: true }),
  ).rejects.toThrow('admin user is required');
  expect(() => setAcquisitionControl(db, { ...input, reason: ' '.repeat(3) })).toThrow('Reason');
  expect(() => setAcquisitionControl(db, { ...input, reason: 'a'.repeat(256) })).toThrow('Reason');
  await setAcquisitionControl(db, input);
  expect(
    await db
      .selectFrom('web_acquisition_controls')
      .selectAll()
      .where('actor_id', '=', admin)
      .execute(),
  ).toEqual([]);
  expect(
    await db.selectFrom('security_events').select('id').where('actor_id', '=', admin).execute(),
  ).toEqual([]);
  await setAcquisitionControl(db, { ...input, apply: true });
  const url = new URL('https://shop.bücher.test/page');
  await expect(authorizeAcquisition(db, url)).rejects.toMatchObject({
    code: 'acquisition_unavailable',
  });
  await expect(authorizeAcquisition(db, new URL('https://other.test'))).resolves.toBeUndefined();
  await setAcquisitionControl(db, { ...input, resume: true, apply: true });
  await expect(authorizeAcquisition(db, url)).resolves.toBeUndefined();
  await setAcquisitionControl(db, { ...input, domain: '*', apply: true });
  await expect(authorizeAcquisition(db, url)).rejects.toMatchObject({
    code: 'acquisition_unavailable',
  });
  await setAcquisitionControl(db, { ...input, domain: '*', resume: true, apply: true });
  await expect(authorizeAcquisition(db, url)).resolves.toBeUndefined();
  expect(
    await db
      .selectFrom('security_events')
      .select('event')
      .where('actor_id', '=', admin)
      .where('event', '=', 'acquisition.control')
      .execute(),
  ).toHaveLength(4);
  await db.updateTable('users').set({ is_active: false }).where('id', '=', admin).execute();
  await expect(setAcquisitionControl(db, { ...input, apply: true })).rejects.toThrow(
    'admin user is required',
  );
  await db.updateTable('users').set({ is_active: true }).where('id', '=', admin).execute();
});
